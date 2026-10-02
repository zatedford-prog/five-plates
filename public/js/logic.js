// Pure planning logic shared by the app and the tests. No DOM, no network.

export const BUCKETS = ['dinner', 'breakfast', 'lunch', 'snack'];
export const SPECIAL = {
  leftovers: { name: 'Leftovers night', sub: 'Use up the fridge' },
  out: { name: 'Eating out', sub: 'Comes from the eating-out money' }
};

// ---------- Dates (weeks start on Sunday, local time) ----------
export function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export function weekStart(d) { return addDays(d, -d.getDay()); }
export function weekId(d) { return isoDate(weekStart(d)); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function weekDays(id) {
  const start = parseIso(id);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    return { dow: DOW[i], date: d.getDate(), month: MONTHS[d.getMonth()] };
  });
}
export function weekLabel(id) {
  const s = parseIso(id), e = addDays(s, 6);
  return s.getMonth() === e.getMonth()
    ? MONTHS[s.getMonth()] + ' ' + s.getDate() + ' – ' + e.getDate()
    : MONTHS[s.getMonth()] + ' ' + s.getDate() + ' – ' + MONTHS[e.getMonth()] + ' ' + e.getDate();
}

// ---------- Costs ----------
export function itemsCost(items, products) {
  return items.reduce((t, [k, q]) => t + (products[k] ? products[k].price * q : 0), 0);
}
export function tier(cost) {
  return cost < 16 ? ['cheap', 'Easy on budget'] : cost < 25 ? ['mid', 'Middle'] : ['treat', 'Treat'];
}
export function byId(list) { return Object.fromEntries(list.map(x => [x.id, x])); }

// ---------- Weeks ----------
export function normalizeWeek(catalog, week) {
  const d = catalog.defaults;
  const w = week || {};
  const ints = (src, fallback) => {
    const o = {};
    for (const [k, v] of Object.entries(src || fallback)) o[k] = Math.max(0, Math.min(14, Math.round(+v || 0)));
    return o;
  };
  return {
    plan: Array.isArray(w.plan) && w.plan.length === 7 ? w.plan.map(String) : d.plan.slice(),
    bf: ints(w.bf, d.bf),
    ln: ints(w.ln, d.ln),
    sn: ints(w.sn, d.sn),
    on: w.on && typeof w.on === 'object' ? Object.fromEntries(Object.entries(w.on).map(([k, v]) => [k, !!v])) : {},
    sentAt: +w.sentAt || 0,
    updatedAt: +w.updatedAt || 0
  };
}

// Repeatable randomness: the same week id always suggests the same dinners, so two phones
// opening a brand-new week see the same plan before anyone saves it.
export function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// A new week starts with a suggested dinner plan and last week's everyday picks.
export function newWeek(catalog, previous, rand = Math.random) {
  const base = normalizeWeek(catalog, previous ? { bf: previous.bf, ln: previous.ln, sn: previous.sn } : null);
  base.plan = suggestPlan(catalog, rand);
  return base;
}

// Ingredients in this dinner that another day's dinner also uses.
export function sharedWith(catalog, plan, dayIdx, mealId) {
  const dinners = byId(catalog.dinners), P = catalog.products;
  const m = dinners[mealId];
  if (!m) return [];
  const mine = new Set(m.items.map(([k]) => k).filter(k => P[k] && P[k].shareName));
  const out = [];
  plan.forEach((id, i) => {
    if (i === dayIdx || !dinners[id]) return;
    dinners[id].items.forEach(([k]) => {
      if (mine.has(k) && !out.find(o => o.key === k)) out.push({ key: k, day: i });
    });
  });
  return out;
}

export function suggestPlan(catalog, rand = Math.random) {
  const dinners = byId(catalog.dinners);
  const pool = catalog.dinners.filter(m => !['steak', 'friedRice', 'dateNight'].includes(m.id));
  let best = null;
  for (let t = 0; t < 60; t++) {
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const ids = shuffled.slice(0, 7).map(m => m.id);
    if (dinners.steak && rand() < 0.2) ids[Math.floor(rand() * 7)] = 'steak';
    const gi = ids.indexOf('grilledChicken');
    if (dinners.friedRice && gi > -1 && gi < 5 && rand() < 0.6) ids[gi + 2] = 'friedRice';
    const cost = ids.reduce((s, id) => s + (dinners[id] ? itemsCost(dinners[id].items, catalog.products) : 0), 0);
    const shares = ids.reduce((s, id, i) => s + sharedWith(catalog, ids, i, id).length, 0);
    const score = shares * 3 - cost / 5;
    if (!best || score > best.score) best = { ids, score };
  }
  return best ? best.ids : catalog.defaults.plan.slice();
}

// ---------- Shopping list ----------
// Sums what every planned meal uses, rounds up to whole packages, and splits each
// package's cost across dinners / breakfast / lunch / snacks by how much each uses.
export function buildList(catalog, week) {
  const P = catalog.products;
  const dinners = byId(catalog.dinners);
  const need = {}, from = {};
  const add = (k, q, bucket, label) => {
    if (!q || !P[k]) return;
    const n = need[k] = need[k] || { dinner: 0, breakfast: 0, lunch: 0, snack: 0 };
    n[bucket] += q;
    (from[k] = from[k] || new Set()).add(label);
  };
  week.plan.forEach(id => { const m = dinners[id]; if (m) m.items.forEach(([k, q]) => add(k, q, 'dinner', m.name)); });
  catalog.breakfasts.forEach(b => { const d = week.bf[b.id] || 0; b.items.forEach(([k, q]) => add(k, q * d, 'breakfast', 'Breakfast')); });
  if (catalog.settings.milkPerWeek) add('milk', catalog.settings.milkPerWeek, 'breakfast', 'Breakfast');
  catalog.lunches.forEach(l => { const d = week.ln[l.id] || 0; l.items.forEach(([k, q]) => add(k, q * d, 'lunch', 'Lunch')); });
  catalog.snacks.forEach(k => add(k, week.sn[k] || 0, 'snack', 'Snack shelf'));
  return Object.keys(need).map(k => {
    const p = P[k], n = need[k];
    const sum = BUCKETS.reduce((s, b) => s + n[b], 0);
    const qty = Math.max(1, Math.ceil(sum - 0.02));
    const on = k in week.on ? week.on[k] : !p.pantry;
    const cost = qty * p.price;
    const split = Object.fromEntries(BUCKETS.map(b => [b, cost * n[b] / sum]));
    return { key: k, product: p, qty, cost, split, on, pantry: !!p.pantry, from: [...from[k]] };
  });
}

export function totals(rows) {
  const t = { dinner: 0, breakfast: 0, lunch: 0, snack: 0, total: 0, count: 0 };
  rows.filter(r => r.on).forEach(r => {
    t.count += 1;
    t.total += r.cost;
    BUCKETS.forEach(b => { t[b] += r.split[b]; });
  });
  return t;
}

export function listAsText(catalog, rows, label) {
  const lines = ['Five Plates list · ' + label, ''];
  catalog.aisles.forEach(a => {
    const rs = rows.filter(r => r.on && r.product.aisle === a).sort((x, y) => x.product.name.localeCompare(y.product.name));
    if (!rs.length) return;
    lines.push(a.toUpperCase());
    rs.forEach(r => lines.push('- ' + (r.qty > 1 ? r.qty + ' × ' : '') + r.product.name + (r.product.size ? ' (' + r.product.size + ')' : '')));
    lines.push('');
  });
  return lines.join('\n').trim() + '\n';
}
