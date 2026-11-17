import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NODE = process.env.LAUNCHSCOPE_NODE ?? '/opt/node-v22.23.4-linux-x64/bin/node';
const REPO = new URL('..', import.meta.url).pathname;
const KIT_INPUT = '/home/sentinelx/makefun-agent/bounties/gta6-twitch-ccu-forecast-01-workspace/kit/unpacked/gta6-twitch-ccu-forecast-01-kit/input';
const IDS = ['p00', 'p01', 'p02', 'p03'];

function runAll(inputDir, outDir, env = {}) {
  const t0 = performance.now();
  execFileSync(NODE, [join(REPO, 'main.ts')], {
    env: { ...process.env, MAKEFUN_INPUT_DIR: inputDir, MAKEFUN_OUTPUT_DIR: outDir, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return performance.now() - t0;
}

test('all-case run produces exactly four valid .out files', () => {
  const out = mkdtempSync(join(tmpdir(), 'ls-all-'));
  try {
    runAll(KIT_INPUT, out);
    assert.deepEqual(readdirSync(out).sort(), IDS.map((id) => `${id}.out`));
    for (const id of IDS) {
      const text = readFileSync(join(out, `${id}.out`), 'utf8');
      const obj = JSON.parse(text);
      assert.deepEqual(Object.keys(obj), ['hours']);
      assert.equal(obj.hours.length, 23);
      assert.ok(Buffer.byteLength(text, 'utf8') < 65536);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('deterministic replay: two independent runs write byte-identical outputs', () => {
  const a = mkdtempSync(join(tmpdir(), 'ls-a-'));
  const b = mkdtempSync(join(tmpdir(), 'ls-b-'));
  try {
    runAll(KIT_INPUT, a);
    runAll(KIT_INPUT, b);
    for (const id of IDS) {
      const ba = readFileSync(join(a, `${id}.out`));
      const bb = readFileSync(join(b, `${id}.out`));
      assert.ok(ba.equals(bb), `${id} differs between runs`);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('runtime and memory sanity: 4 cases finish well under the 8s/case cap', async () => {
  const out = mkdtempSync(join(tmpdir(), 'ls-timing-'));
  try {
    const ms = runAll(KIT_INPUT, out);
    assert.ok(ms < 8000, `4 cases took ${ms.toFixed(0)}ms (cap is 8000ms per case)`);
    const before = process.memoryUsage().heapUsed;
    // core-only memory sanity in-process
    const { parseCase } = await import('../src/case.ts');
    const { forecast } = await import('../src/model.ts');
    let sink = 0;
    for (let i = 0; i < 40; i++) {
      for (const id of IDS) {
        const c = parseCase(JSON.parse(readFileSync(`${KIT_INPUT}/${id}.in`, 'utf8')), id).case;
        sink += forecast(c).hours.length;
      }
    }
    const delta = process.memoryUsage().heapUsed - before;
    assert.equal(sink, 40 * IDS.length * 23);
    assert.ok(delta < 512 * 1024 * 1024, `heap grew ${(delta / 1e6).toFixed(0)}MB`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('malformed / missing / empty fields degrade safely without invalid output', () => {
  const inDir = mkdtempSync(join(tmpdir(), 'ls-edge-in-'));
  const out = mkdtempSync(join(tmpdir(), 'ls-edge-out-'));
  try {
    writeFileSync(join(inDir, 'broken.in'), '{not json');
    writeFileSync(join(inDir, 'empty.in'), '{}');
    writeFileSync(join(inDir, 'partial.in'), JSON.stringify({
      schema: 'makefun/twitch-ccu-case/v1', id: 'partial', levels: [0.05,0.25,0.5,0.75,0.95],
      day_start: '2020-01-01T00:00:00Z', known: [{ hour: 1, viewers: null }],
      forecast: [{ hour: 2 }], history: [], comparables: [], notes: '',
    }));
    runAll(inDir, out);
    // nothing invalid must be emitted
    for (const f of readdirSync(out)) {
      const text = readFileSync(join(out, f), 'utf8');
      const obj = JSON.parse(text);
      assert.deepEqual(Object.keys(obj), ['hours']);
      assert.equal(obj.hours.length, 23);
    }
  } finally {
    rmSync(inDir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('no-network guarantee: entrypoint source contains no network APIs', () => {
  const main = readFileSync(join(REPO, 'main.ts'), 'utf8');
  const srcs = readdirSync(join(REPO, 'src')).map((f) => readFileSync(join(REPO, 'src', f), 'utf8')).join('\n');
  for (const banned of ['fetch(', 'https.request', 'http.request', 'node:http', 'node:https', 'net.connect', 'child_process']) {
    assert.equal(main.includes(banned), false, `main.ts uses ${banned}`);
    assert.equal(srcs.includes(banned), false, `src uses ${banned}`);
  }
  void mkdirSync;
});
