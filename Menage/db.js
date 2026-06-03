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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS actions (
  id        SERIAL PRIMARY KEY,
  label     TEXT NOT NULL,
  room      TEXT NOT NULL DEFAULT 'Général',
  position  INTEGER NOT NULL DEFAULT 0,
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  position  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
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

  // Backfill the rooms table from any existing tasks (one-time, idempotent),
  // so rooms created before this table existed are preserved.
  await pool.query(`
    INSERT INTO rooms (name, position)
    SELECT room, (ROW_NUMBER() OVER (ORDER BY room)) - 1
    FROM (SELECT DISTINCT room FROM actions WHERE active = TRUE) d
    ON CONFLICT (name) DO NOTHING
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
          "INSERT INTO rooms (name, position) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
          [group.room, roomPos++]
        );
        for (const label of group.actions) {
          await pool.query(
            "INSERT INTO actions (label, room, position) VALUES ($1, $2, $3)",
            [label, group.room, pos++]
          );
        }
      }
      console.log(`Bibliothèque initialisée avec ${pos} tâches.`);
    }
  }
}

module.exports = { pool, init };
