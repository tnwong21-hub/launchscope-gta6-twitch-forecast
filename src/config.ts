/**
 * Versioned RAMQE configuration. Every numeric choice is explicit so the
 * backtest tool can ablate one field at a time and the shipped entry can be
 * audited field by field. Production defaults are embedded in the entrypoint.
 *
 * The shipped production defaults below are the PUBLISHED v1 values. On the
 * exact leakage-safe LOCO backtest they reproduce the published 0.395114
 * (all 37) / 0.251989 (rolling 11). The v2 additions (log-ratio clipping,
 * heat and platform similarity, release-date gate) are retained ONLY as
 * opt-in ablation switches: every one of them was measured to be neutral or
 * harmful on the leakage-safe holdout, so all of them are OFF by default.
 */
export const MODEL_VERSION = 'RAMQE-1.0.0';

/** Scored quantile levels, fixed by the competition (RULES.txt "Your forecast"). */
export const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95] as const;

/** Standard-normal quantiles at LEVELS, used by the house persistence baseline. */
export const Z = [-1.645, -0.674, 0, 0.674, 1.645] as const;

/** Precise normal quantiles at LEVELS, used for the model's symmetric band. */
export const QNORM = [
  -1.6448536269514729, -0.6744897501960817, 0,
  0.6744897501960817, 1.6448536269514729,
] as const;

export interface ModelConfig {
  /** Multiplier on weighted cross-sectional log dispersion when sizing the band. */
  widthMultiplier: number;
  /** Minimum log-space half-width (guards a degenerate, zero-width band). */
  sigmaFloor: number;
  /** Maximum log-space half-width (guards absurd bands from outlier curves). */
  sigmaCap: number;
  /** Tier multipliers: clean rolling AAA first, weak/early-access last. */
  tierWeight: { comparable: number; weak: number; early_access: number; target_history: number; unknown: number };
  /** Unlock-regime multipliers relative to the target case. */
  regimeMatch: number;
  regimeMismatch: number;
  regimeUnknown: number;
  /** Log-scale kernel bandwidth for hour-1 audience-size similarity. */
  scaleSigma: number;
  /** Drop comparables whose final weight is below this floor. */
  minWeight: number;
  /** Blend between weighted median (w) and weighted mean (1-w) of log ratios. */
  medianBlend: number;
  /** 'normal' = centre +/- z*sigma; 'empirical' = weighted quantile of analogues. */
  quantileMethod: 'normal' | 'empirical';
  /** House baseline sigma, used only when no comparable curve is usable. */
  fallbackSigma: number;

  /*
   * v2 ABLATION SWITCHES — OFF in production. They exist only so
   * tools/backtest.ts can measure them under the exact leakage-safe protocol.
   * None is enabled in the shipped default config.
   */
  /** Clip each analogue's log ratio to +/- this many log units; Infinity = off. */
  logRatioClip: number;
  /** Broad heat-similarity mix (0 = off). Controlled ablation only. */
  heatMix: number;
  heatSigma: number;
  /** Optional platform-match multiplier (0 = off). Controlled ablation only. */
  platformMix: number;
  /**
   * Release-date gate: exclude comparables released strictly after this ms.
   * Infinity = off (published behaviour). The temporal backtest sets it per
   * pseudo-case; it is never enabled in the shipped default config.
   */
  maxDayStartMs: number | null;
}

export const DEFAULT_CONFIG: ModelConfig = {
  // Published v1 production values (unchanged from the shipped baseline).
  widthMultiplier: 1.0,
  sigmaFloor: 0.10,
  sigmaCap: 1.50,
  tierWeight: { comparable: 1.0, weak: 0.25, early_access: 0.12, target_history: 0, unknown: 0.4 },
  regimeMatch: 1.0,
  regimeMismatch: 0.4,
  regimeUnknown: 0.6,
  scaleSigma: 1.2,
  minWeight: 1e-4,
  medianBlend: 0.6,
  quantileMethod: 'normal',
  fallbackSigma: 0.15,
  // v2 ablations — OFF by default.
  logRatioClip: Infinity,
  heatMix: 0,
  heatSigma: 1.5,
  platformMix: 0,
  maxDayStartMs: Infinity,
};
