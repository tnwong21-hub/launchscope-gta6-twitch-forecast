/**
 * LaunchScope / RAMQE-1.0.0 — offline competition entrypoint.
 *
 *   node /bot/main.ts              (Node 22, standard library only, no network)
 *
 * The grader runs one case per sandbox: it mounts that case at /input and reads
 * one forecast file from /output. For local replay we handle every *.in file in
 * $MAKEFUN_INPUT_DIR (else /input), in stable filename order, and emit exactly
 * one <id>.out per case into $MAKEFUN_OUTPUT_DIR (else /output).
 *
 * The scoring core is pure: no clock, no randomness, no network, and no I/O
 * beyond those two directories. Diagnostics go to stderr only, so stdout and
 * the output files remain machine-readable.
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

function diagnostics(...args: unknown[]): void {
  console.error('[launchscope]', ...args);
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

interface CaseRun {
  id: string;
  case: Case;
  text: string;
  bytes: number;
  hours: number;
}

/**
 * Parse, forecast and serialise one case.
 *
 * Input is untrusted: malformed JSON, missing fields and partial cases are all
 * expected. Any failure is reported on stderr and the case is SKIPPED — no
 * output file is written for it and no exception escapes to main. This keeps
 * the process exit status clean and guarantees that every file we do emit has
 * passed the exact graded contract.
 */
function runOne(filename: string): CaseRun | null {
  const path = join(INPUT_DIR, filename);
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) {
      diagnostics(`skip ${filename}: not a regular file or larger than ${MAX_INPUT_BYTES} bytes`);
      return null;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (err) {
      diagnostics(`skip ${filename}: malformed JSON (${(err as Error).message})`);
      return null;
    }

    const parsed = parseCase(raw, filename.replace(/\.in$/i, ''));
    if (!parsed.case) {
      diagnostics(`skip ${filename}: unusable case (${parsed.errors.join('; ')})`);
      return null;
    }
    const c = parsed.case;
    const text = serialize(forecast(c));
    // The graded contract is always the fixed 23 rows for hours 2..24,
    // independent of whatever a (possibly partial) input case claimed.
    const check = validateContract(text, defaultHours());
    if (!check.ok) {
      diagnostics(`skip ${filename}: contract violation (${check.errors.join('; ')})`);
      return null;
    }
    return { id: c.id, case: c, text, bytes: check.bytes, hours: c.forecast.length };
  } catch (err) {
    diagnostics(`skip ${filename}: unexpected error (${(err as Error).message})`);
    return null;
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
