/**
 * Shared types for the LaunchScope / RAMQE forecaster.
 *
 * These describe the official `makefun/twitch-ccu-case/v1` case shape and the
 * internal, richly-instrumented forecast object. The grader sees only the
 * compact `{hours:[{hour,q:[...]}]}` projection built in `contract.ts`.
 * All types here are structural; runtime validation lives in `case.ts`.
 */

// ---- Classification vocabularies -----------------------------------------

export type Tier = 'comparable' | 'early-access' | 'weak' | 'target-history' | 'unknown';
export type Regime = 'rolling' | 'simultaneous' | 'unknown';
export type PlatformFamily = 'console' | 'cross' | 'pc' | 'unknown';

// ---- Input shape ----------------------------------------------------------

export interface KnownRow {
  hour: number;
  from?: string;
  until?: string;
  viewers: number;
  channels?: number | null;
  reads?: number | null;
}

export interface ForecastRow {
  hour: number;
  from?: string;
  until?: string;
}

export interface HistoryPoint {
  at?: string;
  from?: string;
  viewers: number | null;
  channels?: number | null;
  reads?: number | null;
}

export interface ComparableHourly {
  from: string;
  viewers: number | null;
  channels?: number | null;
  reads?: number | null;
}

export interface Comparable {
  name: string;
  day_start: string;
  unlock: string;
  platforms: string;
  source: string;
  hourly: ComparableHourly[];
}

export interface StreamRow {
  login?: string;
  viewers?: number | null;
  language?: string;
  started_at?: string;
}

export interface CategoryHour {
  from: string;
  top: Array<{ name?: string; viewers?: number | null; channels?: number | null }>;
}

export interface Case {
  schema: string;
  id: string;
  game: { name: string; twitch_id: string };
  day_start: string;
  checkpoint: string;
  levels: number[];
  known: KnownRow[];
  forecast: ForecastRow[];
  history: HistoryPoint[];
  history_hourly: HistoryPoint[];
  streams: StreamRow[] | null;
  categories_hourly: CategoryHour[] | null;
  comparables: Comparable[];
  notes: string;
}

// ---- Derived structures ---------------------------------------------------

/** One extracted comparable release-day shape (see `curves.ts`). */
export interface ComparableCurve {
  name: string;
  tier: Tier;
  regime: Regime;
  v1: number;
  /** ratio[0] is hour 1 (always 1); ratio[h-1] is hour h, null when unsampled. */
  ratio: Array<number | null>;
  viewers: Array<number | null>;
  peakHour: number;
  peakRatio: number | null;
  preLevel: number | null;
  dayStartMs: number;
  /** log(hour1 / prelaunch level), null when the comparable has no prelaunch samples */
  logHeat: number | null;
  /** coarse platform class used by the compatibility ablation */
  platform: 'console' | 'cross' | 'pc' | 'unknown';
}

/** Diagnostics kept for the LIVE app; never written to the graded .out file. */
export interface ComparableWeight {
  name: string;
  tier: Tier;
  regime: Regime;
  weight: number;
  v1: number;
  peakHour: number;
  peakRatio: number | null;
}

export interface HourForecast {
  hour: number;
  /** five quantiles in LEVELS order: q05,q25,q50,q75,q95 */
  q: [number, number, number, number, number];
  /** median ratio to p1 (diagnostic) */
  medianRatio: number;
  /** cross-sectional log spread used to size the band (diagnostic) */
  logSpread: number;
  regime: Regime;
}

export interface ForecastResult {
  caseId: string;
  modelVersion: string;
  p1: number;
  regime: Regime;
  hours: HourForecast[];
  selected: ComparableWeight[];
  totalWeight: number;
  usedFallback: boolean;
  widthMultiplier: number;
  /** diagnostic: target hour-1 heat relative to its own prelaunch history */
  heat: number | null;
  /** number of analogues that survived weighting */
  nAnalogs: number;
  /** number of comparables removed by the strictly-prequential release-date gate */
  excludedFuture: number;
}
