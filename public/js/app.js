import {
  SPECIAL, weekId, weekDays, weekLabel, parseIso, addDays, isoDate, itemsCost, tier, byId,
  normalizeWeek, newWeek, seededRandom, sharedWith, suggestPlan, buildList, totals, listAsText
} from './logic.js';

// ---------- App state ----------
const CACHE_KEY = 'fp-cache-v1';
const app = {
  user: null,
  catalog: null,
  weeks: {},          // weekId -> week
  dirty: new Set(),   // weekIds with changes not yet saved
  current: weekId(new Date()),
  tab: 'week',
  sync: 'saved'       // saved | saving | offline
};

const $ = id => document.getElementById(id);
const money = n => '$' + n.toFixed(2);
const whole = n => '$' + Math.round(n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
};

function saveCache() {
  local.set(CACHE_KEY, { user: app.user, catalog: app.catalog, weeks: app.weeks, dirty: [...app.dirty] });
}

// ---------- Server ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

async function loadWeek(id, { quiet } = {}) {
  let res;
  try { res = await api('/api/bootstrap?week=' + id); }
  catch { setSync('offline'); return false; }
  if (res.status === 401) { signOutLocal(); return false; }
  if (res.status !== 200) { if (!quiet) toast('Couldn\'t load. Showing what\'s saved on this phone.'); return false; }
  const { user, catalog, week, previous } = res.data;
  app.user = user;
  app.catalog = catalog;
  if (week) {
    const localWeek = app.weeks[id];
    if (!app.dirty.has(id) || !localWeek || week.updatedAt > localWeek.updatedAt) {
      app.weeks[id] = normalizeWeek(catalog, week);
      app.dirty.delete(id);
    }
  } else if (!app.weeks[id]) {
    app.weeks[id] = newWeek(catalog, previous, seededRandom(id));
  }
  if (app.sync === 'offline') setSync(app.dirty.size ? 'saving' : 'saved');
  saveCache();
  if (app.dirty.size) flushSoon();
  return true;
}

let flushTimer = null, retryTimer = null;
function markDirty() {
  app.dirty.add(app.current);
  app.weeks[app.current].updatedAt = Date.now();
  saveCache();
  setSync('saving');
  flushSoon();
}
function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 700); }
async function flush() {
  clearTimeout(retryTimer);
  for (const id of [...app.dirty]) {
    const w = app.weeks[id];
    let res;
    try { res = await api('/api/week/' + id, { method: 'PUT', body: { plan: w.plan, bf: w.bf, ln: w.ln, sn: w.sn, on: w.on } }); }
    catch { setSync('offline'); retryTimer = setTimeout(flush, 15000); return; }
    if (res.status === 401) { signOutLocal(); return; }
    if (res.status !== 200) { setSync('offline'); retryTimer = setTimeout(flush, 15000); return; }
    w.updatedAt = res.data.updatedAt;
    app.dirty.delete(id);
  }
  saveCache();
  setSync('saved');
}

function setSync(s) {
  app.sync = s;
  const el = $('sync');
  if (!el) return;
  el.className = 'sync ' + s;
  el.innerHTML = '<i></i>' + (s === 'saved' ? 'Saved' : s === 'saving' ? 'Saving…' : 'Offline, will save later');
}

// ---------- Boot ----------
async function boot() {
  const cached = local.get(CACHE_KEY);
  if (cached && cached.user && cached.catalog) {
    app.user = cached.user;
    app.catalog = cached.catalog;
    app.weeks = cached.weeks || {};
    app.dirty = new Set(cached.dirty || []);
    if (!app.weeks[app.current]) app.weeks[app.current] = newWeek(app.catalog, null, seededRandom(app.current));
    renderShell();
    renderAll();
    if (await loadWeek(app.current, { quiet: true }) && app.user) renderAll();
  } else {
    let res;
    try { res = await api('/api/bootstrap?week=' + app.current); }
    catch { $('boot').textContent = 'Can\'t reach Five Plates. Check your connection and reopen the app.'; return; }
    if (res.status === 401) { renderSignIn(); return; }
    await loadWeek(app.current);
    renderShell();
    renderAll();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !app.user) return;
  if (await loadWeek(app.current, { quiet: true }) && app.user) renderAll();
});
window.addEventListener('online', () => { if (app.dirty.size) flush(); });

