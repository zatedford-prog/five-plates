import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_CATALOG } from '../src/seed.js';
import {
  weekId, weekLabel, weekDays, buildList, totals, normalizeWeek, newWeek, seededRandom, suggestPlan, itemsCost, listAsText
} from '../public/js/logic.js';

const catalog = SEED_CATALOG;

test('weeks start on Sunday', () => {
  assert.equal(weekId(new Date(2026, 8, 30)), '2026-09-27'); // Wed Sep 30 -> Sun Sep 27
  assert.equal(weekId(new Date(2026, 9, 4)), '2026-10-04');  // a Sunday is its own week
  assert.equal(weekLabel('2026-09-27'), 'Sep 27 – Oct 3');
  assert.equal(weekLabel('2026-10-04'), 'Oct 4 – 10');
  assert.deepEqual(weekDays('2026-10-04')[6], { dow: 'Sat', date: 10, month: 'Oct' });
});

test('every referenced product exists in the catalog', () => {
  const all = [...catalog.dinners, ...catalog.breakfasts, ...catalog.lunches];
  for (const m of all) for (const [k] of m.items) assert.ok(catalog.products[k], m.id + ' uses missing product ' + k);
  for (const k of catalog.snacks) assert.ok(catalog.products[k], 'missing snack ' + k);
  for (const id of catalog.defaults.plan) assert.ok(catalog.dinners.find(m => m.id === id), 'missing dinner ' + id);
});

test('list combines meals and rounds up to whole packages', () => {
  const week = normalizeWeek(catalog, null);
  week.plan = ['sweetPotato', 'pastaSausage', 'leftovers', 'leftovers', 'leftovers', 'leftovers', 'leftovers'];
  week.bf = {}; week.ln = {}; week.sn = {};
  const rows = buildList({ ...catalog, settings: { ...catalog.settings, milkPerWeek: 0 } }, week);
  const sausage = rows.find(r => r.key === 'itSausage');
  assert.equal(sausage.qty, 2);                          // one pack per meal
  assert.deepEqual(sausage.from.sort(), ['Pasta & sausage', 'Sweet potato, kale & sausage']);
  const onions = rows.find(r => r.key === 'onion');
  assert.equal(onions.qty, 2);                           // 1 + 0.5 rounds up to 2
  assert.equal(rows.find(r => r.key === 'oil').on, false); // pantry items start unchecked
});

test('bucket split adds up to the total', () => {
  const week = normalizeWeek(catalog, null);
  const t = totals(buildList(catalog, week));
  assert.ok(Math.abs(t.dinner + t.breakfast + t.lunch + t.snack - t.total) < 1e-6);
  assert.ok(t.total > 150 && t.total < 400, 'default week costs ' + t.total);
});

test('unchecking an item removes it from the total', () => {
  const week = normalizeWeek(catalog, null);
  const before = totals(buildList(catalog, week));
  week.on.goldfish = false;
  const after = totals(buildList(catalog, week));
  assert.equal(after.count, before.count - 1);
  assert.ok(Math.abs(before.total - after.total - catalog.products.goldfish.price) < 1e-6);
});

test('a new week is the same on every device', () => {
  const a = newWeek(catalog, null, seededRandom('2026-10-11'));
  const b = newWeek(catalog, null, seededRandom('2026-10-11'));
  assert.deepEqual(a.plan, b.plan);
  assert.equal(a.plan.length, 7);
});

test('a new week keeps last week\'s everyday picks', () => {
  const prev = normalizeWeek(catalog, { bf: { cereal: 7 }, ln: { pbj: 7 }, sn: { apples: 3 } });
  const w = newWeek(catalog, prev, seededRandom('x'));
  assert.deepEqual(w.bf, { cereal: 7 });
  assert.deepEqual(w.sn, { apples: 3 });
});

test('suggested weeks lean cheap and skip date night', () => {
  for (let i = 0; i < 20; i++) {
    const plan = suggestPlan(catalog, seededRandom('s' + i));
    assert.ok(!plan.includes('dateNight'));
    const cost = plan.reduce((s, id) => s + itemsCost(catalog.dinners.find(m => m.id === id).items, catalog.products), 0);
    assert.ok(cost < 200, 'suggested week costs ' + cost);
  }
});

test('copied list text groups by aisle', () => {
  const text = listAsText(catalog, buildList(catalog, normalizeWeek(catalog, null)), 'Week of Oct 4 – 10');
  assert.match(text, /^Five Plates list · Week of Oct 4 – 10/);
  assert.match(text, /PRODUCE\n- /);
  assert.doesNotMatch(text, /Olive oil/); // pantry items are off by default
});
