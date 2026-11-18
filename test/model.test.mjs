import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  forecast, baselineQuantiles, analogueWeight, weightedQuantile,
} from '../src/model.ts';
import {
  parseCase, num, count, str, isRecord, p1Of,
} from '../src/case.ts';
import {
  classifyTier, classifyRegime, buildCurves, audienceHeat, classifyPlatform,
} from '../src/curves.ts';
import {
  serialize, validateContract, defaultHours,
} from '../src/contract.ts';
import { scoreCase, aggregate, pinball } from '../src/scoring.ts';
import { Z, LEVELS, QNORM, DEFAULT_CONFIG, MODEL_VERSION } from '../src/config.ts';

const INPUT = '/home/sentinelx/makefun-agent/bounties/gta6-twitch-ccu-forecast-01-workspace/kit/unpacked/gta6-twitch-ccu-forecast-01-kit/input';
const IDS = ['p00', 'p01', 'p02', 'p03'];
const load = (id) => parseCase(JSON.parse(readFileSync(`${INPUT}/${id}.in`, 'utf8')), id).case;

/** Minimal, fully valid case used to probe the defensive parser. */
function minimalCase() {
  return {
    schema: 'makefun/twitch-ccu-case/v1',
    id: 'synthetic',
    game: { name: 'Synthetic', twitch_id: '' },
    day_start: '2024-01-01T00:00:00Z',
    checkpoint: '2024-01-01T01:00:00Z',
    levels: [...LEVELS],
    known: [{ hour: 1, viewers: 1000 }],
    forecast: Array.from({ length: 23 }, (_, i) => ({ hour: i + 2 })),
    history: [],
    history_hourly: [],
    streams: null,
    categories_hourly: null,
    comparables: [],
    notes: 'Rolling midnight local.',
  };
}

// ---- Core determinism and contract ----------------------------------------

test('forecast is byte-deterministic across repeated calls', () => {
  for (const id of IDS) {
    const c = load(id);
    const a = JSON.stringify(forecast(c));
    const b = JSON.stringify(forecast(c));
    assert.equal(a, b, `${id} not deterministic`);
  }
});

test('forecast emits 23 ordered hours with five finite positive monotone quantiles', () => {
  for (const id of IDS) {
    const r = forecast(load(id));
    assert.equal(r.hours.length, 23, id);
    assert.deepEqual(r.hours.map((h) => h.hour), defaultHours(), id);
    for (const h of r.hours) {
      assert.equal(h.q.length, 5, `${id}/${h.hour}: expected exactly 5 quantiles`);
      for (const v of h.q) assert.ok(Number.isFinite(v) && v > 0 && v <= 1e9);
      for (let i = 1; i < 5; i++) assert.ok(h.q[i] >= h.q[i - 1]);
    }
  }
});

test('serialized output satisfies the exact graded contract', () => {
  for (const id of IDS) {
    const text = serialize(forecast(load(id)));
    const check = validateContract(text);
    assert.equal(check.ok, true, `${id}: ${check.errors.join('; ')}`);
    assert.deepEqual(Object.keys(JSON.parse(text)), ['hours']);
    assert.ok(check.bytes <= 65536);
  }
});

test('five quantile levels are fixed and shared by model, baseline and scorer', () => {
  assert.equal(LEVELS.length, 5);
  assert.equal(QNORM.length, 5);
  assert.equal(Z.length, 5);
  assert.deepEqual([...Z], [-1.645, -0.674, 0, 0.674, 1.645]);
  assert.equal(baselineQuantiles(1000, 2).length, 5);
  assert.equal(baselineQuantiles(1000, 24).length, 5);
  // The scorer penalises each of the five levels independently.
  assert.ok(pinball(100, 100, 0.5) >= 0);
  const oneCase = scoreCase('x', new Map([[2, [90, 95, 100, 105, 110]]]), new Map([[2, 100]]));
  assert.ok(Number.isFinite(aggregate([oneCase]).loss));
});

// ---- Fallbacks and zero-weight guard ---------------------------------------

