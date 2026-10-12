(function () {
  "use strict";
  const WF = window.WF;
  const I18N = window.WF_I18N;
  const WEEK_COUNT = 6;

  // Start of the week containing d, where the week begins on startDow
  // (0 = Sunday, 1 = Monday; Date.getDay() convention).
  function startOfWeek(d, startDow) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = (copy.getDay() - startDow + 7) % 7;
    copy.setDate(copy.getDate() - diff);
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
  // "Jul 15 – Aug 4, 2026" / "15. Jul – 4. Aug 2026" - day/month order
  // differs per locale, so each side is formatted with Intl and composed.
  function fmtRangeLabel(first, last) {
    const loc = I18N.locale;
    // German month abbreviations carry a trailing dot ("Jul."); drop it.
    const m1 = new Intl.DateTimeFormat(loc, { month: "short" }).format(first).replace(/\.$/, "");
    const m2 = new Intl.DateTimeFormat(loc, { month: "short" }).format(last).replace(/\.$/, "");
    const y1 = first.getFullYear(), y2 = last.getFullYear();
    if (loc === "de") {
      if (y1 !== y2) return `${first.getDate()}. ${m1} ${y1} – ${last.getDate()}. ${m2} ${y2}`;
      if (first.getMonth() !== last.getMonth()) return `${first.getDate()}. ${m1} – ${last.getDate()}. ${m2} ${y1}`;
      return `${first.getDate()}.–${last.getDate()}. ${m1} ${y1}`;
    }
    if (y1 !== y2) return `${m1} ${first.getDate()}, ${y1} – ${m2} ${last.getDate()}, ${y2}`;
    if (first.getMonth() !== last.getMonth()) return `${m1} ${first.getDate()} – ${m2} ${last.getDate()}, ${y1}`;
    return `${m1} ${first.getDate()}–${last.getDate()}, ${y1}`;
  }

  const state = {
    createDates: new Set(),
    weekStart: startOfWeek(new Date(), WF.weekStartDow()), // start of the first visible week
    weekOffset: 0, // weeks navigated away from the current week (locale-independent)
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
    state.weekOffset += delta;
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
    const startDow = WF.weekStartDow();
    for (let i = 0; i < 7; i++) {
      const th = document.createElement("th");
      th.textContent = WF.dowShort((startDow + i) % 7);
      headRow.appendChild(th);
    }
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
        cell.classList.toggle("pv-top", preview && edges.top);
        cell.classList.toggle("pv-right", preview && edges.right);
        cell.classList.toggle("pv-bottom", preview && edges.bottom);
        cell.classList.toggle("pv-left", preview && edges.left);
      },
    });
  }

  renderCalendar();

  document.getElementById("c-title").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  document.getElementById("c-submit").addEventListener("click", submit);

  async function submit() {
    const title = titleInput.value.trim();
    if (!title) { errEl.textContent = I18N.t("err_title_required"); titleInput.focus(); return; }
    if (state.createDates.size === 0) { errEl.textContent = I18N.t("err_no_dates"); return; }

    const startMin = timeToMin(startInput.value);
    const endMin = timeToMin(endInput.value);
    if (startMin == null || endMin == null) { errEl.textContent = I18N.t("err_both_times"); return; }
    if (endMin <= startMin) { errEl.textContent = I18N.t("err_end_after"); return; }
    // Client-side mirror of the server rule (main.py create_meeting); the
    // server check stays as the source of truth.
    if (startMin % 15 !== 0 || endMin % 15 !== 0) { errEl.textContent = I18N.t("err_quarter_hour"); return; }

    errEl.textContent = I18N.t("creating");
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
      errEl.textContent = e.message || I18N.t("err_save");
    }
  }

  // Locale switch: re-derive the week anchor (Sunday vs Monday start) from a
  // fixed reference (today) plus the user's week offset, then re-render so
  // header order and month label follow the new locale. Re-anchoring from the
  // previous weekStart instead drifts: "the week containing X" is not
  // invertible across week-start days, so the grid slipped back a week on
  // every EN<->DE round trip.
  document.addEventListener("wf:locale", () => {
    state.weekStart = addDays(startOfWeek(new Date(), WF.weekStartDow()), state.weekOffset * 7);
    renderCalendar();
  });
})();
