-- Battle report store for Cloudflare D1.
-- Run this once in the Cloudflare dashboard (D1 -> your database -> Console)
-- or with:  npx wrangler d1 execute idol-reports --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT    NOT NULL,          -- ISO timestamp, set by the server
  submitted_by  TEXT,                      -- optional in-game name, so you can ask follow-ups
  mode          TEXT    NOT NULL,          -- parking | p25 | rally | hq | landmark
  outcome       TEXT    NOT NULL,          -- a | b | draw   (which side won)

  -- side A (the person submitting, by convention)
  a_name        TEXT,
  a_fans        INTEGER NOT NULL,
  a_loss        INTEGER NOT NULL,          -- injured is always 4x this, so it is not stored
  a_sing        INTEGER NOT NULL,
  a_dance       INTEGER NOT NULL,
  a_active      INTEGER NOT NULL,
  a_natk        REAL    NOT NULL,          -- stored as a fraction: 205% -> 2.05
  a_nred        REAL    NOT NULL,
  a_sb          REAL    NOT NULL,
  a_sred        REAL    NOT NULL,
  a_bonus       INTEGER DEFAULT 0,

  -- side B (the opponent)
  b_name        TEXT,
  b_fans        INTEGER NOT NULL,
  b_loss        INTEGER NOT NULL,
  b_sing        INTEGER NOT NULL,
  b_dance       INTEGER NOT NULL,
  b_active      INTEGER NOT NULL,
  b_natk        REAL    NOT NULL,
  b_nred        REAL    NOT NULL,
  b_sb          REAL    NOT NULL,
  b_sred        REAL    NOT NULL,
  b_bonus       INTEGER DEFAULT 0,

  -- a fingerprint of the numbers, so the same report cannot be submitted twice
  fingerprint   TEXT    NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_reports_mode    ON reports(mode);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
