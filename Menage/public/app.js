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
$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.toggle("is-active", b === btn));
    const name = btn.dataset.tab;
    $$(".panel").forEach((p) => p.classList.toggle("is-active", p.id === "tab-" + name));
    if (name === "library") renderLibrary();
    if (name === "history") loadHistory();
  })
);

/* ====================== NOUVELLE SÉANCE ====================== */
function renderNew() {
  const filter = $("#new-search").value.trim().toLowerCase();
  const list = $("#new-list");
  const visible = actions.filter((a) => !filter || a.label.toLowerCase().includes(filter));
  const groups = groupByRoom(visible);

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
      });
      body.appendChild(row);
    }
    $(".room-toggle", card).addEventListener("click", () => {
      const turnOn = !allChecked;
      items.forEach((a) => (turnOn ? selected.add(a.id) : selected.delete(a.id)));
      renderNew();
      updateCount();
    });
    list.appendChild(card);
  }
}

function updateCount() {
  $("#sel-count").textContent = selected.size;
}

$("#new-search").addEventListener("input", renderNew);
$("#clear-sel").addEventListener("click", () => {
  selected.clear();
  renderNew();
  updateCount();
});

/* ----------------------------- Print ----------------------------- */
$("#print-btn").addEventListener("click", () => {
  if (!selected.size) return toast("Sélectionnez au moins une tâche.");
  buildPrintArea();
  window.print();
});

function buildPrintArea() {
  const date = $("#sess-date").value;
  const title = $("#sess-title").value.trim() || "Liste de ménage";
  const note = $("#sess-note").value.trim();
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
      ${note ? `<div class="print-note"><b>Note :</b> ${escapeHtml(note)}</div>` : ""}
    </div>
    <div class="print-rooms">${rooms}</div>
    <div class="print-footer">Liste de ménage — à cocher pendant la séance</div>`;
}

/* ----------------------------- Save ----------------------------- */
$("#save-btn").addEventListener("click", async () => {
  if (!selected.size) return toast("Sélectionnez au moins une tâche.");
  try {
    await api("POST", "/api/sessions", {
      date: $("#sess-date").value || undefined,
      title: $("#sess-title").value,
      note: $("#sess-note").value,
      actionIds: [...selected],
    });
    toast("Séance enregistrée ✓");
    selected.clear();
    $("#sess-title").value = "";
    $("#sess-note").value = "";
    renderNew();
    updateCount();
  } catch (e) {
    toast(e.message);
  }
});

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

/* ====================== HISTORIQUE ====================== */
async function loadHistory() {
  const list = $("#history-list");
  list.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    const sessions = await api("GET", "/api/sessions");
    $("#history-empty").hidden = sessions.length > 0;
    list.innerHTML = "";
    for (const s of sessions) {
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      const card = document.createElement("div");
      card.className = "hist-card";
      card.innerHTML = `
        <div class="progress" style="--p:${pct}"><span>${pct}%</span></div>
        <div class="hist-main">
          <div class="hist-date">${escapeHtml(s.title || "Séance")} — ${frenchDate(
        s.session_date.slice(0, 10)
      )}</div>
          <div class="hist-sub">${s.done}/${s.total} tâche(s) faite(s)${
        s.note ? " · " + escapeHtml(s.note) : ""
      }</div>
        </div>
        <button class="btn danger small del">Supprimer</button>`;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".del")) return;
        openSession(s.id);
      });
      $(".del", card).addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Supprimer cette séance ?")) return;
        await api("DELETE", `/api/sessions/${s.id}`);
        loadHistory();
      });
      list.appendChild(card);
    }
  } catch (e) {
    list.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`;
  }
}

async function openSession(id) {
  const s = await api("GET", `/api/sessions/${id}`);
  const groups = groupByRoom(s.items);
  let html = `<h1>${escapeHtml(s.title || "Séance")}</h1>
    <p class="muted">${frenchDate(s.session_date.slice(0, 10))}${
    s.note ? " · " + escapeHtml(s.note) : ""
  }</p><div class="rooms" style="margin-top:14px">`;
  for (const [room, items] of groups) {
    html += `<div class="room-card"><div class="room-title"><span>${escapeHtml(
      room
    )}</span></div><div class="room-body">`;
    for (const it of items) {
      html += `<label class="task${it.done ? " checked" : ""}">
        <input type="checkbox" data-item="${it.id}" ${it.done ? "checked" : ""} />
        <span class="label">${escapeHtml(it.label)}</span></label>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  $("#modal-body").innerHTML = html;
  $$("#modal-body input[type=checkbox]").forEach((cb) =>
    cb.addEventListener("change", async () => {
      cb.closest(".task").classList.toggle("checked", cb.checked);
      await api("PUT", `/api/sessions/${id}/items/${cb.dataset.item}`, { done: cb.checked });
    })
  );
  showModal();
}

function showModal() {
  // Never open an empty dialog.
  if (!$("#modal-body").innerHTML.trim()) return;
  $("#modal").hidden = false;
}
function closeModal() {
  const modal = $("#modal");
  if (modal.hidden) return;
  modal.hidden = true;
  $("#modal-body").innerHTML = "";
  loadHistory(); // refresh progress rings
}
$("#modal-close").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* ------------------------------ Boot ------------------------------ */
async function loadActions() {
  actions = await api("GET", "/api/actions");
}

async function boot() {
  $("#sess-date").value = new Date().toISOString().slice(0, 10);
  try {
    await loadActions();
  } catch (e) {
    toast("Connexion à la base impossible.");
  }
  renderNew();
  updateCount();
}

boot();
