# Five Plates

A weekly meal and grocery planner for a family of five (two adults, kids 6, 4 and 2) in Arvada, CO.
Live at https://five-plates.five-plates.workers.dev. Jamie (iPhone) does the planning and shopping;
Zach (Android) is the builder. Both use it as an installed home-screen app.

## Working with Zach
- One step at a time: short replies that end with a single clear action for him.
- On his Windows PowerShell, `npx` is blocked by the execution policy. Give him `npx.cmd ...`.
- Secrets pasted into PowerShell's hidden prompt have gone wrong before. For any key or token,
  have him paste it in the Cloudflare dashboard (Workers & Pages → five-plates → Settings →
  Variables and Secrets) and never into chat.

## Family rules the app must respect
- The oldest is allergic to red and blue food dyes (Red 40, Red 3, Blue 1, Blue 2). Products in risky
  categories carry `dyeRisk`; only a family member (or a package that says "No Dyes") marks one
  `dyeChecked`. Switching to a different product clears the check. Never mark products safe on a guess.
- Lactose is not a concern (they use Lactaid). Don't flag dairy.
- Most snacks come from Costco (`store: 'costco'`, typed prices, never sent to the King Soopers cart).
- Budget: $400/week for groceries plus household items. YNAB has the real numbers.

## How it's built
- `public/`: the app (plain HTML/CSS/JS modules, no build step). `public/js/logic.js` is the pure
  planning math (dates, filling the plan, shopping list, totals) and is unit-tested. `public/sw.js`
  caches the app on the phone; **bump `VERSION` in sw.js on every deploy that changes app files.**
- `src/worker.js`: Cloudflare Worker (sign-in, saving, routes). `src/kroger.js`: King Soopers prices,
  product search, cheaper swaps, cart. `src/ynab.js`: read-only YNAB balances. `src/seed.js`: the
  original starting catalog (the live catalog lives in the database and has moved on from it).
- Database: Cloudflare D1, one table `docs` of JSON documents:
  - `catalog`: products (each optionally linked to an exact King Soopers product under `kroger`),
    dinners, breakfasts, lunches, snacks, household items, settings (store, YNAB category ids).
  - `dinners`: the plan, `days` keyed by date (dinner), `b:` + date (breakfast), `l:` + date (lunch).
    Per-meal notes use a prefix on that key: `a:` = filled in automatically (Suggest may change it;
    anything without it was picked by a person and Suggest must never touch it), `s:` = batch size
    (0.5 / 1.5 / 2), `h:` = comma list of product keys already on hand (left off the list).
  - `household`: weekly shelf counts (`sn` snacks & drinks, `hh` household), one-off `extra` list items
    (cleared after a cart send), list check-offs, `sentAt`.
  - `kroger:user`: Jamie's linked King Soopers cart tokens.
- The plan always shows today plus the next 6 days. Empty slots fill with the same suggestion on every
  phone (seeded by date).
- Daily cron (5am Mountain): refresh prices, then look for cheaper swaps on a batch of products.
- Kroger's public API has prices, store lookup and cart-add only. It has **no order history**.
- Store: King Soopers Marketplace, Lake Arbor (8031 Wadsworth), Kroger locationId 62000036.

## Commands
```
npm test          # logic tests (node --test)
npm run dev       # local server on :8787 (test passcode and sample YNAB numbers in .dev.vars)
npx wrangler deploy
```
Secrets (Cloudflare only): FAMILY_PASSCODE, SESSION_SECRET, ALLOWED_EMAILS, KROGER_CLIENT_ID,
KROGER_CLIENT_SECRET, YNAB_TOKEN, ADMIN_TOKEN.

Maintenance: `ADMIN_TOKEN` (also in the git-ignored `.dev.vars`) lets scripts call the live API with
`Authorization: Bearer ...`, e.g. `GET /api/bootstrap`, `PUT /api/catalog` (replace the catalog),
`PUT /api/products/<key>/kroger {"productId": "...", "confirmed": true}`, `POST /api/kroger/swaps`,
`GET /api/kroger/diag`, `GET /api/ynab/diag`. Picks made with the admin token stay unconfirmed unless
`confirmed: true` is sent (use that only for items from the family's own purchase history).

## Gotchas
- Git Bash heredocs on this machine can eat backslashes in inline scripts. Write edit scripts to a file
  (or use the Edit tool) when they contain regexes.
- The King Soopers phone app is slow to show items added through the API; the website shows them.
- Open idea not built yet: importing recipes (paste text or a link), which would need a decision about
  an Anthropic API key.
