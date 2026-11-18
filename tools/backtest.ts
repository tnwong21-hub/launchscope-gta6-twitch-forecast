/**
 * Independent, leakage-safe backtest for the SHIPPED RAMQE-1.0.0 model.
 *
 * Two protocols, both scored with the exact competition log pinball loss:
 *
 *  LOCO (default production benchmark) — each usable comparable becomes a
 *    pseudo-case: cut it at its own hour 1, hide hours 2..24, and forecast from
 *    ALL OTHER comparables. The held-out launch's own curve never enters its
 *    forecast. This reproduces the published benchmark exactly.
 *
 *  TEMPORAL (strictly prequential) — comparables are sorted by release date.
 *    A pseudo-case for launch i may use ONLY launches 0..i-1, i.e. material
 *    that existed before that launch. The date gate is applied explicitly in
 *    `pseudoCase` for every pseudo-case; nothing from the future is consulted.
 *
 * The four practice launches are not in the comparables list; their withheld
 * targets are never read. No official grade is claimed.
 *
 * Usage: node tools/backtest.ts <path/to/p00.in> [report.json]
 */
import { mkdirSync, readFileSync, writeSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Case, Comparable, ComparableCurve } from '../src/types.ts';
import { buildCurves } from '../src/curves.ts';
import { forecast, baselineQuantiles } from '../src/model.ts';
import { scoreCase, aggregate, type CaseScore } from '../src/scoring.ts';
import { DEFAULT_CONFIG, type ModelConfig } from '../src/config.ts';

const USAGE = `Usage: node tools/backtest.ts <path/to/p00.in> [report.json]

Run the independent, leakage-safe backtest of the shipped RAMQE-1.0.0 model on
the comparables in a supplied practice input file. Two protocols are reported:
LOCO (all other comparables) and strictly prequential temporal holdout.

Arguments:
  <path/to/p00.in>  Practice input file whose comparables are backtested
  [report.json]     Optional JSON report path
                    (default: artifacts/backtest-report.json)

Options:
  -h, --help        Print this usage and exit 0

Example:
  node tools/backtest.ts /path/to/p00.in /tmp/backtest-report.json

The four practice targets are withheld and never used as labels or for tuning.
No official grade is claimed.`;

if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  writeSync(1, USAGE + '\n');
  process.exit(0);
}

const INPUT = process.argv[2];
const OUT = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(process.cwd(), 'artifacts/backtest-report.json');
if (!INPUT) throw new Error(USAGE);

const HOUR_MS = 3_600_000;
const cfg = (over: Partial<ModelConfig>): ModelConfig => ({ ...DEFAULT_CONFIG, ...over });

interface Variant {
  name: string;
  cfg: ModelConfig;
  /** house/starter persistence baseline, not a model forecast */
  baseline?: boolean;
}

/**
 * The shipped production config already equals the published v1 settings:
 * heat/platform off, logRatioClip effectively infinite and maxDayStartMs =
 * Infinity so LOCO sees all peer comparables. `production_v1` is that default;
 * it must reproduce the published 0.395114 / 0.251989. The remaining rows are
 * controlled one-field ablations of the rejected v2 ideas — documented, never
 * used to tune the practice targets.
 */
const VARIANTS: Variant[] = [
  { name: 'house_baseline', cfg: DEFAULT_CONFIG, baseline: true },
  { name: 'production_v1', cfg: cfg({}) },
  // Rejected v2 ideas, isolated on top of the shipped v1 config.
  { name: 'v1_plus_clip1.5', cfg: cfg({ logRatioClip: 1.5 }) },
  { name: 'v1_plus_heat0.25', cfg: cfg({ heatMix: 0.25 }) },
  { name: 'v1_plus_heat0.75', cfg: cfg({ heatMix: 0.75, heatSigma: 0.6 }) },
  { name: 'v1_plus_platform0.5', cfg: cfg({ platformMix: 0.5 }) },
  { name: 'v1_plus_daygate', cfg: cfg({ maxDayStartMs: null }) },
  // All rejected v2 effects enabled together.
  {
    name: 'v2_as_shipped',
    cfg: cfg({ logRatioClip: 1.5, heatMix: 0.25, platformMix: 0.5, maxDayStartMs: null }),
  },
  // Legacy parameter ablations, each otherwise using the shipped defaults.
  { name: 'no_regime', cfg: cfg({ regimeMatch: 1, regimeMismatch: 1, regimeUnknown: 1 }) },
  {
    name: 'no_tier',
    cfg: cfg({
      tierWeight: { comparable: 1, weak: 1, early_access: 1, target_history: 0, unknown: 1 },
    }),
  },
  { name: 'no_scale', cfg: cfg({ scaleSigma: 1e6 }) },
  { name: 'mean_only', cfg: cfg({ medianBlend: 0 }) },
  { name: 'median_only', cfg: cfg({ medianBlend: 1 }) },
  { name: 'empirical_quantiles', cfg: cfg({ quantileMethod: 'empirical' }) },
  { name: 'width_0.6', cfg: cfg({ widthMultiplier: 0.6 }) },
  { name: 'width_0.9', cfg: cfg({ widthMultiplier: 0.9 }) },
  { name: 'width_1.2', cfg: cfg({ widthMultiplier: 1.2 }) },
  { name: 'width_1.6', cfg: cfg({ widthMultiplier: 1.6 }) },
];

