import { SEED_CATALOG } from './seed.js';
import { KrogerError, findStores, searchProducts, productsById, bestMatch, currentPrice } from './kroger.js';

// Static files in /public are served straight from Cloudflare's edge; only /api/* reaches this code.
const COOKIE = 'fp_session';
const SESSION_DAYS = 400; // the longest browsers allow, so phones stay signed in
const WEEK_RE = /^\/api\/week\/(\d{4}-\d{2}-\d{2})$/;
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
    ctx.waitUntil(refreshPrices(env).catch(err => console.error('price refresh failed', err)));
  }
};

async function route(request, env, url) {
  const { pathname } = url, method = request.method;
  if (pathname === '/api/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });

  const user = await sessionUser(request, env);
  if (!user) return json({ error: 'signin' }, 401);
  if (method !== 'GET' && !sameOrigin(request, url)) return json({ error: 'Bad origin' }, 403);

  if (pathname === '/api/bootstrap' && method === 'GET') {
    const id = url.searchParams.get('week') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return json({ error: 'Missing week' }, 400);
    const [catalog, week] = await Promise.all([getCatalog(env), getDoc(env, 'week:' + id)]);
    const previous = week ? null : await previousWeek(env, id);
    return json({ user, catalog, week, previous });
  }

  let m = pathname.match(WEEK_RE);
  if (m && method === 'PUT') {
    const body = await readJson(request);
    if (!body) return json({ error: 'Invalid week' }, 400);
    const week = cleanWeek(body);
    if (!week) return json({ error: 'Invalid week' }, 400);
    week.updatedAt = Date.now();
    week.updatedBy = user;
    await putDoc(env, 'week:' + m[1], week);
    return json({ updatedAt: week.updatedAt });
  }

  m = pathname.match(PRODUCT_RE);
  if (m && method === 'PATCH') {
    const body = await readJson(request);
    const catalog = await getCatalog(env);
    const p = catalog.products[m[1]];
    if (!p || !body) return json({ error: 'Unknown product' }, 404);
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
    delete p.noMatch;
    await putDoc(env, 'catalog', catalog);
    return json({ product: p });
  }

  return json({ error: 'Not found' }, 404);
}

// Stores a King Soopers match on our product and uses its current price.
// A different exact product means the old label check no longer applies.
function applyKroger(p, k, confirmed, user) {
  if (p.kroger && p.kroger.upc !== k.upc) { delete p.dyeChecked; delete p.dyeCheckedBy; }
  if (p.estPrice == null) p.estPrice = p.price;
  p.kroger = { ...k, confirmed: !!confirmed || !!(p.kroger && p.kroger.confirmed && p.kroger.upc === k.upc), confirmedBy: confirmed ? user : p.kroger?.confirmedBy, updatedAt: Date.now() };
  p.price = currentPrice(k);
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
async function previousWeek(env, id) {
  const row = await env.DB.prepare("SELECT body FROM docs WHERE id LIKE 'week:%' AND id < ? ORDER BY id DESC LIMIT 1").bind('week:' + id).first();
  return row ? JSON.parse(row.body) : null;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function cleanWeek(w) {
  const counts = o => {
    if (!o || typeof o !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) return null;
      out[k] = Math.max(0, Math.min(14, Math.round(+v || 0)));
    }
    return out;
  };
  if (!Array.isArray(w.plan) || w.plan.length !== 7 || !w.plan.every(s => typeof s === 'string' && s.length <= 40)) return null;
  const bf = counts(w.bf), ln = counts(w.ln), sn = counts(w.sn);
  const on = {};
  for (const [k, v] of Object.entries(w.on || {})) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) return null;
    on[k] = !!v;
  }
  if (!bf || !ln || !sn) return null;
  return { plan: w.plan, bf, ln, sn, on };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}