test('robust fallback when no usable comparables exist', () => {
  const c = load('p00');
  c.comparables = [];
  const r = forecast(c);
  assert.equal(r.usedFallback, true);
  assert.equal(r.hours.length, 23);
  assert.equal(r.nAnalogs, 0);
  for (const h of r.hours) for (const v of h.q) assert.ok(v > 0 && Number.isFinite(v));
  assert.deepEqual(r.hours[0].q, baselineQuantiles(r.p1, 2));
});

test('no zero-weight fallback on real inputs or with optional ablations enabled', () => {
  const normal = forecast(load('p00'));
  assert.equal(normal.usedFallback, false);
  assert.ok(normal.nAnalogs > 0);
  assert.ok(Number.isFinite(normal.totalWeight) && normal.totalWeight > 0);

  // Turning on every optional diagnostic factor must keep a positive weight:
  // a missing/non-finite diagnostic must never collapse the model to baseline.
  const ablated = forecast(load('p00'), {
    heatMix: 0.25, platformMix: 0.5, logRatioClip: 1.5,
  });
  assert.equal(ablated.usedFallback, false);
  assert.ok(ablated.nAnalogs > 0);
  assert.ok(Number.isFinite(ablated.totalWeight) && ablated.totalWeight > 0);
});

// ---- Classification and curve extraction ----------------------------------

test('tier/regime/platform classification handles negation and unknown text', () => {
  assert.equal(classifyTier('No early access. Rolling midnight local.', 'Wolverine'), 'comparable');
  assert.equal(classifyTier('Early access (premium) began 2023-09-01', 'Starfield'), 'early-access');
  assert.equal(classifyTier('Tier: weak. Live-service F2P', 'Marvel Rivals'), 'weak');
  assert.equal(classifyTier('Tier: target-history', 'GTA6'), 'target-history');
  assert.equal(classifyTier('some opaque text', 'X'), 'unknown');
  assert.equal(classifyRegime('Rolling midnight local on release day'), 'rolling');
  assert.equal(classifyRegime('Single simultaneous global unlock at 14:00Z'), 'simultaneous');
  assert.equal(classifyRegime(''), 'unknown');
  assert.equal(classifyPlatform('PS5'), 'console');
  assert.equal(classifyPlatform('PC / Steam'), 'pc');
  assert.equal(classifyPlatform('PS5 + PC + Xbox'), 'cross');
});

test('all practice-launch notes classify as clean rolling comps (final-case scenario)', () => {
  for (const id of IDS) {
    const c = load(id);
    assert.equal(classifyTier(c.notes, c.game.name), 'comparable', id);
    assert.equal(classifyRegime(c.notes), 'rolling', id);
  }
});

test('comparable curves extracted with hour-1 anchor = 1', () => {
  const curves = buildCurves(load('p00').comparables);
  assert.equal(curves.length, 37); // target-history excluded (no hour-1 anchor)
  for (const c of curves) {
    assert.equal(c.ratio[0], 1);
    assert.equal(c.v1 > 0, true);
    assert.equal(c.ratio.length, 24);
  }
});

test('audienceHeat is finite or null and clamps pathological ratios', () => {
  assert.equal(audienceHeat(100, 10), Math.log(10));
  assert.equal(audienceHeat(100, null), null);
  assert.equal(audienceHeat(100, 0), null);
  assert.equal(audienceHeat(0, 10), null);
  const huge = audienceHeat(1e12, 1);
  assert.ok(Number.isFinite(huge) && huge <= 4);
  const tiny = audienceHeat(1, 1e12);
  assert.ok(Number.isFinite(tiny) && tiny >= -4);
});

// ---- Ensemble helpers ------------------------------------------------------

test('weighted quantile is monotone and bounded', () => {
  const pairs = [[0, 1], [1, 1], [2, 1], [3, 1]];
  assert.equal(weightedQuantile(pairs, 0), 0);
  assert.equal(weightedQuantile(pairs, 1), 3);
  assert.ok(weightedQuantile(pairs, 0.5) >= 1 && weightedQuantile(pairs, 0.5) <= 2);
  assert.deepEqual(weightedQuantile([], 0.5), NaN);
});

