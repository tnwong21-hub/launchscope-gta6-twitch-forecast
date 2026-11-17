import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forecast, baselineQuantiles, analogueWeight, weightedQuantile } from '../src/model.ts';
import { parseCase } from '../src/case.ts';
import { classifyTier, classifyRegime, buildCurves } from '../src/curves.ts';
import { Z, LEVELS, QNORM, DEFAULT_CONFIG, MODEL_VERSION } from '../src/config.ts';

const INPUT = '/home/sentinelx/makefun-agent/bounties/gta6-twitch-ccu-forecast-01-workspace/kit/unpacked/gta6-twitch-ccu-forecast-01-kit/input';
const load = (id) => parseCase(JSON.parse(readFileSync(`${INPUT}/${id}.in`, 'utf8')), id).case;

test('forecast is byte-deterministic across repeated calls', () => {
  for (const id of ['p00', 'p01', 'p02', 'p03']) {
    const c = load(id);
    const a = JSON.stringify(forecast(c));
    const b = JSON.stringify(forecast(c));
    assert.equal(a, b, `${id} not deterministic`);
  }
});

test('forecast has all 23 hours, monotone positive finite quantiles', () => {
  for (const id of ['p00', 'p01', 'p02', 'p03']) {
    const r = forecast(load(id));
    assert.equal(r.hours.length, 23);
    assert.deepEqual(r.hours.map((h) => h.hour), Array.from({ length: 23 }, (_, i) => i + 2));
    for (const h of r.hours) {
      assert.equal(h.q.length, 5);
      for (const v of h.q) assert.ok(Number.isFinite(v) && v > 0 && v <= 1e9);
      for (let i = 1; i < 5; i++) assert.ok(h.q[i] >= h.q[i - 1]);
    }
  }
});

test('robust fallback when no usable comparables exist', () => {
  const c = load('p00');
  c.comparables = [];
  const r = forecast(c);
  assert.equal(r.usedFallback, true);
  assert.equal(r.hours.length, 23);
  for (const h of r.hours) for (const v of h.q) assert.ok(v > 0 && Number.isFinite(v));
  // fallback must match the house baseline shape
  assert.deepEqual(r.hours[0].q, baselineQuantiles(r.p1, 2));
});

test('tier/regime classification handles negation and unknown text', () => {
  assert.equal(classifyTier("No early access. Rolling midnight local.", "Wolverine"), 'comparable');
  assert.equal(classifyTier("Early access (premium) began 2023-09-01", "Starfield"), 'early-access');
  assert.equal(classifyTier("Tier: weak. Live-service F2P", "Marvel Rivals"), 'weak');
  assert.equal(classifyTier("Tier: target-history", "GTA6"), 'target-history');
  assert.equal(classifyTier("some opaque text", "X"), 'unknown');
  assert.equal(classifyRegime("Rolling midnight local on release day"), 'rolling');
  assert.equal(classifyRegime("Single simultaneous global unlock at 14:00Z"), 'simultaneous');
  assert.equal(classifyRegime(""), 'unknown');
});

test('all practice-launch notes classify as clean rolling comps (final-case scenario)', () => {
  for (const id of ['p00', 'p01', 'p02', 'p03']) {
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

// ---- Regressions for the published-v1 restoration -------------------------
// A corrupt 6-element Z emitted 6 quantiles; scoreCase drops any row whose q
// length !== 5, so the house baseline silently scored 0.000000. A field-name
// mismatch (curve.heat instead of curve.logHeat) produced NaN weights, zero
// total weight and a silent collapse onto that baseline. These tests pin both.

test('house-baseline Z has exactly five values aligned to LEVELS and QNORM', () => {
  assert.equal(LEVELS.length, 5);
  assert.equal(QNORM.length, 5);
  assert.equal(Z.length, 5);
  assert.deepEqual([...Z], [-1.645, -0.674, 0, 0.674, 1.645]);
  assert.equal(baselineQuantiles(1000, 2).length, 5);
  assert.equal(baselineQuantiles(1000, 24).length, 5);
});

test('production identity is RAMQE-1.0.0 with every v2 ablation off', () => {
  assert.equal(MODEL_VERSION, 'RAMQE-1.0.0');
  assert.equal(DEFAULT_CONFIG.heatMix, 0);
  assert.equal(DEFAULT_CONFIG.platformMix, 0);
  assert.equal(DEFAULT_CONFIG.logRatioClip, Infinity);
  assert.equal(DEFAULT_CONFIG.maxDayStartMs, Infinity);
});

test('buildCurves always exposes a logHeat property that is finite or null', () => {
  for (const id of ['p00', 'p01', 'p02', 'p03']) {
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
  // Neutral heat means the forecast is unchanged from the production result.
  assert.deepEqual(JSON.parse(JSON.stringify(r)), JSON.parse(JSON.stringify(normal)));
});

test('analogueWeight treats non-finite optional diagnostics as neutral', () => {
  // Build a fully valid fixture: a clean comparable whose hour-1 anchor p1 is
  // its OWN v1 (so the scale kernel is exactly 1) and whose regime matches the
  // target (so every required field is valid and the weight is positive).
  // Using p1=1000/target='rolling' here would let wScale/regime plunge the
  // baseline below minWeight -> 0, failing for fixture reasons, not model ones.
  const real = buildCurves(load('p00').comparables)
    .find((c) => c.tier === 'comparable' && Number.isFinite(c.v1) && c.v1 > 0);
  assert.ok(real, 'expected at least one clean comparable curve');
  const curve = { ...real, logHeat: 0 };
  const p1 = real.v1;
  const target = real.regime;
  const targetHeat = 0;
  const cfgHeat = { ...DEFAULT_CONFIG, heatMix: 0.25 };
  const cfgNoHeat = { ...DEFAULT_CONFIG, heatMix: 0 };

  const baseline = analogueWeight(curve, p1, target, targetHeat, cfgHeat);
  assert.ok(Number.isFinite(baseline) && baseline > 0, 'baseline must be a positive finite weight');

  // With finite heat on both sides, the blended heat factor is exactly 1, so
  // the heat-enabled weight equals the heat-free weight. This is the neutral
  // reference; a broken guard would yield 0/NaN or silently fall back.
  const neutral = analogueWeight(curve, p1, target, targetHeat, cfgNoHeat);
  assert.ok(Number.isFinite(neutral) && neutral > 0);
  assert.equal(baseline, neutral);

  for (const bad of [NaN, Infinity, -Infinity]) {
    // Non-finite curve/target diagnostics must degrade to that SAME neutral
    // weight — never NaN, never zero (which would trigger the house fallback).
    const badCurve = analogueWeight({ ...curve, logHeat: bad }, p1, target, targetHeat, cfgHeat);
    assert.ok(Number.isFinite(badCurve) && badCurve > 0, `curve logHeat=${bad}`);
    assert.equal(badCurve, neutral, `curve logHeat=${bad} must be neutral`);
    const badTarget = analogueWeight(curve, p1, target, bad, cfgHeat);
    assert.ok(Number.isFinite(badTarget) && badTarget > 0, `target heat=${bad}`);
    assert.equal(badTarget, neutral, `target heat=${bad} must be neutral`);
  }
});
