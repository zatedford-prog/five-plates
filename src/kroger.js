// Kroger (King Soopers) API: store lookup, product search and current prices.
// Docs: https://developer.kroger.com/api-products/api/product-api-public

const API = 'https://api.kroger.com/v1';
let appToken = null; // reused while this worker instance stays warm

async function getAppToken(env) {
  if (appToken && appToken.exp > Date.now() + 60_000) return appToken.token;
  if (!env.KROGER_CLIENT_ID || !env.KROGER_CLIENT_SECRET) throw new KrogerError('King Soopers keys are not set up yet.', 503);
  const res = await fetch(API + '/connect/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(env.KROGER_CLIENT_ID.trim() + ':' + env.KROGER_CLIENT_SECRET.trim())
    },
    body: 'grant_type=client_credentials&scope=product.compact'
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error('kroger token', res.status, detail);
    throw new KrogerError('King Soopers sign-in failed (' + res.status + '): ' + detail, 502);
  }
  const data = await res.json();
  appToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return appToken.token;
}

export class KrogerError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function get(env, path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + await getAppToken(env) } });
  if (res.status === 401) { appToken = null; throw new KrogerError('King Soopers sign-in expired. Try again.', 502); }
  if (!res.ok) throw new KrogerError('King Soopers returned an error (' + res.status + ').', 502);
  return res.json();
}

// ---------- Stores ----------
export async function findStores(env, zip) {
  const data = await get(env, '/locations', { 'filter.zipCode.near': zip, 'filter.limit': 20, 'filter.radiusInMiles': 15 });
  return (data.data || []).map(l => ({
    locationId: l.locationId,
    chain: l.chain,
    name: l.name,
    address: [l.address?.addressLine1, l.address?.city, l.address?.state, l.address?.zipCode].filter(Boolean).join(', ')
  }));
}

// ---------- Products ----------
// Flattens Kroger's product record to what the app needs.
export function simplify(p) {
  const item = (p.items || [])[0] || {};
  const price = item.price || {};
  const img = (p.images || []).find(i => i.perspective === 'front') || (p.images || [])[0];
  const size = img && (img.sizes || []).find(s => s.size === 'medium') || img && (img.sizes || [])[0];
  return {
    productId: p.productId,
    upc: p.upc,
    description: p.description,
    brand: p.brand || '',
    size: item.size || '',
    regular: +price.regular || 0,
    promo: +price.promo || 0,
    image: size ? size.url : '',
    aisle: (p.aisleLocations || [])[0]?.description || '',
    categories: p.categories || [],
    pickup: item.fulfillment ? !!item.fulfillment.curbside : null,
    stock: item.inventory?.stockLevel || ''
  };
}

export async function searchProducts(env, term, locationId, limit = 12) {
  const data = await get(env, '/products', {
    'filter.term': term.split(/\s+/).slice(0, 8).join(' '),
    'filter.locationId': locationId,
    'filter.limit': limit
  });
  return (data.data || []).map(simplify).filter(p => p.regular > 0);
}

export async function productsById(env, ids, locationId) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await get(env, '/products', { 'filter.productId': ids.slice(i, i + 50).join(','), 'filter.locationId': locationId });
    out.push(...(data.data || []).map(simplify));
  }
  return out;
}

// ---------- Customer cart (OAuth authorization code) ----------
// One family King Soopers account is linked; its tokens live in the database, never on phones.
export function authorizeUrl(env, redirectUri, state) {
  const u = new URL(API + '/connect/oauth2/authorize');
  u.searchParams.set('scope', 'cart.basic:write');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.KROGER_CLIENT_ID.trim());
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('banner', 'kingsoopers');
  return u.toString();
}

async function tokenRequest(env, body) {
  const res = await fetch(API + '/connect/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(env.KROGER_CLIENT_ID.trim() + ':' + env.KROGER_CLIENT_SECRET.trim())
    },
    body: new URLSearchParams(body).toString()
  });
  if (!res.ok) {
    console.error('kroger user token', res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const d = await res.json();
  return { access: d.access_token, refresh: d.refresh_token, exp: Date.now() + d.expires_in * 1000 };
}

export function exchangeCode(env, code, redirectUri) {
  return tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export async function freshUserToken(env, saved) {
  if (saved.exp > Date.now() + 60_000) return saved;
  const next = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: saved.refresh });
  return next ? { ...saved, ...next, refresh: next.refresh || saved.refresh } : null;
}

// items: [{ upc, quantity }]. Kroger adds to whatever is already in the cart.
export async function addToCart(accessToken, items) {
  const res = await fetch(API + '/cart/add', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify({ items: items.map(i => ({ upc: i.upc, quantity: i.quantity, modality: 'PICKUP' })) })
  });
  if (res.status === 204 || res.ok) return { ok: true };
  const detail = (await res.text()).slice(0, 300);
  console.error('kroger cart', res.status, detail);
  return { ok: false, status: res.status, detail };
}

export function currentPrice(k) { return k.promo > 0 && k.promo < k.regular ? k.promo : k.regular; }

