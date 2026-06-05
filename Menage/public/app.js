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

/* ------------------------------ State ------------------------------ */
let actions = [];
const selected = new Set();

/* ------------------------------ Place ------------------------------ */
const PLACES = ["Appartement Aumetz", "Maison Aumetz"];
let currentPlace = (() => {
  try {
    const p = localStorage.getItem("menage_place");
    if (PLACES.includes(p)) return p;
  } catch (_) {}
  return PLACES[0];
})();
// Append the current place to a GET url.
const placeQ = () => "?place=" + encodeURIComponent(currentPlace);
// Add the current place to a request body.
const withPlace = (body) => Object.assign({ place: currentPlace }, body || {});

async function setPlace(p) {
  if (!PLACES.includes(p) || p === currentPlace) return;
  currentPlace = p;
  try {
    localStorage.setItem("menage_place", p);
  } catch (_) {}
  selected.clear();
  setStatus("");
  try {
    await reloadRoomsAndActions();
    await loadCurrentForDate();
  } catch (e) {
    toast("Connexion à la base impossible.");
    renderNew();
    updateCount();
  }
  if ($("#tab-history").classList.contains("is-active")) loadHistory();
}

/* ------------------------------ Tabs ------------------------------ */
function switchTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("is-active", p.id === "tab-" + name));
  if (name === "history") loadHistory();
}
$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab))
);

/* ====================== LISTE ACTUELLE ====================== */
let roomList = []; // persistent list of rooms (from the server)
let focusAddRoom = null; // room whose "add task" input should regain focus after render

// Rooms shown on the page, in saved order. Defensive union with any room
// referenced by a task but somehow missing from the list.
function roomsInOrder() {
  const seen = [...roomList];
  for (const a of actions) if (!seen.includes(a.room)) seen.push(a.room);
  return seen;
}

function renderNew() {
  const list = $("#new-list");
  list.innerHTML = "";
  const rooms = roomsInOrder();

  if (!rooms.length) {
    list.innerHTML =
      '<p class="rooms-hint">Aucune pièce pour l\'instant. Ajoutez-en une ci-dessous pour commencer.</p>';
    return;
  }

  rooms.forEach((room, rIdx) => {
    const items = actions.filter((a) => a.room === room);
    const allChecked = items.length > 0 && items.every((a) => selected.has(a.id));
    const card = document.createElement("div");
    card.className = "room-card";
    card.dataset.room = room;
    card.innerHTML = `
      <div class="room-title">
        <span class="room-name">
          ${escapeHtml(room)}
          <span class="room-tools">
            <button class="room-up" type="button" title="Monter la pièce" aria-label="Monter la pièce" ${
              rIdx === 0 ? "disabled" : ""
            }>▲</button>
            <button class="room-down" type="button" title="Descendre la pièce" aria-label="Descendre la pièce" ${
              rIdx === rooms.length - 1 ? "disabled" : ""
            }>▼</button>
            <button class="room-rename" type="button" title="Renommer la pièce" aria-label="Renommer">✎</button>
            <button class="room-del" type="button" title="Supprimer la pièce" aria-label="Supprimer la pièce">🗑</button>
          </span>
        </span>
        ${
          items.length
            ? `<button class="btn ghost small room-toggle">${allChecked ? "Décocher" : "Tout cocher"}</button>`
            : ""
        }
      </div>
      <div class="room-body"></div>
      <div class="room-add">
        <input type="text" class="add-task-input" placeholder="Ajouter une tâche dans « ${escapeHtml(
          room
        )} »…" />
        <button class="btn small add-task-btn">Ajouter</button>
      </div>`;

    const body = $(".room-body", card);
    items.forEach((a, idx) => {
      const row = document.createElement("label");
      row.className = "task" + (selected.has(a.id) ? " checked" : "");
      row.innerHTML = `
        <input type="checkbox" ${selected.has(a.id) ? "checked" : ""} />
        <span class="label">${escapeHtml(a.label)}</span>
        <span class="reorder">
          <button class="task-up" type="button" title="Monter" aria-label="Monter" ${
            idx === 0 ? "disabled" : ""
          }>▲</button>
          <button class="task-down" type="button" title="Descendre" aria-label="Descendre" ${
            idx === items.length - 1 ? "disabled" : ""
          }>▼</button>
        </span>
        <button class="task-del" type="button" title="Supprimer cette tâche" aria-label="Supprimer">✕</button>`;
      const cb = $("input", row);
      cb.addEventListener("change", () => {
        cb.checked ? selected.add(a.id) : selected.delete(a.id);
        row.classList.toggle("checked", cb.checked);
        updateCount();
        scheduleAutosave();
      });
      const stop = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      $(".task-up", row).addEventListener("click", (e) => {
        stop(e);
        moveWithin(room, idx, -1);
      });
      $(".task-down", row).addEventListener("click", (e) => {
        stop(e);
        moveWithin(room, idx, +1);
      });
      $(".task-del", row).addEventListener("click", (e) => {
        stop(e);
        deleteAction(a);
      });
      body.appendChild(row);
    });

    const toggle = $(".room-toggle", card);
    if (toggle)
      toggle.addEventListener("click", () => {
        const turnOn = !allChecked;
        items.forEach((a) => (turnOn ? selected.add(a.id) : selected.delete(a.id)));
        renderNew();
        updateCount();
        scheduleAutosave();
      });

    $(".room-rename", card).addEventListener("click", () => renameRoom(room));
    $(".room-del", card).addEventListener("click", () => deleteRoom(room));
    $(".room-up", card).addEventListener("click", () => moveRoom(rIdx, -1));
    $(".room-down", card).addEventListener("click", () => moveRoom(rIdx, +1));

    const addInput = $(".add-task-input", card);
    const submitTask = () => {
      const label = addInput.value.trim();
      if (!label) return;
      focusAddRoom = room;
      addActionToRoom(label, room);
    };
    $(".add-task-btn", card).addEventListener("click", submitTask);
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitTask();
      }
    });

    list.appendChild(card);
  });

  if (focusAddRoom) {
    const card = [...list.querySelectorAll(".room-card")].find(
      (c) => c.dataset.room === focusAddRoom
    );
    if (card) $(".add-task-input", card).focus();
    focusAddRoom = null;
  }
}

