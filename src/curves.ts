/**
 * Comparable release-day shape extraction (RAMQE-1.0.0).
 *
 * Every comparable carries an hourly curve from day_start-14d to day_start+3d.
 * We align it to its own UTC day_start, take hour 1 (offset 0) as the anchor and
 * express hours 1..24 as ratios to that anchor. Free-text unlock/platform
 * metadata is classified into a Tier, an unlock Regime and a platform family
 * with explicit, stable rules; unknown text degrades to 'unknown' rather than
 * being silently trusted.
 *
 * `logHeat` = log(hour1 / prelaunch level) is a diagnostic feature. It is
 * computed only from information available at the checkpoint (the comparable's
 * own hour-1 print and its pre-release hours), so it never leaks a withheld
 * target. It does NOT affect the shipped weights (heatMix = 0 by default).
 */
import type { Comparable, ComparableCurve, Regime, Tier, PlatformFamily } from './types.ts';

const HOUR_MS = 3_600_000;

export function classifyTier(unlock: string, name = ''): Tier {
  const t = `${unlock} ${name}`.toLowerCase();
  const m = /tier:\s*([a-z-]+)/.exec(t);
  if (m) {
    const v = m[1];
    if (v === 'comparable') return 'comparable';
    if (v === 'weak') return 'weak';
    if (v === 'target-history' || v === 'target_history') return 'target-history';
    if (v.startsWith('early-access') || v === 'early') return 'early-access';
  }
  if (/target.?history|before release|extended-look premiere/i.test(unlock)) return 'target-history';
  if (/live-service|free-to-play|f2p|slow-burn|not a paid analogue/i.test(unlock)) return 'weak';
  // A negation ("no early access") must not be read as contamination.
  const negated = /no early.access|without early.access|not early.access|no preload early/i.test(unlock);
  if (!negated && /early.access|premium (edition )?(early|unlock)|deluxe.*early/i.test(unlock)) return 'early-access';
  if (/single-player|console-only|console only|rolling midnight|midnight local|no early access/i.test(unlock)) return 'comparable';
  return 'unknown';
}

export function classifyRegime(unlockOrNotes: string): Regime {
  const t = unlockOrNotes.toLowerCase();
  if (/midnight local|rolling/i.test(t)) return 'rolling';
  if (/simultaneous/i.test(t)) return 'simultaneous';
  return 'unknown';
}

export function targetRegime(notes: string): Regime {
  return classifyRegime(notes);
}

/** Coarse platform family from the free-text `platforms` field. */
export function classifyPlatform(platforms: string, unlock = ''): PlatformFamily {
  const t = `${platforms} ${unlock}`.toLowerCase();
  if (/free-to-play|f2p/.test(t)) return 'f2p';
  const pc = /pc|steam|epic|gog|stadia/.test(t);
  const console = /ps[45]|playstation|xbox|switch/.test(t);
  if (pc && console) return 'cross';
  if (pc) return 'pc';
  if (console) return 'console';
  return 'unknown';
}

/** Median of a numeric list; null for an empty list. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** log(hour1 / prelaunch level), finite or null; clamps pathological ratios. */
export function audienceHeat(v1: number, preLevel: number | null): number | null {
  if (!(v1 > 0) || preLevel === null || !(preLevel > 0)) return null;
  const h = Math.log(v1 / preLevel);
  return Number.isFinite(h) ? Math.max(-4, Math.min(4, h)) : null;
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
    if (!byOffset.has(off)) byOffset.set(off, p.viewers); // first sample wins, deterministically
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

  // prelaunch level: up to 6 sampled hours in [-24,-1], median for robustness
  const pre: number[] = [];
  for (let off = -1; off >= -24 && pre.length < 8; off--) {
    const v = byOffset.get(off);
    if (v !== undefined) pre.push(v);
  }
  const preLevel = median(pre.slice(0, 6));

  return {
    name: c.name,
    tier: classifyTier(c.unlock, c.name),
    regime: classifyRegime(c.unlock),
    platform: classifyPlatform(c.platforms, c.unlock),
    v1,
    ratio,
    viewers,
    peakHour,
    peakRatio,
    preLevel,
    logHeat: audienceHeat(v1, preLevel),
    dayStartMs: ds,
  };
}

export function buildCurves(comparables: Comparable[]): ComparableCurve[] {
  const out: ComparableCurve[] = [];
  for (const c of comparables) {
    const curve = buildCurve(c);
    if (curve) out.push(curve);
  }
  out.sort((a, b) => a.dayStartMs - b.dayStartMs || a.name.localeCompare(b.name));
  return out;
}

/**
 * Last up-to-N pre-checkpoint viewers from the case's own history (sparse safe).
 * Used only for the target's heat diagnostic — never as a training label.
 */
export function prelaunchLevel(history: Array<{ at?: string; from?: string; viewers: number | null }>, n = 8): number | null {
  const pts: Array<{ t: number; v: number }> = [];
  for (const p of history) {
    if (p.viewers === null || !Number.isFinite(p.viewers)) continue;
    const t = Date.parse(p.at ?? p.from ?? '');
    if (Number.isFinite(t)) pts.push({ t, v: p.viewers });
  }
  pts.sort((a, b) => a.t - b.t);
  return median(pts.slice(-n).map((p) => p.v));
}