// Picks the search result that best fits our product: shared words, matching brand, similar size.
const STOP = new Set(['and', 'the', 'of', 'with', 'a', 'frozen', 'each', 'about', 'pack', 'ct', 'oz', 'lb']);
const words = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
export function ounces(s) {
  const t = String(s).toLowerCase();
  // "12 pack / 3.2 oz" or "8 ct / 1 oz" means 12 × 3.2 oz in total.
  const multi = t.match(/([\d.]+)\s*(?:ct|pk|pack|count)\s*\/\s*([\d.]+)\s*(fl oz|oz|lb)\b/);
  if (multi) return { n: +multi[1] * +multi[2] * (multi[3] === 'lb' ? 16 : 1), unit: 'oz' };
  const m = t.match(/([\d.]+)\s*(fl oz|oz|lbs?|gal|ct)\b/);
  if (!m) return null;
  const n = +m[1];
  return { n: /^lb/.test(m[2]) ? n * 16 : m[2] === 'gal' ? n * 128 : n, unit: m[2] === 'ct' ? 'ct' : 'oz' };
}
// ---------- Cheaper swaps ----------
// Brand words come off the search so other brands (often the store brand) show up.
const BRANDS = /\b(kroger|simple truth( organic)?|private selection|johnsonville|barilla|kodiak|pillsbury|krusteaz|ore-ida|heinz|campbell'?s|hormel|red baron|welch'?s|annie'?s|goodles|just bare|gallo|chomps|oscar mayer|tyson|cheerios|general mills|gogo squeez|snyder'?s|skinnypop|lactaid|mccormick|nature'?s own)\b/gi;
export function swapSearchTerm(p) { return (p.search || p.name).replace(BRANDS, ' ').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim(); }

// Packs sold by count (buns, bars, pouches) compare per piece; everything else per ounce.
function unitPrice(price, size) {
  const count = String(size).toLowerCase().match(/^\s*([\d.]+)\s*(?:ct|pk|pack|count|biscuits|rolls)\b/);
  if (count && +count[1] > 0) return { per: price / +count[1], unit: 'piece' };
  const s = ounces(size);
  return s && s.n > 0 ? { per: price / s.n, unit: s.unit } : null;
}

// Words that mark a healthier version. A swap has to keep every one the current product has,
// so organic stays organic, protein-packed stays protein-packed, and so on.
const QUALITY = ['organic', 'protein', 'less fat', 'reduced fat', 'lean', 'grass fed', 'no sugar added', 'uncured', 'whole grain', 'whole wheat', 'gluten free', 'low sodium', 'less sodium', 'natural'];

// The cheapest result that is the same kind of food: same store category, shares most of our
// product's words, keeps its healthier qualities, similar package size (no 4 lb bags for an 8 oz
// item), sold for pickup, and at least 15% less per ounce or count.
export function findSwap(p, results) {
  const k = p.kroger;
  if (!k || p.noSwap) return null;
  const mine = unitPrice(currentPrice(k), k.size);
  if (!mine) return null;
  const want = words(swapSearchTerm(p));
  const myText = (k.brand + ' ' + k.description).toLowerCase();
  const keep = QUALITY.filter(q => myText.includes(q));
  const myCats = new Set(k.categories || []);
  const mySize = ounces(k.size);
  let best = null;
  for (const r of results) {
    if (r.productId === k.productId || r.pickup === false || !r.regular) continue;
    const text = (r.brand + ' ' + r.description).toLowerCase();
    if (/\b(dog|cat|pet|puppy|kitten|baby food)\b/.test(text)) continue;
    if (myCats.size && r.categories && r.categories.length && !r.categories.some(c => myCats.has(c))) continue;
    if (!keep.every(q => text.includes(q))) continue;
    const have = new Set(words(text));
    if (want.length && want.filter(w => have.has(w)).length / want.length < 0.6) continue;
    const price = currentPrice(r);
    const theirs = unitPrice(price, r.size);
    if (!theirs || theirs.unit !== mine.unit) continue;
    const theirSize = ounces(r.size);
    if (mySize && theirSize) {
      const sizeRatio = theirSize.n / mySize.n;
      if (sizeRatio < 0.5 || sizeRatio > 3) continue;
    }
    const ratio = theirs.per / mine.per;
    if (ratio > 0.85 || ratio < 0.3) continue; // too small a saving, or too good to be the same thing
    if (!best || ratio < best.ratio) best = { ratio, r, price };
  }
  if (!best) return null;
  const r = best.r;
  return { productId: r.productId, description: r.description, size: r.size, price: best.price, image: r.image, savingsPct: Math.round((1 - best.ratio) * 100) };
}

export function bestMatch(product, results) {
  const want = words(product.name);
  const wantSize = ounces(product.size);
  let best = null;
  for (const r of results) {
    const have = new Set(words(r.brand + ' ' + r.description));
    let score = want.filter(w => have.has(w)).length / Math.max(1, want.length) * 10;
    const firstWord = want[0];
    if (firstWord && r.brand && r.brand.toLowerCase().includes(firstWord)) score += 2;
    const s = ounces(r.size);
    if (wantSize && s && s.unit === wantSize.unit) score += 3 * Math.max(0, 1 - Math.abs(Math.log(s.n / wantSize.n)));
    if (r.pickup === false) score -= 5;
    if (!best || score > best.score) best = { score, r };
  }
  return best ? best.r : null;
}
