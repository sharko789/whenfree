(function () {
  "use strict";
  const WF = window.WF;
  const WEEK_COUNT = 6;

  function startOfWeek(d) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() - copy.getDay());
    return copy;
  }
  // Calendar-day step: fixed 24h ms math drifts across DST transition days
  // (a 25h fall-back day pushes every later cell back by an hour, onto the
  // previous day at 23:00). The Date constructor normalizes day overflow in
  // local calendar days; local midnight always exists.
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function isoOf(d) {
    return WF.isoDate(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function timeToMin(v) {
    if (!v) return null;
    const [h, m] = v.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }
  function fmtRangeLabel(first, last) {
    const m1 = WF.MONTH[first.getMonth()].slice(0, 3), m2 = WF.MONTH[last.getMonth()].slice(0, 3);
    const y1 = first.getFullYear(), y2 = last.getFullYear();
    if (y1 !== y2) return `${m1} ${first.getDate()}, ${y1} – ${m2} ${last.getDate()}, ${y2}`;
    if (m1 !== m2) return `${m1} ${first.getDate()} – ${m2} ${last.getDate()}, ${y1}`;
    return `${m1} ${first.getDate()}–${last.getDate()}, ${y1}`;
  }

  const state = {
    createDates: new Set(),
    weekStart: startOfWeek(new Date()), // Sunday of the first visible week
  };
  let calRubberBandController = null;

  const titleInput = document.getElementById("c-title");
  const startInput = document.getElementById("c-start");
  const endInput = document.getElementById("c-end");
  const errEl = document.getElementById("c-err");
  const calSlot = document.getElementById("cal-slot");
  const monthLabel = document.getElementById("cal-month-label");

  document.getElementById("cal-prev").addEventListener("click", () => shiftWeek(-1));
  document.getElementById("cal-next").addEventListener("click", () => shiftWeek(1));

  function shiftWeek(delta) {
    state.weekStart = addDays(state.weekStart, delta * 7);
    renderCalendar();
  }

  function renderCalendar() {
    const days = [];
    for (let i = 0; i < WEEK_COUNT * 7; i++) days.push(addDays(state.weekStart, i));
    monthLabel.textContent = fmtRangeLabel(days[0], days[days.length - 1]);

    const today = WF.todayISO();

    const table = document.createElement("table");
    table.className = "cal";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    WF.DOW.forEach((d) => {
      const th = document.createElement("th");
      th.textContent = d;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let row = 0; row < WEEK_COUNT; row++) {
      const tr = document.createElement("tr");
      for (let col = 0; col < 7; col++) {
        const d = days[row * 7 + col];
        const iso = isoOf(d);
        const td = document.createElement("td");
        td.dataset.row = row;
        td.dataset.col = col;
        td.dataset.date = iso;
        td.className = "cal-day" + (iso === today ? " today" : "") + (state.createDates.has(iso) ? " selected" : "");
        td.textContent = String(d.getDate());
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    calSlot.innerHTML = "";
    calSlot.appendChild(table);

    // Rebuilding the table each render means old cell listeners go away for
    // free, but the container/window listeners from enableRubberBand would
    // otherwise stack up across renders (each stacked set re-toggles cells,
    // silently breaking selection after a couple of navigations). Abort the
    // previous binding before creating a fresh one.
    if (calRubberBandController) calRubberBandController.abort();
    calRubberBandController = new AbortController();

    WF.enableRubberBand(calSlot, "td.cal-day", {
      signal: calRubberBandController.signal,
      getKey: (cell) => cell.dataset.date,
      isSelected: (key) => state.createDates.has(key),
      snapshot: () => new Set(state.createDates),
      onChange: (key, sel, cell, preview, edges, displaySel) => {
        if (sel) state.createDates.add(key); else state.createDates.delete(key);
        cell.classList.toggle("selected", displaySel);
        cell.classList.toggle("selected-preview", preview);
      },
    });
  }

  renderCalendar();

  document.getElementById("c-title").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  document.getElementById("c-submit").addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) { errEl.textContent = "Give the meeting a name."; titleInput.focus(); return; }
    if (state.createDates.size === 0) { errEl.textContent = "Add at least one date."; return; }

    const startMin = timeToMin(startInput.value);
    const endMin = timeToMin(endInput.value);
    if (startMin == null || endMin == null) { errEl.textContent = "Set both times."; return; }
    if (endMin <= startMin) { errEl.textContent = "Latest time has to be after earliest time."; return; }

    errEl.textContent = "Creating…";
    try {
      const res = await WF.api("/meetings", {
        method: "POST",
        body: JSON.stringify({
          title, start_min: startMin, end_min: endMin,
          dates: [...state.createDates],
        }),
      });
      window.location.href = "/organize/" + res.organize_token;
    } catch (e) {
      errEl.textContent = e.message || "Something went wrong saving the meeting. Try again.";
    }
  });
})();
