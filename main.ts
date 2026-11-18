/**
 * LaunchScope / RAMQE-1.0.0 — offline competition entrypoint.
 *
 *   node /bot/main.ts              (Node 22, standard library only, no network)
 *
 * One case per sandbox: the grader mounts a case at /input and reads one
 * forecast file from /output. For local replay this program scans every *.in
 * file in $MAKEFUN_INPUT_DIR (default /input) in stable filename order and
 * writes one <id>.out per valid case into $MAKEFUN_OUTPUT_DIR (default /output).
 *
 * The scoring core is pure: no clock, no randomness, no network, and no I/O
 * beyond those two directories. Diagnostics are stderr-only so stdout and the
 * emitted files stay machine-readable.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCase } from './src/case.ts';
import { forecast } from './src/model.ts';
import { defaultHours, serialize, validateContract } from './src/contract.ts';
import { MODEL_VERSION } from './src/config.ts';
import type { Case } from './src/types.ts';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

interface CaseRun {
  id: string;
  text: string;
  bytes: number;
  hours: number;
}

function diagnostics(...args: unknown[]): void {
  console.error('[launchscope]', ...args);
}

/** Uniform skip report: a skipped case never produces an output file. */
function skip(filename: string, reason: string): null {
  diagnostics(`skip ${filename}: ${reason}`);
  return null;
}

/** Stable filename order makes a multi-case local replay deterministic. */
function inputFiles(dir: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.in')) continue;
    names.push(entry.name);
  }
  return names.sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Parse, forecast and validate one case.
 *
 * Input is untrusted: malformed JSON, missing fields and partial cases are
 * expected. Any failure is reported on stderr and the case is SKIPPED — no
 * output file is written and no exception escapes. This keeps the process exit
 * status clean and guarantees that every emitted file passed the exact graded
 * contract.
 */
function runOne(filename: string): CaseRun | null {
  const path = join(INPUT_DIR, filename);
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) {
      return skip(filename, `not a regular file or larger than ${MAX_INPUT_BYTES} bytes`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (err) {
      return skip(filename, `malformed JSON (${(err as Error).message})`);
    }

    const parsed = parseCase(raw, filename.replace(/\.in$/i, ''));
    if (!parsed.case) {
      return skip(filename, `unusable case (${parsed.errors.join('; ')})`);
    }
    const c: Case = parsed.case;

    const text = serialize(forecast(c));
    // The graded shape is always the fixed 23 rows for hours 2..24,
    // independent of what a (possibly partial) input case claimed.
    const check = validateContract(text, defaultHours());
    if (!check.ok) {
      return skip(filename, `contract violation (${check.errors.join('; ')})`);
    }
    return { id: c.id, text, bytes: check.bytes, hours: c.forecast.length };
  } catch (err) {
    return skip(filename, `unexpected error (${(err as Error).message})`);
  }
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = inputFiles(INPUT_DIR);
  if (files.length === 0) {
    diagnostics(`no *.in files found in ${INPUT_DIR}`);
    return;
  }
  for (const filename of files) {
    const run = runOne(filename);
    if (!run) continue;
    writeFileSync(join(OUTPUT_DIR, `${run.id}.out`), run.text, 'utf8');
    diagnostics(`wrote ${run.id}.out (${run.bytes} bytes, ${run.hours} hours, ${MODEL_VERSION})`);
  }
}

main();
