(function () {
  "use strict";
  const WF = window.WF;

  const pathMatch = window.location.pathname.match(/^\/meeting\/([A-Za-z0-9]+)\/?$/);
  if (!pathMatch) { window.location.href = "/"; return; }
  const meetingId = pathMatch[1].toUpperCase();

  let meeting = null;            // full meeting payload from the API
  let currentName = "";          // name the "your availability" panel is editing
  let currentPassword = "";      // sent with every save for that name
  let selectedCells = new Set(); // working (auto-saved) selection for currentName
  let ownRubberBandController = null;
  let participantListController = null;

  const titleText = document.getElementById("meeting-title-text");
  const shareLinkInput = document.getElementById("share-link");
  const ownPanelBody = document.getElementById("own-panel-body");
  const groupPanelBody = document.getElementById("group-panel-body");
  const participantListEl = document.getElementById("participant-list");
  const tipEl = document.getElementById("tip");

  async function init() {
    try {
      meeting = await WF.api("/meetings/" + meetingId);
    } catch (e) {
      window.location.href = "/";
      return;
    }
    titleText.textContent = meeting.title;
    document.title = meeting.title + " - WhenFree";
    const link = WF.meetingUrl(meeting.id);
    shareLinkInput.value = link;
    document.getElementById("copy-link").addEventListener("click", (e) => {
      shareLinkInput.select();
      navigator.clipboard && navigator.clipboard.writeText(link);
      e.target.textContent = "Copied";
      setTimeout(() => { e.target.textContent = "Copy link"; }, 1200);
    });

    renderParticipantList();
    renderGroupPanel();
    renderOwnPanelNameForm();

    window.addEventListener("resize", renderParticipantList);
  }

  function renderParticipantList() {
    if (meeting.participants.length === 0) {
      participantListEl.textContent = "No one has added their availability yet — be the first.";
      return;
    }

    const total = meeting.participants.length;
    const label = `${total} ${total === 1 ? "person" : "people"} so far:`;
    let names = meeting.participants.map(WF.escapeHtml);
    let hiddenNames = [];

    participantListEl.innerHTML = `<b>${label}</b> ${names.join(", ")}`;

    while (participantListEl.scrollWidth > participantListEl.clientWidth && names.length > 0) {
      hiddenNames.unshift(names.pop());
      const remaining = total - names.length;
      participantListEl.innerHTML =
        `<b>${label}</b> ${names.join(", ")}${remaining ? ` <span class="others-tip">and ${remaining} others</span>` : ""}`;
    }

    if (participantListController) participantListController.abort();
    participantListController = new AbortController();
    const signal = participantListController.signal;

    participantListEl.addEventListener("mousemove", (e) => {
      const others = e.target.closest(".others-tip");
      if (!others) return;
      tipEl.innerHTML = hiddenNames.map(name => `<div class="hidden-name">${name}</div>`).join("");
      tipEl.style.left = (e.clientX + 12) + "px";
      tipEl.style.top = (e.clientY + 14) + "px";
      tipEl.style.display = "block";
    }, { signal });

    participantListEl.addEventListener("mouseleave", () => {
      tipEl.style.display = "none";
    }, { signal });
  }

  /* ---------- left panel: name entry, then editable grid ---------- */
  function renderOwnPanelNameForm() {
    ownPanelBody.innerHTML = "";
    ownPanelBody.classList.add("own-panel-body-login");

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Your name";
    nameLabel.setAttribute("for", "own-name-input");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.id = "own-name-input";
    nameInput.placeholder = "Type your name";
    nameInput.value = currentName;

    const passLabel = document.createElement("label");
    passLabel.textContent = "Password (optional)";
    passLabel.setAttribute("for", "own-password-input");
    const passInput = document.createElement("input");
    passInput.type = "password";
    passInput.id = "own-password-input";
    passInput.placeholder = "Only if you want to protect this name";

    const err = document.createElement("div");
    err.className = "err";

    const btn = document.createElement("button");
    btn.className = "btn-primary btn-block";
    btn.type = "button";
    btn.textContent = "Continue";

    ownPanelBody.append(nameLabel, nameInput, passLabel, passInput, err, btn);

    async function submit() {
      const name = nameInput.value.trim();
      const password = passInput.value;
      if (!name) { err.textContent = "Enter your name to continue."; return; }

      const existingCells = meeting.availability[name];
      if (existingCells === undefined) {
        // Brand-new name: nothing to verify against yet, no need to touch
        // the server until they actually mark something.
        currentName = name;
        currentPassword = password;
        selectedCells = new Set();
        renderOwnPanelGrid();
        return;
      }

      // Existing name: confirm the password (if any) matches before handing
      // over the grid. Re-saving the unchanged cells doubles as a check,
      // since the server rejects a mismatched password without writing.
      btn.disabled = true;
      err.textContent = "Checking…";
      try {
        meeting = await WF.api("/meetings/" + meetingId + "/availability", {
          method: "POST",
          body: JSON.stringify({ name, password, cells: existingCells }),
        });
        currentName = name;
        currentPassword = password;
        selectedCells = new Set(meeting.availability[name] || existingCells);
        renderOwnPanelGrid();
        renderParticipantList();
        renderGroupPanel();
      } catch (e) {
        err.textContent = e.message || "Couldn't verify that name.";
      } finally {
        btn.disabled = false;
      }
    }
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    btn.addEventListener("click", submit);
    nameInput.focus();
  }

  function renderOwnPanelGrid() {
    const prevScroll = ownPanelBody.querySelector(".tf-blocks")?.scrollLeft || 0;
    ownPanelBody.innerHTML = "";
    ownPanelBody.classList.remove("own-panel-body-login");

    const introRow = document.createElement("div");
    introRow.style.display = "flex";
    introRow.style.alignItems = "baseline";
    introRow.style.justifyContent = "space-between";
    introRow.style.gap = "10px";

    const intro = document.createElement("div");
    intro.className = "participant-list";
    intro.innerHTML = "Editing availability for <b>" + WF.escapeHtml(currentName) + "</b>";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "back-link";
    delBtn.style.color = "var(--danger)";
    delBtn.textContent = "Delete my entry";

    introRow.append(intro, delBtn);

    const gridWrap = document.createElement("div");
    gridWrap.className = "grid-wrap";

    const status = document.createElement("div");
    status.className = "hint";
    status.id = "save-status";

    ownPanelBody.append(introRow, gridWrap, status);

    delBtn.addEventListener("click", () => deleteMyEntry(delBtn, status));

    if (ownRubberBandController) ownRubberBandController.abort();
    ownRubberBandController = new AbortController();

    WF.renderHeatmap(gridWrap, {
      meeting,
      heat: false,
      selection: selectedCells,
      editable: true,
      signal: ownRubberBandController.signal,
      onCommit: saveAvailability,
      scrollLeft: prevScroll,
    });
  }

  function renderGroupPanel() {
    const prevScroll = groupPanelBody.querySelector(".tf-blocks")?.scrollLeft || 0;
    groupPanelBody.innerHTML = "";
    const gridWrap = document.createElement("div");
    gridWrap.className = "grid-wrap";
    groupPanelBody.appendChild(gridWrap);
    WF.renderHeatmap(gridWrap, {
      meeting,
      decision: new Set(meeting.decision_cells || []),
      tooltips: true,
      scrollLeft: prevScroll,
    });
    renderDecisionNotice();
  }

  function renderDecisionNotice() {
    const notice = document.getElementById("decision-notice");
    const set = new Set(meeting.decision_cells || []);
    if (!set.size) { notice.hidden = true; return; }
    notice.innerHTML = `<b>Meeting is set for</b> ${WF.escapeHtml(WF.formatDecision(meeting, set))}`;
    notice.hidden = false;
  }

  /* ---------- self-service deletion ---------- */
  // Removes the current participant's entry entirely (name + cells vanish
  // for everyone - that's the point of self-service deletion, not
  // anonymization). The password field from the identity step is reused.
  async function deleteMyEntry(btn, status) {
    if (!window.confirm("This removes your name and marks from the group. It cannot be undone.")) return;
    btn.disabled = true;
    if (status) { status.style.color = "var(--ink-faint)"; status.textContent = "Deleting…"; }
    try {
      meeting = await WF.api("/meetings/" + meetingId + "/availability", {
        method: "DELETE",
        body: JSON.stringify({ name: currentName, password: currentPassword }),
      });
      if (ownRubberBandController) ownRubberBandController.abort();
      currentName = "";
      currentPassword = "";
      selectedCells = new Set();
      renderParticipantList();
      renderGroupPanel();
      renderOwnPanelNameForm();
    } catch (e) {
      if (status) { status.style.color = "var(--danger)"; status.textContent = e.message || "Couldn't delete. Try again."; }
      btn.disabled = false;
    }
  }

  /* ---------- saving ---------- */
  async function saveAvailability() {
    const status = document.getElementById("save-status");
    if (status) { status.style.color = "var(--ink-faint)"; status.textContent = "Saving…"; }
    try {
      meeting = await WF.api("/meetings/" + meetingId + "/availability", {
        method: "POST",
        body: JSON.stringify({ name: currentName, password: currentPassword, cells: Array.from(selectedCells) }),
      });
      if (status) status.textContent = "Saved.";
      renderParticipantList();
      renderGroupPanel();
    } catch (e) {
      if (status) { status.style.color = "var(--danger)"; status.textContent = e.message || "Couldn't save. Try again."; }
    }
  }

  init();
})();
