(function () {
  "use strict";
  const WF = window.WF;

  const pathMatch = window.location.pathname.match(/^\/organize\/([A-Za-z0-9]+)\/?$/);
  if (!pathMatch) { window.location.href = "/"; return; }
  let organizerToken = pathMatch[1];

  let meeting = null;             // full meeting payload from the API
  let workingDecision = new Set(); // decision cells being edited in the grid
  let gridRubberBandController = null;
  let deleted = false;

  const titleText = document.getElementById("meeting-title-text");
  const participantLinkInput = document.getElementById("participant-link");
  const organizerLinkInput = document.getElementById("organizer-link");
  const participantsBody = document.getElementById("participants-body");
  const groupPanelBody = document.getElementById("group-panel-body");
  const decisionStatus = document.getElementById("decision-status");
  const renameInput = document.getElementById("rename-input");
  const manageErr = document.getElementById("manage-err");
  const deletedBanner = document.getElementById("deleted-banner");

  async function init() {
    if (!(await loadMeeting())) return;
    bindStaticControls();
    renderAll();
    new ResizeObserver(syncParticipantsHeight).observe(groupPanelBody);
  }

  // Cap the participant list to the heatmap grid's height so a long list
  // scrolls inside the panel instead of stretching the whole page.
  function syncParticipantsHeight() {
    if (!groupPanelBody || !participantsBody) return;
    participantsBody.style.maxHeight = groupPanelBody.offsetHeight + "px";
  }

  async function loadMeeting() {
    try {
      meeting = await WF.api("/organize/" + organizerToken);
    } catch (e) {
      showDeadPanel(e.message || "No meeting found for that organizer link.");
      return false;
    }
    workingDecision = new Set(meeting.decision_cells || []);
    return true;
  }

  // Unknown/rotated/deleted token: the panel can't do anything useful.
  function showDeadPanel(msg) {
    document.getElementById("page").innerHTML =
      `<div class="topbar"><a class="brand" href="/"><div class="mark"></div><h1>When<span>Free</span></h1></a>` +
      `<a class="topbar-link" href="https://github.com/sharko789/whenfree">GitHub</a></div>` +
      `<div class="card dead-card"><h3>This organizer link doesn't work</h3>` +
      `<p class="hint">${WF.escapeHtml(msg)}</p>` +
      `<p class="hint">The link may have been regenerated, or the meeting deleted.</p></div>`;
  }

  function bindStaticControls() {
    document.getElementById("copy-participant-link").addEventListener("click", (e) => copyField(participantLinkInput, e.target, "Copy link"));
    document.getElementById("open-participant-link").addEventListener("click", () => openField(participantLinkInput));
    document.getElementById("copy-organizer-link").addEventListener("click", (e) => copyField(organizerLinkInput, e.target, "Copy link"));
    document.getElementById("rotate-token").addEventListener("click", rotateToken);
    document.getElementById("save-decision").addEventListener("click", saveDecision);
    document.getElementById("clear-decision").addEventListener("click", clearDecision);
    document.getElementById("rename-save").addEventListener("click", renameMeeting);
    renameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") renameMeeting(); });
    document.getElementById("delete-meeting").addEventListener("click", deleteMeeting);
  }

  function copyField(input, btn, originalLabel) {
    input.select();
    input.setSelectionRange(0, input.value.length);
    navigator.clipboard && navigator.clipboard.writeText(input.value);
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = originalLabel; }, 1200);
  }

  function openField(input) {
    if (!input.value) return;
    const a = document.createElement("a");
    a.href = input.value;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------- rendering ---------- */
  function renderAll() {
    titleText.textContent = meeting.title;
    setDocumentTitle();
    participantLinkInput.value = WF.meetingUrl(meeting.id);
    organizerLinkInput.value = window.location.origin + "/organize/" + organizerToken;
    renameInput.value = meeting.title;
    document.getElementById("delete-code-label").textContent = meeting.id;
    renderParticipants();
    renderDecisionGrid();
  }

  function renderParticipants() {
    participantsBody.innerHTML = "";
    if (meeting.participants.length === 0) {
      participantsBody.innerHTML = '<div class="hint">No one has added their availability yet. Share the participant link to collect availability.</div>';
      return;
    }
    const table = document.createElement("table");
    table.className = "p-table";
    const body = document.createElement("tbody");
    const names = [...meeting.participants].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    names.forEach((name) => {
      const row = document.createElement("tr");
      row.className = "participant-row";

      const nameCell = document.createElement("td");
      const nameEl = document.createElement("span");
      nameEl.className = "p-name";
      nameEl.textContent = name;
      nameCell.appendChild(nameEl);

      const actionsCell = document.createElement("td");
      actionsCell.className = "p-actions";

      const hideBtn = document.createElement("button");
      hideBtn.type = "button";
      hideBtn.className = "p-toggle";
      hideBtn.textContent = "Hide";
      hideBtn.title = "Only hides them in this panel's heatmap — participants are unaffected.";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "p-delete";
      delBtn.textContent = "Delete";
      delBtn.title = "Remove this participant and their marks for everyone.";

      actionsCell.append(hideBtn, delBtn);
      row.append(nameCell, actionsCell);
      body.appendChild(row);
    });
    table.appendChild(body);
    participantsBody.appendChild(table);

    // Bind after insertion so handlers reference the live rows.
    body.querySelectorAll(".participant-row").forEach((row) => {
      const name = row.querySelector(".p-name").textContent;
      row.querySelector(".p-toggle").addEventListener("click", () => hideParticipant(row));
      row.querySelector(".p-delete").addEventListener("click", () => deleteParticipant(name, row));
    });
  }

  function hideParticipant(row) {
    // Local view filter only: excluded from heat counts, never persisted.
    const hidden = row.dataset.hidden === "1";
    row.dataset.hidden = hidden ? "" : "1";
    row.querySelector(".p-toggle").textContent = hidden ? "Hide" : "Show";
    renderDecisionGrid();
  }

  async function deleteParticipant(name, row) {
    if (!window.confirm(`Remove ${name} and their marks from this meeting? This affects everyone.`)) return;
    row.classList.add("p-deleting");
    try {
      meeting = await WF.api("/organize/" + organizerToken + "/participants/" + encodeURIComponent(name), { method: "DELETE" });
      workingDecision = new Set(meeting.decision_cells || []);
      renderAll();
    } catch (e) {
      row.classList.remove("p-deleting");
      manageErr.textContent = e.message || "Couldn't delete that participant.";
    }
  }

  function setDocumentTitle() {
    document.title = meeting.title + " - Organize - WhenFree";
  }

  function hiddenParticipantNames() {
    const out = [];
    participantsBody.querySelectorAll('.participant-row[data-hidden="1"] .p-name').forEach((el) => out.push(el.textContent));
    return out;
  }

  function renderDecisionGrid() {
    const prevScroll = groupPanelBody.querySelector(".tf-blocks")?.scrollLeft || 0;
    groupPanelBody.innerHTML = "";
    const gridWrap = document.createElement("div");
    gridWrap.className = "grid-wrap";
    groupPanelBody.appendChild(gridWrap);

    if (gridRubberBandController) gridRubberBandController.abort();
    gridRubberBandController = new AbortController();

    WF.renderHeatmap(gridWrap, {
      meeting,
      hiddenNames: hiddenParticipantNames(),
      decision: workingDecision,
      selection: workingDecision,
      outlineSelection: true,
      editable: true,
      tooltips: true,
      signal: gridRubberBandController.signal,
      onCommit: renderDecisionGrid,
      scrollLeft: prevScroll,
    });
    syncParticipantsHeight();
  }

  /* ---------- decision ---------- */
  async function saveDecision() {
    if (deleted) return;
    const status = decisionStatus;
    status.style.color = "var(--ink-faint)";
    status.textContent = "Saving…";
    try {
      meeting = await WF.api("/organize/" + organizerToken + "/decision", {
        method: "POST",
        body: JSON.stringify({ cells: Array.from(workingDecision) }),
      });
      workingDecision = new Set(meeting.decision_cells || []);
      renderDecisionGrid();
      status.textContent = workingDecision.size ? "Decision saved." : "Decision cleared.";
    } catch (e) {
      status.style.color = "var(--danger)";
      status.textContent = e.message || "Couldn't save the decision.";
    }
  }

  function clearDecision() {
    if (deleted) return;
    workingDecision = new Set();
    renderDecisionGrid();
    saveDecision();
  }

  /* ---------- manage ---------- */
  async function renameMeeting() {
    if (deleted) return;
    const title = renameInput.value.trim();
    if (!title) { manageErr.textContent = "Meeting name is required."; return; }
    manageErr.textContent = "";
    const btn = document.getElementById("rename-save");
    btn.disabled = true;
    try {
      meeting = await WF.api("/organize/" + organizerToken + "/meeting", {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      titleText.textContent = meeting.title;
      setDocumentTitle();
      renameInput.value = meeting.title;
    } catch (e) {
      manageErr.textContent = e.message || "Couldn't rename the meeting.";
    } finally {
      btn.disabled = false;
    }
  }

  async function rotateToken() {
    if (deleted) return;
    if (!window.confirm("Regenerate the organizer link? The current link stops working immediately.")) return;
    manageErr.textContent = "";
    try {
      const res = await WF.api("/organize/" + organizerToken + "/rotate-token", { method: "POST" });
      organizerToken = res.organize_token;
      history.replaceState(null, "", "/organize/" + organizerToken);
      organizerLinkInput.value = window.location.origin + "/organize/" + organizerToken;
    } catch (e) {
      manageErr.textContent = e.message || "Couldn't regenerate the link.";
    }
  }

  async function deleteMeeting() {
    if (deleted) return;
    const code = document.getElementById("delete-confirm-input").value.trim().toUpperCase();
    if (code !== meeting.id) {
      manageErr.textContent = "That code doesn't match. Type " + meeting.id + " to confirm.";
      return;
    }
    if (!window.confirm("Delete this meeting for everyone? Their availability and the decision are removed. This cannot be undone.")) return;
    try {
      await WF.api("/organize/" + organizerToken, { method: "DELETE" });
      deleted = true;
      document.getElementById("page").querySelectorAll("input, button").forEach((el) => { el.disabled = true; });
      deletedBanner.hidden = false;
    } catch (e) {
      manageErr.textContent = e.message || "Couldn't delete the meeting.";
    }
  }

  init();
})();