// ---------- Sign-in ----------
function renderSignIn(message, email = '') {
  $('app').innerHTML =
    '<form class="signin" id="signinForm" novalidate>' +
    '<div class="brand"><span class="plates" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Five Plates</div>' +
    '<h1>Welcome in</h1><p>Sign in once on this phone and it stays signed in.</p>' +
    (message ? '<div class="error" role="alert">' + esc(message) + '</div>' : '') +
    '<div class="field"><label for="email">Your email</label><input id="email" type="email" value="' + esc(email) + '" autocomplete="username" inputmode="email" autocapitalize="off" required></div>' +
    '<div class="field"><label for="passcode">Family passcode</label><input id="passcode" type="password" autocomplete="current-password" required></div>' +
    '<button class="cta" type="submit" id="signinBtn">Sign in</button></form>';
  $('signinForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('signinBtn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    let res;
    try { res = await api('/api/login', { method: 'POST', body: { email: $('email').value, passcode: $('passcode').value } }); }
    catch { renderSignIn('Can\'t reach Five Plates. Check your connection and try again.'); return; }
    if (res.status !== 200) { renderSignIn(res.data?.error || 'Sign-in didn\'t work. Try again.', $('email').value); return; }
    app.user = res.data.user;
    await loadWeek(app.current);
    renderShell();
    renderAll();
  };
}

function signOutLocal() {
  app.user = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  renderSignIn();
}

// ---------- Icons ----------
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.2-3 7.7-7 9.5-4-1.8-7-5.3-7-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5s-6 6.6-6 10.9a6 6 0 0 0 12 0C18 10.1 12 3.5 12 3.5z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'
};

// A product that can contain dyes shows either "checked" (someone read the label) or "check label".
function dyeBadge(key, p) {
  if (!p.dyeRisk) return '';
  return p.dyeChecked
    ? '<button type="button" class="safe" data-dye="' + key + '">' + ICON.shield + 'Dye-free, checked</button>'
    : '<button type="button" class="chk" data-dye="' + key + '">' + ICON.eye + 'Check label</button>';
}

// ---------- Shell ----------
const TITLES = { week: 'Dinners this week', every: 'Breakfast, lunch & snacks', list: 'Shopping list', meals: 'Our dinners' };

