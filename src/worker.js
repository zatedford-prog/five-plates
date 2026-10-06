import { SEED_CATALOG } from './seed.js';
import {
  KrogerError, findStores, searchProducts, productsById, bestMatch, currentPrice,
  authorizeUrl, exchangeCode, freshUserToken, addToCart, swapSearchTerm, findSwap
} from './kroger.js';

// Static files in /public are served straight from Cloudflare's edge; only /api/* reaches this code.
const COOKIE = 'fp_session';
const SESSION_DAYS = 400; // the longest browsers allow, so phones stay signed in
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PRODUCT_RE = /^\/api\/products\/([A-Za-z0-9_-]{1,40})$/;
const MAX_BODY = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof KrogerError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },

  // Daily price refresh (see "triggers" in wrangler.jsonc).
  async scheduled(event, env, ctx) {
    // Prices first, then look for cheaper options on a batch of products (stays under the per-run request limit).
    ctx.waitUntil(refreshPrices(env).then(() => findSwaps(env, 30)).catch(err => console.error('daily job failed', err)));
  }
};

async function route(request, env, url) {
  const { pathname } = url, method = request.method;
  if (pathname === '/api/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });

  if (pathname === '/api/kroger/callback' && method === 'GET') return krogerCallback(env, url);

  const user = await sessionUser(request, env);
  if (!user) return json({ error: 'signin' }, 401);
  if (method !== 'GET' && !sameOrigin(request, url)) return json({ error: 'Bad origin' }, 403);

  if (pathname === '/api/bootstrap' && method === 'GET') {
    const catalog = await getCatalog(env);
    const [household, dinners, link] = await Promise.all([getHousehold(env), getDoc(env, 'dinners'), getDoc(env, 'kroger:user')]);
    const kroger = { connected: !!link, connectedBy: link ? link.connectedBy : null };
    return json({ user, catalog, household, dinners: dinners || { days: {}, updatedAt: 0 }, kroger });
  }

  // Breakfast/lunch/snack picks and list check-offs.
  if (pathname === '/api/household' && method === 'PUT') {
    const h = cleanHousehold(await readJson(request));
    if (!h) return json({ error: 'Invalid household' }, 400);
    h.updatedAt = Date.now();
    h.updatedBy = user;
    await putDoc(env, 'household', h);
    return json({ updatedAt: h.updatedAt });
  }

  // Dinner per date. Merges, so two phones changing different days don't overwrite each other.
  if (pathname === '/api/dinners' && method === 'PUT') {
    const body = await readJson(request);
    const incoming = body && body.days && typeof body.days === 'object' ? Object.entries(body.days) : null;
    if (!incoming || incoming.length > 60 || !incoming.every(([d, id]) => DATE_RE.test(d) && typeof id === 'string' && id.length <= 40)) {
      return json({ error: 'Invalid dinners' }, 400);
    }
    const doc = (await getDoc(env, 'dinners')) || { days: {} };
    for (const [d, id] of incoming) doc.days[d] = id;
    const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
    for (const d of Object.keys(doc.days)) if (d < cutoff) delete doc.days[d];
    doc.updatedAt = Date.now();
    doc.updatedBy = user;
    await putDoc(env, 'dinners', doc);
    return json({ updatedAt: doc.updatedAt, days: doc.days });
  }

  // Adds a King Soopers product as a new breakfast, lunch or snack.
  if (pathname === '/api/everyday' && method === 'POST') {
    const body = await readJson(request);
    const kind = body && body.kind;
    if (!['breakfast', 'lunch', 'snack'].includes(kind)) return json({ error: 'Invalid item' }, 400);
    const catalog = await getCatalog(env);
    let key, label;
    if (body.custom) {
      // Something bought elsewhere (usually Costco): no King Soopers link, price typed in by the family.
      const c = body.custom, price = Math.round((+c.price || 0) * 100) / 100;
      const cname = String(c.name || '').trim().slice(0, 60);
      if (!cname || !(price > 0 && price < 500)) return json({ error: 'Add a name and a price.' }, 400);
      key = 'x' + Date.now().toString(36);
      catalog.products[key] = { name: cname, size: String(c.size || '').trim().slice(0, 30), price, aisle: 'Costco', store: 'costco', dyeRisk: true, custom: true };
      label = cname;
    } else {
      if (!/^\d{13}$/.test(String(body.productId))) return json({ error: 'Invalid item' }, 400);
      const store = catalog.settings.krogerStore;
      if (!store) return json({ error: 'Pick your King Soopers store first.' }, 409);
      const [k] = await productsById(env, [body.productId], store.locationId);
      if (!k) return json({ error: 'That product is not sold at your store.' }, 404);
      key = 'k' + k.productId;
      if (!catalog.products[key]) {
        catalog.products[key] = { name: k.description, size: k.size, price: currentPrice(k), aisle: aisleFor(k), dyeRisk: true, custom: true };
        applyKroger(catalog.products[key], k, true, user);
      }
      label = k.description;
    }
    if (!catalog.aisles.includes('Costco')) catalog.aisles.push('Costco');
    const name = String(body.name || label).trim().slice(0, 60) || label;
    const household = await getHousehold(env);
    let entryId = key;
    if (kind === 'snack') {
      if (!catalog.snacks.includes(key)) catalog.snacks.push(key);
      household.sn[key] = Math.max(1, household.sn[key] || 0);
    } else {
      const lasts = Math.max(1, Math.min(14, Math.round(+body.lasts || 3)));
      const list = kind === 'breakfast' ? catalog.breakfasts : catalog.lunches;
      entryId = 'c' + Date.now().toString(36);
      list.push({ id: entryId, name, items: [[key, Math.round(1000 / lasts) / 1000]], custom: true });
      (kind === 'breakfast' ? household.bf : household.ln)[entryId] = 0;
    }
    household.updatedAt = Date.now();
    await Promise.all([putDoc(env, 'catalog', catalog), putDoc(env, 'household', household)]);
    return json({ catalog, household, entryId });
  }

  let m;
  m = pathname.match(PRODUCT_RE);
  if (m && method === 'PATCH') {
    const body = await readJson(request);
    const catalog = await getCatalog(env);
    const p = catalog.products[m[1]];
    if (!p || !body) return json({ error: 'Unknown product' }, 404);
    if ('price' in body) {
      const price = Math.round((+body.price || 0) * 100) / 100;
      if (p.kroger) return json({ error: 'King Soopers sets this price.' }, 400);
      if (!(price > 0 && price < 500)) return json({ error: 'Enter a price.' }, 400);
      p.price = price;
    }
    if ('dyeChecked' in body) {
      if (body.dyeChecked === null) delete p.dyeChecked;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.dyeChecked))) { p.dyeChecked = body.dyeChecked; p.dyeCheckedBy = user; }
      else return json({ error: 'Invalid date' }, 400);
    }
    await putDoc(env, 'catalog', catalog);
    return json({ product: p });
  }

  // Admin-only: replace the catalog (used for maintenance edits like meal quantities).
  if (pathname === '/api/catalog' && method === 'PUT' && user === 'admin') {
    const body = await readJson(request);
    if (!body || !body.products || !Array.isArray(body.dinners)) return json({ error: 'Invalid catalog' }, 400);
    await putDoc(env, 'catalog', body);
    return json({ ok: true });
  }

  // ---------- King Soopers cart ----------
  if (pathname === '/api/kroger/connect' && method === 'GET') {
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ e: user, x: Date.now() + 15 * 60_000, n: crypto.randomUUID() })));
    const state = payload + '.' + await sign(payload, env.SESSION_SECRET);
    return Response.redirect(authorizeUrl(env, url.origin + '/api/kroger/callback', state), 302);
  }

  if (pathname === '/api/kroger/disconnect' && method === 'POST') {
    await env.DB.prepare('DELETE FROM docs WHERE id = ?').bind('kroger:user').run();
    return json({ ok: true });
  }

  if (pathname === '/api/kroger/cart' && method === 'POST') {
    const body = await readJson(request);
    const want = Array.isArray(body?.items) ? body.items.slice(0, 150) : null;
    if (!want) return json({ error: 'Nothing to send' }, 400);
    let link = await getDoc(env, 'kroger:user');
    if (!link) return json({ error: 'connect' }, 409);
    const fresh = await freshUserToken(env, link);
    if (!fresh) {
      await env.DB.prepare('DELETE FROM docs WHERE id = ?').bind('kroger:user').run();
      return json({ error: 'connect' }, 409);
    }
    if (fresh.access !== link.access) await putDoc(env, 'kroger:user', fresh);
    const products = (await getCatalog(env)).products;
    const items = [], skipped = [];
    for (const it of want) {
      const p = products[String(it.key)];
      const quantity = Math.max(1, Math.min(24, Math.round(+it.qty || 1)));
      if (p && p.kroger && p.kroger.upc && !p.kroger.unavailable) items.push({ upc: p.kroger.upc, quantity });
      else skipped.push(p ? p.name : String(it.key));
    }
    if (!items.length) return json({ added: 0, skipped });
    const result = await addToCart(fresh.access, items);
    if (!result.ok) {
      if (result.status === 401) return json({ error: 'connect' }, 409);
      return json({ error: 'King Soopers did not accept the order (' + result.status + '). Try again in a minute.' }, 502);
    }
    return json({ added: items.length, units: items.reduce((s, i) => s + i.quantity, 0), skipped });
  }

  // ---------- King Soopers ----------
  // Admin-only: shows whether the stored Kroger keys work, without revealing them.
  if (pathname === '/api/kroger/diag' && method === 'GET' && user === 'admin') {
    const id = env.KROGER_CLIENT_ID || '', secret = env.KROGER_CLIENT_SECRET || '';
    const shape = s => ({ length: s.length, trimmedLength: s.trim().length, hasSpace: /\s/.test(s.trim()), hasNewline: /[\r\n]/.test(s) });
    const tryHost = async host => {
      const res = await fetch(host + '/v1/connect/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(id.trim() + ':' + secret.trim()) },
        body: 'grant_type=client_credentials&scope=product.compact'
      });
      return res.status;
    };
    return json({ id: shape(id), secret: shape(secret), production: await tryHost('https://api.kroger.com'), certification: await tryHost('https://api-ce.kroger.com') });
  }

  if (pathname === '/api/kroger/stores' && method === 'GET') {
    const zip = url.searchParams.get('zip') || '';
    if (!/^\d{5}$/.test(zip)) return json({ error: 'Enter a 5-digit zip code.' }, 400);
    return json({ stores: await findStores(env, zip) });
  }

  if (pathname === '/api/kroger/store' && method === 'PUT') {
    const body = await readJson(request);
    if (!body || !/^\w{8}$/.test(String(body.locationId))) return json({ error: 'Invalid store' }, 400);
    const catalog = await getCatalog(env);
    catalog.settings.krogerStore = { locationId: body.locationId, name: String(body.name || '').slice(0, 80), address: String(body.address || '').slice(0, 160) };
    await putDoc(env, 'catalog', catalog);
    return json({ settings: catalog.settings });
  }

  if (pathname === '/api/kroger/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const store = (await getCatalog(env)).settings.krogerStore;
    if (!store) return json({ error: 'Pick your King Soopers store first.' }, 409);
    if (q.length < 3) return json({ results: [] });
    return json({ results: await searchProducts(env, q.slice(0, 80), store.locationId, 15) });
  }

  // Links products that don't have a King Soopers match yet. Does a batch per call to stay
  // under Cloudflare's per-request limits; call again while "remaining" is above zero.
  if (pathname === '/api/kroger/match' && method === 'POST') {
    const catalog = await getCatalog(env);
    const store = catalog.settings.krogerStore;
    if (!store) return json({ error: 'Pick your King Soopers store first.' }, 409);
    const todo = Object.entries(catalog.products).filter(([, p]) => !p.kroger && !p.noMatch);
    const batch = todo.slice(0, 30);
    let matched = 0;
    for (const [, p] of batch) {
      const results = await searchProducts(env, p.search || p.name, store.locationId, 12);
      const pick = bestMatch(p, results);
      if (pick) { applyKroger(p, pick, false); matched++; } else p.noMatch = true;
    }
    catalog.settings.pricesUpdatedAt = Date.now();
    await putDoc(env, 'catalog', catalog);
    return json({ matched, remaining: todo.length - batch.length });
  }

  if (pathname === '/api/kroger/swaps' && method === 'POST') {
    return json(await findSwaps(env, 30));
  }

  if (pathname === '/api/kroger/refresh' && method === 'POST') {
    return json(await refreshPrices(env));
  }

  m = pathname.match(/^\/api\/products\/([A-Za-z0-9_-]{1,40})\/kroger$/);
  if (m && method === 'PUT') {
    const body = await readJson(request);
    const catalog = await getCatalog(env);
    const p = catalog.products[m[1]];
    const store = catalog.settings.krogerStore;
    if (!p || !body || !/^\d{13}$/.test(String(body.productId))) return json({ error: 'Unknown product' }, 404);
    if (!store) return json({ error: 'Pick your King Soopers store first.' }, 409);
    const [k] = await productsById(env, [body.productId], store.locationId);
    if (!k) return json({ error: 'That product isn\'t sold at your store.' }, 404);
    applyKroger(p, k, user !== 'admin', user); // picks made by maintenance scripts still need a family OK
    delete p.swap;
    p.swapCheckedAt = 0;
    delete p.noMatch;
    await putDoc(env, 'catalog', catalog);
    return json({ product: p });
  }

  return json({ error: 'Not found' }, 404);
}

