/**
 * Output serialization + strict contract validation (RULES.txt "Your forecast").
 * The exact JSON shape is produced here and nowhere else.
 */
import type { ForecastResult } from './types.ts';

export interface ContractCheck {
  ok: boolean;
  errors: string[];
  bytes: number;
  text: string;
}

/** Project the rich internal result into the exact graded object and JSON text. */
export function serialize(result: ForecastResult): string {
  const hours = result.hours.map((r) => ({ hour: r.hour, q: r.q }));
  return `${JSON.stringify({ hours })}\n`;
}

/** Validate a serialized output string against the full grader contract. */
export function validateContract(text: string, expectedHours: number[] = defaultHours()): ContractCheck {
  const errors: string[] = [];
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > 65536) errors.push(`output too large: ${bytes} > 65536 bytes`);
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    errors.push(`not JSON: ${(e as Error).message}`);
    return { ok: false, errors, bytes, text };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    errors.push('top level is not an object');
    return { ok: false, errors, bytes, text };
  }
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1 || keys[0] !== 'hours') errors.push(`top-level keys must be exactly ['hours'], got ${JSON.stringify(keys)}`);
  if (!Array.isArray(o.hours)) {
    errors.push('hours is not an array');
    return { ok: false, errors, bytes, text };
  }
  if (o.hours.length !== expectedHours.length) errors.push(`expected ${expectedHours.length} rows, got ${o.hours.length}`);
  const seen = new Set<number>();
  for (let i = 0; i < o.hours.length; i++) {
    const row = o.hours[i];
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      errors.push(`row ${i} is not an object`);
      continue;
    }
    const r = row as Record<string, unknown>;
    const rk = Object.keys(r);
    if (rk.length !== 2 || !rk.includes('hour') || !rk.includes('q')) errors.push(`row ${i} keys must be exactly hour,q; got ${JSON.stringify(rk)}`);
    const h = r.hour;
    if (typeof h !== 'number' || !Number.isInteger(h)) errors.push(`row ${i} hour is not an integer`);
    else {
      seen.add(h);
      if (!expectedHours.includes(h)) errors.push(`row ${i} hour ${h} outside 2..24`);
    }
    if (!Array.isArray(r.q) || r.q.length !== 5) {
      errors.push(`row ${i} q must have 5 numbers`);
      continue;
    }
    let prev = -Infinity;
    for (let j = 0; j < 5; j++) {
      const v = r.q[j];
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`row ${i} q[${j}] not finite`);
      else {
        if (!(v > 0)) errors.push(`row ${i} q[${j}] <= 0`);
        if (v > 1e9) errors.push(`row ${i} q[${j}] > 1e9`);
        if (v < prev) errors.push(`row ${i} q[${j}] < previous quantile`);
        prev = v;
      }
    }
  }
  for (const h of expectedHours) if (!seen.has(h)) errors.push(`missing hour ${h}`);
  return { ok: errors.length === 0, errors, bytes, text };
}

export function defaultHours(): number[] {
  return Array.from({ length: 23 }, (_, i) => i + 2);
}
