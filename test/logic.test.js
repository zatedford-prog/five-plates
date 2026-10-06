import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_CATALOG } from '../src/seed.js';
import {
  upcomingDates, dayInfo, rangeLabel, normalizeHousehold, fillDinners, fillEveryday, tally, slotKey, buildList, totals,
  seededRandom, suggestPlan, itemsCost, listAsText
} from '../public/js/logic.js';

const catalog = SEED_CATALOG;
// The list works from 7 dinners plus the household's breakfast/lunch/snack picks.
const view = (plan = catalog.defaults.plan) => ({ plan, ...normalizeHousehold(catalog, null) });

test('the plan always starts today and covers 7 days', () => {
  const dates = upcomingDates(new Date(2026, 9, 1)); // Thu Oct 1
  assert.equal(dates.length, 7);
  assert.equal(dates[0], '2026-10-01');
  assert.equal(dates[6], '2026-10-07');
  assert.equal(rangeLabel(dates), 'Oct 1 – 7');
  assert.equal(rangeLabel(upcomingDates(new Date(2026, 8, 28))), 'Sep 28 – Oct 4');
  assert.deepEqual(dayInfo('2026-10-01', '2026-10-01'), { dow: 'Thu', date: 1, month: 'Oct', rel: 'Today' });
  assert.equal(dayInfo('2026-10-02', '2026-10-01').rel, 'Tomorrow');
  assert.equal(dayInfo('2026-10-03', '2026-10-01').rel, '');
});

test('empty days get a suggestion; picked days stay as they are', () => {
  const dates = upcomingDates(new Date(2026, 9, 1));
  const days = { '2026-10-01': 'tacoSalad', '2026-10-03': 'steak' };
  const a = fillDinners(catalog, days, dates);
  assert.equal(a.plan[0], 'tacoSalad');
  assert.equal(a.plan[2], 'steak');
  assert.equal(a.filled.length, 5);
  assert.equal(new Set(a.plan).size, 7, 'no repeats: ' + a.plan);
  assert.deepEqual(fillDinners(catalog, days, dates).plan, a.plan, 'same answer on every phone');
});

test('breakfast and lunch fill from the usual picks, without repeating yesterday', () => {
  const dates = upcomingDates(new Date(2026, 9, 5));
  const weights = { cereal: 3, frozen: 4 };
  const days = { 'b:2026-10-05': 'swedish' };
  const a = fillEveryday(catalog.breakfasts, weights, days, dates, 'b');
  assert.equal(a.plan[0], 'swedish');                     // a picked day stays
  assert.deepEqual(a.filled, dates.slice(1).map(d => 'b:' + d));
  assert.ok(a.plan.slice(1).every(id => id === 'cereal' || id === 'frozen'));
  for (let i = 2; i < 7; i++) assert.notEqual(a.plan[i], a.plan[i - 1], 'repeat on ' + dates[i]);
  assert.deepEqual(fillEveryday(catalog.breakfasts, weights, days, dates, 'b').plan, a.plan, 'same on every phone');
  assert.deepEqual(tally(['cereal', 'frozen', 'cereal', 'out']), { cereal: 2, frozen: 1, out: 1 });
  assert.equal(slotKey('b', '2026-10-05'), 'b:2026-10-05');
  assert.equal(slotKey('d', '2026-10-05'), '2026-10-05');
});

test('every referenced product exists in the catalog', () => {
  const all = [...catalog.dinners, ...catalog.breakfasts, ...catalog.lunches];
  for (const m of all) for (const [k] of m.items) assert.ok(catalog.products[k], m.id + ' uses missing product ' + k);
  for (const k of catalog.snacks) assert.ok(catalog.products[k], 'missing snack ' + k);
  for (const id of catalog.defaults.plan) assert.ok(catalog.dinners.find(m => m.id === id), 'missing dinner ' + id);
});

test('list combines meals and rounds up to whole packages', () => {
  const v = view(['sweetPotato', 'pastaSausage', 'leftovers', 'leftovers', 'leftovers', 'leftovers', 'leftovers']);
  v.bf = {}; v.ln = {}; v.sn = {};
  const rows = buildList({ ...catalog, settings: { ...catalog.settings, milkPerWeek: 0 } }, v);
  const sausage = rows.find(r => r.key === 'itSausage');
  assert.equal(sausage.qty, 2);
  assert.deepEqual(sausage.from.sort(), ['Pasta & sausage', 'Sweet potato, kale & sausage']);
  assert.equal(rows.find(r => r.key === 'onion').qty, 2);   // 1 + 0.5 rounds up
  assert.equal(rows.find(r => r.key === 'oil').on, false);  // pantry items start unchecked
});

test('bucket split adds up to the total', () => {
  const t = totals(buildList(catalog, view()));
  assert.ok(Math.abs(t.dinner + t.breakfast + t.lunch + t.snack - t.total) < 1e-6);
  assert.ok(t.total > 150 && t.total < 400, 'default plan costs ' + t.total);
});

test('unchecking an item removes it from the total', () => {
  const v = view();
  const before = totals(buildList(catalog, v));
  v.on.goldfish = false;
  const after = totals(buildList(catalog, v));
  assert.equal(after.count, before.count - 1);
  assert.ok(Math.abs(before.total - after.total - catalog.products.goldfish.price) < 1e-6);
});

test('household picks fall back to the defaults and clamp bad numbers', () => {
  const h = normalizeHousehold(catalog, { bf: { cereal: 99, frozen: -3 }, ln: null, sn: { apples: '2' } });
  assert.deepEqual(h.bf, { cereal: 14, frozen: 0 });
  assert.deepEqual(h.ln, catalog.defaults.ln);
  assert.equal(h.sn.apples, 2);
});

test('suggested dinners lean cheap and skip date night', () => {
  for (let i = 0; i < 20; i++) {
    const plan = suggestPlan(catalog, seededRandom('s' + i));
    assert.ok(!plan.includes('dateNight'));
    const cost = plan.reduce((s, id) => s + itemsCost(catalog.dinners.find(m => m.id === id).items, catalog.products), 0);
    assert.ok(cost < 200, 'suggested dinners cost ' + cost);
  }
});

test('copied list text groups by aisle', () => {
  const text = listAsText(catalog, buildList(catalog, view()), 'Dinners Oct 1 – 7');
  assert.match(text, /^Five Plates list · Dinners Oct 1 – 7/);
  assert.match(text, /PRODUCE\n- /);
  assert.doesNotMatch(text, /Olive oil/);
});