async function krogerCallback(env, url) {
  const page = (title, text) => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Five Plates</title><body style="font-family:system-ui,sans-serif;background:#F3F6F2;color:#17221E;padding:40px 24px;max-width:460px;margin:auto">' +
    '<h1 style="font-size:26px">' + title + '</h1><p style="font-size:17px;line-height:1.5">' + text + '</p>' +
    '<p><a href="/" style="display:inline-block;background:#1F5E55;color:#fff;padding:14px 20px;border-radius:14px;text-decoration:none;font-weight:700">Back to Five Plates</a></p></body>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  const code = url.searchParams.get('code');
  const [payload, sig] = String(url.searchParams.get('state') || '').split('.');
  let who = null;
  if (payload && sig) {
    const key = await hmacKey(env.SESSION_SECRET);
    if (await crypto.subtle.verify('HMAC', key, unb64url(sig), new TextEncoder().encode(payload))) {
      try { const s = JSON.parse(new TextDecoder().decode(unb64url(payload))); if (s.x > Date.now()) who = s.e; } catch { /* bad state */ }
    }
  }
  if (!code || !who) return page('That link expired', 'Open Five Plates and tap Connect King Soopers again.');
  const tokens = await exchangeCode(env, code, url.origin + '/api/kroger/callback');
  if (!tokens) return page('King Soopers did not connect', 'Something went wrong on the King Soopers side. Open Five Plates and try Connect King Soopers again.');
  await putDoc(env, 'kroger:user', { ...tokens, connectedBy: who, connectedAt: Date.now() });
  return page('King Soopers is connected', 'You can close this page. In Five Plates, tap <b>Send to King Soopers</b> on the List tab to fill your cart.');
}

