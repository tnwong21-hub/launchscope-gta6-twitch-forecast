/**
 * RAMQE — Regime-Aware Multi-Anchor Quantile Ensemble (core, deterministic).
 *
 * For the target case we observe only hour 1's print p1. For each comparable
 * launch we already know its whole release-day curve, so we express it as a
 * ratio to its own hour 1. The median forecast is a robust, weighted blend of
 * those ratio curves in log space. Weights combine tier quality, unlock-regime
 * match with the target and log-scale similarity of hour-1 counts. The band is
 * sized from the weighted cross-sectional dispersion of the same log ratios;
 * its global multiplier is calibrated out-of-fold by the backtest tool.
 *
 * The function is pure: no I/O, no clock, no randomness. Identical input and
 * config always produce identical bytes.
 */
import type { Case, ComparableCurve, ComparableWeight, ForecastResult, HourForecast, Regime } from './types.ts';
import { DEFAULT_CONFIG, LEVELS, MODEL_VERSION, Z, type ModelConfig } from './config.ts';
import { p1Of } from './case.ts';
import { buildCurves, targetRegime } from './curves.ts';

/** precise standard-normal quantiles at LEVELS (Z in config.ts is only the house baseline's coarse copy) */
const QNORM = [-1.6448536269514729, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514729];

type Pair = [number, number]; // [log-ratio, weight]

function weightedMean(pairs: Pair[]): number {
  let s = 0, w = 0;
  for (const [v, wt] of pairs) { s += v * wt; w += wt; }
  return w > 0 ? s / w : 0;
}

function weightedVar(pairs: Pair[]): number {
  const m = weightedMean(pairs);
  let s = 0, w = 0;
  for (const [v, wt] of pairs) { s += wt * (v - m) ** 2; w += wt; }
  return w > 0 ? s / w : 0;
}

/** Weighted quantile of value/weight pairs sorted ascending by value (linear-in-weight CDF). */
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

function comparableWeight(curve: ComparableCurve, p1: number, target: Regime, cfg: ModelConfig): number {
  const wTier = tierMultiplier(curve, cfg);
  if (wTier <= 0 || curve.v1 <= 0) return 0;
  const wRegime =
    target === 'unknown' || curve.regime === 'unknown'
      ? cfg.regimeUnknown
      : curve.regime === target
        ? cfg.regimeMatch
        : cfg.regimeMismatch;
  const d = (Math.log(curve.v1) - Math.log(p1)) / cfg.scaleSigma;
  const wScale = Math.exp(-0.5 * d * d);
  const w = wTier * wRegime * wScale;
  return Number.isFinite(w) && w >= cfg.minWeight ? w : 0;
}

function fallbackRow(hour: number, p1: number, cfg: ModelConfig): HourForecast {
  // Exactly the house persistence baseline: same z values and 2-decimal rounding.
  const s = cfg.fallbackSigma * Math.sqrt(Math.max(1, hour - 1));
  const p = Math.max(1, p1);
  const q = Z.map((z) => clampPos(Math.round(p * Math.exp(z * s) * 100) / 100)) as [number, number, number, number, number];
  return { hour, q, medianRatio: 1, logSpread: s, regime: 'unknown' };
}

function clampPos(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1e-6;
  return Math.min(x, 1e9);
}

export function forecast(c: Case, config: Partial<ModelConfig> = {}): ForecastResult {
  const cfg: ModelConfig = { ...DEFAULT_CONFIG, ...config };
  const p1 = p1Of(c);
  const regime = targetRegime(c.notes);
  const curves = buildCurves(c.comparables);

  const weighted: Array<{ curve: ComparableCurve; weight: number }> = [];
  let totalWeight = 0;
  for (const curve of curves) {
    const w = comparableWeight(curve, p1, regime, cfg);
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

    // pairs of (log ratio, weight) for comparables that actually sampled this hour
    const pairs: Pair[] = [];
    for (const { curve, weight } of weighted) {
      const r = curve.ratio[h - 1];
      if (r !== null && Number.isFinite(r) && r > 0) pairs.push([Math.log(r), weight]);
    }

    if (pairs.length === 0 || totalWeight <= 0) {
      hours.push(fallbackRow(h, p1, cfg));
      continue;
    }

    const center =
      cfg.medianBlend * weightedQuantile([...pairs].sort((a, b) => a[0] - b[0]), 0.5) +
      (1 - cfg.medianBlend) * weightedMean(pairs);

    let logSpread: number;
    if (cfg.quantileMethod === 'empirical') {
      logSpread = 0; // empirical path ignores the normal-size parameter
    } else {
      const raw = Math.sqrt(Math.max(0, weightedVar(pairs)));
      logSpread = Math.min(cfg.sigmaCap, Math.max(cfg.sigmaFloor, cfg.widthMultiplier * raw));
    }

    let logs: number[];
    if (cfg.quantileMethod === 'empirical') {
      const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
      logs = LEVELS.map((tau) => weightedQuantile(sorted, tau));
      // enforce a minimum non-zero width so a degenerate sample never gives zero-width bands
      const med = weightedQuantile(sorted, 0.5);
      logs = logs.map((v) => med + Math.max(-cfg.sigmaCap, Math.min(cfg.sigmaCap, v - med)));
    } else {
      logs = QNORM.map((z) => center + z * logSpread);
    }

    const q = logs.map((v) => clampPos(p1 * Math.exp(v))) as [number, number, number, number, number];
    // enforce monotone non-decreasing (numerical safety; theoretatically guaranteed)
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
  };
}

/** House-baseline forecast, used as a comparison anchor in the backtest tool. */
export function baselineQuantiles(p1: number, hour: number): [number, number, number, number, number] {
  const p = Math.max(1, p1);
  const s = 0.15 * Math.sqrt(Math.max(1, hour - 1));
  return Z.map((z) => Math.round(p * Math.exp(z * s) * 100) / 100) as [number, number, number, number, number];
}
