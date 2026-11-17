/**
 * LaunchScope / RAMQE — offline competition entrypoint.
 *
 *   node /bot/main.ts              (Node 22, standard library only, no network)
 *
 * Reads every *.in in $MAKEFUN_INPUT_DIR (else /input) in filename order and
 * writes exactly one <id>.out per case to $MAKEFUN_OUTPUT_DIR (else /output).
 * Pure core: no clock, no randomness, no I/O beyond those two directories.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCase } from './src/case.ts';
import { forecast } from './src/model.ts';
import { serialize, validateContract, defaultHours } from './src/contract.ts';
import { MODEL_VERSION } from './src/config.ts';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

function diagnostics(...args: unknown[]): void {
  // stderr only — stdout stays clean for harness wrappers
  console.error('[ramqe]', ...args);
}

function run(): void {
  let files: string[];
  try {
    files = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
  } catch (e) {
    diagnostics(`cannot read input dir ${INPUT_DIR}:`, (e as Error).message);
    return;
  }

  if (files.length === 0) {
    diagnostics(`no *.in files in ${INPUT_DIR}`);
    return;
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const file of files) {
    const id = file.slice(0, -'.in'.length);
    try {
      const path = join(INPUT_DIR, file);
      const st = statSync(path);
      if (!st.isFile() || st.size > MAX_INPUT_BYTES) {
        diagnostics(`${file}: not a regular file or too large (${st.size} bytes)`);
        continue;
      }
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      const parsed = parseCase(raw, id);
      if (!parsed.ok || !parsed.case) {
        diagnostics(`${file}: invalid case — ${parsed.errors.join('; ')}`);
        continue;
      }
      const result = forecast(parsed.case);
      const text = serialize(result);
      const check = validateContract(text, defaultHours());
      if (!check.ok) {
        diagnostics(`${file}: output failed contract — ${check.errors.join('; ')}`);
        continue;
      }
      writeFileSync(join(OUTPUT_DIR, `${id}.out`), text, 'utf8');
    } catch (e) {
      diagnostics(`${file}: error — ${(e as Error).message}`);
      // never emit a partial/invalid output file
      continue;
    }
  }
}

run();

// keep the version symbol live for transcript/authorship traceability
void MODEL_VERSION;