// Stores a King Soopers match on our product and uses its current price.
// A different exact product means the old label check no longer applies.
function applyKroger(p, k, confirmed, user) {
  if (p.kroger && p.kroger.upc !== k.upc) { delete p.dyeChecked; delete p.dyeCheckedBy; }
  if (p.estPrice == null) p.estPrice = p.price;
  p.kroger = { ...k, confirmed: !!confirmed || !!(p.kroger && p.kroger.confirmed && p.kroger.upc === k.upc), confirmedBy: confirmed ? user : p.kroger?.confirmedBy, updatedAt: Date.now() };
  p.price = currentPrice(k);
}

// Checks the products we've looked at least recently for a cheaper option of the same kind.
async function findSwaps(env, limit) {
  const catalog = await getCatalog(env);
  const store = catalog.settings.krogerStore;
  if (!store) return { checked: 0 };
  const todo = Object.values(catalog.products)
    .filter(p => p.kroger && !p.pantry && p.store !== 'costco')
    .sort((a, b) => (a.swapCheckedAt || 0) - (b.swapCheckedAt || 0))
    .slice(0, limit);
  let found = 0;
  for (const p of todo) {
    const results = await searchProducts(env, swapSearchTerm(p), store.locationId, 15);
    const swap = findSwap(p, results);
    if (swap) { p.swap = swap; found++; } else delete p.swap;
    p.swapCheckedAt = Date.now();
  }
  await putDoc(env, 'catalog', catalog);
  return { checked: todo.length, found };
}