// Move a task up (-1) or down (+1) within its room.
function moveWithin(room, idx, delta) {
  const items = actions.filter((a) => a.room === room);
  const j = idx + delta;
  if (j < 0 || j >= items.length) return;
  const ids = items.map((x) => x.id);
  [ids[idx], ids[j]] = [ids[j], ids[idx]];
  reorderRoom(room, ids);
}

// Apply a new task order for a room: update locally for instant feedback, then persist.
async function reorderRoom(room, orderedIds) {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((a) => a && a.room === room);
  let k = 0;
  actions = actions.map((a) => (a.room === room ? ordered[k++] : a));
  ordered.forEach((a, i) => (a.position = i));
  renderNew();
  try {
    await api("PUT", "/api/actions/reorder", withPlace({ room, orderedIds }));
  } catch (e) {
    toast(e.message);
    await loadActions();
    renderNew();
  }
}

// Add a new task to a room.
async function addActionToRoom(label, room) {
  try {
    await api("POST", "/api/actions", withPlace({ label, room }));
    await reloadRoomsAndActions();
    renderNew();
  } catch (e) {
    toast(e.message);
  }
}

// Remove a task. Soft-deleted server-side, so past lists keep it.
async function deleteAction(a) {
  if (!confirm(`Supprimer la tâche « ${a.label} » ?`)) return;
  const wasSelected = selected.has(a.id);
  try {
    await api("DELETE", `/api/actions/${a.id}`);
    selected.delete(a.id);
    await loadActions();
    renderNew();
    updateCount();
    if (wasSelected) scheduleAutosave();
  } catch (e) {
    toast(e.message);
  }
}

// Rename a room (updates its tasks and past-list labels).
async function renameRoom(room) {
  const input = prompt("Nouveau nom de la pièce :", room);
  if (input === null) return;
  const newRoom = input.trim();
  if (!newRoom || newRoom === room) return;
  try {
    await api("PUT", "/api/rooms/rename", withPlace({ oldRoom: room, newRoom }));
    await reloadRoomsAndActions();
    renderNew();
  } catch (e) {
    toast(e.message);
  }
}

// Delete a room and its tasks (kept in past lists via snapshots).
async function deleteRoom(room) {
  const items = actions.filter((a) => a.room === room);
  const msg = items.length
    ? `Supprimer la pièce « ${room} » et ses ${items.length} tâche(s) ?`
    : `Supprimer la pièce « ${room} » ?`;
  if (!confirm(msg)) return;

  const hadSelected = items.some((a) => selected.has(a.id));
  try {
    await api("DELETE", "/api/rooms", withPlace({ room }));
    items.forEach((a) => selected.delete(a.id));
    await reloadRoomsAndActions();
    renderNew();
    updateCount();
    if (hadSelected) scheduleAutosave();
  } catch (e) {
    toast(e.message);
  }
}

