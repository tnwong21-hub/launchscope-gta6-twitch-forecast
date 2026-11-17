import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCase, p1Of, num, count } from '../src/case.ts';
import { serialize, validateContract, defaultHours } from '../src/contract.ts';
import { forecast } from '../src/model.ts';

const INPUT = '/home/sentinelx/makefun-agent/bounties/gta6-twitch-ccu-forecast-01-workspace/kit/unpacked/gta6-twitch-ccu-forecast-01-kit/input';

test('numeric coercion is safe for missing/malformed values', () => {
  assert.equal(num(5), 5);
  assert.equal(num('12.5'), 12.5);
  assert.equal(num(Infinity), null);
  assert.equal(num(NaN), null);
  assert.equal(num(undefined), null);
  assert.equal(num({}), null);
  assert.equal(count(-3), null);
  assert.equal(count('7'), 7);
});

test('all four practice cases parse with the expected schema', () => {
  for (const id of ['p00', 'p01', 'p02', 'p03']) {
    const raw = JSON.parse(readFileSync(`${INPUT}/${id}.in`, 'utf8'));
    const parsed = parseCase(raw, id);
    assert.equal(parsed.ok, true, `${id}: ${parsed.errors.join('; ')}`);
    assert.equal(parsed.case.id, id);
    assert.equal(parsed.case.levels.join(','), '0.05,0.25,0.5,0.75,0.95');
    assert.equal(parsed.case.known.filter((k) => k.hour === 1).length, 1);
    assert.equal(parsed.case.forecast.length, 23);
    assert.equal(parsed.case.comparables.length, 38);
    assert.equal(parsed.case.streams, null);
    assert.equal(parsed.case.categories_hourly, null);
    assert.ok(p1Of(parsed.case) > 0);
  }
});

test('malformed cases are rejected, never half-accepted', () => {
  assert.equal(parseCase(null).ok, false);
  assert.equal(parseCase([]).ok, false);
  assert.equal(parseCase({}).ok, false);
  assert.equal(parseCase({ levels: [0.1], known: [{ hour: 1, viewers: 5 }], forecast: [{ hour: 2 }], day_start: 'x' }).ok, false);
  const bad = parseCase({ levels: [0.05,0.25,0.5,0.75,0.95], known: [], forecast: [{ hour: 2 }], day_start: '2020-01-01T00:00:00Z' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('hour-1')));
});

test('every practice forecast passes the exact output contract', () => {
  const hours = defaultHours();
  for (const id of ['p00', 'p01', 'p02', 'p03']) {
    const c = parseCase(JSON.parse(readFileSync(`${INPUT}/${id}.in`, 'utf8')), id).case;
    const text = serialize(forecast(c));
    const check = validateContract(text, hours);
    assert.equal(check.ok, true, `${id}: ${check.errors.join('; ')}`);
    assert.ok(check.bytes < 65536);
    assert.ok(text.endsWith('\n'));
    const obj = JSON.parse(text);
    assert.deepEqual(Object.keys(obj), ['hours']);
    assert.equal(obj.hours.length, 23);
    for (const r of obj.hours) {
      assert.deepEqual(Object.keys(r), ['hour', 'q']);
      assert.equal(r.q.length, 5);
      for (let i = 1; i < 5; i++) assert.ok(r.q[i] >= r.q[i - 1]);
    }
  }
});

test('contract validator rejects bad shapes', () => {
  const good = serialize(forecast(parseCase(JSON.parse(readFileSync(`${INPUT}/p00.in`, 'utf8')), 'p00').case));
  assert.equal(validateContract(good).ok, true);
  assert.equal(validateContract('{}').ok, false);
  assert.equal(validateContract('not json').ok, false);
  assert.equal(validateContract('{"hours":[],"x":1}').ok, false);
  const obj = JSON.parse(good);
  obj.hours[0].q[2] = 0; // non-positive
  assert.equal(validateContract(JSON.stringify(obj)).ok, false);
  const obj2 = JSON.parse(good);
  obj2.hours[0].q[4] = 1e10; // too big
  assert.equal(validateContract(JSON.stringify(obj2)).ok, false);
  const obj3 = JSON.parse(good);
  [obj3.hours[0].q[0], obj3.hours[0].q[1]] = [obj3.hours[0].q[1], obj3.hours[0].q[0]]; // non-monotone
  assert.equal(validateContract(JSON.stringify(obj3)).ok, false);
});
