import {
  SPECIAL, upcomingDates, dayInfo, rangeLabel, isoDate, itemsCost, tier, byId,
  normalizeHousehold, fillDinners, fillEveryday, tally, slotKey, SLOTS, sharedWith, suggestPlan, buildList, totals, listAsText
} from './logic.js';

// ---------- App state ----------
// Dinners are stored per date; the app always shows today and the next 6 days.
// Breakfast, lunch, snacks and list check-offs are household-wide picks.
const CACHE_KEY = 'fp-cache-v2';
const app = {
  user: null,
  catalog: null,
  household: null,                     // { bf, ln, sn, on, sentAt, updatedAt }
  dinners: { days: {}, updatedAt: 0 }, // { days: { 'YYYY-MM-DD': mealId } }
  dirty: { household: false, days: {} },
  tab: 'week',
  sync: 'saved'                        // saved | saving | offline
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
  local.set(CACHE_KEY, { user: app.user, kroger: app.kroger, catalog: app.catalog, household: app.household, dinners: app.dinners, dirty: app.dirty });
}
function isDirty() { return app.dirty.household || Object.keys(app.dirty.days).length > 0; }

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

async function load({ quiet } = {}) {
  let res;
  try { res = await api('/api/bootstrap'); }
  catch { setSync('offline'); return false; }
  if (res.status === 401) { signOutLocal(); return false; }
  if (res.status !== 200) { if (!quiet) toast('Couldn\'t load. Showing what\'s saved on this phone.'); return false; }
  const { user, catalog, household, dinners, kroger } = res.data;
  app.user = user;
  app.catalog = catalog;
  app.kroger = kroger || { connected: false };
  // Server wins unless this phone has unsaved changes.
  if (!app.dirty.household || !app.household || (household && household.updatedAt > app.household.updatedAt)) {
    app.household = normalizeHousehold(catalog, household && !household.fresh ? household : null);
    app.dirty.household = false;
  }
  const days = { ...dinners.days };
  for (const d of Object.keys(app.dirty.days)) days[d] = app.dinners.days[d];
  app.dinners = { days, updatedAt: dinners.updatedAt };
  if (app.sync === 'offline') setSync(isDirty() ? 'saving' : 'saved');
  saveCache();
  if (isDirty()) flushSoon();
  return true;
}

let flushTimer = null, retryTimer = null;
function markHousehold() {
  app.dirty.household = true;
  app.household.updatedAt = Date.now();
  saveCache(); setSync('saving'); flushSoon();
}
function setDinner(date, id) {
  app.dinners.days[date] = id;
  app.dirty.days[date] = true;
  saveCache(); setSync('saving'); flushSoon();
}
function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 700); }
async function flush() {
  clearTimeout(retryTimer);
  const fail = () => { setSync('offline'); retryTimer = setTimeout(flush, 15000); };
  try {
    const dates = Object.keys(app.dirty.days);
    if (dates.length) {
      const body = { days: Object.fromEntries(dates.map(d => [d, app.dinners.days[d]])) };
      const res = await api('/api/dinners', { method: 'PUT', body });
      if (res.status === 401) { signOutLocal(); return; }
      if (res.status !== 200) return fail();
      dates.forEach(d => delete app.dirty.days[d]);
      app.dinners = { days: { ...res.data.days, ...Object.fromEntries(Object.keys(app.dirty.days).map(d => [d, app.dinners.days[d]])) }, updatedAt: res.data.updatedAt };
    }
    if (app.dirty.household) {
      const h = app.household;
      const res = await api('/api/household', { method: 'PUT', body: { bf: h.bf, ln: h.ln, sn: h.sn, hh: h.hh || {}, on: h.on, sentAt: h.sentAt || 0 } });
      if (res.status === 401) { signOutLocal(); return; }
      if (res.status !== 200) return fail();
      h.updatedAt = res.data.updatedAt;
      app.dirty.household = false;
    }
  } catch { return fail(); }
  saveCache();
  setSync(isDirty() ? 'saving' : 'saved');
  if (isDirty()) flushSoon();
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
  if (cached && cached.user && cached.catalog && cached.household) {
    Object.assign(app, { user: cached.user, catalog: cached.catalog, kroger: cached.kroger || { connected: false }, household: cached.household, dinners: cached.dinners || { days: {} }, dirty: cached.dirty || { household: false, days: {} } });
    renderShell();
    renderAll();
    if (await load({ quiet: true }) && app.user) renderAll();
  } else {
    let res;
    try { res = await api('/api/bootstrap'); }
    catch { $('boot').textContent = 'Can\'t reach Five Plates. Check your connection and reopen the app.'; return; }
    if (res.status === 401) { renderSignIn(); return; }
    await load();
    renderShell();
    renderAll();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Reopening the app (or the date changing) moves the 7 days forward and picks up the other phone's changes.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !app.user) return;
  renderAll();
  if (await load({ quiet: true }) && app.user) renderAll();
});
window.addEventListener('online', () => { if (isDirty()) flush(); });

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
    await load();
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
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5"/><path d="M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"/></svg>',
  pantry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 10h16M4 16h16M8 6.5h3M8 13h3M8 18.5h3"/></svg>',
  away: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>',
  leftovers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="11" rx="2.5"/><path d="M5 9V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L21 8H6.3"/></svg>',
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
const TITLES = { week: 'Your 7-day plan', every: 'Snacks, drinks & home', list: 'Shopping list', meals: 'Our dinners' };

