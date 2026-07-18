window.WF = (function () {
  "use strict";

  const API_BASE = "/api";
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // Grid geometry - keep these numbers in sync with the CSS custom
  // properties (--cell-h, --cell-w, --header-h, --group-gap) in styles.css.
  const GRID = { CELL_H: 10, CELL_W: 50, HEADER_H: 34, GROUP_GAP: 14, SLOT_MIN: 15 };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function isoDate(y, m, d) {
    return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function fmtDateLabel(iso) {
    const d = new Date(iso + "T00:00:00");
    return { dow: DOW[d.getDay()], label: MONTH[d.getMonth()].slice(0, 3) + " " + d.getDate() };
  }
  // Whole-hour label, e.g. 540 -> "9 AM", 0/1440 -> "12 AM".
  function fmtHourLabel(mins) {
    let h = Math.round(mins / 60) % 24;
    const ap = h >= 12 && h !== 24 ? "PM" : "AM";
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + " " + ap;
  }
  function todayISO() {
    const d = new Date();
    return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function meetingUrl(id) {
    return window.location.origin + "/meeting/" + id;
  }

  async function api(path, opts) {
    const res = await fetch(API_BASE + path, Object.assign(
      { headers: { "Content-Type": "application/json" } }, opts
    ));
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (body && body.detail) || ("Request failed (" + res.status + ")");
      throw new Error(msg);
    }
    return body;
  }

  // Splits a sorted array of ISO dates into runs of calendar-consecutive
  // days, e.g. [Jul15..Jul20, Jul22..Jul27] -> two groups. Each date keeps
  // its original (global) index into the full array, since that index is
  // what the availability grid uses as a stable column number.
  function groupConsecutiveDates(sortedDates) {
    const groups = [];
    let current = [];
    let prevTime = null;
    sortedDates.forEach((iso, idx) => {
      const t = new Date(iso + "T00:00:00").getTime();
      if (prevTime !== null && t - prevTime === 86400000) {
        current.push({ iso, idx });
      } else {
        if (current.length) groups.push(current);
        current = [{ iso, idx }];
      }
      prevTime = t;
    });
    if (current.length) groups.push(current);
    return groups;
  }

  // Generic rubber-band box selection over a grid of cells laid out with
  // data-row/data-col attributes. Dragging from a cell toggles it to the
  // opposite of its start state, and that state is applied to every cell
  // inside the drag rectangle; cells that leave the rectangle mid-drag
  // revert to what they were before the drag started.
  //
  // Pass a fresh AbortController's `signal` each time you rebind this to a
  // rebuilt grid, so previous listeners are cleaned up instead of stacking
  // (stacked listeners cause N-fold toggling and silently-broken selection).
  //
  // opts.onCommit(), if given, fires once when a drag/click interaction ends
  // (not on every intermediate cell during the drag) - the place to persist
  // the selection.
  function enableRubberBand(container, selector, opts) {
    let dragging = false, startRow = 0, startCol = 0, target = false, original = new Set();
    const signal = opts.signal;

    function cellsIn() { return container.querySelectorAll(selector); }

    function applyRect(curRow, curCol) {
      const r0 = Math.min(startRow, curRow), r1 = Math.max(startRow, curRow);
      const c0 = Math.min(startCol, curCol), c1 = Math.max(startCol, curCol);
      cellsIn().forEach((cell) => {
        if (opts.isDisabled && opts.isDisabled(cell)) return;
        const row = +cell.dataset.row, col = +cell.dataset.col;
        const key = opts.getKey(cell);
        const inside = row >= r0 && row <= r1 && col >= c0 && col <= c1;
        const newSel = inside ? target : original.has(key);
        opts.onChange(key, newSel, cell);
      });
    }

    function start(cell) {
      if (!cell || (opts.isDisabled && opts.isDisabled(cell))) return;
      dragging = true;
      startRow = +cell.dataset.row;
      startCol = +cell.dataset.col;
      target = !opts.isSelected(opts.getKey(cell));
      original = opts.snapshot();
      applyRect(startRow, startCol);
    }
    function move(cell) {
      if (!dragging || !cell) return;
      applyRect(+cell.dataset.row, +cell.dataset.col);
    }
    function end() {
      if (dragging) {
        dragging = false;
        if (opts.onCommit) opts.onCommit();
      }
    }

    container.addEventListener("mousedown", (e) => {
      const cell = e.target.closest(selector);
      if (!cell) return;
      e.preventDefault();
      start(cell);
    }, { signal });
    container.addEventListener("mouseover", (e) => {
      if (!dragging) return;
      const cell = e.target.closest(selector);
      if (cell) move(cell);
    }, { signal });
    window.addEventListener("mouseup", end, { signal });

    container.addEventListener("touchstart", (e) => {
      const cell = e.target.closest(selector);
      if (!cell) return;
      e.preventDefault();
      start(cell);
    }, { signal, passive: false });
    container.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const t = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const cell = el ? el.closest(selector) : null;
      if (cell) move(cell);
    }, { signal, passive: false });
    window.addEventListener("touchend", end, { signal });
  }

  return {
    DOW, MONTH, GRID,
    escapeHtml, isoDate, fmtDateLabel, fmtHourLabel, todayISO, meetingUrl,
    api, groupConsecutiveDates, enableRubberBand,
  };
})();
