(function () {
  "use strict";
  const WF = window.WF;
  const I18N = window.WF_I18N;

  const pathMatch = window.location.pathname.match(/^\/organize\/([A-Za-z0-9]+)\/?$/);
  if (!pathMatch) { window.location.href = "/"; return; }
  let organizerToken = pathMatch[1];

  let meeting = null;             // full meeting payload from the API
  let workingDecision = new Set(); // decision cells being edited in the grid
  let gridRubberBandController = null;
  let deleted = false;
  const hiddenParticipants = new Set(); // local view filter, survives re-renders

  const titleText = document.getElementById("meeting-title-text");
  const participantLinkInput = document.getElementById("participant-link");
  const organizerLinkInput = document.getElementById("organizer-link");
  const participantsBody = document.getElementById("participants-body");
  const groupPanelBody = document.getElementById("group-panel-body");
  const decisionStatus = document.getElementById("decision-status");
  const renameInput = document.getElementById("rename-input");
  const manageErr = document.getElementById("manage-err");
  const deletedBanner = document.getElementById("deleted-banner");

  // Thin-line icons (Feather, MIT) that inherit currentColor the same way the
  // week-nav arrows do. Text labels move to aria-label + title, so the
  // accessible name must be set explicitly on each button.
  const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

  async function init() {
    await I18N.ready;
    if (!(await loadMeeting())) return;
    bindStaticControls();
    renderAll();
    new ResizeObserver(syncParticipantsHeight).observe(groupPanelBody);
    document.addEventListener("wf:locale", () => {
      if (meeting && !deleted) renderAll();
    });
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
      showDeadPanel(I18N.t("no_meeting_found"));
      return false;
    }
    workingDecision = new Set(meeting.decision_cells || []);
    return true;
  }

  // Unknown/rotated/deleted token: the panel can't do anything useful.
  function showDeadPanel(msg) {
    document.getElementById("page").innerHTML =
      `<div class="topbar"><a class="brand" href="/"><div class="mark"></div><h1>When<span>Free</span></h1></a>` +
      `<div class="topbar-right"><div class="lang-switch" role="group">` +
      `<button class="lang-btn" data-lang="en" type="button">EN</button>` +
      `<button class="lang-btn" data-lang="de" type="button">DE</button></div>` +
      `<a class="topbar-link" href="https://github.com/sharko789/whenfree">GitHub</a></div></div>` +
      `<div class="card dead-card"><h3>${I18N.t("dead_panel_title")}</h3>` +
      `<p class="hint">${WF.escapeHtml(msg)}</p>` +
      `<p class="hint">${I18N.t("dead_panel_hint")}</p></div>`;
    I18N.applyStatic(document.getElementById("page"));
  }

  function bindStaticControls() {
    document.getElementById("copy-participant-link").addEventListener("click", (e) => copyField(participantLinkInput, e.target));
    document.getElementById("open-participant-link").addEventListener("click", () => openField(participantLinkInput));
    document.getElementById("copy-organizer-link").addEventListener("click", (e) => copyField(organizerLinkInput, e.target));
    document.getElementById("rotate-token").addEventListener("click", rotateToken);
    document.getElementById("save-decision").addEventListener("click", saveDecision);
    document.getElementById("clear-decision").addEventListener("click", clearDecision);
    document.getElementById("rename-save").addEventListener("click", renameMeeting);
    renameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") renameMeeting(); });
    document.getElementById("delete-meeting").addEventListener("click", deleteMeeting);
  }

  function copyField(input, btn) {
    input.select();
    input.setSelectionRange(0, input.value.length);
    navigator.clipboard && navigator.clipboard.writeText(input.value);
    btn.textContent = I18N.t("copied");
    setTimeout(() => { btn.textContent = I18N.t("copy_link"); }, 1200);
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
    // Detach from static i18n: applyStatic() would otherwise clobber the
    // real title with the "loading" placeholder on every locale switch.
    // (Currently masked because renderAll re-runs right after applyStatic
    // in the wf:locale handler - don't rely on that ordering.)
    titleText.removeAttribute("data-i18n");
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
      participantsBody.innerHTML = `<div class="hint">${I18N.t("no_participants_org")}</div>`;
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

      row.dataset.hidden = hiddenParticipants.has(name) ? "1" : "";

      const isHidden = hiddenParticipants.has(name);
      const hideBtn = document.createElement("button");
      hideBtn.type = "button";
      hideBtn.className = "p-toggle";
      hideBtn.innerHTML = isHidden ? ICON_EYE_OFF : ICON_EYE;
      hideBtn.setAttribute("aria-label", I18N.t("hide_aria"));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "p-delete";
      delBtn.innerHTML = ICON_TRASH;
      delBtn.setAttribute("aria-label", I18N.t("delete_participant_aria"));

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
    const name = row.querySelector(".p-name").textContent;
    const hidden = !hiddenParticipants.has(name);
    if (hidden) hiddenParticipants.add(name); else hiddenParticipants.delete(name);
    row.dataset.hidden = hidden ? "1" : "";
    const toggle = row.querySelector(".p-toggle");
    toggle.innerHTML = hidden ? ICON_EYE_OFF : ICON_EYE;
    toggle.setAttribute("aria-label", I18N.t("hide_aria"));
    renderDecisionGrid();
  }

  async function deleteParticipant(name, row) {
    if (!window.confirm(I18N.t("confirm_delete_participant", { name }))) return;
    row.classList.add("p-deleting");
    try {
      meeting = await WF.api("/organize/" + organizerToken + "/participants/" + encodeURIComponent(name), { method: "DELETE" });
      hiddenParticipants.delete(name);
      workingDecision = new Set(meeting.decision_cells || []);
      renderAll();
    } catch (e) {
      row.classList.remove("p-deleting");
      manageErr.textContent = e.message || I18N.t("err_delete");
    }
  }

  function setDocumentTitle() {
    document.title = I18N.t("doc_title_organize", { title: meeting.title });
  }

  function hiddenParticipantNames() {
    return [...hiddenParticipants];
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
    status.textContent = I18N.t("saving");
    try {
      meeting = await WF.api("/organize/" + organizerToken + "/decision", {
        method: "POST",
        body: JSON.stringify({ cells: Array.from(workingDecision) }),
      });
      workingDecision = new Set(meeting.decision_cells || []);
      renderDecisionGrid();
      status.textContent = workingDecision.size ? I18N.t("saved") : I18N.t("decision_cleared");
    } catch (e) {
      status.style.color = "var(--danger)";
      status.textContent = e.message || I18N.t("err_save");
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
    if (!title) { manageErr.textContent = I18N.t("err_title_required"); return; }
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
      manageErr.textContent = e.message || I18N.t("err_rename");
    } finally {
      btn.disabled = false;
    }
  }

  async function rotateToken() {
    if (deleted) return;
    if (!window.confirm(I18N.t("confirm_rotate"))) return;
    manageErr.textContent = "";
    try {
      const res = await WF.api("/organize/" + organizerToken + "/rotate-token", { method: "POST" });
      organizerToken = res.organize_token;
      history.replaceState(null, "", "/organize/" + organizerToken);
      organizerLinkInput.value = window.location.origin + "/organize/" + organizerToken;
    } catch (e) {
      manageErr.textContent = e.message || I18N.t("err_rotate");
    }
  }

  async function deleteMeeting() {
    if (deleted) return;
    const code = document.getElementById("delete-confirm-input").value.trim().toUpperCase();
    if (code !== meeting.id) {
      manageErr.textContent = I18N.t("err_code_mismatch", { code: meeting.id });
      return;
    }
    if (!window.confirm(I18N.t("confirm_delete_meeting"))) return;
    try {
      await WF.api("/organize/" + organizerToken, { method: "DELETE" });
      deleted = true;
      document.getElementById("page").querySelectorAll("input, button:not(.lang-btn)").forEach((el) => { el.disabled = true; });
      deletedBanner.hidden = false;
    } catch (e) {
      manageErr.textContent = e.message || I18N.t("err_delete");
    }
  }

  init();
})();