test('empirical-quantile ablation stays valid', () => {
  const c = load('p02');
  const r = forecast(c, { quantileMethod: 'empirical' });
  assert.equal(r.hours.length, 23);
  for (const h of r.hours) for (let i = 1; i < 5; i++) assert.ok(h.q[i] >= h.q[i - 1]);
});

// ---- Published-v1 restoration guards --------------------------------------
// A corrupt 6-element Z emitted 6 quantiles; scoreCase drops any row whose q
// length !== 5, so the house baseline silently scored 0.000000. A field-name
// mismatch (curve.heat instead of curve.logHeat) produced NaN weights, zero
// total weight and a silent collapse onto that baseline. These tests pin both.

test('production identity is RAMQE-1.0.0 with every v2 ablation off', () => {
  assert.equal(MODEL_VERSION, 'RAMQE-1.0.0');
  assert.equal(DEFAULT_CONFIG.heatMix, 0);
  assert.equal(DEFAULT_CONFIG.platformMix, 0);
  assert.equal(DEFAULT_CONFIG.logRatioClip, Infinity);
  assert.equal(DEFAULT_CONFIG.maxDayStartMs, Infinity);
});

test('buildCurves always exposes a logHeat property that is finite or null', () => {
  for (const id of IDS) {
    const curves = buildCurves(load(id).comparables);
    assert.ok(curves.length > 0, id);
    for (const curve of curves) {
      assert.ok(Object.hasOwn(curve, 'logHeat'), `${id}/${curve.name}: logHeat property missing`);
      assert.ok(
        curve.logHeat === null || Number.isFinite(curve.logHeat),
        `${id}/${curve.name}: logHeat=${curve.logHeat} is neither null nor finite`,
      );
    }
  }
  // A comparable with no prelaunch samples must yield null, never undefined/NaN.
  const synthetic = [{
    name: 'NoPrelaunch',
    day_start: '2024-01-01T00:00:00Z',
    unlock: 'Tier: comparable. Rolling midnight local.',
    platforms: 'PS5',
    source: 'regression-test',
    hourly: [{ from: '2024-01-01T00:00:00Z', viewers: 100 }],
  }];
  const [curve] = buildCurves(synthetic);
  assert.ok(curve);
  assert.equal(Object.hasOwn(curve, 'logHeat'), true);
  assert.equal(curve.logHeat, null);
});

test('missing heat diagnostics never zero all weights or silently fall back', () => {
  const normal = forecast(load('p00'));
  assert.equal(normal.usedFallback, false);
  assert.ok(normal.nAnalogs > 0);
  assert.ok(Number.isFinite(normal.totalWeight) && normal.totalWeight > 0);

  // Strip every comparable's prelaunch history: buildCurve() must emit logHeat
  // = null for all of them (a present, finite-or-null property).
  const stripped = load('p00');
  for (const comp of stripped.comparables) {
    const ds = Date.parse(comp.day_start);
    comp.hourly = comp.hourly.filter((p) => {
      const t = Date.parse(p.from);
      return Number.isFinite(t) && t >= ds && t < ds + 24 * 3_600_000;
    });
  }
  for (const curve of buildCurves(stripped.comparables)) assert.equal(curve.logHeat, null);

  // Enable the optional heat ablation: a missing diagnostic must degrade to a
  // NEUTRAL factor (1), not NaN -> zero total weight -> house fallback.
  const r = forecast(stripped, { heatMix: 0.25 });
  assert.equal(r.usedFallback, false);
  assert.ok(r.nAnalogs > 0);
  assert.ok(Number.isFinite(r.totalWeight) && r.totalWeight > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), JSON.parse(JSON.stringify(normal)));
});