// Move a room up (-1) or down (+1) in the list.
function moveRoom(idx, delta) {
  const rooms = roomsInOrder();
  const j = idx + delta;
  if (j < 0 || j >= rooms.length) return;
  [rooms[idx], rooms[j]] = [rooms[j], rooms[idx]];
  reorderRooms(rooms);
}

// Apply a new room order: update locally for instant feedback, then persist.
async function reorderRooms(orderedNames) {
  roomList = orderedNames.slice();
  renderNew();
  try {
    await api("PUT", "/api/rooms/reorder", withPlace({ orderedNames }));
  } catch (e) {
    toast(e.message);
    await loadRooms();
    renderNew();
  }
}

// Add a new room. Saved immediately so it persists even before it has tasks.
async function addRoom() {
  const input = $("#add-room-input");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  focusAddRoom = name;
  try {
    await api("POST", "/api/rooms", withPlace({ name }));
    await reloadRoomsAndActions();
    renderNew();
  } catch (e) {
    toast(e.message);
  }
}
$("#add-room-btn").addEventListener("click", addRoom);
$("#add-room-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addRoom();
  }
});

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
    await api("PUT", `/api/sessions/by-date/${date}`, withPlace({
      title: sessionTitle(),
      actionIds: [...selected],
    }));
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
      const data = await api("GET", `/api/sessions/by-date/${date}` + placeQ());
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
  // Blank the page title during printing so the browser's header doesn't show it.
  const prevTitle = document.title;
  document.title = " ";
  const restore = () => {
    document.title = prevTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
  setTimeout(restore, 1000);
});

function buildPrintArea() {
  const date = $("#sess-date").value;
  const title = "Liste de tâches ménagères";
  const chosen = actions.filter((a) => selected.has(a.id));

  // Same room/task order as the main page.
  let rooms = "";
  for (const room of roomsInOrder()) {
    const items = chosen.filter((a) => a.room === room);
    if (!items.length) continue;
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
      </div>
    </div>
    <div class="print-rooms">${rooms}</div>`;
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
    const data = await api("GET", "/api/matrix" + placeQ());
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
    html += `<th class="date-col" data-date="${s.date}" data-id="${s.id}" title="${escapeHtml(
      s.title || ""
    )} — cliquer pour rouvrir">
      <span class="date-label">${escapeHtml(shortDate(s.date))}</span>
      <button class="sess-del" type="button" title="Supprimer cette liste" aria-label="Supprimer cette liste">✕</button>
    </th>`;
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

  $$(".matrix .date-col").forEach((th) => {
    th.addEventListener("click", (e) => {
      if (e.target.closest(".sess-del")) return; // delete button handled separately
      openListForDate(th.dataset.date);
    });
    $(".sess-del", th).addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSession(th.dataset.id, th.dataset.date);
    });
  });
}

// Click a date column -> go back to the generator with that day's list loaded.
function openListForDate(date) {
  switchTab("new");
  $("#sess-date").value = date;
  updateHeading();
  loadCurrentForDate();
}

// Delete a whole saved list (a date column).
async function deleteSession(id, date) {
  if (!confirm(`Supprimer la liste du ${frenchDate(date)} ?`)) return;
  try {
    await api("DELETE", `/api/sessions/${id}`);
    loadHistory();
  } catch (e) {
    toast(e.message);
  }
}
// The table reloads whenever you open the "Listes précédentes" tab (see switchTab),
// so it is always current without any background polling.

/* ------------------------------ Boot ------------------------------ */
async function loadActions() {
  actions = await api("GET", "/api/actions" + placeQ());
}
async function loadRooms() {
  roomList = await api("GET", "/api/rooms" + placeQ());
}
async function reloadRoomsAndActions() {
  await Promise.all([loadRooms(), loadActions()]);
}

// Local YYYY-MM-DD (avoids the UTC off-by-one that showed yesterday's date).
function localISO(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function boot() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  $("#sess-date").value = localISO(tomorrow);
  $("#place-select").value = currentPlace;
  $("#place-select").addEventListener("change", (e) => setPlace(e.target.value));
  updateHeading();
  try {
    await reloadRoomsAndActions();
    await loadCurrentForDate();
  } catch (e) {
    toast("Connexion à la base impossible.");
    renderNew();
    updateCount();
  }
}

boot();
