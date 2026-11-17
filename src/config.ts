/**
 * Versioned RAMQE configuration. Every numeric choice is explicit and auditable.
 * Ablations in the backtest tool override individual fields; the production
 * defaults here are the ones embedded in the final entrypoint.
 */

export const MODEL_VERSION = 'RAMQE-1.0.0';

/** Scored quantile levels, fixed by the competition. */
export const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95] as const;

/** Standard-normal quantiles at LEVELS (used only for the fallback baseline). */
export const Z = [-1.645, -0.674, 0, 0.674, 1.645] as const;

export interface ModelConfig {
  /** Multiplier on the empirical cross-sectional log spread when sizing bands. */
  widthMultiplier: number;
  /** Minimum log-space half-width for any hour (guards zero-width bands). */
  sigmaFloor: number;
  /** Cap on log-space half-width (guards absurd bands from outlier curves). */
  sigmaCap: number;
  /** Weight multipliers by comparable tier. */
  tierWeight: { comparable: number; weak: number; early_access: number; target_history: number; unknown: number };
  /** Weight for a comparables whose unlock regime matches / differs from the target. */
  regimeMatch: number;
  regimeMismatch: number;
  regimeUnknown: number;
  /** Log-space gaussian kernel bandwidth for scale similarity (natural-log units). */
  scaleSigma: number;
  /** Weight floor/zero threshold: comparables below this are dropped. */
  minWeight: number;
  /** Blend between weighted median (w) and weighted mean (1-w) of log ratios. */
  medianBlend: number;
  /** 'normal' = median +/- z*sigma; 'empirical' = weighted quantile of comparable log ratios. */
  quantileMethod: 'normal' | 'empirical';
  /** House baseline sigma, used only when no usable comparable curve exists. */
  fallbackSigma: number;
}

export const DEFAULT_CONFIG: ModelConfig = {
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
};
