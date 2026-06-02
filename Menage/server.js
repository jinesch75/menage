const path = require("path");
const express = require("express");
const { pool, init } = require("./db");

// Load .env in local dev if present (no dependency needed).
try {
  require("fs")
    .readFileSync(path.join(__dirname, ".env"), "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    });
} catch (_) {
  /* no .env file — fine in production */
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: err.message });
  });

/* ----------------------------- ACTIONS ----------------------------- */

// List all active actions, grouped order by room/position.
app.get(
  "/api/actions",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, label, room, position FROM actions WHERE active = TRUE ORDER BY room, position, id"
    );
    res.json(rows);
  })
);

app.post(
  "/api/actions",
  wrap(async (req, res) => {
    const label = (req.body.label || "").trim();
    const room = (req.body.room || "Général").trim() || "Général";
    if (!label) return res.status(400).json({ error: "Le libellé est requis." });
    const pos = await nextPosition(room);
    const { rows } = await pool.query(
      "INSERT INTO actions (label, room, position) VALUES ($1, $2, $3) RETURNING id, label, room, position",
      [label, room, pos]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/api/actions/:id",
  wrap(async (req, res) => {
    const label = (req.body.label || "").trim();
    const room = (req.body.room || "Général").trim() || "Général";
    if (!label) return res.status(400).json({ error: "Le libellé est requis." });
    const { rows } = await pool.query(
      "UPDATE actions SET label = $1, room = $2 WHERE id = $3 RETURNING id, label, room, position",
      [label, room, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Introuvable." });
    res.json(rows[0]);
  })
);

// Soft delete so historical sessions keep their snapshot.
app.delete(
  "/api/actions/:id",
  wrap(async (req, res) => {
    await pool.query("UPDATE actions SET active = FALSE WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  })
);

async function nextPosition(room) {
  const { rows } = await pool.query(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM actions WHERE room = $1",
    [room]
  );
  return rows[0].p;
}

/* ----------------------------- SESSIONS ---------------------------- */

// List sessions with progress summary.
app.get(
  "/api/sessions",
  wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT s.id, s.session_date, s.title, s.note, s.created_at,
             COUNT(i.id)::int AS total,
             COUNT(i.id) FILTER (WHERE i.done)::int AS done
      FROM sessions s
      LEFT JOIN session_items i ON i.session_id = s.id
      GROUP BY s.id
      ORDER BY s.session_date DESC, s.id DESC
    `);
    res.json(rows);
  })
);

// Create a session from a list of action ids (snapshotting label + room).
app.post(
  "/api/sessions",
  wrap(async (req, res) => {
    const date = req.body.date || new Date().toISOString().slice(0, 10);
    const title = (req.body.title || "").trim() || null;
    const note = (req.body.note || "").trim() || null;
    const actionIds = Array.isArray(req.body.actionIds) ? req.body.actionIds : [];
    if (!actionIds.length)
      return res.status(400).json({ error: "Sélectionnez au moins une tâche." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const s = await client.query(
        "INSERT INTO sessions (session_date, title, note) VALUES ($1, $2, $3) RETURNING id",
        [date, title, note]
      );
      const sessionId = s.rows[0].id;
      // Pull selected actions, preserving room/position order.
      const a = await client.query(
        "SELECT id, label, room, position FROM actions WHERE id = ANY($1::int[]) ORDER BY room, position, id",
        [actionIds]
      );
      let pos = 0;
      for (const act of a.rows) {
        await client.query(
          "INSERT INTO session_items (session_id, action_id, label, room, position) VALUES ($1, $2, $3, $4, $5)",
          [sessionId, act.id, act.label, act.room, pos++]
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ id: sessionId });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

// Get one session with its items.
app.get(
  "/api/sessions/:id",
  wrap(async (req, res) => {
    const s = await pool.query(
      "SELECT id, session_date, title, note, created_at FROM sessions WHERE id = $1",
      [req.params.id]
    );
    if (!s.rows.length) return res.status(404).json({ error: "Introuvable." });
    const items = await pool.query(
      "SELECT id, label, room, position, done FROM session_items WHERE session_id = $1 ORDER BY room, position, id",
      [req.params.id]
    );
    res.json({ ...s.rows[0], items: items.rows });
  })
);

// Toggle / set an item's done flag.
app.put(
  "/api/sessions/:id/items/:itemId",
  wrap(async (req, res) => {
    const done = !!req.body.done;
    const { rows } = await pool.query(
      "UPDATE session_items SET done = $1 WHERE id = $2 AND session_id = $3 RETURNING id, done",
      [done, req.params.itemId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Introuvable." });
    res.json(rows[0]);
  })
);

app.delete(
  "/api/sessions/:id",
  wrap(async (req, res) => {
    await pool.query("DELETE FROM sessions WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  })
);

/* ------------------------------ START ------------------------------ */

const PORT = process.env.PORT || 3000;
init()
  .then(() => {
    app.listen(PORT, () => console.log(`Ménage en écoute sur le port ${PORT}`));
  })
  .catch((err) => {
    console.error("Échec de l'initialisation de la base :", err);
    process.exit(1);
  });