function renderShell() {
  $('app').innerHTML = `
  <header class="top">
    <div class="brandrow">
      <div class="brand"><span class="plates" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Five Plates</div>
      <span class="sync" id="sync" role="status"></span>
    </div>
    <div>
      <div class="eyebrow" id="eyebrow"></div>
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
    <button class="cta" id="sendBtn" type="button">${ICON.cart}<span id="sendLabel">Send to King Soopers</span></button>
  </div>
  <nav class="tabs" role="tablist" aria-label="Sections">
    <button class="tab" role="tab" aria-selected="true" data-tab="week" id="tab-week" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
      Plan</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="every" id="tab-every" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11h13v1a6.5 6.5 0 0 1-6.5 6.5A6.5 6.5 0 0 1 4 12v-1z"/><path d="M17 12h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/><path d="M6 21h9"/></svg>
      Snacks</button>
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
  $('sendBtn').onclick = sendSheet;
  setSync(isDirty() ? 'saving' : app.sync);
  setTab(app.tab);
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

// The next 7 days of breakfast, lunch and dinner. Empty slots get a suggestion,
// saved right away so both phones agree.
function upcoming() {
  const c = app.catalog, days = app.dinners.days, dates = upcomingDates(new Date());
  const d = fillDinners(c, days, dates);
  const b = fillEveryday(c.breakfasts, app.household.bf, days, dates, 'b');
  const l = fillEveryday(c.lunches, app.household.ln, days, dates, 'l');
  const save = (filled, plan, slot) => filled.forEach(key => {
    const date = key.replace(/^[bl]:/, '');
    days[key] = plan[dates.indexOf(date)];
    app.dirty.days[key] = true;
  });
  save(d.filled.map(x => slotKey('d', x)), d.plan, 'd');
  save(b.filled, b.plan, 'b');
  save(l.filled, l.plan, 'l');
  if (d.filled.length || b.filled.length || l.filled.length) flushSoon();
  return { dates, plan: d.plan, bplan: b.plan, lplan: l.plan, today: dates[0] };
}
function slotPlan(u, slot) { return slot === 'b' ? u.bplan : slot === 'l' ? u.lplan : u.plan; }
function slotList(slot) { return slot === 'b' ? app.catalog.breakfasts : slot === 'l' ? app.catalog.lunches : app.catalog.dinners; }
// What the list and totals work from: the next 7 days of meals plus the weekly shelves.
function week() {
  const h = app.household, u = upcoming();
  if (!h.hh) h.hh = {};
  return { plan: u.plan, bf: tally(u.bplan), ln: tally(u.lplan), sn: h.sn, hh: h.hh, on: h.on, sentAt: h.sentAt };
}
function dayLabel(i) { const u = upcoming(); return dayInfo(u.dates[i], u.today); }
function renderAll() {
  if (!$('meter')) return;
  $('eyebrow').textContent = 'Next 7 days · ' + rangeLabel(upcoming().dates);
  renderMeter(); renderWeek(); renderEvery(); renderList(); renderMeals();
}

// ---------- Header meter ----------
function renderMeter() {
  const c = app.catalog, t = totals(buildList(c, week()));
  const budget = c.settings.weeklyBudget;
  const pct = x => Math.min(100, x / budget * 100);
  const left = budget - t.total;
  const note = left >= 0 ? whole(left) + ' left this week' : 'A little over. Try swapping one thing.';
  const segs = [['dinner', 'Dinners', '--accent'], ['breakfast', 'Breakfast', '--butter'], ['lunch', 'Lunch', '--sky'], ['snack', 'Snacks', '--clay'], ['household', 'Household', '--muted']];
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

// One card per day with breakfast, lunch and dinner. Each meal shows its cost and can be opened or swapped.
function renderWeek() {
  const c = app.catalog, u = upcoming(), P = c.products;
  const days = u.dates.map(d => dayInfo(d, u.today));
  const lists = { b: byId(c.breakfasts), l: byId(c.lunches), d: byId(c.dinners) };
  let h = dismissible('hello-plan', 'Your next 7 days', 'Tap any meal to see what it costs, or Swap to change it. Each morning the plan moves forward a day, and changes show up on both phones.');
  u.dates.forEach((date, i) => {
    const d = days[i];
    let dayCost = 0, rows = '';
    for (const slot of ['b', 'l', 'd']) {
      const id = slotPlan(u, slot)[i], m = lists[slot][id];
      let name, meta;
      if (m) {
        const cost = itemsCost(m.items, P);
        dayCost += cost;
        name = m.name;
        meta = '<span class="num">' + money(cost) + '</span>';
        if (slot === 'd') {
          const [tc, tl] = tier(cost), sh = sharedWith(c, u.plan, i, id);
          meta += '<span class="chip ' + tc + '">' + tl + '</span>' + (m.idea ? '<span class="chip idea">New idea</span>' : '') +
            (sh.length ? '<span class="chip share">Shares ' + esc(P[sh[0].key].shareName) + ' with ' + days[sh[0].day].dow + '</span>' : '');
        }
      } else {
        const s = SPECIAL[id] || SPECIAL.leftovers;
        name = s.name; meta = '<span class="blocked">' + (ICON[id] || '') + esc(s.sub) + '</span>';
      }
      rows += '<div class="slot' + (m ? '' : ' off') + '"><span class="slot-label">' + SLOTS[slot] + '</span>' +
        '<button class="meal-btn" type="button" data-open="' + i + '" data-slot="' + slot + '"><span class="meal-name">' + esc(name) + '</span><span class="meal-meta">' + meta + '</span></button>' +
        '<button class="swap" type="button" data-swap="' + i + '" data-slot="' + slot + '" aria-label="Swap ' + d.dow + ' ' + SLOTS[slot] + '">' + ICON.swap + 'Swap</button></div>';
    }
    h += '<section class="daycard"><div class="daycard-head"><span><b>' + (d.rel || d.dow) + '</b> ' + d.month + ' ' + d.date + '</span><span class="num">' + money(dayCost) + '</span></div>' + rows + '</section>';
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
// A shelf of things bought by the package: snacks and drinks, or household supplies.
function shelfSection(title, keys, picks, group, cost, kind, tip) {
  const P = app.catalog.products;
  const packs = keys.reduce((s, k) => s + (picks[k] || 0), 0);
  let h = '<section class="sec"><div class="sec-head"><div><h2>' + title + '</h2><small>' + packs + ' pack' + (packs === 1 ? '' : 's') + ' this week</small></div><div class="sec-cost num">' + whole(cost) + '<small>this week</small></div></div>';
  keys.forEach(k => {
    const p = P[k], n = picks[k] || 0;
    if (!p) return;
    h += '<div class="erow' + (n ? '' : ' zero') + '"><div style="min-width:0"><button type="button" class="erow-name ing-name" data-product="' + k + '">' + esc(displayName(p)) + '</button><div class="erow-sub"><span>' + money(p.price) + (p.size ? ' · ' + esc(p.size) : '') + '</span>' + (p.store === 'costco' ? '<span class="chip costco">Costco</span>' : '') + dyeBadge(k, p) + '</div></div>' +
      stepper(group, k, n, n < 6, p.name) + '</div>';
  });
  h += '<button class="addrow" type="button" data-add="' + kind.split(' ')[0] + '">' + ICON.plus + 'Add a ' + kind + '</button>';
  return h + '<p class="sec-tip">' + esc(tip) + '</p></section>';
}

function renderEvery() {
  const c = app.catalog, w = week(), t = totals(buildList(c, w));
  let h = '';
  h += shelfSection('Snacks & drinks', c.snacks, w.sn, 'sn', t.snack, 'snack',
    'Costco boxes last a few weeks, so tap + only in the week you restock. Fill a snack bin on Sunday; when it’s empty, it’s fruit until next week. Snacks and drinks grabbed in the aisle are an easy way to go over, and they’re where dyes hide most.');
  h += shelfSection('Household & coffee', c.household || [], w.hh, 'hh', t.household, 'household item',
    'These last a while, so tap + only in the week you’re running low. They come out of the same $400.');
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
    '<span class="item-main"><button type="button" class="item-name" data-product="' + r.key + '">' + esc(displayName(r.product)) + '</button><span class="item-sub"><span>' + esc(src) + '</span>' + saleChip(r.product) + (r.product.swap ? '<span class="chip cheap swapchip">Cheaper option</span>' : '') + dyeBadge(r.key, r.product) + '</span></span>' +
    '<span class="item-right"><span class="item-price num">' + money(r.cost) + '</span><br><span class="item-qty">' + (r.qty > 1 ? r.qty + ' × ' : '') + esc(r.product.size || '1') + '</span></span></div>';
}
function renderList() {
  const c = app.catalog, rows = buildList(c, week()), t = totals(rows);
  const unchecked = rows.filter(r => r.on && r.product.dyeRisk && !r.product.dyeChecked).length;
  let h = '<div class="list-summary"><div><div class="eyebrow">For pickup</div><div class="big num">' + money(t.total) + '</div><small>' + t.count + ' items · whole packages, combined across meals</small></div></div>';
  const swaps = rows.filter(r => r.on && r.product.swap);
  if (swaps.length) {
    const save = swaps.reduce((s, r) => s + r.cost * r.product.swap.savingsPct / 100, 0);
    h += '<div class="tip good">' + ICON.leaf + '<span><b>' + swaps.length + ' cheaper option' + (swaps.length > 1 ? 's' : '') + ' could save about ' + money(save) + ' a week.</b> Tap an item marked "Cheaper option" to see it and switch.</span></div>';
  }
  if (unchecked) {
    h += '<div class="tip dye">' + ICON.eye + '<span><b>' + unchecked + ' item' + (unchecked > 1 ? 's' : '') + ' still need a label check.</b> Tap "Check label" once you\'ve confirmed there\'s no Red 40, Red 3, Blue 1 or Blue 2. The app remembers it after that.</span></div>';
  }
  c.aisles.forEach(a => {
    const rs = rows.filter(r => !r.pantry && r.product.aisle === a).sort((x, y) => x.product.name.localeCompare(y.product.name));
    if (!rs.length) return;
    const sub = rs.filter(r => r.on).reduce((s, r) => s + r.cost, 0);
    h += '<div class="group"><div class="group-head"><h3>' + esc(a === 'Costco' ? 'Costco run' : a) + '</h3><span class="num">' + money(sub) + '</span></div><div class="items">' + rs.map(itemRow).join('') + '</div></div>';
  });
  const pan = rows.filter(r => r.pantry);
  if (pan.length) h += '<div class="group"><div class="group-head"><h3>Probably in the pantry</h3><span>Tap if you need it</span></div><div class="items">' + pan.map(itemRow).join('') + '</div></div>';
  h += '<p class="hint">Uncheck anything you already have.</p>';
  $('screen-list').innerHTML = h;
  $('sendLabel').textContent = 'Send ' + t.count + ' items to King Soopers';
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

function mealSheet(id, dayIdx, slot = 'd') {
  const c = app.catalog, P = c.products, m = byId(slotList(slot))[id];
  if (!m) { swapSheet(dayIdx, slot); return; }
  const what = SLOTS[slot];
  const cost = itemsCost(m.items, P), portions = c.settings.adultPortions;
  const bought = m.items.filter(([k]) => !P[k].pantry).reduce((t, [k, q]) => t + Math.ceil(q - .02) * P[k].price, 0);
  const days = upcoming().dates.map(d => dayInfo(d, upcoming().today));
  const head = '<div class="eyebrow">' + (dayIdx != null ? days[dayIdx].dow + ' ' + days[dayIdx].month + ' ' + days[dayIdx].date : 'Meal card') + '</div><h2 id="sheetTitle">' + esc(m.name) + '</h2>';
  let b = '<div class="stats">' +
    '<div class="stat"><b class="num">' + money(cost) + '</b><small>True cost of this ' + what + '</small></div>' +
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
  b += '</div><p class="why">True cost counts only what this meal uses. Bought just for this ' + what + ', the receipt would be about ' + whole(bought) + '. The rest carries into other meals.</p>';
  if (dayIdx != null) b += '<button class="cta ghost" type="button" data-swap="' + dayIdx + '" data-slot="' + slot + '">' + ICON.swap + 'Swap this ' + what + '</button>';
  openSheet(head, b);
}

function swapSheet(dayIdx, slot = 'd') {
  const c = app.catalog, u = upcoming(), plan = slotPlan(u, slot), cur = plan[dayIdx], d = dayLabel(dayIdx), what = SLOTS[slot];
  const head = '<div class="eyebrow">' + d.dow + ' ' + d.month + ' ' + d.date + '</div><h2 id="sheetTitle">Pick a ' + what + '</h2>';
  const list = slotList(slot).slice().sort((a, b) => itemsCost(a.items, c.products) - itemsCost(b.items, c.products));
  const pick = id => 'data-pick="' + id + '" data-day="' + dayIdx + '" data-slot="' + slot + '"';
  let b = '<div><h3 style="margin-bottom:8px">' + (slot === 'd' ? 'No cooking this day' : 'Not eating at home') + '</h3><div class="blocks">' +
    Object.entries(SPECIAL).map(([id, s]) => '<button class="block' + (cur === id ? ' current' : '') + '" type="button" ' + pick(id) + '>' +
      ICON[id] + '<span>' + esc(s.short) + '</span></button>').join('') + '</div></div>' +
    '<h3>Or pick a ' + what + '</h3><div class="opts">';
  list.forEach(m => {
    const cost = itemsCost(m.items, c.products), [tc, tl] = tier(cost);
    const sh = slot === 'd' ? sharedWith(c, plan, dayIdx, m.id).map(s => c.products[s.key].shareName).filter((v, i, a) => a.indexOf(v) === i) : [];
    const used = plan.filter((id, i) => i !== dayIdx && id === m.id).length;
    b += '<button class="opt' + (cur === m.id ? ' current' : '') + '" type="button" ' + pick(m.id) + '><span style="min-width:0"><span class="meal-name">' + esc(m.name) + '</span><span class="meal-meta">' +
      (slot === 'd' ? '<span class="chip ' + tc + '">' + tl + '</span>' : '') +
      (m.idea ? '<span class="chip idea">New idea</span>' : '') +
      (sh.length ? '<span class="chip share">Shares ' + esc(sh.slice(0, 2).join(' & ')) + '</span>' : '') +
      (used ? '<span>' + (slot === 'd' ? 'Already this week' : used + ' other day' + (used > 1 ? 's' : '')) + '</span>' : '') + '</span></span><span class="opt-cost num">' + money(cost) + '</span></button>';
  });
  b += '</div>';
  if (slot !== 'd') b += '<button class="addrow" type="button" data-add="' + what + '">' + ICON.plus + 'Add a new ' + what + '</button>';
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
  const head = '<div class="eyebrow">' + esc(p.store === 'costco' ? 'Costco' : p.name) + '</div><h2 id="sheetTitle">' + esc(displayName(p)) + '</h2>';
  if (p.store === 'costco') {
    openSheet(head,
      '<div class="kp-meta">' + esc(p.size || '') + dyeBadge(key, p) + '</div>' +
      '<div class="field"><label for="editPrice">Price at Costco</label><input id="editPrice" type="number" inputmode="decimal" step="0.01" min="0" value="' + p.price.toFixed(2) + '"></div>' +
      '<button class="cta" type="button" id="savePrice">Save price</button>' +
      '<p class="why">Costco has no price feed, so update this when the price on the shelf changes.</p>');
    $('savePrice').onclick = () => savePrice(key);
    return;
  }
  let b = '';
  if (k) {
    b += '<div class="kp">' + (k.image ? '<img src="' + esc(k.image) + '" alt="" width="88" height="88" loading="lazy">' : '') +
      '<div><div class="kp-price num">' + (onSale(p) ? money(k.promo) + ' <s>' + money(k.regular) + '</s>' : money(k.regular)) + '</div>' +
      '<div class="kp-meta">' + esc([k.size, k.aisle].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="kp-meta">' + saleChip(p) + dyeBadge(key, p) + (k.stock === 'LOW' ? '<span class="chip treat">Low stock</span>' : '') + (k.unavailable ? '<span class="chip treat">Not at your store right now</span>' : '') + '</div></div></div>';
    if (p.swap) {
      const s = p.swap;
      b += '<div class="swapcard"><div class="eyebrow">Cheaper option · about ' + s.savingsPct + '% less for the same amount</div>' +
        '<div class="kp">' + (s.image ? '<img src="' + esc(s.image) + '" alt="" width="64" height="64" loading="lazy">' : '<span></span>') +
        '<div><div class="meal-name">' + esc(s.description) + '</div><div class="kp-meta">' + esc(s.size) + ' · ' + money(s.price) + '</div></div></div>' +
        '<p class="why">Same kind of food at your store. It keeps anything like organic, protein or no sugar added. Switching clears the dye check, so give the new label a quick look.</p>' +
        '<button class="cta" type="button" data-choose="' + s.productId + '" data-key="' + key + '">' + ICON.swap + 'Switch to this</button></div>';
    }
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

// ---------- Add a breakfast, lunch or snack ----------
const LASTS = [1, 2, 3, 4, 5, 7];
function addSheet(kind, source = 'ks') {
  const unit = kind === 'breakfast' ? 'mornings' : kind === 'lunch' ? 'lunches' : '';
  const head = '<div class="eyebrow">' + ({ snack: 'Snacks & drinks', household: 'Household & coffee', breakfast: 'Breakfast', lunch: 'Lunch' }[kind]) + '</div><h2 id="sheetTitle">Add a ' + (kind === 'household' ? 'household item' : kind) + '</h2>';
  let b = '<div class="seg" role="tablist">' +
    '<button type="button" role="tab" data-addsrc="ks" data-kind="' + kind + '" aria-selected="' + (source === 'ks') + '">King Soopers</button>' +
    '<button type="button" role="tab" data-addsrc="costco" data-kind="' + kind + '" aria-selected="' + (source === 'costco') + '">Costco or other</button></div>';
  if (kind === 'breakfast' || kind === 'lunch') {
    b += '<div class="field"><label for="addName">Name it</label><input id="addName" type="text" placeholder="' + (kind === 'breakfast' ? 'Turkey bacon & eggs' : 'Goodles mac & cheese') + '" autocomplete="off"></div>' +
      '<div class="field"><label>One package lasts about</label><div class="chips" id="lastsChips">' +
      LASTS.map(n => '<button type="button" class="pick' + (n === 3 ? ' on' : '') + '" data-lasts="' + n + '">' + n + ' ' + (n === 1 ? unit.replace(/s$/, '').replace('lunche', 'lunch') : unit) + '</button>').join('') + '</div></div>';
  }
  if (source === 'ks') {
    b += '<div class="field"><label for="addSearch">Find it at King Soopers</label><input id="addSearch" type="search" placeholder="Search King Soopers" autocomplete="off"></div><div class="opts" id="addResults"></div>';
  } else {
    b += '<div class="field"><label for="cName">What is it?</label><input id="cName" type="text" placeholder="Annie\'s fruit snacks" autocomplete="off"></div>' +
      '<div class="opts-row"><div class="field"><label for="cPrice">Price</label><input id="cPrice" type="number" inputmode="decimal" step="0.01" min="0" placeholder="13.99"></div>' +
      '<div class="field"><label for="cSize">Size</label><input id="cSize" type="text" placeholder="42 ct" autocomplete="off"></div></div>' +
      '<button class="cta" type="button" id="cAdd">' + ICON.plus + 'Add it</button>' +
      '<p class="why">Costco items stay on your list for the Costco run and aren\'t sent to King Soopers.</p>';
  }
  openSheet(head, b);
  const lasts = () => { const on = document.querySelector('#lastsChips .pick.on'); return on ? +on.dataset.lasts : 3; };
  const nameVal = () => ($('addName') && $('addName').value.trim()) || '';
  if (source === 'ks') {
    const input = $('addSearch');
    let timer;
    input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => addSearch(kind, input.value), 400); };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); addSearch(kind, input.value); } };
    $('addResults').onclick = e => {
      const btn = e.target.closest('[data-addpick]');
      if (btn) addEveryday(kind, { productId: btn.dataset.addpick, lasts: lasts(), name: nameVal() });
    };
  } else {
    $('cAdd').onclick = () => addEveryday(kind, { custom: { name: $('cName').value, price: $('cPrice').value, size: $('cSize').value }, lasts: lasts(), name: nameVal() || $('cName').value });
  }
}

async function addSearch(kind, q) {
  const box = $('addResults');
  if (!box) return;
  if (q.trim().length < 3) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="hint">Searching…</p>';
  let res;
  try { res = await api('/api/kroger/search?q=' + encodeURIComponent(q.trim())); }
  catch { box.innerHTML = '<p class="hint">You\'re offline. Try again when you have signal.</p>'; return; }
  if (res.status !== 200) { box.innerHTML = '<p class="hint">' + esc(res.data?.error || 'Search didn\'t work. Try again.') + '</p>'; return; }
  box.innerHTML = res.data.results.length ? res.data.results.map(r =>
    '<button class="opt kopt" type="button" data-addpick="' + r.productId + '">' +
    (r.image ? '<img src="' + esc(r.image) + '" alt="" width="44" height="44" loading="lazy">' : '<span></span>') +
    '<span style="min-width:0"><span class="meal-name">' + esc(r.description) + '</span><span class="meal-meta">' + esc(r.size) + '</span></span>' +
    '<span class="opt-cost num">' + money(r.promo > 0 && r.promo < r.regular ? r.promo : r.regular) + '</span></button>').join('')
    : '<p class="hint">Nothing found. Try fewer or different words.</p>';
}

async function addEveryday(kind, body) {
  let res;
  try { res = await api('/api/everyday', { method: 'POST', body: { kind, ...body } }); }
  catch { toast('You\'re offline. Try again when you have signal.'); return; }
  if (res.status === 401) { signOutLocal(); return; }
  if (res.status !== 200) { toast(res.data?.error || 'That didn\'t save. Try again.'); return; }
  app.catalog = res.data.catalog;
  if (!app.dirty.household) app.household = normalizeHousehold(app.catalog, res.data.household);
  else if (kind === 'snack') app.household.sn[res.data.entryId] = Math.max(1, app.household.sn[res.data.entryId] || 0);
  else if (kind === 'household') (app.household.hh = app.household.hh || {})[res.data.entryId] = Math.max(1, app.household.hh[res.data.entryId] || 0);
  saveCache();
  renderAll();
  closeSheet();
  toast(kind === 'snack' || kind === 'household' ? 'Added for this week' : 'Added. Tap + to plan it.');
}

async function savePrice(key) {
  const price = $('editPrice').value;
  let res;
  try { res = await api('/api/products/' + key, { method: 'PATCH', body: { price } }); }
  catch { toast('You\'re offline. Try again when you have signal.'); return; }
  if (res.status !== 200) { toast(res.data?.error || 'That didn\'t save. Try again.'); return; }
  app.catalog.products[key] = res.data.product;
  saveCache(); renderAll(); closeSheet();
  toast('Price saved');
}

// ---------- Send to King Soopers ----------
function sendSheet() {
  const c = app.catalog, rows = buildList(c, week()).filter(r => r.on);
  if (!app.kroger || !app.kroger.connected) {
    openSheet('<div class="eyebrow">One-time setup</div><h2 id="sheetTitle">Connect King Soopers</h2>',
      '<div class="store"><span class="store-logo">KS</span><p><b>Link the King Soopers account you order pickup with</b>You’ll sign in on King Soopers’ own page. Five Plates never sees the password, and it can only add items to the cart. It can’t check out or pay.</p></div>' +
      '<a class="cta" href="/api/kroger/connect">' + ICON.cart + 'Connect King Soopers</a>' +
      '<p class="why">Do this once. After that, the button sends your whole list to the cart. When King Soopers says it’s connected, come back to Five Plates.</p>' +
      '<button class="cta ghost" type="button" id="copyInstead">' + ICON.copy + 'Copy the list instead</button>');
    $('copyInstead').onclick = copySheet;
    return;
  }
  const linked = rows.filter(r => r.product.kroger && !r.product.kroger.unavailable);
  const costco = rows.filter(r => r.product.store === 'costco');
  const missing = rows.filter(r => r.product.store !== 'costco' && (!r.product.kroger || r.product.kroger.unavailable));
  const sentAt = app.household.sentAt && Date.now() - app.household.sentAt < 6 * 86400_000 ? app.household.sentAt : 0;
  const total = linked.reduce((s, r) => s + r.cost, 0);
  let b = '<div class="store"><span class="store-logo">KS</span><p><b>' + esc((c.settings.krogerStore && c.settings.krogerStore.name) || 'Your King Soopers') + '</b>Items go into your cart. You pick the pickup time and check out in the King Soopers app.</p></div>';
  if (sentAt) b += '<div class="tip dye">' + ICON.eye + '<span>You already sent a list on ' + esc(new Date(sentAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '. Sending again adds everything a second time, so clear the cart first if you’re starting over.</span></div>';
  if (missing.length) b += '<p class="why">' + missing.length + ' item' + (missing.length > 1 ? 's aren’t' : ' isn’t') + ' linked to a King Soopers product and will be skipped: ' + esc(missing.map(r => r.product.name).join(', ')) + '.</p>';
  if (costco.length) b += '<p class="why">' + costco.length + ' Costco item' + (costco.length > 1 ? 's stay' : ' stays') + ' on your list for the Costco run.</p>';
  b += '<div class="send-list">' + linked.map(r => '<div class="send-row done"><span>' + esc(displayName(r.product)) + '</span><span class="num">' + (r.qty > 1 ? '×' + r.qty : '') + '</span></div>').join('') + '</div>' +
    '<button class="cta" type="button" id="doSend">' + ICON.cart + 'Add ' + linked.length + ' items · about ' + money(total) + '</button>' +
    '<button class="textlink" type="button" id="copyInstead">Copy the list instead</button>';
  openSheet('<div class="eyebrow">Pickup order</div><h2 id="sheetTitle">Send to your cart</h2>', b);
  $('copyInstead').onclick = copySheet;
  $('doSend').onclick = async () => {
    const btn = $('doSend');
    btn.disabled = true; btn.textContent = 'Adding to your cart…';
    let res;
    try { res = await api('/api/kroger/cart', { method: 'POST', body: { items: linked.map(r => ({ key: r.key, qty: r.qty })) } }); }
    catch { btn.disabled = false; btn.textContent = 'Try again'; toast('You’re offline. Try again when you have signal.'); return; }
    if (res.status === 401) { signOutLocal(); return; }
    if (res.status === 409) { app.kroger = { connected: false }; saveCache(); sendSheet(); return; }
    if (res.status !== 200) { btn.disabled = false; btn.textContent = 'Try again'; toast(res.data?.error || 'That didn’t go through. Try again.'); return; }
    app.household.sentAt = Date.now();
    markHousehold();
    sentSheet(res.data);
  };
}

function sentSheet(r) {
  openSheet('<div class="eyebrow">Done</div><h2 id="sheetTitle">It’s in your cart</h2>',
    '<div class="done-mark">' + ICON.check + '</div>' +
    '<div class="center"><h2>' + r.added + ' items added</h2><p>Open the King Soopers app, pick a pickup time, and check out.</p></div>' +
    (r.skipped && r.skipped.length ? '<p class="why">Skipped (add these yourself): ' + esc(r.skipped.join(', ')) + '.</p>' : '') +
    '<a class="cta" href="https://www.kingsoopers.com/cart" target="_blank" rel="noopener">Open King Soopers</a>' +
    '<button class="cta ghost" type="button" id="doneBtn">Done</button>');
  $('doneBtn').onclick = closeSheet;
}

function copySheet() {
  const c = app.catalog, rows = buildList(c, week()), t = totals(rows);
  const text = listAsText(c, rows, 'Dinners ' + rangeLabel(upcoming().dates));
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
  const c = app.catalog, u = upcoming(), plan = suggestPlan(c), seed = String(Date.now());
  const b = fillEveryday(c.breakfasts, app.household.bf, {}, u.dates, 'b', seed);
  const l = fillEveryday(c.lunches, app.household.ln, {}, u.dates, 'l', seed);
  u.dates.forEach((d, i) => { setDinner(d, plan[i]); setDinner(slotKey('b', d), b.plan[i]); setDinner(slotKey('l', d), l.plan[i]); });
  renderAll();
  toast('New 7 days suggested');
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
  const el = e.target.closest('[data-tab],[data-open],[data-swap],[data-pick],[data-item],[data-meal],[data-step],[data-dye],[data-dyeset],[data-hide],[data-product],[data-choose],[data-confirm],[data-add],[data-addsrc],[data-lasts]');
  if (!el || !app.catalog) return;
  const ds = el.dataset, w = week();
  if (ds.tab) setTab(ds.tab);
  else if (ds.add) addSheet(ds.add);
  else if (ds.addsrc) addSheet(ds.kind, ds.addsrc);
  else if (ds.lasts) { document.querySelectorAll('#lastsChips .pick').forEach(b => b.classList.toggle('on', b === el)); }
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
    markHousehold();
    renderMeter(); renderEvery(); renderList();
    $('screen-every').scrollTop = sc;
    const again = document.querySelector('[data-step="' + ds.step + '"][data-id="' + ds.id + '"][data-d="' + ds.d + '"]');
    if (again && !again.disabled) again.focus();
  }
  else if (ds.open != null) { const slot = ds.slot || 'd'; mealSheet(slotPlan(upcoming(), slot)[+ds.open], +ds.open, slot); }
  else if (ds.swap != null) swapSheet(+ds.swap, ds.slot || 'd');
  else if (ds.pick) {
    const d = +ds.day, slot = ds.slot || 'd';
    setDinner(slotKey(slot, upcoming().dates[d]), ds.pick);
    renderAll();
    closeSheet();
    const m = byId(slotList(slot))[ds.pick];
    toast(dayLabel(d).dow + ': ' + (m ? m.name : SPECIAL[ds.pick].name));
  }
  else if (ds.item) {
    const row = buildList(app.catalog, w).find(r => r.key === ds.item);
    w.on[ds.item] = !(row && row.on);
    const sc = $('screen-list').scrollTop;
    markHousehold();
    renderMeter(); renderList();
    $('screen-list').scrollTop = sc;
  }
  else if (ds.meal) mealSheet(ds.meal, null);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

boot();
