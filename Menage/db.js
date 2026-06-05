const { Pool } = require("pg");

// Railway provides DATABASE_URL automatically when you add the Postgres plugin.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "Erreur : la variable DATABASE_URL est manquante. " +
      "En local, copiez .env.example vers .env et lancez un Postgres."
  );
}

// Railway Postgres requires SSL in production but not for local dev.
const isLocal =
  !connectionString ||
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1");

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// The two fixed places, each with its own independent rooms/tasks/lists.
const PLACES = ["Appartement Aumetz", "Maison Aumetz"];
const DEFAULT_PLACE = PLACES[0];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS actions (
  id        SERIAL PRIMARY KEY,
  place     TEXT NOT NULL DEFAULT 'Appartement Aumetz',
  label     TEXT NOT NULL,
  room      TEXT NOT NULL DEFAULT 'Général',
  position  INTEGER NOT NULL DEFAULT 0,
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id        SERIAL PRIMARY KEY,
  place     TEXT NOT NULL DEFAULT 'Appartement Aumetz',
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (place, name)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  place      TEXT NOT NULL DEFAULT 'Appartement Aumetz',
  session_date DATE NOT NULL,
  title      TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_items (
  id         SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  action_id  INTEGER REFERENCES actions(id) ON DELETE SET NULL,
  label      TEXT NOT NULL,
  room       TEXT NOT NULL DEFAULT 'Général',
  position   INTEGER NOT NULL DEFAULT 0,
  done       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_session_items_session ON session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_actions_room ON actions(room);
`;

async function init() {
  await pool.query(SCHEMA);

  // Migration for databases created before the "place" dimension existed:
  // add the column (existing data defaults to 'Appartement Aumetz') and move
  // the rooms uniqueness from (name) to (place, name).
  await pool.query(
    "ALTER TABLE actions  ADD COLUMN IF NOT EXISTS place TEXT NOT NULL DEFAULT 'Appartement Aumetz'"
  );
  await pool.query(
    "ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS place TEXT NOT NULL DEFAULT 'Appartement Aumetz'"
  );
  await pool.query(
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS place TEXT NOT NULL DEFAULT 'Appartement Aumetz'"
  );
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_name_key') THEN
        ALTER TABLE rooms DROP CONSTRAINT rooms_name_key;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_place_name_key') THEN
        ALTER TABLE rooms ADD CONSTRAINT rooms_place_name_key UNIQUE (place, name);
      END IF;
    END $$;
  `);

  // Backfill the rooms table from any existing tasks (one-time, idempotent),
  // so rooms created before this table existed are preserved (per place).
  await pool.query(`
    INSERT INTO rooms (place, name, position)
    SELECT place, room, (ROW_NUMBER() OVER (PARTITION BY place ORDER BY room)) - 1
    FROM (SELECT DISTINCT place, room FROM actions WHERE active = TRUE) d
    ON CONFLICT (place, name) DO NOTHING
  `);

  // Optional one-time seed (default OFF — library starts empty).
  if (String(process.env.SEED_DEFAULT).toLowerCase() === "true") {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM actions");
    if (rows[0].n === 0) {
      const seed = require("./seed-data");
      let pos = 0;
      let roomPos = 0;
      for (const group of seed) {
        await pool.query(
          "INSERT INTO rooms (place, name, position) VALUES ($1, $2, $3) ON CONFLICT (place, name) DO NOTHING",
          [DEFAULT_PLACE, group.room, roomPos++]
        );
        for (const label of group.actions) {
          await pool.query(
            "INSERT INTO actions (place, label, room, position) VALUES ($1, $2, $3, $4)",
            [DEFAULT_PLACE, label, group.room, pos++]
          );
        }
      }
      console.log(`Bibliothèque initialisée avec ${pos} tâches.`);
    }
  }
}

module.exports = { pool, init, PLACES, DEFAULT_PLACE };
