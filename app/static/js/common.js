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
  function fmtTimeLabel(mins) {
    const h24 = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const ap = h24 >= 12 ? "PM" : "AM";
    let h12 = h24 % 12; if (h12 === 0) h12 = 12;
    return h12 + (m ? ":" + String(m).padStart(2, "0") : "") + " " + ap;
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
    // Compare calendar days in UTC: a local-timezone diff of exactly 24h
    // fails on DST transition days (25h/23h days) and would split a
    // continuous date range. In UTC consecutive days are always 86400000ms
    // apart.
    const groups = [];
    let current = [];
    let prevTime = null;
    sortedDates.forEach((iso, idx) => {
      const t = new Date(iso + "T00:00:00Z").getTime();
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
    let lastRow = 0, lastCol = 0;
    const signal = opts.signal;

    function cellsIn() { return container.querySelectorAll(selector); }

    // `finalize` is true only on the very last pass (mouseup/touchend): at
    // that point the rectangle's cells should commit to their real (non-
    // preview) styling. During the drag itself, only cells *inside* the
    // current rectangle are "preview" - cells outside it are just reverting
    // to whatever they already were, and shouldn't flicker translucent.
    function applyRect(curRow, curCol, finalize) {
      const r0 = Math.min(startRow, curRow), r1 = Math.max(startRow, curRow);
      const c0 = Math.min(startCol, curCol), c1 = Math.max(startCol, curCol);

      const cells = Array.from(cellsIn()).filter(
        (cell) => !(opts.isDisabled && opts.isDisabled(cell))
      );

      const previewKeys = new Set();
      cells.forEach((cell) => {
        const row = +cell.dataset.row, col = +cell.dataset.col;
        const inside = row >= r0 && row <= r1 && col >= c0 && col <= c1;
        if (inside && !finalize) previewKeys.add(row + "," + col);
      });

      cells.forEach((cell) => {
        const row = +cell.dataset.row, col = +cell.dataset.col;
        const key = opts.getKey(cell);
        const inside = row >= r0 && row <= r1 && col >= c0 && col <= c1;
        const newSel = inside ? target : original.has(key);
        const preview = inside && !finalize;
        // While dragging, the *fill* stays whatever it already was - only the
        // border communicates "this cell is inside the pending rectangle".
        // On finalize, the fill catches up to the real new value.
        const displaySel = preview ? original.has(key) : newSel;
        let edges;
        if (preview) {
          edges = {
            top: !previewKeys.has((row - 1) + "," + col),
            bottom: !previewKeys.has((row + 1) + "," + col),
            left: !previewKeys.has(row + "," + (col - 1)),
            right: !previewKeys.has(row + "," + (col + 1)),
          };
        }
        opts.onChange(key, newSel, cell, preview, edges, displaySel);
      });
    }

    function start(cell) {
      if (!cell || (opts.isDisabled && opts.isDisabled(cell))) return;
      dragging = true;
      if (opts.onDragChange) opts.onDragChange(true);
      startRow = +cell.dataset.row;
      startCol = +cell.dataset.col;
      lastRow = startRow;
      lastCol = startCol;
      target = !opts.isSelected(opts.getKey(cell));
      original = opts.snapshot();
      applyRect(startRow, startCol, false);
    }
    function move(cell) {
      if (!dragging || !cell) return;
      lastRow = +cell.dataset.row;
      lastCol = +cell.dataset.col;
      applyRect(lastRow, lastCol, false);
    }
    function end() {
      if (dragging) {
        dragging = false;
        if (opts.onDragChange) opts.onDragChange(false);
        applyRect(lastRow, lastCol, true); // finalize: lock in the rectangle's cells, drop preview styling
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

  // ---------- decision outline ----------
  // Boundary edges for a set of decided cells: for each decided cell, each of
  // its 4 grid neighbors (within the same date block) that is NOT decided or
  // doesn't exist contributes an edge on that side, so adjacent decided cells
  // share one continuous line instead of per-cell borders. Returns
  // { key: [sides] } with sides ⊆ ["top","bottom","left","right"].
  function decisionEdges(decisionSet, meeting) {
    const dates = new Set(meeting.dates);
    const edges = {};
    const decided = (iso, mins) =>
      dates.has(iso) &&
      mins >= meeting.start_min && mins < meeting.end_min &&
      decisionSet.has(iso + "_" + mins);
    decisionSet.forEach((key) => {
      const uscore = key.lastIndexOf("_");
      const iso = key.slice(0, uscore);
      const mins = parseInt(key.slice(uscore + 1), 10);
      const sides = [];
      if (!decided(iso, mins - GRID.SLOT_MIN)) sides.push("top");
      if (!decided(iso, mins + GRID.SLOT_MIN)) sides.push("bottom");
      if (!decided(shiftDay(iso, -1), mins)) sides.push("left");
      if (!decided(shiftDay(iso, 1), mins)) sides.push("right");
      if (sides.length) edges[key] = sides;
    });
    return edges;
  }
  function shiftDay(iso, delta) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + delta);
    return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // "Jul 15, 10 AM – 11 AM and Jul 16, 2 PM – 2:15 PM" - contiguous decided
  // slots merge into one range per date.
  function formatDecision(meeting, decisionSet) {
    const parts = [];
    meeting.dates.forEach((iso) => {
      const mins = [];
      decisionSet.forEach((key) => {
        const uscore = key.lastIndexOf("_");
        if (key.slice(0, uscore) === iso) mins.push(parseInt(key.slice(uscore + 1), 10));
      });
      mins.sort((a, b) => a - b);
      const ranges = [];
      for (let i = 0; i < mins.length; i++) {
        const first = mins[i];
        let last = first;
        while (i + 1 < mins.length && mins[i + 1] === last + GRID.SLOT_MIN) last = mins[++i];
        ranges.push(fmtTimeLabel(first) + " – " + fmtTimeLabel(last + GRID.SLOT_MIN));
      }
      if (ranges.length) parts.push(fmtDateLabel(iso).label + ", " + ranges.join(", "));
    });
    return parts.join(" and ");
  }

  // ---------- shared heatmap grid ----------
  // Renders the when2meet-style grid: 15-minute rows grouped visually into
  // hour boxes (solid border at :00/top-of-next-hour, dotted at :30, no
  // border at :15/:45), date columns grouped into blocks with a gap between
  // non-consecutive date ranges, and hour labels centered on the solid
  // hour-boundary lines (including one extra label for the closing edge).
  // Shared by the meeting page (own editable grid + group heatmap) and the
  // organizer panel (decision grid) so both render identical grids.
  //
  // opts:
  //   meeting      - meeting payload (start_min, end_min, dates, participants, availability)
  //   heat         - default true; color cells by how many people are free
  //   hiddenNames  - names excluded from the heat counts (organizer panel only)
  //   decision     - Set of cell keys to draw the saved decision outline on
  //   selection    - Set of initially-selected keys (draws .on); required when editable
  //   outlineSelection - when true, selected cells render as the decision
  //                      outline (d-*) instead of the amber .on fill (organizer)
  //   editable     - enable rubber-band drag-select over the selection
  //   signal       - AbortSignal for the rubber-band binding
  //   onCommit     - fires once when a drag/click interaction ends
  //   tooltips     - attach the per-cell "who's free" hover handlers
  function renderHeatmap(container, opts) {
    const meeting = opts.meeting;
    const useHeat = opts.heat !== false;

    const slots = [];
    for (let m = meeting.start_min; m < meeting.end_min; m += GRID.SLOT_MIN) slots.push(m);
    const nSlots = slots.length;
    const nHours = (meeting.end_min - meeting.start_min) / 60;

    const hiddenNames = new Set(opts.hiddenNames || []);
    const counts = {};
    let participantCount = 0;
    if (useHeat) {
      meeting.participants.forEach((n) => {
        if (hiddenNames.has(n)) return;
        participantCount += 1;
        (meeting.availability[n] || []).forEach((key) => {
          counts[key] = (counts[key] || 0) + 1;
        });
      });
    }
    const highestCount = Math.max(0, ...Object.values(counts));

    // Inline style so it composes with per-cell CSS; selected cells clear it
    // so the .on fill (CSS) wins instead of the inline heat background.
    function heatBg(key) {
      if (!useHeat) return "";
      const c = counts[key] || 0;
      if (!c) return "";
      const intensity = highestCount ? Math.pow(c / highestCount, 1.5) : 0;
      return `color-mix(in srgb, var(--hot) ${intensity * 100}%, transparent)`;
    }

    const decision = opts.decision;
    const decisionEdgesMap = decision && decision.size ? decisionEdges(decision, meeting) : null;
    const selection = opts.selection;

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
      lbl.textContent = fmtHourLabel(meeting.start_min + h * 60);
      labelsBody.appendChild(lbl);
    }
    labelsCol.append(spacer, labelsBody);

    // date blocks, grouped so discontinuous ranges get a visual gap
    const blocksWrap = document.createElement("div");
    blocksWrap.className = "tf-blocks";
    const groups = groupConsecutiveDates(meeting.dates);

    groups.forEach((group) => {
      const block = document.createElement("div");
      block.className = "tf-block";

      const headerRow = document.createElement("div");
      headerRow.className = "tf-block-header";
      group.forEach(({ iso }) => {
        const f = fmtDateLabel(iso);
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
          const isOn = !!(selection && selection.has(key));
          const fill = isOn && !opts.outlineSelection;
          cell.style.background = fill ? "" : heatBg(key);
          if (fill) cell.classList.add("on");
          if (decisionEdgesMap && decisionEdgesMap[key]) {
            decisionEdgesMap[key].forEach((side) => cell.classList.add("d-" + side));
          }
          gridEl.appendChild(cell);
        });
      });

      block.append(headerRow, gridEl);
      blocksWrap.appendChild(block);
    });

    outer.append(labelsCol, blocksWrap);
    // no-fade suppresses the shadow opacity transition for the first paint
    // so a data re-render doesn't replay the fade-in.
    outer.classList.add("no-fade");
    container.appendChild(outer);
    // Re-renders rebuild the scroller from scratch; restore the caller's
    // horizontal position before the shadow classes are computed.
    blocksWrap.scrollLeft = opts.scrollLeft || 0;

    // Edge shadows hint at off-screen dates while the block row overflows.
    // The classes go on the non-scrolling wrapper (outer), since an absolute
    // child of the scroller would scroll along with the content. The
    // ResizeObserver needs no explicit disconnect: it only observes the
    // (soon-detached) scroll container, so the whole listener graph is
    // garbage-collected when the grid is re-rendered.
    function updateScrollShadows() {
      outer.classList.toggle("can-scroll-left", blocksWrap.scrollLeft > 1);
      outer.classList.toggle(
        "can-scroll-right",
        blocksWrap.scrollLeft + blocksWrap.clientWidth < blocksWrap.scrollWidth - 1
      );
    }
    blocksWrap.addEventListener("scroll", updateScrollShadows, { passive: true });
    new ResizeObserver(updateScrollShadows).observe(blocksWrap);
    updateScrollShadows();
    // Commit the initial shadow state with transitions off, then re-enable
    // them for scroll/resize changes.
    void outer.offsetWidth;
    outer.classList.remove("no-fade");

    // A grid can be both editable (decision drag-select) and show the
    // per-cell "who's free" hover tip; the tip is suppressed while a drag is
    // active so it doesn't chase the cursor under the rubber band.
    const dragState = { active: false };
    let hideTip = () => {};
    if (opts.editable) {
      enableRubberBand(blocksWrap, ".tf-cell", {
        signal: opts.signal,
        getKey: (cell) => cell.dataset.key,
        isSelected: (key) => selection.has(key),
        snapshot: () => new Set(selection),
        onChange: (key, sel, cell, preview, edges, displaySel) => {
          if (sel) selection.add(key); else selection.delete(key);
          const fill = !opts.outlineSelection && displaySel;
          cell.classList.toggle("on", fill);
          cell.style.background = fill ? "" : heatBg(key);
          cell.classList.toggle("pv-top", preview && edges.top);
          cell.classList.toggle("pv-right", preview && edges.right);
          cell.classList.toggle("pv-bottom", preview && edges.bottom);
          cell.classList.toggle("pv-left", preview && edges.left);
        },
        onCommit: opts.onCommit,
        onDragChange: (active) => { dragState.active = active; if (active) hideTip(); },
      });
    }
    if (opts.tooltips) {
      hideTip = attachHeatHandlers(blocksWrap, counts, meeting, hiddenNames, () => dragState.active).hide;
    }

    const legend = document.createElement("div");
    legend.className = "legend";
    if (useHeat) {
      const legendOpacities = Array.from(
        { length: highestCount + 1 },
        (_, i) => (highestCount ? i / highestCount : 0)
      );
      legend.innerHTML =
        `0/${participantCount} free` +
        `<span class="legend-scale" style="width:${legendOpacities.length * 25 + "px"};">${legendOpacities.map(t => `<div style="background:var(--hot);opacity:${Math.pow(t, 1.5)}"></div>`).join("")}</span>` +
        `${highestCount}/${participantCount} free`;
      if (decision && decision.size) {
        legend.innerHTML += `<span class="swatch swatch-decided" style="margin-left:12px;"></span>decided`;
      }
    } else {
      legend.innerHTML = `<span class="swatch" style="background:var(--cold)"></span>occupied<span class="swatch" style="background:var(--amber);margin-left:12px;"></span>free`;
    }
    container.appendChild(legend);

    return { counts, participantCount, highestCount, blocksWrap };
  }

  function attachHeatHandlers(container, counts, meeting, hiddenNames, isDragging) {
    isDragging = isDragging || (() => false);
    const tipEl = document.getElementById("tip");
    function show(cell, x, y) {
      if (isDragging()) { hide(); return; }
      const key = cell.dataset.key;
      const c = counts[key] || 0;
      if (c === 0) { tipEl.style.display = "none"; return; }
      const visibleNames = meeting.participants.filter((n) => !hiddenNames.has(n));
      const names = visibleNames.filter((n) => (meeting.availability[n] || []).includes(key));
      tipEl.innerHTML = `<b>${c} ${c === 1 ? "person" : "people"}</b><br>${visibleNames
        .map((name) => `<div class="${names.includes(name) ? "" : "unavailable"}">${escapeHtml(name)}</div>`)
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
    return { hide };
  }

  return {
    DOW, MONTH, GRID,
    escapeHtml, isoDate, fmtDateLabel, fmtHourLabel, todayISO, meetingUrl,
    api, groupConsecutiveDates, enableRubberBand,
    decisionEdges, formatDecision, renderHeatmap,
  };
})();
