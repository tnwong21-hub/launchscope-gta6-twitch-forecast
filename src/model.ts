/**
 * RAMQE-1.0.0 — Regime-Aware Multi-Anchor Quantile Ensemble (pure core).
 *
 * The shipped production algorithm is the PUBLISHED v1 model. The target case
 * reveals only hour 1's print p1. Every comparable supplies a full release-day
 * curve, normalised to its own hour 1 as r_c(h). The median forecast is a
 * robust weighted blend of those log ratios; the band is sized from the
 * weighted cross-sectional dispersion at each hour. Weights combine tier
 * quality, unlock-regime match and log-scale similarity of hour-1 counts.
 *
 * The leakage-safe LOCO backtest reproduces the published score (0.395114 all,
 * 0.251989 rolling) with these defaults. A separate strictly prequential
 * temporal holdout sets an explicit per-pseudo-case date gate; that gate is
 * NEVER enabled in production (maxDayStartMs = Infinity).
 *
 * Three v2 ideas were added and ablation-tested in `tools/backtest.ts`, then
 * REJECTED because they regressed the leakage-safe holdout: production
 * release-date gating, hour-1 audience-heat similarity and log-ratio clipping.
 * They survive only as opt-in switches, all OFF by default. Audience heat
 * remains a diagnostic field only.
 *
 * No clock, no randomness, no I/O: identical input + config -> identical bytes.
 */
import type { Case, ComparableCurve, ComparableWeight, ForecastResult, HourForecast, Regime } from './types.ts';
import { DEFAULT_CONFIG, LEVELS, MODEL_VERSION, QNORM, Z, type ModelConfig } from './config.ts';
import { audienceHeat, buildCurves, prelaunchLevel, targetRegime } from './curves.ts';
import { p1Of } from './case.ts';

/** A log-ratio and its analogue weight. */
type Pair = [number, number];

function weightedMean(pairs: Pair[]): number {
  let s = 0;
  let w = 0;
  for (const [v, wt] of pairs) {
    s += v * wt;
    w += wt;
  }
  return w > 0 ? s / w : 0;
}

function weightedVar(pairs: Pair[]): number {
  const m = weightedMean(pairs);
  let s = 0;
  let w = 0;
  for (const [v, wt] of pairs) {
    s += wt * (v - m) ** 2;
    w += wt;
  }
  return w > 0 ? s / w : 0;
}

/** Weighted quantile of value/weight pairs sorted ascending by value. */
export function weightedQuantile(sorted: Pair[], tau: number): number {
  if (sorted.length === 0) return NaN;
  let total = 0;
  for (const [, wt] of sorted) total += wt;
  if (total <= 0) return sorted[0][0];
  const target = Math.min(Math.max(tau, 0), 1) * total;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i][1];
    if (acc >= target) return sorted[i][0];
  }
  return sorted[sorted.length - 1][0];
}

function tierMultiplier(curve: ComparableCurve, cfg: ModelConfig): number {
  switch (curve.tier) {
    case 'comparable': return cfg.tierWeight.comparable;
    case 'weak': return cfg.tierWeight.weak;
    case 'early-access': return cfg.tierWeight.early_access;
    case 'target-history': return cfg.tierWeight.target_history;
    default: return cfg.tierWeight.unknown;
  }
}

/** Product of tier, release-regime, scale and (optionally) heat/platform factors. */
export function analogueWeight(
  curve: ComparableCurve,
  p1: number,
  target: Regime,
  targetLogHeat: number | null,
  cfg: ModelConfig,
): number {
  const wTier = tierMultiplier(curve, cfg);
  if (wTier <= 0 || !(curve.v1 > 0)) return 0;

  const wRegime =
    target === 'unknown' || curve.regime === 'unknown'
      ? cfg.regimeUnknown
      : curve.regime === target ? cfg.regimeMatch : cfg.regimeMismatch;

  const d = (Math.log(curve.v1) - Math.log(p1)) / cfg.scaleSigma;
  const wScale = Math.exp(-0.5 * d * d);

  /*
   * Heat is OPTIONAL and diagnostic by default (heatMix = 0). A missing or
   * non-finite heat value MUST degrade to a NEUTRAL factor of 1, never to NaN
   * or zero: a NaN weight here would zero out every comparable, drop total
   * weight to 0 and silently collapse the forecast onto the house baseline.
   */
  let wHeat = 1;
  if (cfg.heatMix > 0 && cfg.heatSigma > 0 &&
      Number.isFinite(targetLogHeat) && Number.isFinite(curve.logHeat)) {
    const dh = (curve.logHeat - targetLogHeat) / cfg.heatSigma;
    const factor = Math.exp(-0.5 * dh * dh);
    if (Number.isFinite(factor)) {
      const blended = (1 - cfg.heatMix) + cfg.heatMix * factor;
      if (Number.isFinite(blended) && blended > 0) wHeat = blended;
    }
  }

  let wPlatform = 1;
  if (cfg.platformMix > 0 && cfg.platformMix <= 1) {
    // Target is a console single-player release (GTA VI): PS/Xbox-only is
    // closest, cross-platform next, PC-first weakest.
    const affinity: Record<ComparableCurve['platform'], number> = {
      console: 1, cross: 0.75, pc: 0.45, unknown: 0.6,
    };
    const aff = affinity[curve.platform];
    if (Number.isFinite(aff)) {
      const blended = (1 - cfg.platformMix) + cfg.platformMix * aff;
      if (Number.isFinite(blended) && blended > 0) wPlatform = blended;
    }
  }

  // Explicit neutrality guard: optional factors are exactly 1 unless their
  // switch is on and the supporting diagnostic is finite. No edge case may
  // turn a usable comparable into NaN and trigger the zero-weight fallback.
  if (!Number.isFinite(wHeat)) wHeat = 1;
  if (!Number.isFinite(wPlatform)) wPlatform = 1;

  const w = wTier * wRegime * wScale * wHeat * wPlatform;
  // Non-finite weights are dropped individually, never allowed to poison the
  // aggregate; a final minWeight floor keeps tiny numerical dust out.
  return Number.isFinite(w) && w >= cfg.minWeight ? w : 0;
}