test('analogueWeight treats non-finite optional diagnostics as neutral', () => {
  // Anchor p1 to the comparable's own v1 (scale kernel = 1) and use its own
  // regime so every required factor is valid and the weight is positive.
  const real = buildCurves(load('p00').comparables)
    .find((c) => c.tier === 'comparable' && Number.isFinite(c.v1) && c.v1 > 0);
  assert.ok(real, 'expected at least one clean comparable curve');
  const curve = { ...real, logHeat: 0 };
  const p1 = real.v1;
  const target = real.regime;
  const cfgHeat = { ...DEFAULT_CONFIG, heatMix: 0.25 };
  const cfgNoHeat = { ...DEFAULT_CONFIG, heatMix: 0 };

  const baseline = analogueWeight(curve, p1, target, 0, cfgHeat);
  assert.ok(Number.isFinite(baseline) && baseline > 0, 'baseline must be a positive finite weight');
  const neutral = analogueWeight(curve, p1, target, 0, cfgNoHeat);
  assert.ok(Number.isFinite(neutral) && neutral > 0);
  assert.equal(baseline, neutral);

  for (const bad of [NaN, Infinity, -Infinity]) {
    const badCurve = analogueWeight({ ...curve, logHeat: bad }, p1, target, 0, cfgHeat);
    assert.ok(Number.isFinite(badCurve) && badCurve > 0, `curve logHeat=${bad}`);
    assert.equal(badCurve, neutral, `curve logHeat=${bad} must be neutral`);
    const badTarget = analogueWeight(curve, p1, target, bad, cfgHeat);
    assert.ok(Number.isFinite(badTarget) && badTarget > 0, `target heat=${bad}`);
    assert.equal(badTarget, neutral, `target heat=${bad} must be neutral`);
  }
});

// ---- Malformed / untrusted input -------------------------------------------

test('parseCase rejects structurally invalid cases without throwing', () => {
  for (const bad of [null, undefined, 42, 'text', []]) {
    const r = parseCase(bad, 'bad');
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  }
  const empty = parseCase({}, 'empty');
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some((e) => e.includes('levels')));
  assert.ok(empty.errors.some((e) => e.includes('hour-1')));
  assert.ok(empty.errors.some((e) => e.includes('forecast')));
  assert.ok(empty.errors.some((e) => e.includes('day_start')));
});

test('parseCase accepts a minimal valid case and repairs optional fields', () => {
  const r = parseCase(minimalCase(), 'synthetic');
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.case.id, 'synthetic');
  assert.equal(r.case.known.length, 1);
  assert.equal(r.case.forecast.length, 23);
  assert.deepEqual(r.case.streams, null);
  assert.deepEqual(r.case.categories_hourly, null);
  assert.equal(p1Of(r.case), 1000);

  // Wrong levels, missing hour-1, empty forecast and bad date are each fatal.
  const wrong = minimalCase(); wrong.levels = [0.1, 0.2, 0.3, 0.4, 0.5];
  assert.equal(parseCase(wrong).ok, false);
  const noP1 = minimalCase(); noP1.known = [{ hour: 2, viewers: 10 }];
  assert.equal(parseCase(noP1).ok, false);
  const noFc = minimalCase(); noFc.forecast = [];
  assert.equal(parseCase(noFc).ok, false);
  const badDate = minimalCase(); badDate.day_start = 'not-a-date';
  assert.equal(parseCase(badDate).ok, false);
});

test('numeric/string coercion helpers map malformed values to null/fallbacks', () => {
  assert.equal(num('1.5'), 1.5);
  assert.equal(num('  '), null);
  assert.equal(num('abc'), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(count('-3'), null);
  assert.equal(count('10'), 10);
  assert.equal(str(123, 'fallback'), 'fallback');
  assert.equal(str('ok', 'fallback'), 'ok');
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
});

test('validateContract rejects malformed serialized forecasts', () => {
  const good = JSON.parse(serialize(forecast(load('p00'))));
  const badShape = { hours: good.hours, extra: 1 };
  assert.equal(validateContract(JSON.stringify(badShape)).ok, false);
  const sixQ = { hours: good.hours.map((r) => ({ ...r, q: [...r.q, 1] })) };
  assert.equal(validateContract(JSON.stringify(sixQ)).ok, false);
  const missingHour = { hours: good.hours.slice(1) };
  assert.equal(validateContract(JSON.stringify(missingHour)).ok, false);
  const decreasing = {
    hours: good.hours.map((r) => ({ hour: r.hour, q: [9, 8, 7, 6, 5] })),
  };
  assert.equal(validateContract(JSON.stringify(decreasing)).ok, false);
});
