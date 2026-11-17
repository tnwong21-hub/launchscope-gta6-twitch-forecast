/**
 * Comparable release-day shape extraction.
 *
 * Every comparable carries a full hourly curve from day_start-14d to day_start+3d.
 * We align it to its own UTC day_start, take hour 1 (offset 0) as the anchor and
 * express hours 1..24 as ratios to that anchor. Free-text `unlock`/`platforms`
 * metadata is classified into a Tier and an unlock Regime with stable, explicit
 * rules; unknown text degrades to 'unknown' rather than being silently trusted.
 */
import type { Comparable, ComparableCurve, Regime, Tier } from './types.ts';

const HOUR_MS = 3_600_000;

export function classifyTier(unlock: string, name = ''): Tier {
  const t = `${unlock} ${name}`.toLowerCase();

  // 1) Explicit research tier label wins.
  const m = /tier:\s*([a-z-]+)/.exec(t);
  if (m) {
    const v = m[1];
    if (v === 'comparable') return 'comparable';
    if (v === 'weak') return 'weak';
    if (v === 'target-history' || v === 'target_history') return 'target-history';
    if (v.startsWith('early-access') || v === 'early') return 'early-access';
  }

  // 2) Target-category prelaunch history is never a launch analogue.
  if (/target.?history|before release|extended-look premiere/i.test(unlock)) return 'target-history';

  // 3) Weak launch archetypes.
  if (/live-service|free-to-play|f2p|slow-burn|not a paid analogue/i.test(unlock)) return 'weak';

  // 4) Early access: only an AFFIRMATIVE statement counts. "No early access" and
  //    "without early access" must NOT be read as contamination — this phrasing
  //    appears in the four practice launches' notes, which are clean analogues.
  const negated = /no early.access|without early.access|not early.access|no preload early/i.test(unlock);
  if (!negated && /early.access|early access|premium (edition )?(early|unlock)|deluxe.*early/i.test(unlock)) return 'early-access';

  // 5) A clean rolling/console single-player launch without an explicit label.
  if (/single-player|console-only|console only|rolling midnight|midnight local|no early access/i.test(unlock)) return 'comparable';

  return 'unknown';
}

export function classifyRegime(unlockOrNotes: string): Regime {
  const t = unlockOrNotes.toLowerCase();
  // "rolling midnight local" dominates Twitch audience even where PC is simultaneous.
  if (/midnight local|rolling/i.test(t)) return 'rolling';
  if (/simultaneous/i.test(t)) return 'simultaneous';
  return 'unknown';
}

/** Target regime from the case notes (all practice notes describe a rolling midnight unlock). */
export function targetRegime(notes: string): Regime {
  return classifyRegime(notes);
}

export function buildCurve(c: Comparable): ComparableCurve | null {
  const ds = Date.parse(c.day_start);
  if (!Number.isFinite(ds)) return null;
  const byOffset = new Map<number, number>();
  for (const p of c.hourly) {
    if (p.viewers === null || !Number.isFinite(p.viewers) || p.viewers < 0) continue;
    const t = Date.parse(p.from);
    if (!Number.isFinite(t)) continue;
    const off = Math.round((t - ds) / HOUR_MS);
    // keep first sample for an offset (data is oldest-first, so this is deterministic)
    if (!byOffset.has(off)) byOffset.set(off, p.viewers);
  }
  const v1 = byOffset.get(0);
  if (v1 === undefined || v1 <= 0) return null;

  const viewers: Array<number | null> = [];
  const ratio: Array<number | null> = [];
  for (let h = 1; h <= 24; h++) {
    const v = byOffset.get(h - 1);
    viewers.push(v === undefined ? null : v);
    ratio.push(v === undefined || v <= 0 ? null : v / v1);
  }

  let peakHour = 1;
  let peakRatio: number | null = null;
  let peakV = -1;
  for (let h = 0; h < 24; h++) {
    const v = viewers[h];
    if (v !== null && v > peakV) {
      peakV = v;
      peakHour = h + 1;
      peakRatio = ratio[h];
    }
  }

  // prelaunch level: up to 6 sampled hours in [-24,-1]
  const pre: number[] = [];
  for (let off = -1; off >= -24 && pre.length < 6; off--) {
    const v = byOffset.get(off);
    if (v !== undefined) pre.push(v);
  }
  const preLevel = pre.length ? pre.reduce((a, b) => a + b, 0) / pre.length : null;

  return {
    name: c.name,
    tier: classifyTier(c.unlock, c.name),
    regime: classifyRegime(c.unlock),
    v1,
    ratio,
    viewers,
    peakHour,
    peakRatio,
    preLevel,
    dayStartMs: ds,
  };
}

export function buildCurves(comparables: Comparable[]): ComparableCurve[] {
  const out: ComparableCurve[] = [];
  for (const c of comparables) {
    const curve = buildCurve(c);
    if (curve) out.push(curve);
  }
  // stable ordering, name as tie-break: identical inputs -> identical order
  out.sort((a, b) => a.dayStartMs - b.dayStartMs || a.name.localeCompare(b.name));
  return out;
}

/** Last up-to-N pre-checkpoint viewers from the case's own history (sparse-safe). */
export function prelaunchLevel(history: Array<{ at?: string; from?: string; viewers: number | null }>): number | null {
  const pts: Array<{ t: number; v: number }> = [];
  for (const p of history) {
    if (p.viewers === null || !Number.isFinite(p.viewers)) continue;
    const t = Date.parse(p.at ?? p.from ?? '');
    if (Number.isFinite(t)) pts.push({ t, v: p.viewers });
  }
  pts.sort((a, b) => a.t - b.t);
  const tail = pts.slice(-8);
  return tail.length ? tail.reduce((a, b) => a + b.v, 0) / tail.length : null;
}
