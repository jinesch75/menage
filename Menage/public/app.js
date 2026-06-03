"use strict";

/* ------------------------------ Helpers ------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Erreur réseau");
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function frenchDate(iso) {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function groupByRoom(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.room)) map.set(it.room, []);
    map.get(it.room).push(it);
  }
  return map;
}

/* ------------------------------ State ------------------------------ */
let actions = [];
const selected = new Set();

/* ------------------------------ Tabs ------------------------------ */
function switchTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("is-active", p.id === "tab-" + name));
  if (name === "library") renderLibrary();
  if (name === "history") loadHistory();
}
$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab))
);

/* ====================== NOUVELLE SÉANCE ====================== */
function renderNew() {
  const list = $("#new-list");
  const groups = groupByRoom(actions);

  if (!actions.length) {
    list.innerHTML =
      '<p class="empty">La bibliothèque est vide. Allez dans l\'onglet <b>Bibliothèque</b> pour ajouter des tâches.</p>';
    return;
  }

  list.innerHTML = "";
  for (const [room, items] of groups) {
    const allChecked = items.every((a) => selected.has(a.id));
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-title">
        <span>${escapeHtml(room)}</span>
        <button class="btn ghost small room-toggle">${allChecked ? "Décocher" : "Tout cocher"}</button>
      </div>
      <div class="room-body"></div>`;
    const body = $(".room-body", card);
    for (const a of items) {
      const row = document.createElement("label");
      row.className = "task" + (selected.has(a.id) ? " checked" : "");
      row.innerHTML = `
        <input type="checkbox" ${selected.has(a.id) ? "checked" : ""} />
        <span class="label">${escapeHtml(a.label)}</span>`;
      const cb = $("input", row);
      cb.addEventListener("change", () => {
        cb.checked ? selected.add(a.id) : selected.delete(a.id);
        row.classList.toggle("checked", cb.checked);
        updateCount();
        scheduleAutosave();
      });
      body.appendChild(row);
    }
    $(".room-toggle", card).addEventListener("click", () => {
      const turnOn = !allChecked;
      items.forEach((a) => (turnOn ? selected.add(a.id) : selected.delete(a.id)));
      renderNew();
      updateCount();
      scheduleAutosave();
    });
    list.appendChild(card);
  }
}

function updateCount() {
  $("#sel-count").textContent = selected.size;
}

$("#clear-sel").addEventListener("click", () => {
  selected.clear();
  renderNew();
  updateCount();
  scheduleAutosave();
});

// Title that reflects the chosen date's weekday, e.g. "… pour jeudi".
function frenchWeekday(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long" });
}
function sessionTitle() {
  const wd = frenchWeekday($("#sess-date").value);
  return "Liste de tâches ménagères pour " + wd;
}
function updateHeading() {
  $("#new-title").textContent = sessionTitle().trim();
}

/* --------- Auto-save: each change is persisted to the date's session --------- */
let autosaveTimer = null;
function setStatus(msg) {
  $("#save-status").textContent = msg;
}
function scheduleAutosave() {
  setStatus("Enregistrement…");
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveNow, 500);
}
async function autosaveNow() {
  const date = $("#sess-date").value;
  if (!date) return;
  try {
    await api("PUT", `/api/sessions/by-date/${date}`, {
      title: sessionTitle(),
      actionIds: [...selected],
    });
    setStatus("Enregistré ✓");
    if ($("#tab-history").classList.contains("is-active")) loadHistory();
  } catch (e) {
    setStatus("Échec de l'enregistrement");
  }
}

// Load the existing list saved for the chosen date (so editing continues it).
async function loadCurrentForDate() {
  const date = $("#sess-date").value;
  selected.clear();
  if (date) {
    try {
      const data = await api("GET", `/api/sessions/by-date/${date}`);
      for (const it of data.items) if (it.action_id) selected.add(it.action_id);
      setStatus(data.session ? "Enregistré ✓" : "");
    } catch (e) {
      setStatus("");
    }
  }
  renderNew();
  updateCount();
}

$("#sess-date").addEventListener("change", () => {
  updateHeading();
  loadCurrentForDate();
});

/* ----------------------------- Print ----------------------------- */
$("#print-btn").addEventListener("click", () => {
  if (!selected.size) return toast("Sélectionnez au moins une tâche.");
  buildPrintArea();
  window.print();
});

function buildPrintArea() {
  const date = $("#sess-date").value;
  const title = sessionTitle();
  const chosen = actions.filter((a) => selected.has(a.id));
  const groups = groupByRoom(chosen);

  let rooms = "";
  for (const [room, items] of groups) {
    rooms += `<div class="print-room"><h2>${escapeHtml(room)}</h2>`;
    for (const a of items) {
      rooms += `<div class="print-task"><span class="print-box"></span><span>${escapeHtml(
        a.label
      )}</span></div>`;
    }
    rooms += `</div>`;
  }

  $("#print-area").innerHTML = `
    <div class="print-header">
      <h1>${escapeHtml(title)}</h1>
      <div class="print-meta">
        <span><b>Date :</b> ${date ? frenchDate(date) : "____________________"}</span>
        <span><b>Tâches :</b> ${chosen.length}</span>
      </div>
    </div>
    <div class="print-rooms">${rooms}</div>
    <div class="print-footer">Liste de ménage — à cocher pendant la séance</div>`;
}

/* ====================== BIBLIOTHÈQUE ====================== */
function renderLibrary() {
  const list = $("#library-list");
  const groups = groupByRoom(actions);
  $("#library-empty").hidden = actions.length > 0;
  refreshRoomDatalist();

  list.innerHTML = "";
  for (const [room, items] of groups) {
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `<div class="room-title"><span>${escapeHtml(room)}</span>
      <span class="muted" style="font-weight:500">${items.length}</span></div>
      <div class="room-body"></div>`;
    const body = $(".room-body", card);
    for (const a of items) {
      const row = document.createElement("div");
      row.className = "task";
      row.innerHTML = `
        <span class="label">${escapeHtml(a.label)}</span>
        <span class="row-actions">
          <button class="btn ghost small edit">Modifier</button>
          <button class="btn danger small del">Supprimer</button>
        </span>`;
      $(".edit", row).addEventListener("click", () => editAction(a));
      $(".del", row).addEventListener("click", () => deleteAction(a));
      body.appendChild(row);
    }
    list.appendChild(card);
  }
}

function refreshRoomDatalist() {
  const rooms = [...new Set(actions.map((a) => a.room))].sort();
  $("#rooms-list").innerHTML = rooms.map((r) => `<option value="${escapeHtml(r)}">`).join("");
}

$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const label = $("#add-label").value.trim();
  const room = $("#add-room").value.trim() || "Général";
  if (!label) return;
  try {
    await api("POST", "/api/actions", { label, room });
    $("#add-label").value = "";
    await loadActions();
    renderLibrary();
    toast("Tâche ajoutée ✓");
  } catch (err) {
    toast(err.message);
  }
});

async function editAction(a) {
  const label = prompt("Modifier la tâche :", a.label);
  if (label === null) return;
  const room = prompt("Pièce :", a.room);
  if (room === null) return;
  try {
    await api("PUT", `/api/actions/${a.id}`, { label: label.trim(), room: room.trim() });
    await loadActions();
    renderLibrary();
    toast("Modifié ✓");
  } catch (err) {
    toast(err.message);
  }
}

async function deleteAction(a) {
  if (!confirm(`Supprimer « ${a.label} » ?`)) return;
  try {
    await api("DELETE", `/api/actions/${a.id}`);
    selected.delete(a.id);
    await loadActions();
    renderLibrary();
    toast("Supprimé");
  } catch (err) {
    toast(err.message);
  }
}

/* ====================== LISTES PRÉCÉDENTES (matrice) ====================== */
const MSEP = "|~|"; // must match the server's separator

function shortDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

async function loadHistory() {
  const wrap = $("#history-table");
  try {
    const data = await api("GET", "/api/matrix");
    renderMatrix(data);
  } catch (e) {
    wrap.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

function renderMatrix(data) {
  const wrap = $("#history-table");
  $("#history-empty").hidden = data.sessions.length > 0;
  if (!data.sessions.length) {
    wrap.innerHTML = "";
    return;
  }

  let html =
    '<table class="matrix"><thead><tr><th class="corner">Tâche</th>';
  for (const s of data.sessions) {
    html += `<th class="date-col" data-date="${s.date}" title="${escapeHtml(
      s.title || ""
    )} — cliquer pour rouvrir">${escapeHtml(shortDate(s.date))}</th>`;
  }
  html += "</tr></thead><tbody>";

  let lastRoom = null;
  for (const r of data.rows) {
    if (r.room !== lastRoom) {
      lastRoom = r.room;
      html += `<tr class="room-row"><td class="room-cell" colspan="${
        data.sessions.length + 1
      }">${escapeHtml(r.room)}</td></tr>`;
    }
    html += `<tr><th class="task-cell">${escapeHtml(r.label)}</th>`;
    for (const s of data.sessions) {
      const on = data.cells[s.id + MSEP + r.room + MSEP + r.label];
      html += `<td class="cell">${on ? '<span class="chk">✓</span>' : ""}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  wrap.innerHTML = html;

  $$(".matrix .date-col").forEach((th) =>
    th.addEventListener("click", () => openListForDate(th.dataset.date))
  );
}

// Click a date column -> go back to the generator with that day's list loaded.
function openListForDate(date) {
  switchTab("new");
  $("#sess-date").value = date;
  updateHeading();
  loadCurrentForDate();
}
// The table reloads whenever you open the "Listes précédentes" tab (see switchTab),
// so it is always current without any background polling.

/* ------------------------------ Boot ------------------------------ */
async function loadActions() {
  actions = await api("GET", "/api/actions");
}

// Local YYYY-MM-DD (avoids the UTC off-by-one that showed yesterday's date).
function localISO(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function boot() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  $("#sess-date").value = localISO(tomorrow);
  updateHeading();
  try {
    await loadActions();
    await loadCurrentForDate();
  } catch (e) {
    toast("Connexion à la base impossible.");
    renderNew();
    updateCount();
  }
}

boot();
