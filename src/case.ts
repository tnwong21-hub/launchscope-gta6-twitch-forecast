/**
 * Defensive case parsing and validation.
 *
 * The competition input is untrusted JSON. We never throw on a missing/odd
 * optional field: `num` maps anything non-finite to null and the model degrades
 * through explicit fallbacks. Only a fundamentally unusable case (no schema,
 * no hour-1 print, no forecast rows) is rejected, and `main.ts` logs that to
 * stderr without emitting an invalid output file.
 */
import type { Case, Comparable, ComparableHourly, HistoryPoint, KnownRow, StreamRow, CategoryHour } from './types.ts';
import { LEVELS } from './config.ts';

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** finite number, or null for anything missing/malformed/non-finite */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** non-negative finite viewer count, or null */
export function count(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function parseKnown(v: unknown): KnownRow[] {
  if (!Array.isArray(v)) return [];
  const out: KnownRow[] = [];
  for (const r of v) {
    if (!isRecord(r)) continue;
    const viewers = num(r.viewers);
    if (viewers === null) continue;
    out.push({
      hour: num(r.hour) ?? 0,
      from: str(r.from),
      until: str(r.until),
      viewers,
      channels: num(r.channels),
      reads: num(r.reads),
    });
  }
  return out;
}

function parseForecast(v: unknown): Array<{ hour: number; from?: string; until?: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ hour: number; from?: string; until?: string }> = [];
  for (const r of v) {
    if (!isRecord(r)) continue;
    const hour = num(r.hour);
    if (hour === null) continue;
    out.push({ hour, from: str(r.from), until: str(r.until) });
  }
  return out;
}

function parseHistory(v: unknown): HistoryPoint[] {
  if (!Array.isArray(v)) return [];
  const out: HistoryPoint[] = [];
  for (const r of v) {
    if (!isRecord(r)) continue;
    out.push({
      at: str(r.at),
      from: str(r.from),
      viewers: count(r.viewers),
      channels: num(r.channels),
      reads: num(r.reads),
    });
  }
  return out;
}

function parseHourly(v: unknown): ComparableHourly[] {
  if (!Array.isArray(v)) return [];
  const out: ComparableHourly[] = [];
  for (const r of v) {
    if (!isRecord(r)) continue;
    const from = str(r.from);
    if (!from) continue;
    out.push({ from, viewers: count(r.viewers), channels: num(r.channels), reads: num(r.reads) });
  }
  return out;
}

function parseComparables(v: unknown): Comparable[] {
  if (!Array.isArray(v)) return [];
  const out: Comparable[] = [];
  for (const r of v) {
    if (!isRecord(r)) continue;
    const name = str(r.name);
    const dayStart = str(r.day_start);
    if (!name || !dayStart || !Number.isFinite(Date.parse(dayStart))) continue;
    out.push({
      name,
      day_start: dayStart,
      unlock: str(r.unlock),
      platforms: str(r.platforms),
      source: str(r.source),
      hourly: parseHourly(r.hourly),
    });
  }
  return out;
}

function parseStreams(v: unknown): StreamRow[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isRecord).map((r) => ({
    login: str(r.login),
    viewers: num(r.viewers),
    language: str(r.language),
    started_at: str(r.started_at),
  }));
}

function parseCategories(v: unknown): CategoryHour[] | null {
  if (!Array.isArray(v)) return null;
  const out: CategoryHour[] = [];
  for (const r of v) {
    if (!isRecord(r)) continue;
    const top = Array.isArray(r.top)
      ? r.top.filter(isRecord).map((t) => ({ name: str(t.name), viewers: num(t.viewers), channels: num(t.channels) }))
      : [];
    out.push({ from: str(r.from), top });
  }
  return out;
}

export interface ParseResult {
  ok: boolean;
  case?: Case;
  errors: string[];
}

export function parseCase(raw: unknown, idHint = ''): ParseResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['top-level JSON is not an object'] };

  const levels = Array.isArray(raw.levels) ? raw.levels.map(num) : [];
  if (levels.length !== 5 || levels.some((t, i) => t !== LEVELS[i])) {
    errors.push(`levels must be ${JSON.stringify(LEVELS)}, got ${JSON.stringify(raw.levels)}`);
  }

  const known = parseKnown(raw.known);
  if (!known.some((k) => k.hour === 1)) errors.push('no hour-1 print in known');

  const forecast = parseForecast(raw.forecast);
  if (forecast.length === 0) errors.push('no forecast rows');

  const dayStart = str(raw.day_start);
  if (!dayStart || !Number.isFinite(Date.parse(dayStart))) errors.push('invalid day_start');

  if (errors.length) return { ok: false, errors };

  const c: Case = {
    schema: str(raw.schema, 'makefun/twitch-ccu-case/v1'),
    id: str(raw.id, idHint),
    game: {
      name: isRecord(raw.game) ? str(raw.game.name) : '',
      twitch_id: isRecord(raw.game) ? str(raw.game.twitch_id) : '',
    },
    day_start: dayStart,
    checkpoint: str(raw.checkpoint),
    levels: levels as number[],
    known,
    forecast,
    history: parseHistory(raw.history),
    history_hourly: parseHistory(raw.history_hourly),
    streams: parseStreams(raw.streams),
    categories_hourly: parseCategories(raw.categories_hourly),
    comparables: parseComparables(raw.comparables),
    notes: str(raw.notes),
  };
  return { ok: true, case: c, errors: [] };
}

export function p1Of(c: Case): number {
  const k = c.known.find((r) => r.hour === 1);
  const v = k ? num(k.viewers) : null;
  return v !== null && v > 0 ? v : 1;
}
