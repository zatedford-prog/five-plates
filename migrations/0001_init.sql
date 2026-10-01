-- One row per JSON document: 'catalog' (products and meals) and 'week:YYYY-MM-DD' (each week's plan).
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
