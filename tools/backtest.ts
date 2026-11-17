/**
 * Independent, leakage-safe backtest for RAMQE.
 *
 * Each of the 38 comparables becomes a pseudo-case: we cut it at its own
 * hour 1, hide hours 2..24, and forecast from the OTHER 37 comparables only.
 * This is leave-one-comparable-out (LOCO): the held-out launch's own curve
 * never enters its forecast. Scoring uses the exact competition pinball loss.
 *
 * The four real practice launches are NOT in the comparables list, so their
 * withheld targets are never used. No official grade is claimed.
 *
 * Usage: node tools/backtest.ts [path/to/p00.in] [report.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Case, Comparable, ComparableCurve } from '../src/types.ts';
import { buildCurves } from '../src/curves.ts';
import { forecast, baselineQuantiles } from '../src/model.ts';
import { scoreCase, aggregate, type CaseScore } from '../src/scoring.ts';
import { DEFAULT_CONFIG, type ModelConfig } from '../src/config.ts';

const INPUT = process.argv[2] ?? '/home/sentinelx/makefun-agent/bounties/gta6-twitch-ccu-forecast-01-workspace/kit/unpacked/gta6-twitch-ccu-forecast-01-kit/input/p00.in';
const OUT = process.argv[3] ?? '/home/sentinelx/makefun-agent/bounties/gta6-twitch-ccu-forecast-01-workspace/artifacts/backtest-report.json';

type Variant = { name: string; cfg: ModelConfig; baseline?: boolean };

const cfg = (over: Partial<ModelConfig>): ModelConfig => ({ ...DEFAULT_CONFIG, ...over });

const VARIANTS: Variant[] = [
  { name: 'house_baseline', cfg: DEFAULT_CONFIG, baseline: true },
  { name: 'ramqe_full', cfg: cfg({}) },
  { name: 'no_regime', cfg: cfg({ regimeMatch: 1, regimeMismatch: 1, regimeUnknown: 1 }) },
  { name: 'no_tier', cfg: cfg({ tierWeight: { comparable: 1, weak: 1, early_access: 1, target_history: 0, unknown: 1 } }) },
  { name: 'no_scale', cfg: cfg({ scaleSigma: 1e6 }) },
  { name: 'mean_only', cfg: cfg({ medianBlend: 0 }) },
  { name: 'median_only', cfg: cfg({ medianBlend: 1 }) },
  { name: 'empirical_quantiles', cfg: cfg({ quantileMethod: 'empirical' }) },
  { name: 'width_0.5', cfg: cfg({ widthMultiplier: 0.5 }) },
  { name: 'width_1.5', cfg: cfg({ widthMultiplier: 1.5 }) },
  { name: 'width_2.0', cfg: cfg({ widthMultiplier: 2.0 }) },
  { name: 'scale_0.8', cfg: cfg({ scaleSigma: 0.8 }) },
  { name: 'scale_1.6', cfg: cfg({ scaleSigma: 1.6 }) },
  { name: 'scale_2.2', cfg: cfg({ scaleSigma: 2.2 }) },
];

function pseudoCase(curve: ComparableCurve, all: Comparable[]): Case {
  const others = all.filter((c) => c.name !== curve.name);
  const forecastRows = Array.from({ length: 23 }, (_, i) => ({ hour: i + 2 }));
  const actual = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const v = curve.viewers[h - 1];
    if (v !== null && Number.isFinite(v) && v > 0) actual.set(h, v);
  }
  return {
    schema: 'makefun/twitch-ccu-case/v1',
    id: curve.name,
    game: { name: curve.name, twitch_id: '' },
    day_start: new Date(curve.dayStartMs).toISOString(),
    checkpoint: '',
    levels: [0.05, 0.25, 0.5, 0.75, 0.95],
    known: [{ hour: 1, viewers: curve.v1 }],
    forecast: forecastRows,
    history: [],
    history_hourly: [],
    streams: null,
    categories_hourly: null,
    comparables: others,
    notes: all.find((c) => c.name === curve.name)?.unlock ?? '',
    // stash actuals outside the type via a symbol-free side channel:
    ...({} as Record<string, never>),
  } as Case;
}

// side channel: actual prints keyed by pseudo-case id (avoids polluting the Case type used by the core)
const ACTUALS = new Map<string, Map<number, number>>();

function runVariant(v: Variant, curves: ComparableCurve[], all: Comparable[]): { scores: CaseScore[]; agg: ReturnType<typeof aggregate> } {
  const scores: CaseScore[] = [];
  for (const curve of curves) {
    const pc = pseudoCase(curve, all);
    const actual = ACTUALS.get(curve.name)!;
    let qByHour: Map<number, number[]>;
    if (v.baseline) {
      qByHour = new Map();
      for (let h = 2; h <= 24; h++) qByHour.set(h, baselineQuantiles(curve.v1, h));
    } else {
      const result = forecast(pc, v.cfg);
      qByHour = new Map(result.hours.map((r) => [r.hour, r.q]));
    }
    scores.push(scoreCase(curve.name, qByHour, actual));
  }
  return { scores, agg: aggregate(scores) };
}

function summarize(scores: CaseScore[], curves: ComparableCurve[]): { label: string; agg: ReturnType<typeof aggregate> } {
  const rolling = new Set(curves.filter((c) => c.regime === 'rolling' && c.tier === 'comparable').map((c) => c.name));
  const clean = new Set(curves.filter((c) => c.tier === 'comparable').map((c) => c.name));
  const sub = (names: Set<string>) => aggregate(scores.filter((s) => names.has(s.id)));
  void sub; // detailed subsets printed below
  return { label: '', agg: aggregate(scores) };
}

function main(): void {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { comparables: Comparable[] };
  const all = raw.comparables;
  const curves = buildCurves(all).filter((c) => c.tier !== 'target-history');
  for (const c of curves) {
    const actual = new Map<number, number>();
    for (let h = 2; h <= 24; h++) {
      const v = c.viewers[h - 1];
      if (v !== null && Number.isFinite(v) && v > 0) actual.set(h, v);
    }
    ACTUALS.set(c.name, actual);
  }

  const rollingNames = new Set(curves.filter((c) => c.regime === 'rolling' && c.tier === 'comparable').map((c) => c.name));
  const cleanNames = new Set(curves.filter((c) => c.tier === 'comparable').map((c) => c.name));

  const results: Record<string, unknown> = {};
  console.log('LOCO backtest over', curves.length, 'comparable launches (practice targets withheld, not used)');
  console.log('rolling clean subset:', rollingNames.size, 'launches; all clean:', cleanNames.size);
  console.log('');
  console.log('variant'.padEnd(22), 'loss'.padStart(9), 'miss%'.padStart(8), 'cov90'.padStart(7), '|', 'roll.loss'.padStart(9), 'roll.miss'.padStart(8), 'roll.cov'.padStart(7));

  for (const v of VARIANTS) {
    const { scores, agg } = runVariant(v, curves, all);
    const rollAgg = aggregate(scores.filter((s) => rollingNames.has(s.id)));
    const cleanAgg = aggregate(scores.filter((s) => cleanNames.has(s.id)));
    console.log(
      v.name.padEnd(22),
      agg.loss.toFixed(6).padStart(9),
      agg.typicalMissPct.toFixed(1).padStart(8),
      agg.coverage90.toFixed(3).padStart(7),
      '|',
      rollAgg.loss.toFixed(6).padStart(9),
      rollAgg.typicalMissPct.toFixed(1).padStart(8),
      rollAgg.coverage90.toFixed(3).padStart(7),
    );
    results[v.name] = {
      all: agg,
      rolling: rollAgg,
      clean: cleanAgg,
      perCase: scores.map((s) => ({ id: s.id, loss: s.loss, typicalMissPct: s.typicalMissPct, coverage90: s.coverage90, nHours: s.hours.length })),
    };
  }

  // grid search the band multiplier on the rolling subset (reported as in-sample tuning on comparables)
  const grid: Array<{ w: number; loss: number; coverage: number }> = [];
  for (const w of [0.25, 0.4, 0.6, 0.8, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]) {
    const { scores } = runVariant({ name: `grid_${w}`, cfg: cfg({ widthMultiplier: w }) }, curves, all);
    const a = aggregate(scores.filter((s) => rollingNames.has(s.id)));
    grid.push({ w, loss: a.loss, coverage: a.coverage90 });
  }
  console.log('');
  console.log('width grid on rolling subset (in-sample on comparables):');
  for (const g of grid) console.log(`  w=${g.w.toFixed(2)}  loss=${g.loss.toFixed(6)}  cov90=${g.coverage.toFixed(3)}`);
  (results as Record<string, unknown>).widthGrid = grid;

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    input: INPUT,
    nComparables: curves.length,
    nRollingClean: rollingNames.size,
    protocol: 'leave-one-comparable-out; practice targets withheld and unused; local research, not an official grade',
    results,
  }, null, 2) + '\n');
  console.log(`\nwrote ${OUT}`);
  void summarize;
}

main();
