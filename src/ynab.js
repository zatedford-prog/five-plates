// YNAB (read-only): category balances for the current month.
// Docs: https://api.ynab.com — amounts come back in "milliunits" (1000 = $1.00).

const API = 'https://api.ynab.com/v1';
let cache = null; // { at, key, data } reused for a few minutes while this worker instance stays warm

export class YnabError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function get(env, path) {
  if (!env.YNAB_TOKEN) throw new YnabError('YNAB isn’t connected yet.', 503);
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + env.YNAB_TOKEN.trim(), Accept: 'application/json' } });
  if (res.status === 401) throw new YnabError('YNAB didn’t accept the token. It may have been revoked; make a new one.', 502);
  if (res.status === 429) throw new YnabError('YNAB is busy. Try again in a few minutes.', 503);
  if (!res.ok) throw new YnabError('YNAB returned an error (' + res.status + ').', 502);
  return (await res.json()).data;
}

const dollars = m => Math.round(m) / 1000;

// All visible categories this month, grouped, for picking which ones the app shows.
export async function listCategories(env) {
  const data = await get(env, '/budgets/last-used/months/current');
  const month = data.month;
  return {
    month: month.month,
    categories: month.categories
      .filter(c => !c.hidden && !c.deleted && c.category_group_name !== 'Internal Master Category')
      .map(c => ({ id: c.id, name: c.name, group: c.category_group_name, balance: dollars(c.balance), budgeted: dollars(c.budgeted), activity: dollars(c.activity) }))
  };
}

// Balances for the chosen categories. Cached for 5 minutes so opening the app stays fast
// and well under YNAB's limit of 200 requests an hour.
export async function summary(env, ids) {
  const key = ids.join(',');
  if (cache && cache.key === key && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const all = await listCategories(env);
  const data = { month: all.month, categories: ids.map(id => all.categories.find(c => c.id === id)).filter(Boolean), fetchedAt: Date.now() };
  cache = { at: Date.now(), key, data };
  return data;
}
