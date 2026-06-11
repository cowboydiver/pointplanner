/* PointPlanner — map rendering + interactions (vanilla JS) */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var PAD_X = 96, COL = 152, PAD_Y = 92, ROW = 94;
  var VW = 1592, VH = 760, VX = 0, VY = 0;
  var cornerRadius = 18;

  // ---- state ----
  var stationById = {};
  var lineById = {};
  var prereqs = {};       // to -> [from...]
  var dependents = {};    // from -> [to...]
  var selectedId = null;      // station open in detail panel
  var highlightLine = null;   // line id being highlighted
  var canvasEl = null;

  function rebuildIndexes() {
    stationById = {};
    window.STATIONS.forEach(function (s) { stationById[s.id] = s; });
    lineById = {};
    window.LINES.forEach(function (l) { lineById[l.id] = l; });
    prereqs = {}; dependents = {};
    window.EDGES.forEach(function (e) {
      (prereqs[e.to] = prereqs[e.to] || []).push(e.from);
      (dependents[e.from] = dependents[e.from] || []).push(e.to);
    });
  }
  rebuildIndexes();

  function computeBounds() {
    var maxCol = 0, maxRow = 0, hasRight = false, hasLeft = false;
    window.STATIONS.forEach(function (s) {
      maxCol = Math.max(maxCol, s.col); maxRow = Math.max(maxRow, s.row);
      if (s.lp === "right") hasRight = true;
      if (s.lp === "left") hasLeft = true;
    });
    var leftPad = hasLeft ? 80 : 0;
    var rightPad = hasRight ? 170 : 0;
    VX = -leftPad; VY = 0;
    VW = PAD_X * 2 + maxCol * COL + leftPad + rightPad;
    VH = PAD_Y * 2 + maxRow * ROW;
  }

  function px(col) { return PAD_X + col * COL; }
  function py(row) { return PAD_Y + row * ROW; }

  // ---- dependency logic ----
  // Recompute availability: any non-done task whose prereqs are all done and
  // is currently "locked" becomes "available". If a prereq is reopened,
  // downstream non-done tasks that lose readiness go back to "locked".
  function recompute() {
    window.STATIONS.forEach(function (s) {
      if (s.status === "done" || s.status === "active") return;
      var pr = prereqs[s.id] || [];
      var ready = pr.every(function (p) { return stationById[p].status === "done"; });
      s.status = ready ? "available" : "locked";
    });
  }

  // ---- routing (45° transit style) ----
  function routePoints(e) {
    var a = stationById[e.from], b = stationById[e.to];
    var x1 = px(a.col), y1 = py(a.row), x2 = px(b.col), y2 = py(b.row);
    var dx = x2 - x1, dy = y2 - y1;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 1 || ady < 1) return [[x1, y1], [x2, y2]]; // straight
    var sx = Math.sign(dx), sy = Math.sign(dy);
    var diag = Math.min(adx, ady);
    if (e.df) {
      // diagonal first, then straight along the longer axis
      var mx = x1 + sx * diag, my = y1 + sy * diag;
      return [[x1, y1], [mx, my], [x2, y2]];
    } else {
      // straight first along longer axis, then 45° diagonal into target
      if (adx >= ady) {
        var bx = x2 - sx * diag; // remaining horizontal before diagonal
        return [[x1, y1], [bx, y1], [x2, y2]];
      } else {
        var by = y2 - sy * diag;
        return [[x1, y1], [x1, by], [x2, y2]];
      }
    }
  }

  function pointsToPath(pts, radius) {
    if (pts.length < 3 || !radius) {
      return "M" + pts.map(function (p) { return p[0] + " " + p[1]; }).join(" L ");
    }
    // rounded corners between segments
    var d = "M " + pts[0][0] + " " + pts[0][1];
    for (var i = 1; i < pts.length - 1; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      var v1 = norm(p1, p0), v2 = norm(p1, p2);
      var len1 = dist(p0, p1), len2 = dist(p1, p2);
      var r = Math.min(radius, len1 / 2, len2 / 2);
      var aIn = [p1[0] + v1[0] * r, p1[1] + v1[1] * r];
      var aOut = [p1[0] + v2[0] * r, p1[1] + v2[1] * r];
      d += " L " + aIn[0] + " " + aIn[1];
      d += " Q " + p1[0] + " " + p1[1] + " " + aOut[0] + " " + aOut[1];
    }
    var last = pts[pts.length - 1];
    d += " L " + last[0] + " " + last[1];
    return d;
  }
  function norm(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
  function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

  // ---- build SVG ----
  var svg;
  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function buildMap() {
    svg = el("svg", { viewBox: VX + " " + VY + " " + VW + " " + VH, id: "map-svg" });
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    var gLines = el("g", { class: "g-lines" });
    var gStations = el("g", { class: "g-stations" });
    svg.appendChild(gLines);
    svg.appendChild(gStations);

    // edges
    window.EDGES.forEach(function (e) {
      var pts = routePoints(e);
      var color = lineById[e.line].color;
      var d = pointsToPath(pts, cornerRadius);
      // casing (subtle white halo for crossings)
      var casing = el("path", { d: d, class: "seg-casing", fill: "none" });
      casing.dataset.line = e.line; casing.dataset.to = e.to; casing.dataset.from = e.from;
      gLines.appendChild(casing);
      var seg = el("path", { d: d, class: "seg", fill: "none", stroke: color });
      seg.dataset.line = e.line; seg.dataset.to = e.to; seg.dataset.from = e.from;
      gLines.appendChild(seg);
    });

    // stations
    window.STATIONS.forEach(function (s) {
      var g = el("g", { class: "station", "data-id": s.id, tabindex: "0", role: "button" });
      g.setAttribute("transform", "translate(" + px(s.col) + "," + py(s.row) + ")");
      s.lines.forEach(function (l) { g.classList.add("on-" + l); });
      if (s.lines.length > 1) g.classList.add("interchange");
      g.appendChild(el("circle", { class: "hit", r: 26, cx: 0, cy: 0, fill: "transparent" }));
      g.appendChild(el("circle", { class: "halo", r: 16, cx: 0, cy: 0 }));
      g.appendChild(el("circle", { class: "marker", r: 11, cx: 0, cy: 0 }));
      var check = el("path", { class: "check", d: "M -4.2 0.4 L -1.2 3.4 L 4.6 -3.2" });
      g.appendChild(check);
      g.appendChild(el("circle", { class: "active-dot", r: 4.4, cx: 0, cy: 0 }));

      // label
      var lab = el("text", { class: "label" });
      placeLabel(lab, s);
      lab.textContent = s.name;
      g.appendChild(lab);

      g.addEventListener("click", function () { openDetail(s.id); });
      g.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openDetail(s.id); }
      });
      gStations.appendChild(g);
    });

    return svg;
  }

  function placeLabel(lab, s) {
    var off = 22;
    switch (s.lp) {
      case "top":    lab.setAttribute("x", 0); lab.setAttribute("y", -off); lab.setAttribute("text-anchor", "middle"); break;
      case "bottom": lab.setAttribute("x", 0); lab.setAttribute("y", off + 6); lab.setAttribute("text-anchor", "middle"); lab.setAttribute("dominant-baseline", "hanging"); break;
      case "left":   lab.setAttribute("x", -off); lab.setAttribute("y", 0); lab.setAttribute("text-anchor", "end"); lab.setAttribute("dominant-baseline", "middle"); break;
      default:       lab.setAttribute("x", off); lab.setAttribute("y", 0); lab.setAttribute("text-anchor", "start"); lab.setAttribute("dominant-baseline", "middle"); break;
    }
  }

  // ---- paint state onto the DOM ----
  function paint() {
    // station markers
    window.STATIONS.forEach(function (s) {
      var g = svg.querySelector('.station[data-id="' + s.id + '"]');
      if (!g) return;
      g.classList.remove("st-locked", "st-available", "st-active", "st-done");
      g.classList.add("st-" + s.status);
      var primaryColor = lineById[s.lines[0]].color;
      g.style.setProperty("--c", primaryColor);
      g.classList.toggle("selected", s.id === selectedId);
    });
    // segments: dim those leading into not-yet-reachable tasks
    svg.querySelectorAll(".seg, .seg-casing").forEach(function (p) {
      var to = stationById[p.dataset.to];
      var upcoming = (to.status === "locked");
      p.classList.toggle("upcoming", upcoming);
    });
    applyHighlight();
  }

  function applyHighlight() {
    svg.classList.toggle("has-highlight", !!highlightLine);
    if (!highlightLine) {
      svg.querySelectorAll(".dim").forEach(function (n) { n.classList.remove("dim"); });
      return;
    }
    svg.querySelectorAll(".seg, .seg-casing").forEach(function (p) {
      p.classList.toggle("dim", p.dataset.line !== highlightLine);
    });
    svg.querySelectorAll(".station").forEach(function (g) {
      g.classList.toggle("dim", !g.classList.contains("on-" + highlightLine));
    });
  }

  // ---- detail panel ----
  var panel, panelInner;
  function openDetail(id) {
    selectedId = id;
    var s = stationById[id];
    renderPanel(s);
    panel.classList.add("open");
    paint();
  }
  function closeDetail() {
    selectedId = null;
    panel.classList.remove("open");
    paint();
  }

  var STATUS_LABEL = { locked: "Locked", available: "Ready to start", active: "In progress", done: "Completed" };

  function renderPanel(s) {
    var color = lineById[s.lines[0]].color;
    var lineChips = s.lines.map(function (lid) {
      var l = lineById[lid];
      return '<span class="chip" style="--lc:' + l.color + '">' + l.name + '</span>';
    }).join("");
    var pr = (prereqs[s.id] || []).map(function (p) {
      var ps = stationById[p];
      return '<li class="pre st-' + ps.status + '" data-goto="' + p + '"><span class="pre-dot"></span>' +
             '<span class="pre-name">' + ps.name + '</span>' +
             '<span class="pre-state">' + STATUS_LABEL[ps.status] + '</span></li>';
    }).join("");
    var nexts = (dependents[s.id] || []).map(function (d) {
      var ds = stationById[d];
      return '<li class="pre st-' + ds.status + '" data-goto="' + d + '"><span class="pre-dot"></span>' +
             '<span class="pre-name">' + ds.name + '</span>' +
             '<span class="pre-state">' + STATUS_LABEL[ds.status] + '</span></li>';
    }).join("");
    var tags = (s.tags || []).map(function (t) { return '<span class="tag">' + t + '</span>'; }).join("");

    var action = "";
    if (s.status === "available") action = '<button class="act" data-act="start">Start task</button>';
    else if (s.status === "active") action = '<button class="act" data-act="done">Mark complete</button>';
    else if (s.status === "done") action = '<button class="act ghost" data-act="reopen">Reopen task</button>';
    else action = '<button class="act disabled" disabled>Blocked — finish prerequisites</button>';
    action += '<button class="act ghost" data-addnext="' + s.id + '">+ Add a following task</button>';

    panelInner.innerHTML =
      '<div class="p-accent" style="background:' + color + '"></div>' +
      '<button class="p-close" aria-label="Close">&times;</button>' +
      '<div class="p-head">' +
        '<div class="p-status st-' + s.status + '"><span class="p-status-dot"></span>' + STATUS_LABEL[s.status] + '</div>' +
        '<h2 class="p-title">' + s.name + '</h2>' +
        '<div class="p-lines">' + lineChips + (s.lines.length > 1 ? '<span class="ix-badge">interchange</span>' : '') + '</div>' +
      '</div>' +
      '<p class="p-desc">' + s.desc + '</p>' +
      '<div class="p-meta">' +
        metaRow("Owner", s.owner + '<span class="role"> · ' + s.role + '</span>') +
        metaRow("Due", s.due) +
        metaRow("Estimate", s.est) +
      '</div>' +
      (tags ? '<div class="p-tags">' + tags + '</div>' : '') +
      (pr ? '<div class="p-sec"><div class="p-sec-h">Depends on</div><ul class="pre-list">' + pr + '</ul></div>' : '<div class="p-sec"><div class="p-sec-h">Depends on</div><div class="p-none">Nothing — this is a starting station.</div></div>') +
      (nexts ? '<div class="p-sec"><div class="p-sec-h">Unblocks next</div><ul class="pre-list">' + nexts + '</ul></div>' : '') +
      '<div class="p-actions">' + action + '</div>';

    panelInner.querySelector(".p-close").addEventListener("click", closeDetail);
    var actBtn = panelInner.querySelector(".act[data-act]");
    if (actBtn) actBtn.addEventListener("click", function () { doAction(s.id, actBtn.dataset.act); });
    panelInner.querySelectorAll("[data-goto]").forEach(function (li) {
      li.addEventListener("click", function () { openDetail(li.dataset.goto); });
    });
    var addNext = panelInner.querySelector("[data-addnext]");
    if (addNext) addNext.addEventListener("click", function () {
      openCreateModal({ line: s.lines[0], prereqs: [s.id] });
    });
  }
  function metaRow(k, v) {
    return '<div class="m-row"><span class="m-k">' + k + '</span><span class="m-v">' + v + '</span></div>';
  }

  function doAction(id, act) {
    var s = stationById[id];
    if (act === "start") s.status = "active";
    else if (act === "done") s.status = "done";
    else if (act === "reopen") s.status = "active";
    recompute();
    renderPanel(s); // refresh action button + prereq states
    paint();
    renderLegend();
    pulseStation(id);
  }

  function pulseStation(id) {
    var g = svg.querySelector('.station[data-id="' + id + '"]');
    if (!g) return;
    g.classList.remove("just-changed");
    void g.getBoundingClientRect();
    g.classList.add("just-changed");
  }

  // ---- legend / lines panel ----
  var legendEl;
  function renderLegend() {
    var total = window.STATIONS.length;
    var done = window.STATIONS.filter(function (s) { return s.status === "done"; }).length;
    var pct = Math.round((done / total) * 100);

    var linesHtml = window.LINES.map(function (l) {
      var sts = window.STATIONS.filter(function (s) { return s.lines.indexOf(l.id) >= 0; });
      var d = sts.filter(function (s) { return s.status === "done"; }).length;
      var dpct = Math.round((d / sts.length) * 100);
      var on = highlightLine === l.id ? " on" : "";
      return '<button class="line-row' + on + '" data-line="' + l.id + '" style="--lc:' + l.color + '">' +
        '<span class="line-swatch"></span>' +
        '<span class="line-meta"><span class="line-name">' + l.name + '</span>' +
        '<span class="line-sub">' + sts.length + ' stops · ' + d + ' done</span></span>' +
        '<span class="line-prog"><span class="line-prog-fill" style="width:' + dpct + '%"></span></span>' +
      '</button>';
    }).join("");

    legendEl.innerHTML =
      '<div class="prj">' +
        '<div class="prj-name">' + window.PROJECT.name + '</div>' +
        '<div class="prj-sub">' + window.PROJECT.subtitle + '</div>' +
      '</div>' +
      '<div class="overall">' +
        '<div class="overall-top"><span>Overall progress</span><span class="overall-pct">' + pct + '%</span></div>' +
        '<div class="overall-bar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="overall-sub">' + done + ' of ' + total + ' stations complete</div>' +
      '</div>' +
      '<div class="sec-h">Lines<button class="clear-hl" ' + (highlightLine ? '' : 'hidden') + '>show all</button></div>' +
      '<div class="lines-list">' + linesHtml + '</div>' +
      '<div class="sec-h">Key</div>' +
      '<div class="key">' +
        keyRow("done", "Completed") +
        keyRow("active", "In progress") +
        keyRow("available", "Ready to start") +
        keyRow("locked", "Locked (waiting)") +
        '<div class="key-row"><span class="key-ix"></span><span>Interchange — task on multiple lines</span></div>' +
      '</div>';

    legendEl.querySelectorAll(".line-row").forEach(function (b) {
      b.addEventListener("click", function () {
        highlightLine = (highlightLine === b.dataset.line) ? null : b.dataset.line;
        renderLegend();
        applyHighlight();
      });
    });
    var clr = legendEl.querySelector(".clear-hl");
    if (clr) clr.addEventListener("click", function () { highlightLine = null; renderLegend(); applyHighlight(); });
  }
  function keyRow(state, label) {
    return '<div class="key-row"><span class="key-dot st-' + state + '"></span><span>' + label + '</span></div>';
  }

  // ---- rebuild the whole map (after structural changes) ----
  function rebuild() {
    rebuildIndexes();
    recompute();
    computeBounds();
    canvasEl.innerHTML = "";
    canvasEl.appendChild(buildMap());
    canvasEl.style.minWidth = Math.max(980, Math.round(VW * 0.62)) + "px";
    renderLegend();
    paint();
  }

  // ===== task creation =====
  function slugify(name) {
    var base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task";
    var id = base, n = 2;
    while (stationById[id]) { id = base + "-" + n; n++; }
    return id;
  }
  function occupied(col, row) {
    return window.STATIONS.some(function (s) { return s.col === col && s.row === row; });
  }
  function findFreeRow(col, row) {
    if (!occupied(col, row)) return row;
    for (var d = 1; d < 14; d++) {
      if (!occupied(col, row + d)) return row + d;
      if (row - d >= 0 && !occupied(col, row - d)) return row - d;
    }
    return row + 14;
  }
  function placeNewStation(lineId, prereqIds) {
    var col, row;
    if (prereqIds.length) {
      var cols = prereqIds.map(function (id) { return stationById[id].col; });
      col = Math.max.apply(null, cols) + 1;
      var sameLine = prereqIds.map(function (id) { return stationById[id]; })
        .filter(function (s) { return s.lines.indexOf(lineId) >= 0; });
      if (sameLine.length) row = sameLine[sameLine.length - 1].row;
      else row = Math.round(prereqIds.reduce(function (a, id) { return a + stationById[id].row; }, 0) / prereqIds.length);
    } else {
      col = 0; row = 0;
    }
    return { col: col, row: findFreeRow(col, row) };
  }

  function createTask(data) {
    var pos = placeNewStation(data.line, data.prereqs);
    var id = slugify(data.name);
    var st = {
      id: id, name: data.name, lines: [data.line],
      col: pos.col, row: pos.row,
      lp: pos.row >= 3 ? "bottom" : "top",
      status: "locked",
      desc: data.desc || "No description yet.",
      owner: data.owner || "Unassigned", role: data.role || "",
      due: data.due || "\u2014", est: data.est || "\u2014",
      tags: data.tags || []
    };
    window.STATIONS.push(st);
    data.prereqs.forEach(function (pid) {
      window.EDGES.push({ from: pid, to: id, line: data.line,
        df: stationById[pid].row !== pos.row });
    });
    rebuild();
    openDetail(id);
    pulseStation(id);
  }

  // ---- create modal ----
  var modalEl;
  function buildModal() {
    modalEl = document.createElement("div");
    modalEl.className = "modal-overlay";
    modalEl.id = "create-modal";
    modalEl.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<button class="modal-close" aria-label="Close">&times;</button>' +
        '<h2>New task</h2>' +
        '<p class="modal-sub">Add a station to the map. Pick its line and the tasks that must finish before it can start.</p>' +
        '<label>Task name<input type="text" id="f-name" placeholder="e.g. Accessibility audit" autocomplete="off"></label>' +
        '<label>Line<select id="f-line"></select></label>' +
        '<label>Description<textarea id="f-desc" placeholder="What needs to happen here?"></textarea></label>' +
        '<div class="field-row">' +
          '<label>Owner<input type="text" id="f-owner" placeholder="Name" autocomplete="off"></label>' +
          '<label>Role<input type="text" id="f-role" placeholder="Title" autocomplete="off"></label>' +
        '</div>' +
        '<div class="field-row">' +
          '<label>Due<input type="text" id="f-due" placeholder="e.g. Jul 2" autocomplete="off"></label>' +
          '<label>Estimate<input type="text" id="f-est" placeholder="e.g. 3 days" autocomplete="off"></label>' +
        '</div>' +
        '<div class="field"><div class="field-label">Depends on <span class="hint">\u2014 prerequisites that must be completed first</span></div>' +
          '<div class="prereq-grid" id="f-prereqs"></div></div>' +
        '<div class="modal-actions">' +
          '<button class="btn-ghost" data-cancel>Cancel</button>' +
          '<button class="btn-primary" data-create>Create task</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", function (e) {
      if (e.target === modalEl || e.target.closest(".modal-close") || e.target.closest("[data-cancel]")) closeCreateModal();
    });
    modalEl.querySelector("[data-create]").addEventListener("click", submitCreate);
    modalEl.querySelector("#f-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submitCreate(); }
    });
  }

  function openCreateModal(opts) {
    opts = opts || {};
    if (!modalEl) buildModal();
    // line options
    var sel = modalEl.querySelector("#f-line");
    sel.innerHTML = window.LINES.map(function (l) {
      return '<option value="' + l.id + '">' + l.name + '</option>';
    }).join("");
    if (opts.line) sel.value = opts.line;
    // reset fields
    ["f-name", "f-desc", "f-owner", "f-role", "f-due", "f-est"].forEach(function (id) {
      modalEl.querySelector("#" + id).value = "";
    });
    renderPrereqOptions(opts.prereqs || []);
    modalEl.classList.add("open");
    setTimeout(function () { modalEl.querySelector("#f-name").focus(); }, 60);
  }
  function closeCreateModal() { if (modalEl) modalEl.classList.remove("open"); }

  function renderPrereqOptions(preselect) {
    var grid = modalEl.querySelector("#f-prereqs");
    grid.innerHTML = window.STATIONS.map(function (s) {
      var c = lineById[s.lines[0]].color;
      var checked = preselect.indexOf(s.id) >= 0 ? " checked" : "";
      var lineNames = s.lines.map(function (l) { return lineById[l].short; }).join(" · ");
      return '<label class="pq" style="--pc:' + c + '">' +
        '<input type="checkbox" value="' + s.id + '"' + checked + '>' +
        '<span class="pq-dot"></span><span>' + s.name + '</span>' +
        '<span class="pq-line">' + lineNames + '</span></label>';
    }).join("");
  }

  function submitCreate() {
    var name = modalEl.querySelector("#f-name").value.trim();
    var nameField = modalEl.querySelector("#f-name");
    if (!name) { nameField.classList.add("err"); nameField.focus(); return; }
    nameField.classList.remove("err");
    var prereqs = [].slice.call(modalEl.querySelectorAll("#f-prereqs input:checked")).map(function (i) { return i.value; });
    createTask({
      name: name,
      line: modalEl.querySelector("#f-line").value,
      desc: modalEl.querySelector("#f-desc").value.trim(),
      owner: modalEl.querySelector("#f-owner").value.trim(),
      role: modalEl.querySelector("#f-role").value.trim(),
      due: modalEl.querySelector("#f-due").value.trim(),
      est: modalEl.querySelector("#f-est").value.trim(),
      prereqs: prereqs
    });
    closeCreateModal();
  }

  // ---- init ----
  function init() {
    legendEl = document.getElementById("legend");
    panel = document.getElementById("detail");
    panelInner = panel.querySelector(".p-inner");
    canvasEl = document.getElementById("map-canvas");

    rebuild();

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (modalEl && modalEl.classList.contains("open")) closeCreateModal();
        else closeDetail();
      }
    });

    var addBtn = document.getElementById("add-task");
    if (addBtn) addBtn.addEventListener("click", function () { openCreateModal(); });

    // tweaks hook
    window.PP = {
      setLineWeight: function (w) { document.documentElement.style.setProperty("--line-w", w + "px"); },
      setTheme: function (t) { document.body.dataset.theme = t; },
      setLabels: function (on) { document.body.classList.toggle("hide-labels", !on); },
      setCorners: function (r) { cornerRadius = r; rerouteCorners(r); },
    };
  }

  function rerouteCorners(r) {
    if (!svg) return;
    window.EDGES.forEach(function (e, i) {
      var pts = routePoints(e);
      var d = pointsToPath(pts, r);
      var nodes = svg.querySelectorAll('.seg[data-from="' + e.from + '"][data-to="' + e.to + '"], .seg-casing[data-from="' + e.from + '"][data-to="' + e.to + '"]');
      nodes.forEach(function (n) { n.setAttribute("d", d); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
