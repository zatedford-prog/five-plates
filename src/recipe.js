// Recipe import: read ingredient lines from a recipe web page (or pasted text) and turn each line into
// a King Soopers search term and a first guess at how many packages the meal uses.

const MAX_LINES = 25; // each line is one product search; keeps us under Cloudflare's per-request limit

// Most recipe sites publish a schema.org "Recipe" block (JSON-LD) for search engines. We read that.
export async function fetchRecipe(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
  } catch { return { error: 'Couldn’t open that link. Check it, or paste the ingredients instead.' }; }
  if (!res.ok) return { error: 'That site didn’t let us read the recipe (' + res.status + '). Paste the ingredients instead.' };
  const html = (await res.text()).slice(0, 2_000_000);
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const raw of blocks) {
    let data;
    try { data = JSON.parse(raw.trim()); } catch { continue; }
    const recipe = findRecipe(data);
    if (recipe && Array.isArray(recipe.recipeIngredient) && recipe.recipeIngredient.length) {
      return {
        name: clean(recipe.name || ''),
        servings: servingsOf(recipe.recipeYield),
        lines: recipe.recipeIngredient.map(clean).filter(Boolean)
      };
    }
  }
  return { error: 'Couldn’t find the ingredient list on that page. Paste the ingredients instead.' };
}

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  const type = node['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return node;
  if (node['@graph']) return findRecipe(node['@graph']);
  return null;
}

function servingsOf(y) {
  const s = Array.isArray(y) ? y.join(' ') : String(y || '');
  const n = s.match(/\d+/);
  return n ? +n[0] : null;
}

function clean(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/\s+/g, ' ').trim();
}

// Pasted text: one ingredient per line. Drops bullets and list numbering ("- ", "• ", "3. ")
// but keeps amounts like "2 cups".
export function linesFromText(text) {
  return String(text).split(/\r?\n/)
    .map(l => clean(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')))
    .filter(l => l.length > 1);
}

// ---------- Turning a line into a search term and an amount ----------
const UNITS = 'cups?|c\\.|tablespoons?|tbsps?|tbs|tsps?|teaspoons?|pounds?|lbs?|ounces?|oz|grams?|g|kg|ml|liters?|l|quarts?|pints?|cans?|cloves?|pinch(?:es)?|dash(?:es)?|packages?|pkgs?|packets?|bunch(?:es)?|heads?|stalks?|slices?|sticks?|large|medium|small|whole|jars?|bags?|boxes?|containers?|envelopes?|sprigs?';
const PREP = /\b(chopped|diced|minced|sliced|shredded|grated|crushed|softened|melted|divided|optional|fresh(ly)?|to taste|for serving|for garnish|peeled|cubed|halved|drained|rinsed|room temperature|thinly|finely|roughly|cooked|uncooked|boneless|skinless|plus more|more as needed|or more|about|approximately|packed|heaping|beaten|warm|cold|large|medium|small)\b/gi;
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.33, '⅔': 0.67, '⅛': 0.125 };
// Pantry basics (the whole cleaned term must be one of these): they start ticked as "already have".
const PANTRY = /^(salt|kosher salt|sea salt|pepper|black pepper|olive oil|extra virgin olive oil|vegetable oil|canola oil|cooking spray|oil|sugar|granulated sugar|brown sugar|flour|all-purpose flour|baking soda|baking powder|vanilla|vanilla extract|cinnamon|cumin|paprika|chili powder|garlic powder|onion powder|oregano|basil|dried basil|thyme|italian seasoning|red pepper flakes|soy sauce|vinegar|honey|ketchup|mustard|mayonnaise|butter|unsalted butter|salt and pepper)$/i;

export function parseLine(line) {
  let t = line.toLowerCase();
  for (const [f, v] of Object.entries(FRACTIONS)) t = t.replace(f, ' ' + v);
  const amount = t.match(/^\s*(\d+(?:\.\d+)?)(?:\s+(\d)\/(\d))?|^\s*(\d)\/(\d)/) || [];
  let n = null;
  if (amount[1]) n = +amount[1] + (amount[2] ? amount[2] / amount[3] : 0);
  else if (amount[4]) n = amount[4] / amount[5];
  const unitMatch = t.match(new RegExp('^[\\s\\d./]*\\b(' + UNITS + ')\\b'));
  const unit = unitMatch ? unitMatch[1] : '';
  const term = t
    .replace(/\(.*?\)/g, ' ')
    .replace(/^[\s\d./-]+/, ' ')
    .replace(new RegExp('^\\s*(' + UNITS + ')\\b\\.?', 'i'), ' ')
    .replace(/\bof\b/g, ' ')
    .replace(/([a-z])\/([a-z])/g, '$1 or $2') // "stock/broth" means either one
    .split(/,|;| or /)[0]
    .replace(PREP, ' ')
    .replace(/[^a-z0-9&' -]/g, ' ')
    .replace(/\b[a-z]*\d[a-z0-9]*\b/g, ' ') // leftover amounts like "1.2lb" or "500ml"
    .replace(/(^|\s)(g|kg|ml|oz|lb|lbs)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const water = /^(water|ice|hot water|cold water|boiling water|warm water)$/.test(term);
  const pantry = !water && PANTRY.test(term);
  return { text: line, term, amount: n, unit, skip: water || !term, pantry, qty: guessQty(n, unit) };
}

// A rough first guess in packages; the family adjusts it on the review screen.
function guessQty(n, unit) {
  if (/^(tsp|teaspoon|tbsp|tablespoon|tbs|pinch|dash|clove|sprig)/.test(unit)) return 0.25;
  if (/^(cup|c\.)/.test(unit)) return n && n <= 1 ? 0.5 : 1;
  if (/^(pound|lb)/.test(unit)) return n ? Math.max(0.5, Math.round(n * 2) / 2) : 1;
  if (/^(can|package|pkg|packet|jar|bag|box|container|envelope)/.test(unit)) return n ? Math.max(1, Math.round(n)) : 1;
  return 1;
}

export { MAX_LINES };