function renderShell() {
  $('app').innerHTML = `
  <header class="top">
    <div class="brandrow">
      <div class="brand"><span class="plates" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Five Plates</div>
      <span class="sync" id="sync" role="status"></span>
    </div>
    <div>
      <div class="weeknav">
        <button type="button" id="prevWeek" aria-label="Previous week">${ICON.left}</button>
        <div class="eyebrow" id="eyebrow"></div>
        <button type="button" id="nextWeek" aria-label="Next week">${ICON.right}</button>
        <span class="this-week" id="thisWeek" hidden>This week</span>
      </div>
      <div class="brandrow">
        <h1 id="title"></h1>
        <button class="pill-btn" id="suggestBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.9L19 9.7l-4.2 3.1 1.5 5.2L12 15l-4.3 3 1.5-5.2L5 9.7l5.2-1.8z"/></svg>
          Suggest
        </button>
      </div>
    </div>
    <div class="meter" id="meter"></div>
  </header>
  <main class="screen" id="screen-week" role="tabpanel" aria-label="Dinners"></main>
  <main class="screen" id="screen-every" role="tabpanel" aria-label="Breakfast, lunch and snacks" hidden></main>
  <main class="screen" id="screen-list" role="tabpanel" aria-label="Shopping list" hidden></main>
  <main class="screen" id="screen-meals" role="tabpanel" aria-label="Our dinners" hidden></main>
  <div class="cta-wrap" id="ctaWrap" hidden>
    <button class="cta" id="sendBtn" type="button">${ICON.copy}<span id="sendLabel">Copy list</span></button>
  </div>
  <nav class="tabs" role="tablist" aria-label="Sections">
    <button class="tab" role="tab" aria-selected="true" data-tab="week" id="tab-week" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
      Dinners</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="every" id="tab-every" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11h13v1a6.5 6.5 0 0 1-6.5 6.5A6.5 6.5 0 0 1 4 12v-1z"/><path d="M17 12h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/><path d="M6 21h9"/></svg>
      Everyday</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="list" id="tab-list" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M3.5 6.5l1.2 1.2L6.8 5.5M3.5 12l1.2 1.2 2.1-2.2M3.5 17.5l1.2 1.2 2.1-2.2"/></svg>
      <span>List <span class="count num" id="listCount">0</span></span></button>
    <button class="tab" role="tab" aria-selected="false" data-tab="meals" id="tab-meals" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7M9 11.5h5"/></svg>
      Meals</button>
  </nav>
  <div class="scrim" id="scrim"></div>
  <section class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head"><div id="sheetHead"></div>
      <button class="x" id="sheetClose" type="button" aria-label="Close">${ICON.close}</button></div>
    <div class="sheet-body" id="sheetBody"></div>
  </section>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  $('scrim').onclick = closeSheet;
  $('sheetClose').onclick = closeSheet;
  $('suggestBtn').onclick = suggest;
  $('sendBtn').onclick = copySheet;
  $('prevWeek').onclick = () => goWeek(-7);
  $('nextWeek').onclick = () => goWeek(7);
  setSync(app.dirty.size ? 'saving' : app.sync);
  setTab(app.tab);
}

async function goWeek(days) {
  app.current = isoDate(addDays(parseIso(app.current), days));
  if (!app.weeks[app.current]) {
    const prev = app.weeks[isoDate(addDays(parseIso(app.current), -7))];
    app.weeks[app.current] = newWeek(app.catalog, prev, seededRandom(app.current));
  }
  renderAll();
  if (await loadWeek(app.current, { quiet: true }) && app.user) renderAll();
}

function setTab(t) {
  app.tab = t;
  ['week', 'every', 'list', 'meals'].forEach(x => {
    $('screen-' + x).hidden = x !== t;
    $('tab-' + x).setAttribute('aria-selected', x === t);
  });
  $('title').textContent = TITLES[t];
  $('ctaWrap').hidden = t !== 'list';
  $('suggestBtn').hidden = t !== 'week';
  $('screen-' + t).scrollTop = 0;
}

function week() { return app.weeks[app.current]; }
function renderAll() {
  if (!$('meter')) return;
  const isThis = app.current === weekId(new Date());
  $('eyebrow').textContent = 'Week of ' + weekLabel(app.current);
  $('thisWeek').hidden = !isThis;
  renderMeter(); renderWeek(); renderEvery(); renderList(); renderMeals();
}

// ---------- Header meter ----------
function renderMeter() {
  const c = app.catalog, t = totals(buildList(c, week()));
  const budget = c.settings.weeklyBudget;
  const pct = x => Math.min(100, x / budget * 100);
  const left = budget - t.total;
  const note = left >= 0 ? whole(left) + ' left for household & extras' : 'A little over. Try swapping one thing.';
  const segs = [['dinner', 'Dinners', '--accent'], ['breakfast', 'Breakfast', '--butter'], ['lunch', 'Lunch', '--sky'], ['snack', 'Snacks', '--clay']];
  $('meter').innerHTML =
    '<div class="meter-line"><span><b class="num">' + whole(t.total) + '</b> <span class="meter-note">of your ' + whole(budget) + ' week</span></span><span class="meter-note">' + esc(note) + '</span></div>' +
    '<div class="bar" aria-hidden="true">' + segs.map(s => '<span style="width:' + pct(t[s[0]]) + '%;background:var(' + s[2] + ')"></span>').join('') + '</div>' +
    '<div class="legend">' + segs.map(s => '<span><i style="background:var(' + s[2] + ')"></i>' + s[1] + ' <b class="num">' + whole(t[s[0]]) + '</b></span>').join('') + '</div>';
  $('listCount').textContent = t.count;
}

// ---------- Dinners ----------
function dismissible(key, title, text) {
  if (local.get('hide:' + key)) return '';
  return '<div class="hello"><p><strong>' + esc(title) + '</strong>' + esc(text) + '</p>' +
    '<button class="x" type="button" data-hide="' + key + '" aria-label="Hide this note">' + ICON.close + '</button></div>';
}

function renderWeek() {
  const c = app.catalog, w = week(), dinners = byId(c.dinners), days = weekDays(app.current);
  let h = dismissible('hello-week', 'Your week, planned', 'Tap a dinner to see what it costs, or swap it. Changes save on their own and show up on both of your phones.');
  w.plan.forEach((id, i) => {
    const d = days[i];
    let name, meta;
    if (dinners[id]) {
      const m = dinners[id], cost = itemsCost(m.items, c.products), [tc, tl] = tier(cost);
      const sh = sharedWith(c, w.plan, i, id);
      name = m.name;
      meta = '<span class="num">' + money(cost) + '</span><span class="chip ' + tc + '">' + tl + '</span>' +
        (m.idea ? '<span class="chip idea">New idea</span>' : '') +
        (sh.length ? '<span class="chip share">Shares ' + esc(c.products[sh[0].key].shareName) + ' with ' + days[sh[0].day].dow + '</span>' : '');
    } else {
      const s = SPECIAL[id] || SPECIAL.leftovers;
      name = s.name; meta = '<span>' + esc(s.sub) + '</span>';
    }
    h += '<div class="day' + (dinners[id] ? '' : ' off') + '">' +
      '<div class="date"><small>' + d.dow + '</small><b>' + d.date + '</b></div>' +
      '<button class="meal-btn" type="button" data-open="' + i + '"><span class="meal-name">' + esc(name) + '</span><span class="meal-meta">' + meta + '</span></button>' +
      '<button class="swap" type="button" data-swap="' + i + '" aria-label="Swap ' + d.dow + ' dinner">' + ICON.swap + 'Swap</button></div>';
  });
  h += '<p class="hint">' + esc(priceSourceNote()) + '</p>';
  $('screen-week').innerHTML = h;
}

// ---------- Everyday ----------
function stepper(group, id, n, canAdd, label) {
  return '<span class="stepper"><button type="button" data-step="' + group + '" data-id="' + id + '" data-d="-1" aria-label="Fewer ' + esc(label) + '"' + (n <= 0 ? ' disabled' : '') + '>' + ICON.minus + '</button>' +
    '<span class="num">' + n + '</span>' +
    '<button type="button" data-step="' + group + '" data-id="' + id + '" data-d="1" aria-label="More ' + esc(label) + '"' + (canAdd ? '' : ' disabled') + '>' + ICON.plus + '</button></span>';
}
function daySection(title, unit, list, picks, group, bucketCost, tip) {
  const P = app.catalog.products;
  const used = list.reduce((s, x) => s + (picks[x.id] || 0), 0);
  let h = '<section class="sec"><div class="sec-head"><div><h2>' + title + '</h2><small>' + used + ' of 7 ' + unit + ' planned</small>' +
    '<div class="days-dots" aria-hidden="true">' + Array.from({ length: 7 }, (_, i) => '<i class="' + (i < used ? 'on' : '') + '"></i>').join('') + '</div></div>' +
    '<div class="sec-cost num">' + whole(bucketCost) + '<small>this week</small></div></div>';
  list.forEach(x => {
    const n = picks[x.id] || 0, cost = itemsCost(x.items, P);
    const risky = x.items.filter(([k]) => P[k] && P[k].dyeRisk);
    const allChecked = risky.length && risky.every(([k]) => P[k].dyeChecked);
    const badge = !risky.length ? '' : allChecked
      ? '<span class="safe">' + ICON.shield + 'Dye-free, checked</span>'
      : '<span class="chk">' + ICON.eye + 'Check label</span>';
    const sub = (cost ? money(cost) + ' a day' : 'Free') + (x.note ? ' · ' + esc(x.note) : '');
    h += '<div class="erow' + (n ? '' : ' zero') + '"><div style="min-width:0"><div class="erow-name">' + esc(x.name) + '</div><div class="erow-sub"><span>' + sub + '</span>' + badge + '</div></div>' +
      stepper(group, x.id, n, used < 7, x.name) + '</div>';
  });
  if (tip) h += '<p class="sec-tip">' + esc(tip) + '</p>';
  return h + '</section>';
}
function renderEvery() {
  const c = app.catalog, w = week(), P = c.products, t = totals(buildList(c, w));
  const BF = byId(c.breakfasts);
  let h = dismissible('hello-every', 'No daily planning needed', 'Pick how many mornings and lunches of each. The app works out how much to buy.');
  let tip = 'Includes about ' + c.settings.milkPerWeek + ' half-gallons of Lactaid milk for drinking.';
  if (BF.pancakes && BF.frozen) {
    tip = 'Krusteaz pancakes cost about ' + money(itemsCost(BF.pancakes.items, P)) + ' a morning vs ' + money(itemsCost(BF.frozen.items, P)) +
      ' for frozen. Make a double batch on the weekend and freeze the extras for the toaster. ' + tip;
  }
  h += daySection('Breakfast', 'mornings', c.breakfasts, w.bf, 'bf', t.breakfast, tip);
  h += daySection('Lunch', 'lunches', c.lunches, w.ln, 'ln', t.lunch, null);
  const packs = c.snacks.reduce((s, k) => s + (w.sn[k] || 0), 0);
  h += '<section class="sec"><div class="sec-head"><div><h2>Snack shelf</h2><small>' + packs + ' packs for the week</small></div><div class="sec-cost num">' + whole(t.snack) + '<small>this week</small></div></div>';
  c.snacks.forEach(k => {
    const p = P[k], n = w.sn[k] || 0;
    if (!p) return;
    h += '<div class="erow' + (n ? '' : ' zero') + '"><div style="min-width:0"><div class="erow-name">' + esc(p.name) + '</div><div class="erow-sub"><span>' + money(p.price) + (p.size ? ' · ' + esc(p.size) : '') + '</span>' + dyeBadge(k, p) + '</div></div>' +
      stepper('sn', k, n, n < 6, p.name) + '</div>';
  });
  h += '<p class="sec-tip">Fill a snack bin on Sunday. When it\'s empty, it\'s fruit until next week. Snacks grabbed in the aisle are an easy way to go over, and they\'re where dyes hide most.</p></section>';
  $('screen-every').innerHTML = h;
}

// ---------- List ----------
// The exact King Soopers product when we have one, otherwise our generic name.
function displayName(p) { return p.kroger ? p.kroger.description : p.name; }
function onSale(p) { return p.kroger && p.kroger.promo > 0 && p.kroger.promo < p.kroger.regular; }
function saleChip(p) { return onSale(p) ? '<span class="chip sale">Sale, save ' + money(p.kroger.regular - p.kroger.promo) + '</span>' : ''; }

function itemRow(r) {
  const src = r.from.length > 2 ? r.from.length + ' uses' : r.from.join(', ');
  return '<div class="item" data-on="' + r.on + '">' +
    '<button type="button" class="item-toggle" data-item="' + r.key + '" aria-pressed="' + r.on + '" aria-label="' + esc((r.on ? 'Remove ' : 'Add ') + displayName(r.product)) + '"></button>' +
    '<span class="box">' + ICON.check + '</span>' +
    '<span class="item-main"><button type="button" class="item-name" data-product="' + r.key + '">' + esc(displayName(r.product)) + '</button><span class="item-sub"><span>' + esc(src) + '</span>' + saleChip(r.product) + dyeBadge(r.key, r.product) + '</span></span>' +
    '<span class="item-right"><span class="item-price num">' + money(r.cost) + '</span><br><span class="item-qty">' + (r.qty > 1 ? r.qty + ' × ' : '') + esc(r.product.size || '1') + '</span></span></div>';
}
function renderList() {
  const c = app.catalog, rows = buildList(c, week()), t = totals(rows);
  const unchecked = rows.filter(r => r.on && r.product.dyeRisk && !r.product.dyeChecked).length;
  let h = '<div class="list-summary"><div><div class="eyebrow">For pickup</div><div class="big num">' + money(t.total) + '</div><small>' + t.count + ' items · whole packages, combined across meals</small></div></div>';
  if (unchecked) {
    h += '<div class="tip dye">' + ICON.eye + '<span><b>' + unchecked + ' item' + (unchecked > 1 ? 's' : '') + ' still need a label check.</b> Tap "Check label" once you\'ve confirmed there\'s no Red 40, Red 3, Blue 1 or Blue 2. The app remembers it after that.</span></div>';
  }
  c.aisles.forEach(a => {
    const rs = rows.filter(r => !r.pantry && r.product.aisle === a).sort((x, y) => x.product.name.localeCompare(y.product.name));
    if (!rs.length) return;
    const sub = rs.filter(r => r.on).reduce((s, r) => s + r.cost, 0);
    h += '<div class="group"><div class="group-head"><h3>' + esc(a) + '</h3><span class="num">' + money(sub) + '</span></div><div class="items">' + rs.map(itemRow).join('') + '</div></div>';
  });
  const pan = rows.filter(r => r.pantry);
  if (pan.length) h += '<div class="group"><div class="group-head"><h3>Probably in the pantry</h3><span>Tap if you need it</span></div><div class="items">' + pan.map(itemRow).join('') + '</div></div>';
  h += '<p class="hint">Uncheck anything you already have.</p>';
  $('screen-list').innerHTML = h;
  $('sendLabel').textContent = 'Copy list · ' + t.count + ' items';
}

// ---------- Meals ----------
function renderMeals() {
  const c = app.catalog;
  const list = c.dinners.slice().sort((a, b) => itemsCost(a.items, c.products) - itemsCost(b.items, c.products));
  let h = '<p class="lib-note">Cheapest first. Every meal is sized for your family: two adults and three kids eat about ' + c.settings.adultPortions + ' adult portions.</p>';
  list.forEach(m => {
    const cost = itemsCost(m.items, c.products), [tc, tl] = tier(cost);
    h += '<button class="lib" type="button" data-meal="' + m.id + '"><span style="min-width:0"><span class="meal-name">' + esc(m.name) + '</span><span class="meal-meta"><span class="chip ' + tc + '">' + tl + '</span>' + (m.idea ? '<span class="chip idea">New idea</span>' : '') + (m.takeout ? '<span>vs ' + whole(m.takeout) + ' takeout</span>' : '') + '</span></span>' +
      '<span class="lib-cost"><b class="num">' + money(cost) + '</b><small class="num">' + money(cost / c.settings.adultPortions) + ' / portion</small></span></button>';
  });
  h += '<p class="hint">Signed in as ' + esc(app.user || '') + ' · <button type="button" class="textlink" id="signOut">Sign out</button></p>';
  $('screen-meals').innerHTML = h;
  $('signOut').onclick = async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* signing out locally anyway */ }
    signOutLocal();
  };
}

// ---------- Sheets ----------
function openSheet(head, body) {
  $('sheetHead').innerHTML = head;
  $('sheetBody').innerHTML = body;
  $('sheetBody').scrollTop = 0;
  $('sheet').classList.add('open');
  $('scrim').classList.add('open');
  setTimeout(() => $('sheetClose').focus(), 50);
}
function closeSheet() { $('sheet').classList.remove('open'); $('scrim').classList.remove('open'); }

function frac(q) {
  const w = Math.floor(q + 1e-9), r = q - w;
  const map = [[0, ''], [.25, '¼'], [.33, '⅓'], [.5, '½'], [.67, '⅔'], [.75, '¾'], [1, '']];
  let best = map[0];
  for (const m of map) if (Math.abs(m[0] - r) < Math.abs(best[0] - r)) best = m;
  const ww = best[0] === 1 ? w + 1 : w;
  return (ww || '') + best[1];
}
function useText(q, p) {
  if (q < .2) return 'A little';
  if (Math.abs(q - Math.round(q)) < .01) return Math.round(q) === 1 ? (p.size || '1') : Math.round(q) + ' × ' + p.size;
  return frac(q) + (q < 1 ? ' of ' : ' × ') + (p.size || 'pack');
}

function mealSheet(id, dayIdx) {
  const c = app.catalog, P = c.products, m = byId(c.dinners)[id];
  if (!m) { swapSheet(dayIdx); return; }
  const cost = itemsCost(m.items, P), portions = c.settings.adultPortions;
  const bought = m.items.filter(([k]) => !P[k].pantry).reduce((t, [k, q]) => t + Math.ceil(q - .02) * P[k].price, 0);
  const days = weekDays(app.current);
  const head = '<div class="eyebrow">' + (dayIdx != null ? days[dayIdx].dow + ' ' + days[dayIdx].month + ' ' + days[dayIdx].date : 'Meal card') + '</div><h2 id="sheetTitle">' + esc(m.name) + '</h2>';
  let b = '<div class="stats">' +
    '<div class="stat"><b class="num">' + money(cost) + '</b><small>True cost of this dinner</small></div>' +
    '<div class="stat"><b class="num">' + money(cost / portions) + '</b><small>Per adult portion</small></div>' +
    '<div class="stat"><b>All 5</b><small>About ' + portions + ' adult portions</small></div></div>';
  if (m.takeout) {
    const max = Math.max(m.takeout, cost);
    b += '<div class="vs"><div class="vs-row"><span>Made at home</span><span class="vs-bar"><span style="width:' + (cost / max * 100) + '%;background:var(--accent)"></span></span><b class="num">' + whole(cost) + '</b></div>' +
      '<div class="vs-row"><span>' + esc(m.takeoutName || 'Takeout') + '</span><span class="vs-bar"><span style="width:' + (m.takeout / max * 100) + '%;background:var(--butter)"></span></span><b class="num">' + whole(m.takeout) + '</b></div>' +
      '<p>Cooking this saves about ' + whole(m.takeout - cost) + '.</p></div>';
  }
  if (m.dyeTip) b += '<div class="tip dye">' + ICON.drop + '<span>' + esc(m.dyeTip) + '</span></div>';
  if (m.good) b += '<div class="tip good">' + ICON.leaf + '<span>' + esc(m.good) + '</span></div>';
  b += '<div><h3 style="margin-bottom:4px">What goes into it</h3>';
  m.items.forEach(([k, q]) => {
    const p = P[k];
    if (!p) return;
    b += '<div class="ing"><span><button type="button" class="ing-name" data-product="' + k + '">' + esc(displayName(p)) + '</button>' + (p.pantry ? ' <span class="pantry-tag">pantry</span>' : '') + '<small>' + esc(useText(q, p)) + ' ' + saleChip(p) + dyeBadge(k, p) + '</small></span><b class="num">' + money(p.price * q) + '</b></div>';
  });
  b += '</div><p class="why">True cost counts only what this meal uses. Bought just for this dinner, the receipt would be about ' + whole(bought) + '. The rest carries into other meals.</p>';
  if (dayIdx != null) b += '<button class="cta ghost" type="button" data-swap="' + dayIdx + '">' + ICON.swap + 'Swap this dinner</button>';
  openSheet(head, b);
}

function swapSheet(dayIdx) {
  const c = app.catalog, w = week(), cur = w.plan[dayIdx], d = weekDays(app.current)[dayIdx];
  const head = '<div class="eyebrow">' + d.dow + ' ' + d.month + ' ' + d.date + '</div><h2 id="sheetTitle">Pick a dinner</h2>';
  const list = c.dinners.slice().sort((a, b) => itemsCost(a.items, c.products) - itemsCost(b.items, c.products));
  let b = '<div class="opts">';
  list.forEach(m => {
    const cost = itemsCost(m.items, c.products), [tc, tl] = tier(cost);
    const sh = sharedWith(c, w.plan, dayIdx, m.id).map(s => c.products[s.key].shareName).filter((v, i, a) => a.indexOf(v) === i);
    const used = w.plan.some((id, i) => i !== dayIdx && id === m.id);
    b += '<button class="opt' + (cur === m.id ? ' current' : '') + '" type="button" data-pick="' + m.id + '" data-day="' + dayIdx + '"><span style="min-width:0"><span class="meal-name">' + esc(m.name) + '</span><span class="meal-meta"><span class="chip ' + tc + '">' + tl + '</span>' +
      (m.idea ? '<span class="chip idea">New idea</span>' : '') +
      (sh.length ? '<span class="chip share">Shares ' + esc(sh.slice(0, 2).join(' & ')) + '</span>' : '') +
      (used ? '<span>Already this week</span>' : '') + '</span></span><span class="opt-cost num">' + money(cost) + '</span></button>';
  });
  b += '<div class="opts-row">' +
    '<button class="opt' + (cur === 'leftovers' ? ' current' : '') + '" type="button" data-pick="leftovers" data-day="' + dayIdx + '"><span class="meal-name">Leftovers</span><span class="opt-cost">$0</span></button>' +
    '<button class="opt' + (cur === 'out' ? ' current' : '') + '" type="button" data-pick="out" data-day="' + dayIdx + '"><span class="meal-name">Eat out</span><span class="opt-cost">—</span></button></div></div>';
  openSheet(head, b);
}

function dyeSheet(key) {
  const p = app.catalog.products[key];
  if (!p) return;
  const head = '<div class="eyebrow">Dye check</div><h2 id="sheetTitle">' + esc(p.name) + '</h2>';
  let b;
  if (p.dyeChecked) {
    const who = p.dyeCheckedBy ? ' by ' + esc(p.dyeCheckedBy.split('@')[0]) : '';
    b = '<div class="tip good">' + ICON.shield + '<span>Label checked on ' + esc(p.dyeChecked) + who + '. No red or blue dyes.</span></div>' +
      '<p class="why">Recipes change now and then. If the package looks different, it\'s worth a quick re-check.</p>' +
      '<button class="cta ghost" type="button" data-dyeset="' + key + '" data-val="off">Remove the check</button>';
  } else {
    b = '<div class="tip dye">' + ICON.eye + '<span>This kind of product sometimes has red or blue dyes. Look for <b>Red 40, Red 3, Blue 1 or Blue 2</b> in the ingredients (also written as "FD&amp;C Red No. 40" or "Allura Red").</span></div>' +
      '<button class="cta" type="button" data-dyeset="' + key + '" data-val="on">' + ICON.shield + 'It\'s dye-free. Mark it checked</button>' +
      '<p class="why">Once it\'s checked, it shows as safe everywhere in the app for both of you.</p>';
  }
  openSheet(head, b);
}

async function setDyeChecked(key, on) {
  const p = app.catalog.products[key];
  const value = on ? isoDate(new Date()) : null;
  let res;
  try { res = await api('/api/products/' + key, { method: 'PATCH', body: { dyeChecked: value } }); }
  catch { toast('You\'re offline. Try again when you have signal.'); return; }
  if (res.status === 401) { signOutLocal(); return; }
  if (res.status !== 200) { toast('That didn\'t save. Try again.'); return; }
  app.catalog.products[key] = res.data.product;
  saveCache();
  renderAll();
  closeSheet();
  toast(on ? p.name + ' marked dye-free' : 'Check removed');
}

// ---------- King Soopers products ----------
function priceSourceNote() {
  const s = app.catalog.settings;
  if (!s.krogerStore || !s.pricesUpdatedAt) return 'Prices are estimates until King Soopers prices are connected.';
  const when = new Date(s.pricesUpdatedAt);
  const sameDay = when.toDateString() === new Date().toDateString();
  return 'Prices from ' + s.krogerStore.name.replace(/^King Soopers( Marketplace)? - /, '') + ' King Soopers, updated ' +
    (sameDay ? 'today' : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '.';
}

function productSheet(key) {
  const p = app.catalog.products[key];
  if (!p) return;
  const k = p.kroger;
  const head = '<div class="eyebrow">' + esc(p.name) + '</div><h2 id="sheetTitle">' + esc(displayName(p)) + '</h2>';
  let b = '';
  if (k) {
    b += '<div class="kp">' + (k.image ? '<img src="' + esc(k.image) + '" alt="" width="88" height="88" loading="lazy">' : '') +
      '<div><div class="kp-price num">' + (onSale(p) ? money(k.promo) + ' <s>' + money(k.regular) + '</s>' : money(k.regular)) + '</div>' +
      '<div class="kp-meta">' + esc([k.size, k.aisle].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="kp-meta">' + saleChip(p) + dyeBadge(key, p) + (k.stock === 'LOW' ? '<span class="chip treat">Low stock</span>' : '') + (k.unavailable ? '<span class="chip treat">Not at your store right now</span>' : '') + '</div></div></div>';
    if (!k.confirmed) {
      b += '<div class="tip good">' + ICON.leaf + '<span>The app picked this one automatically. If it\'s what you buy, tap <b>This is right</b>. If not, search for the right one below.</span></div>' +
        '<button class="cta" type="button" data-confirm="' + key + '">' + ICON.check + 'This is right</button>';
    }
  } else {
    b += '<div class="tip dye">' + ICON.eye + '<span>This isn\'t linked to a King Soopers product yet, so its price is an estimate. Search for it below.</span></div>';
  }
  b += '<div class="field"><label for="psearch">Find a different product</label><input id="psearch" type="search" placeholder="Search King Soopers" value="' + esc(p.name) + '" autocomplete="off"></div>' +
    '<div class="opts" id="presults"></div>';
  openSheet(head, b);
  const input = $('psearch');
  let timer;
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => runSearch(key, input.value), 400); };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); runSearch(key, input.value); } };
}

async function runSearch(key, q) {
  const box = $('presults');
  if (!box) return;
  if (q.trim().length < 3) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="hint">Searching…</p>';
  let res;
  try { res = await api('/api/kroger/search?q=' + encodeURIComponent(q.trim())); }
  catch { box.innerHTML = '<p class="hint">You\'re offline. Try again when you have signal.</p>'; return; }
  if (res.status !== 200) { box.innerHTML = '<p class="hint">' + esc(res.data?.error || 'Search didn\'t work. Try again.') + '</p>'; return; }
  const current = app.catalog.products[key].kroger?.productId;
  box.innerHTML = res.data.results.length ? res.data.results.map(r =>
    '<button class="opt kopt' + (r.productId === current ? ' current' : '') + '" type="button" data-choose="' + r.productId + '" data-key="' + key + '">' +
    (r.image ? '<img src="' + esc(r.image) + '" alt="" width="44" height="44" loading="lazy">' : '<span></span>') +
    '<span style="min-width:0"><span class="meal-name">' + esc(r.description) + '</span><span class="meal-meta">' + esc(r.size) +
    (r.promo > 0 && r.promo < r.regular ? '<span class="chip sale">Sale</span>' : '') + '</span></span>' +
    '<span class="opt-cost num">' + money(r.promo > 0 && r.promo < r.regular ? r.promo : r.regular) + '</span></button>').join('')
    : '<p class="hint">Nothing found. Try fewer or different words.</p>';
}

async function chooseProduct(key, productId) {
  let res;
  try { res = await api('/api/products/' + key + '/kroger', { method: 'PUT', body: { productId } }); }
  catch { toast('You\'re offline. Try again when you have signal.'); return; }
  if (res.status === 401) { signOutLocal(); return; }
  if (res.status !== 200) { toast(res.data?.error || 'That didn\'t save. Try again.'); return; }
  app.catalog.products[key] = res.data.product;
  saveCache();
  renderAll();
  closeSheet();
  toast('Saved: ' + displayName(res.data.product));
}

function copySheet() {
  const c = app.catalog, rows = buildList(c, week()), t = totals(rows);
  const text = listAsText(c, rows, 'Week of ' + weekLabel(app.current));
  const head = '<div class="eyebrow">Pickup order</div><h2 id="sheetTitle">Your list, ready to copy</h2>';
  const b = '<div class="store"><span class="store-logo">KS</span><p><b>Sending to your cart is coming soon</b>Once King Soopers is connected, this button fills your cart. For now, copy the list and paste it into Notes or a text.</p></div>' +
    '<textarea id="listText" readonly rows="10" style="width:100%;font:inherit;font-size:13px;border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:var(--surface-2);color:var(--ink)">' + esc(text) + '</textarea>' +
    '<button class="cta" type="button" id="doCopy">' + ICON.copy + 'Copy ' + t.count + ' items</button>';
  openSheet(head, b);
  $('doCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('List copied'); closeSheet(); }
    catch { const ta = $('listText'); ta.focus(); ta.select(); toast('Press and hold to copy'); }
  };
}

function suggest() {
  week().plan = suggestPlan(app.catalog);
  markDirty();
  renderAll();
  toast('New week suggested');
}

function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-tab],[data-open],[data-swap],[data-pick],[data-item],[data-meal],[data-step],[data-dye],[data-dyeset],[data-hide],[data-product],[data-choose],[data-confirm]');
  if (!el || !app.catalog) return;
  const ds = el.dataset, w = week();
  if (ds.tab) setTab(ds.tab);
  else if (ds.product) { e.stopPropagation(); productSheet(ds.product); }
  else if (ds.choose) chooseProduct(ds.key, ds.choose);
  else if (ds.confirm) chooseProduct(ds.confirm, app.catalog.products[ds.confirm].kroger.productId);
  else if (ds.hide) { local.set('hide:' + ds.hide, true); renderAll(); }
  else if (ds.dye) { e.stopPropagation(); dyeSheet(ds.dye); }
  else if (ds.dyeset) setDyeChecked(ds.dyeset, ds.val === 'on');
  else if (ds.step) {
    const g = w[ds.step];
    g[ds.id] = Math.max(0, (g[ds.id] || 0) + (+ds.d));
    const sc = $('screen-every').scrollTop;
    markDirty();
    renderMeter(); renderEvery(); renderList();
    $('screen-every').scrollTop = sc;
    const again = document.querySelector('[data-step="' + ds.step + '"][data-id="' + ds.id + '"][data-d="' + ds.d + '"]');
    if (again && !again.disabled) again.focus();
  }
  else if (ds.open != null) mealSheet(w.plan[+ds.open], +ds.open);
  else if (ds.swap != null) swapSheet(+ds.swap);
  else if (ds.pick) {
    const d = +ds.day;
    w.plan[d] = ds.pick;
    markDirty();
    renderAll();
    closeSheet();
    const m = byId(app.catalog.dinners)[ds.pick];
    toast(weekDays(app.current)[d].dow + ': ' + (m ? m.name : SPECIAL[ds.pick].name));
  }
  else if (ds.item) {
    const row = buildList(app.catalog, w).find(r => r.key === ds.item);
    w.on[ds.item] = !(row && row.on);
    const sc = $('screen-list').scrollTop;
    markDirty();
    renderMeter(); renderList();
    $('screen-list').scrollTop = sc;
  }
  else if (ds.meal) mealSheet(ds.meal, null);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

boot();