/**
 * Build a pseudo-case from one comparable's own curve.
 *
 * `gate=true` (TEMPORAL only) restricts peers to strictly earlier releases.
 * `gate=false` (LOCO) uses all OTHER comparables regardless of date — exactly
 * the published benchmark. The production config's own date gate stays off;
 * the temporal gate lives here in the backtest, never in the shipped model.
 */
function pseudoCase(curve: ComparableCurve, all: Comparable[], gate: boolean): Case {
  const own = all.find((c) => c.name === curve.name);
  const history = (own?.hourly ?? [])
    .filter((p) => {
      const t = Date.parse(p.from);
      return Number.isFinite(t) && t < curve.dayStartMs && p.viewers !== null;
    })
    .map((p) => ({ at: p.from, from: p.from, viewers: p.viewers }));

  const peers = gate
    ? all.filter((c) => c.day_start && Date.parse(c.day_start) < curve.dayStartMs)
    : all.filter((c) => c.name !== curve.name);

  const forecastRows = Array.from({ length: 23 }, (_, i) => ({ hour: i + 2 }));
  return {
    schema: 'makefun/twitch-ccu-case/v1',
    id: curve.name,
    game: { name: curve.name, twitch_id: '' },
    day_start: new Date(curve.dayStartMs).toISOString(),
    checkpoint: new Date(curve.dayStartMs + HOUR_MS).toISOString(),
    levels: [0.05, 0.25, 0.5, 0.75, 0.95],
    known: [{ hour: 1, viewers: curve.v1 }],
    forecast: forecastRows,
    history,
    history_hourly: history,
    streams: null,
    categories_hourly: null,
    comparables: peers,
    notes: own?.unlock ?? '',
  } as Case;
}

function actualOf(curve: ComparableCurve): Map<number, number> {
  const actual = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const v = curve.viewers[h - 1];
    if (v !== null && Number.isFinite(v) && v > 0) actual.set(h, v);
  }
  return actual;
}

type Agg = ReturnType<typeof aggregate>;

function runVariant(
  v: Variant,
  curves: ComparableCurve[],
  all: Comparable[],
  mode: 'loco' | 'temporal',
): { scores: CaseScore[]; agg: Agg } {
  const scores: CaseScore[] = [];
  const chronological = [...curves].sort((a, b) => a.dayStartMs - b.dayStartMs);
  for (const held of curves) {
    if (mode === 'temporal') {
      const earlier = chronological.filter((c) => c.dayStartMs < held.dayStartMs);
      if (earlier.length < 6) continue; // warm-up: too few predecessors
    }
    // LOCO uses ALL other comparables; only TEMPORAL applies the date gate.
    const gate = mode === 'temporal';
    const pc = pseudoCase(held, all, gate);
    const actual = actualOf(held);
    let qByHour: Map<number, number[]>;
    if (v.baseline) {
      qByHour = new Map();
      for (let h = 2; h <= 24; h++) qByHour.set(h, baselineQuantiles(held.v1, h));
    } else {
      const result = forecast(pc, v.cfg);
      qByHour = new Map(result.hours.map((r) => [r.hour, r.q]));
    }
    scores.push(scoreCase(held.name, qByHour, actual));
  }
  return { scores, agg: aggregate(scores) };
}

function main(): void {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { comparables: Comparable[] };
  const all = raw.comparables;
  const curves = buildCurves(all).filter((c) => c.tier !== 'target-history');
  const rollingNames = new Set(
    curves.filter((c) => c.regime === 'rolling' && c.tier === 'comparable').map((c) => c.name),
  );
  const cleanNames = new Set(curves.filter((c) => c.tier === 'comparable').map((c) => c.name));

  const results: Record<string, unknown> = {};
  for (const mode of ['loco', 'temporal'] as const) {
    console.log(`\n${mode.toUpperCase()} backtest over ${curves.length} comparables (practice targets withheld, unused)`);
    console.log(
      'variant'.padEnd(22), 'loss'.padStart(9), 'miss%'.padStart(8), 'cov90'.padStart(7), '|',
      'roll.loss'.padStart(9), 'roll.miss'.padStart(8), 'roll.cov'.padStart(7),
    );
    const modeResults: Record<string, unknown> = {};
    for (const v of VARIANTS) {
      const { scores, agg } = runVariant(v, curves, all, mode);
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
      modeResults[v.name] = {
        all: agg,
        rolling: rollAgg,
        clean: cleanAgg,
        perCase: scores.map((s) => ({ id: s.id, loss: s.loss, hours: s.hours.length })),
      };
    }
    results[mode] = modeResults;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    input: INPUT,
    nComparables: curves.length,
    nRollingClean: rollingNames.size,
    protocol:
      'LOCO (leave-one-out, all other comparables, matches published benchmark) and strictly prequential temporal holdout (explicit per-pseudo-case date gate); practice targets withheld and unused; local research, not an official grade',
    results,
  }, null, 2) + '\n');
  console.log(`\nwrote ${OUT}`);
}

main();