async function refreshPrices(env) {
  const catalog = await getCatalog(env);
  const store = catalog.settings.krogerStore;
  if (!store) return { refreshed: 0 };
  const linked = Object.values(catalog.products).filter(p => p.kroger);
  const fresh = await productsById(env, linked.map(p => p.kroger.productId), store.locationId);
  const byId = Object.fromEntries(fresh.map(k => [k.productId, k]));
  let refreshed = 0;
  for (const p of linked) {
    const k = byId[p.kroger.productId];
    if (!k || !k.regular) { p.kroger.unavailable = true; continue; }
    p.kroger = { ...p.kroger, ...k, unavailable: false, updatedAt: Date.now() };
    p.price = currentPrice(k);
    refreshed++;
  }
  catalog.settings.pricesUpdatedAt = Date.now();
  await putDoc(env, 'catalog', catalog);
  return { refreshed, total: linked.length };
}

// ---------- Sign-in: allowed email + family passcode, remembered on the device ----------
async function login(request, env) {
  const body = await readJson(request);
  const email = String(body?.email || '').trim().toLowerCase();
  const passcode = String(body?.passcode || '');
  const allowed = String(env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(email) && env.FAMILY_PASSCODE && await sameSecret(passcode, env.FAMILY_PASSCODE);
  if (!ok) {
    await new Promise(r => setTimeout(r, 600)); // slows down guessing
    return json({ error: 'That email or passcode didn\'t match. Check both and try again.' }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ e: email, x: exp })));
  const token = payload + '.' + await sign(payload, env.SESSION_SECRET);
  const cookie = `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
  return json({ user: email }, 200, { 'Set-Cookie': cookie });
}

async function sessionUser(request, env) {
  // Maintenance access for scripts (the ADMIN_TOKEN secret); remove the secret to turn it off.
  const auth = request.headers.get('Authorization') || '';
  if (env.ADMIN_TOKEN && auth.startsWith('Bearer ') && await sameSecret(auth.slice(7), env.ADMIN_TOKEN)) return 'admin';
  const raw = (request.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!raw || !env.SESSION_SECRET) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const key = await hmacKey(env.SESSION_SECRET);
  const valid = await crypto.subtle.verify('HMAC', key, unb64url(sig), new TextEncoder().encode(payload));
  if (!valid) return null;
  try {
    const { e, x } = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    const allowed = String(env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim());
    return x > Date.now() / 1000 && allowed.includes(e) ? e : null;
  } catch { return null; }
}

function clearCookie() { return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`; }

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(payload, secret) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}
async function sameSecret(a, b) {
  const [ha, hb] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  return crypto.subtle.timingSafeEqual(ha, hb);
}
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// ---------- Storage ----------
async function getDoc(env, id) {
  const row = await env.DB.prepare('SELECT body FROM docs WHERE id = ?').bind(id).first();
  return row ? JSON.parse(row.body) : null;
}
async function putDoc(env, id, body) {
  await env.DB.prepare('INSERT INTO docs (id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
    .bind(id, JSON.stringify(body), Date.now()).run();
}
async function getCatalog(env) {
  const catalog = await getDoc(env, 'catalog');
  if (catalog) return catalog;
  await putDoc(env, 'catalog', SEED_CATALOG);
  return structuredClone(SEED_CATALOG);
}
// Household picks. The first time this runs after the switch from weekly plans,
// it carries the latest week's picks and every week's dinners over.
async function getHousehold(env) {
  const h = await getDoc(env, 'household');
  if (h) return h;
  const { results } = await env.DB.prepare("SELECT id, body FROM docs WHERE id LIKE 'week:%' ORDER BY id").all();
  if (!results.length) return { bf: {}, ln: {}, sn: {}, on: {}, sentAt: 0, updatedAt: 0, fresh: true };
  const days = {};
  let latest = null;
  for (const row of results) {
    const week = JSON.parse(row.body), start = new Date(row.id.slice(5) + 'T12:00:00Z');
    (week.plan || []).forEach((id, i) => { days[new Date(start.getTime() + i * 86400_000).toISOString().slice(0, 10)] = id; });
    latest = week;
  }
  const migrated = { bf: latest.bf || {}, ln: latest.ln || {}, sn: latest.sn || {}, on: latest.on || {}, sentAt: latest.sentAt || 0, updatedAt: Date.now() };
  await putDoc(env, 'household', migrated);
  if (!(await getDoc(env, 'dinners'))) await putDoc(env, 'dinners', { days, updatedAt: Date.now() });
  return migrated;
}

function aisleFor(k) {
  const c = (k.categories || []).join(' ').toLowerCase();
  if (/produce/.test(c)) return 'Produce';
  if (/meat|seafood/.test(c)) return 'Meat';
  if (/dairy|deli|cheese|egg/.test(c)) return 'Dairy & eggs';
  if (/bakery|bread/.test(c)) return 'Bakery';
  if (/frozen/.test(c)) return 'Frozen';
  return 'Pantry';
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function cleanHousehold(h) {
  if (!h || typeof h !== 'object') return null;
  const counts = o => {
    if (!o || typeof o !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (!KEY_RE.test(k)) return null;
      out[k] = Math.max(0, Math.min(14, Math.round(+v || 0)));
    }
    return out;
  };
  const bf = counts(h.bf), ln = counts(h.ln), sn = counts(h.sn), on = {};
  if (!bf || !ln || !sn) return null;
  for (const [k, v] of Object.entries(h.on || {})) {
    if (!KEY_RE.test(k)) return null;
    on[k] = !!v;
  }
  return { bf, ln, sn, on, sentAt: Math.max(0, +h.sentAt || 0) };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}