function clampPos(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1e-6;
  return Math.min(x, 1e9);
}

function fallbackRow(hour: number, p1: number, cfg: ModelConfig): HourForecast {
  // Exactly the house persistence baseline: same z values and 2-decimal rounding.
  const s = cfg.fallbackSigma * Math.sqrt(Math.max(1, hour - 1));
  const p = Math.max(1, p1);
  const q = Z.map((z) => clampPos(Math.round(p * Math.exp(z * s) * 100) / 100)) as [number, number, number, number, number];
  return { hour, q, medianRatio: 1, logSpread: s, regime: 'unknown' };
}

/** House/starter persistence baseline (RULES.txt, "Baseline and prizes"). */
export function baselineQuantiles(p1: number, hour: number): [number, number, number, number, number] {
  const p = Math.max(1, p1);
  const s = 0.15 * Math.sqrt(Math.max(1, hour - 1));
  return Z.map((z) => Math.round(p * Math.exp(z * s) * 100) / 100) as [number, number, number, number, number];
}

/** Collect finite, positive log ratios for one forecast hour. */
function hourPairs(
  weighted: Array<{ curve: ComparableCurve; weight: number }>,
  hour: number,
  clip: number,
): Pair[] {
  const pairs: Pair[] = [];
  for (const { curve, weight } of weighted) {
    const r = curve.ratio[hour - 1];
    if (r !== null && Number.isFinite(r) && r > 0) {
      // Robust log-space clipping tames 100x+ late-unlock comparables.
      const lr = Math.log(r);
      pairs.push([Math.max(-clip, Math.min(clip, lr)), weight]);
    }
  }
  return pairs;
}

export function forecast(c: Case, config: Partial<ModelConfig> = {}): ForecastResult {
  const cfg: ModelConfig = { ...DEFAULT_CONFIG, ...config };
  const p1 = p1Of(c);
  const regime = targetRegime(c.notes);
  const targetDayMs = Date.parse(c.day_start);
  const clip = cfg.logRatioClip;

  // The target's heat is derived solely from its own pre-checkpoint history.
  const preTarget = prelaunchLevel([...c.history_hourly, ...c.history], 8);
  const targetLogHeat = audienceHeat(p1, preTarget);

  const all = buildCurves(c.comparables);
  // STRICT TIMELINE GATE: never train on a comparable released after the target.
  const cutoff = cfg.maxDayStartMs ?? (Number.isFinite(targetDayMs) ? targetDayMs : null);
  const usable = cutoff === null ? all : all.filter((curve) => curve.dayStartMs < cutoff);
  const excludedFuture = all.length - usable.length;

  const weighted: Array<{ curve: ComparableCurve; weight: number }> = [];
  let totalWeight = 0;
  for (const curve of usable) {
    const w = analogueWeight(curve, p1, regime, targetLogHeat, cfg);
    if (w > 0) {
      weighted.push({ curve, weight: w });
      totalWeight += w;
    }
  }

  const selected: ComparableWeight[] = weighted
    .map(({ curve, weight }) => ({
      name: curve.name,
      tier: curve.tier,
      regime: curve.regime,
      weight,
      v1: curve.v1,
      peakHour: curve.peakHour,
      peakRatio: curve.peakRatio,
    }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

  const hours: HourForecast[] = [];
  for (const row of c.forecast) {
    const h = row.hour;
    if (!Number.isFinite(h) || h < 2 || h > 24) continue;

    const pairs = hourPairs(weighted, h, clip);
    if (pairs.length === 0 || totalWeight <= 0) {
      hours.push(fallbackRow(h, p1, cfg));
      continue;
    }

    const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
    const center =
      cfg.medianBlend * weightedQuantile(sorted, 0.5) +
      (1 - cfg.medianBlend) * weightedMean(pairs);

    let logSpread: number;
    if (cfg.quantileMethod === 'empirical') {
      logSpread = 0;
    } else {
      const raw = Math.sqrt(Math.max(0, weightedVar(pairs)));
      logSpread = Math.min(cfg.sigmaCap, Math.max(cfg.sigmaFloor, cfg.widthMultiplier * raw));
    }

    let logs: number[];
    if (cfg.quantileMethod === 'empirical') {
      logs = LEVELS.map((tau) => weightedQuantile(sorted, tau));
      const med = weightedQuantile(sorted, 0.5);
      logs = logs.map((v) => med + Math.max(-cfg.sigmaCap, Math.min(cfg.sigmaCap, v - med)));
    } else {
      logs = QNORM.map((z) => center + z * logSpread);
    }

    const q = logs.map((v) => clampPos(p1 * Math.exp(v))) as [number, number, number, number, number];
    for (let i = 1; i < q.length; i++) if (q[i] < q[i - 1]) q[i] = q[i - 1];
    hours.push({ hour: h, q, medianRatio: Math.exp(center), logSpread, regime });
  }

  hours.sort((a, b) => a.hour - b.hour);
  return {
    caseId: c.id,
    modelVersion: MODEL_VERSION,
    p1,
    regime,
    hours,
    selected,
    totalWeight,
    usedFallback: totalWeight <= 0,
    widthMultiplier: cfg.widthMultiplier,
    heat: targetLogHeat,
    nAnalogs: weighted.length,
    excludedFuture,
  };
}
