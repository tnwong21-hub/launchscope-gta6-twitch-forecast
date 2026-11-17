import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forecast, baselineQuantiles } from '../src/model.ts';
import { parseCase } from '../src/case.ts';
import { classifyTier, classifyRegime, buildCurves } from '../src/curves.ts';
import { weightedQuantile } from '../src/model.ts';

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
