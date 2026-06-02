# 🧹 Ménage

A small French web app to build a custom cleaning checklist for each session, print it for the cleaning person, and keep a history of past sessions (with what was actually done).

- **Nouvelle séance** — pick a date, check the tasks you want (grouped by room), print a clean A4 sheet.
- **Bibliothèque** — add, edit, delete the tasks available to choose from. Starts empty.
- **Historique** — every saved session, with checkboxes to record what was completed.

Single Node/Express service + Postgres. No login (open with the link).

---

## Deploy to Railway (≈5 minutes)

### 1. Put the code on GitHub
From this folder:

```bash
git init
git add .
git commit -m "Ménage app"
```

Create an empty repo on github.com, then:

```bash
git remote add origin https://github.com/<your-user>/menage.git
git branch -M main
git push -u origin main
```

> `node_modules`, `.env`, and the source `Liste_menage.*` files are already git-ignored.

### 2. Create the Railway project
1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → pick the `menage` repo.
2. Railway detects Node, runs `npm install`, then `npm start`. Let the first deploy finish (it will fail to connect until the database exists — that's expected, fixed in the next step).

### 3. Add the database
1. In the project, click **+ New** → **Database** → **Add PostgreSQL**.
2. Railway automatically injects a `DATABASE_URL` variable into your app service. The app creates its tables on startup — nothing else to do.

### 4. Make it reachable
1. Open the app service → **Settings** → **Networking** → **Generate Domain**.
2. You get a URL like `menage-production.up.railway.app`. That's the link your wife bookmarks.

That's it. Redeploys happen automatically on every `git push`.

### Optional environment variables
Set these on the app service under **Variables** (none are required):

| Variable | Default | Purpose |
|---|---|---|
| `SEED_DEFAULT` | `false` | Set to `true` once to load the starter list from `seed-data.js` on first run (only fills if the library is empty). |
| `PORT` | provided by Railway | — |

---

## Run locally (optional)

You need a local Postgres. Then:

```bash
cp .env.example .env          # edit DATABASE_URL if needed
npm install
npm start                     # http://localhost:3000
```

---

## How it works (for reference)

- `server.js` — Express server + JSON API.
- `db.js` — Postgres pool + auto-creates the schema on startup.
- `seed-data.js` — optional starter list (disabled by default).
- `public/` — the whole frontend (plain HTML/CSS/JS, French).

**Tables:** `actions` (the library), `sessions` (each printed session), `session_items`
(a snapshot of the tasks chosen for a session, so editing the library later never
rewrites old history).

The printed sheet uses a dedicated print stylesheet — just use the browser's normal
print dialog (the **Imprimer** button opens it). Works to PDF too.
