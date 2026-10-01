# Five Plates

Our family's weekly meal and grocery planner: dinners, breakfasts, lunches and a snack shelf, true cost per meal, a dye-checked shopping list, and (soon) King Soopers pickup carts.

- `public/`: the app (installs to the iPhone home screen; works offline)
- `src/worker.js`: the small server on Cloudflare Workers (sign-in, saving)
- `src/seed.js`: starting meals and estimated prices
- `migrations/`: database tables (Cloudflare D1)

## Run locally

```
npm install
npm run dev     # http://localhost:8787 (local test passcode is in .dev.vars)
npm test
```

## Deploy

```
npm run deploy
```

Secrets live in Cloudflare, never in git: `FAMILY_PASSCODE`, `SESSION_SECRET`, `ALLOWED_EMAILS`.
