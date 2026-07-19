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
    ownPanelBody.innerHTML = "";
    ownPanelBody.classList.remove("own-panel-body-login");

    const intro = document.createElement("div");
    intro.className = "participant-list";
    intro.innerHTML = "Editing availability for <b>" + WF.escapeHtml(currentName);

    const gridWrap = document.createElement("div");
    gridWrap.className = "grid-wrap";

    const status = document.createElement("div");
    status.className = "hint";
    status.id = "save-status";

    ownPanelBody.append(intro, gridWrap, status);

    if (ownRubberBandController) ownRubberBandController.abort();
    ownRubberBandController = new AbortController();

    buildGrid(gridWrap, {
      editable: true,
      rubberBandSignal: ownRubberBandController.signal,
      onCommit: saveAvailability,
    });
  }

  function renderGroupPanel() {
    groupPanelBody.innerHTML = "";
    const gridWrap = document.createElement("div");
    gridWrap.className = "grid-wrap";
    groupPanelBody.appendChild(gridWrap);
    buildGrid(gridWrap, { editable: false });
  }

  /* ---------- shared grid builder ---------- */
  // Renders the when2meet-style grid: 15-minute rows grouped visually into
  // hour boxes (solid border at :00/top-of-next-hour, dotted at :30, no
  // border at :15/:45), date columns grouped into blocks with a gap between
  // non-consecutive date ranges, and hour labels centered on the solid
  // hour-boundary lines (including one extra label for the closing edge).
  function buildGrid(container, opts) {
    const { GRID } = WF;
    const slots = [];
    for (let m = meeting.start_min; m < meeting.end_min; m += GRID.SLOT_MIN) slots.push(m);
    const nSlots = slots.length;
    const nHours = (meeting.end_min - meeting.start_min) / 60;

    let counts = {}, participantCount = meeting.participants.length;
    if (!opts.editable) {
      meeting.participants.forEach((n) => {
        (meeting.availability[n] || []).forEach((key) => {
          counts[key] = (counts[key] || 0) + 1;
        });
      });
    }
    const highestCount = Math.max(0, ...Object.values(counts));

    const outer = document.createElement("div");
    outer.className = "tf-grid-outer" + (opts.editable ? "" : " heatmode");

    // time label column
    const labelsCol = document.createElement("div");
    labelsCol.className = "tf-time-labels";
    const spacer = document.createElement("div");
    spacer.className = "tf-time-labels-spacer";
    const labelsBody = document.createElement("div");
    labelsBody.className = "tf-time-labels-body";
    labelsBody.style.height = (nSlots * GRID.CELL_H) + "px";
    for (let h = 0; h <= nHours; h++) {
      const lbl = document.createElement("div");
      lbl.className = "tf-hour-label";
      lbl.style.top = (h * 4 * GRID.CELL_H) + "px";
      lbl.textContent = WF.fmtHourLabel(meeting.start_min + h * 60);
      labelsBody.appendChild(lbl);
    }
    labelsCol.append(spacer, labelsBody);

    // date blocks, grouped so discontinuous ranges get a visual gap
    const blocksWrap = document.createElement("div");
    blocksWrap.className = "tf-blocks";
    const groups = WF.groupConsecutiveDates(meeting.dates);

    groups.forEach((group) => {
      const block = document.createElement("div");
      block.className = "tf-block";

      const headerRow = document.createElement("div");
      headerRow.className = "tf-block-header";
      group.forEach(({ iso }) => {
        const f = WF.fmtDateLabel(iso);
        const h = document.createElement("div");
        h.className = "tf-date-header";
        h.innerHTML = `<span class="dow">${f.label}</span>${f.dow}`;
        headerRow.appendChild(h);
      });

      const gridEl = document.createElement("div");
      gridEl.className = "tf-block-grid";
      gridEl.style.gridTemplateColumns = `repeat(${group.length}, ${GRID.CELL_W}px)`;
      gridEl.style.gridTemplateRows = `repeat(${nSlots}, ${GRID.CELL_H}px)`;

      slots.forEach((m, row) => {
        const minuteInHour = m % 60;
        const borderClass = minuteInHour === 0 ? "b-hour" : minuteInHour === 30 ? "b-half" : "b-quarter";
        const isLastRow = row === nSlots - 1;
        group.forEach(({ iso, idx }, col) => {
          const key = iso + "_" + m;
          const isLastCol = col === group.length - 1;
          const cell = document.createElement("div");
          cell.className = "tf-cell " + borderClass + (isLastRow ? " b-last-row" : "") + (isLastCol ? " b-last-col" : "");
          cell.dataset.row = row;
          cell.dataset.col = idx;
          cell.dataset.key = key;
          if (opts.editable) {
            if (selectedCells.has(key)) cell.classList.add("on");
          } else {
            const c = counts[key] || 0;
            if (c > 0) {
              let intensity = highestCount ? Math.pow(c / highestCount, 1.5) : 0;
              cell.style.background = `color-mix(in srgb, var(--hot) ${intensity * 100}%, transparent)`;
            }
          }
          gridEl.appendChild(cell);
        });
      });

      block.append(headerRow, gridEl);
      blocksWrap.appendChild(block);
    });

    outer.append(labelsCol, blocksWrap);
    container.appendChild(outer);

    if (opts.editable) {
      WF.enableRubberBand(blocksWrap, ".tf-cell", {
        signal: opts.rubberBandSignal,
        getKey: (cell) => cell.dataset.key,
        isSelected: (key) => selectedCells.has(key),
        snapshot: () => new Set(selectedCells),
        onChange: (key, sel, cell, preview, edges, displaySel) => {
          if (sel) selectedCells.add(key); else selectedCells.delete(key);
          cell.classList.toggle("on", displaySel);
          cell.classList.toggle("pv-top", preview && edges.top);
          cell.classList.toggle("pv-right", preview && edges.right);
          cell.classList.toggle("pv-bottom", preview && edges.bottom);
          cell.classList.toggle("pv-left", preview && edges.left);
        },
        onCommit: opts.onCommit,
      });

      const legend = document.createElement("div");
      legend.className = "legend";
      legend.innerHTML = `<span class="swatch" style="background:var(--cold)"></span>free time to mark<span class="swatch" style="background:var(--amber);margin-left:12px;"></span>you're marked free`;
      container.appendChild(legend);
    } else {
      attachHeatHandlers(blocksWrap, counts);

      const legendOpacities = Array.from(
        { length: highestCount + 1 },
        (_, i) => (highestCount ? i / highestCount : 0)
      );
      const legend = document.createElement("div");
      legend.className = "legend"; legend.innerHTML = `0/${participantCount} free<span class="legend-scale" style="width:${legendOpacities.length * 25 + "px"};">${legendOpacities.map(t => `<div style="background:var(--hot);opacity:${Math.pow(t, 1.5)}"></div>`).join("")}</span>${highestCount}/${participantCount} free`;
      container.appendChild(legend);
    }
  }

  function attachHeatHandlers(container, counts) {
    function show(cell, x, y) {
      const key = cell.dataset.key;
      const c = counts[key] || 0;
      if (c === 0) { tipEl.style.display = "none"; return; }
      const names = meeting.participants.filter((n) => (meeting.availability[n] || []).includes(key));
      tipEl.innerHTML = `<b>${c} ${c === 1 ? "person" : "people"}</b><br>${meeting.participants
        .map(name => `<div class="${names.includes(name) ? "" : "unavailable"}">${WF.escapeHtml(name)}</div>`)
        .join("")}`;
      tipEl.style.left = Math.min(x + 12, window.innerWidth - 240) + "px";
      tipEl.style.top = (y + 14) + "px";
      tipEl.style.display = "block";
    }
    function hide() { tipEl.style.display = "none"; }
    container.querySelectorAll(".tf-cell").forEach((cell) => {
      cell.addEventListener("mousemove", (e) => show(cell, e.clientX, e.clientY));
      cell.addEventListener("mouseleave", hide);
      cell.addEventListener("click", (e) => show(cell, e.clientX, e.clientY));
    });
    container.addEventListener("mouseleave", hide);
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
