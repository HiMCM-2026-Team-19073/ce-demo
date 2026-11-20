/* Cooling People, Not Air — page logic.
   Every number shown comes from window.SITE (data/site.js), generated from the team's results.
   Charts are hand-written SVG, redrawn to the container width so text stays legible on phones. */
(function () {
  "use strict";
  var D = window.SITE;
  if (!D) { document.body.insertAdjacentHTML("afterbegin", "<p class='wrap'>The data file is missing.</p>"); return; }

  var NS = "http://www.w3.org/2000/svg";
  var DEV = { A: "Fan", B: "Evaporative cooler", C: "Large evaporative cooler", B_fresh: "Evaporative cooler", C_fresh: "Large evaporative cooler", B_recirc: "Evaporative cooler, recirculating" };
  var DEV_CLASS = { A: "ink", B: "mid", C: "green", B_fresh: "mid", C_fresh: "green" };
  var SITE_NAME = { Phoenix: "Phoenix", Honolulu: "Honolulu", Kona: "Kona", LosAngeles: "Los Angeles", NewYork: "New York" };
  var SAFE_BAR = D.constants.safe_bar;

  /* ---------- formatting ---------- */
  function fmt(x, f) {
    if (x === null || x === undefined || (typeof x === "number" && !isFinite(x))) return "n/a";
    switch (f) {
      case "pct0": return Math.round(x * 100) + "%";
      case "pct1": return (x * 100).toFixed(1) + "%";
      case "pp": return String(Math.round(x * 100));
      case "f1": return x.toFixed(1);
      case "f2": return x.toFixed(2);
      case "f3": return x.toFixed(3);
      case "int": return Math.round(x).toLocaleString("en-US");
      case "signed1": return (x < 0 ? "−" : "+") + Math.abs(x).toFixed(1);
      case "signed2": return (x < 0 ? "−" : "+") + Math.abs(x).toFixed(2);
      case "signed3": return (x < 0 ? "−" : "+") + Math.abs(x).toFixed(3);
      case "s3": return sig(x, 3);
      default: return String(x);
    }
  }
  function sig(x, n) {
    if (x === 0) return "0";
    var a = Math.abs(x), d = Math.max(0, n - 1 - Math.floor(Math.log10(a)));
    var s = a.toFixed(Math.min(d, 6));
    return (x < 0 ? "−" : "") + s;
  }
  function get(path) {
    var o = D, parts = path.split("|");
    for (var i = 0; i < parts.length; i++) {
      if (o === null || o === undefined || !(parts[i] in o)) throw new Error("data path not found: " + path);
      o = o[parts[i]];
    }
    return o;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(id) { return document.getElementById(id); }

  /* ---------- bind static numbers ---------- */
  document.querySelectorAll("[data-v]").forEach(function (el) {
    el.textContent = fmt(get(el.getAttribute("data-v")), el.getAttribute("data-f"));
  });
  $("w0-ratio").textContent = (D.r2a.Phoenix.w0 / D.constants.w_comfort).toFixed(1);
  (function () {
    var all = true;
    ["Phoenix", "Honolulu"].forEach(function (s) { "ABC".split("").forEach(function (d) { if (D.r2a[s].devices[d].safe_share < 1) all = false; }); });
    $("r2a-safe").textContent = all ? "All three devices keep people safe in every hot hour at both sites." : "Not every device is safe in every hot hour; see the safe shares.";
  })();

  /* ---------- svg helpers ---------- */
  function svgEl(tag, attrs, parent, txt) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (txt !== undefined) e.textContent = txt;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function widthOf(el) { return Math.max(300, Math.floor(el.parentNode.getBoundingClientRect().width)); }
  function sized(svg, w, h) { svg.setAttribute("viewBox", "0 0 " + w + " " + h); svg.setAttribute("width", w); svg.setAttribute("height", h); }
  function textW(s, px) { return String(s).length * px * 0.56; }

  /* draw-once on scroll */
  var seen = new WeakSet();
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (ents) {
    ents.forEach(function (en) { if (en.isIntersecting) { seen.add(en.target); en.target.classList.remove("pending"); io.unobserve(en.target); } });
  }, { threshold: 0.25 }) : null;
  function animate(svg) {
    if (!io || seen.has(svg)) return;
    svg.classList.add("pending");
    io.observe(svg);
  }

  /* ---------- R1 chart: where the case load comes from ---------- */
  function chartR1() {
    var svg = $("chart-r1"), W = widthOf(svg); clear(svg);
    var narrow = W < 560, lab = narrow ? 0 : 120, top = 30, rowH = narrow ? 96 : 74, barH = 30;
    var H = top + rowH * 2 + 10; sized(svg, W, H);
    var max = Math.max(D.r1.chilled.q_total_w, D.r1.frozen.q_total_w);
    var x0 = lab, x1 = W - (narrow ? 4 : 120), sc = (x1 - x0) / max;
    var parts = [["q_food_w", "Radiation onto food", "f-green"], ["q_wall_w", "Walls", "f-mid"], ["q_internal_w", "Lights, fans", "f-tint"], ["q_leak_w", "Air leaking in", "f-rule"]];
    ["chilled", "frozen"].forEach(function (job, i) {
      var r = D.r1[job], y = top + i * rowH + (narrow ? 22 : 0), x = x0;
      if (narrow) svgEl("text", { x: 0, y: y - 8, "class": "t-b" }, svg, job === "chilled" ? "Chilled case" : "Frozen case");
      else svgEl("text", { x: 0, y: y + barH / 2 + 5, "class": "t-b" }, svg, job === "chilled" ? "Chilled case" : "Frozen case");
      parts.forEach(function (p, j) {
        var w = r[p[0]] * sc;
        svgEl("rect", { x: x, y: y, width: Math.max(0, w - 1), height: barH, "class": p[2] + " grow" }, svg);
        if (j === 3) {
          var lt = (i === 0 ? p[1].toLowerCase() + " " : "leak ") + fmt(r.q_leak_w, "int") + " W (" + fmt(r.leak_share, "pct0") + ")";
          svgEl("text", { x: x + w - 1, y: y + barH + 20, "class": "t-s", "text-anchor": "end" }, svg, lt);
        }
        x += w;
      });
      var ref = r.q_ref_w * sc;
      svgEl("line", { x1: x0, x2: x0 + ref, y1: y + barH + 6, y2: y + barH + 6, "class": "s-green", "stroke-width": 2 }, svg);
      svgEl("text", { x: x0, y: y + barH + 20, "class": "t-s f-green" }, svg, (narrow ? "" : "needed ") + fmt(r.q_ref_w, "int") + " W");
      if (!narrow) svgEl("text", { x: x1 + 14, y: y + barH / 2 + 6, "class": "t-l" }, svg, "ηQ " + fmt(r.eta_Q, "f2"));
      else svgEl("text", { x: W - 4, y: y - 8, "class": "t-b", "text-anchor": "end" }, svg, "ηQ " + fmt(r.eta_Q, "f2"));
    });
    // key for the needed parts (direct, one line, above)
    var kx = x0, ky = 14;
    parts.slice(0, 3).forEach(function (p) {
      svgEl("rect", { x: kx, y: ky - 9, width: 10, height: 10, "class": p[2] }, svg);
      svgEl("text", { x: kx + 14, y: ky, "class": "t-s" }, svg, p[1]);
      kx += 24 + textW(p[1], 12);
    });
    animate(svg);
  }

  /* ---------- Model diagram ---------- */
  function arrow(svg, x1, y1, x2, y2, cls, head) {
    svgEl("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": cls || "s-ink", "stroke-width": 2 }, svg);
    var a = Math.atan2(y2 - y1, x2 - x1), s = head || 9;
    var p = [[x2, y2], [x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)], [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)]];
    svgEl("polygon", { points: p.map(function (q) { return q.join(","); }).join(" "), "class": (cls || "s-ink").replace("s-", "f-") }, svg);
  }
  function diagram() {
    var svg = $("diagram"), W = widthOf(svg); clear(svg);
    var stack = W < 760, pw = stack ? W : (W - 60) * 0.56, bw = stack ? W : W - pw - 60;
    var ph = 330, H = stack ? ph * 2 + 100 : ph + 40; sized(svg, W, H);
    // ---- panel 1: air box
    var bx = 10, by = stack ? 104 : 60, bwid = Math.min(pw - 60, 520), bh = 200;
    svgEl("text", { x: 0, y: 18, "class": "t-b" }, svg, "Air box");
    svgEl("text", { x: 0, y: 36, "class": "t-s" }, svg, "V dT/dt = Q(Tout − T) + sources − cooling");
    svgEl("rect", { x: bx + 30, y: by, width: bwid - 30, height: bh, "class": "f-wash" }, svg);
    svgEl("rect", { x: bx + 30, y: by - 6, width: bwid - 30, height: 6, "class": "f-ink" }, svg); // roof
    // walls: left wall with an opening, right wall with an opening
    svgEl("line", { x1: bx + 30, y1: by, x2: bx + 30, y2: by + 70, "class": "s-ink", "stroke-width": 3 }, svg);
    svgEl("line", { x1: bx + 30, y1: by + 140, x2: bx + 30, y2: by + bh, "class": "s-ink", "stroke-width": 3 }, svg);
    svgEl("line", { x1: bx + bwid, y1: by, x2: bx + bwid, y2: by + 110, "class": "s-ink", "stroke-width": 3 }, svg);
    svgEl("line", { x1: bx, y1: by + bh, x2: bx + bwid + 20, y2: by + bh, "class": "s-ink", "stroke-width": 1 }, svg);
    arrow(svg, bx - 6, by + 105, bx + 70, by + 105, "s-ink");
    svgEl("text", { x: bx - 6, y: by + 96, "class": "t-s" }, svg, "outside air in");
    arrow(svg, bx + bwid - 50, by + 160, bx + bwid + 40, by + 160, "s-ink");
    svgEl("text", { x: bx + bwid - 50, y: by + 182, "class": "t-s" }, svg, "mixed air out");
    svgEl("text", { x: bx + 34, y: by + bh + 22, "class": "t-s" }, svg, "Ω = open share of the walls; τ = V/Q");
    // sun on roof
    svgEl("circle", { cx: bx + bwid - 40, cy: by - 34, r: 12, "class": "f-ink" }, svg);
    arrow(svg, bx + bwid - 54, by - 26, bx + bwid - 80, by - 8, "s-ink", 7);
    svgEl("text", { x: bx + bwid - 62, y: by - 38, "class": "t-s", "text-anchor": "end" }, svg, "sun, hot roof");
    // device
    var dx = bx + 52, dy = by + 18;
    svgEl("rect", { x: dx, y: dy, width: 34, height: 34, "class": "f-green" }, svg);
    svgEl("text", { x: dx + 42, y: dy + 14, "class": "t-s" }, svg, "device");
    svgEl("text", { x: dx + 42, y: dy + 30, "class": "t-s" }, svg, "cool or moving air");
    // jet
    var pxx = bx + Math.min(bwid - 120, 270); for (var k = 0; k < 3; k++) arrow(svg, dx + 40, dy + 50 + k * 10, Math.min(dx + 170, pxx - 22), dy + 92 + k * 6, "s-mid", 7);
    // person
    var px = bx + Math.min(bwid - 120, 270), py = by + 92;
    svgEl("circle", { cx: px, cy: py, r: 11, "class": "f-ink" }, svg);
    svgEl("rect", { x: px - 11, y: py + 15, width: 22, height: 60, "class": "f-ink" }, svg);
    var nb = bwid < 380; svgEl("text", { x: nb ? px - 30 : px + 22, y: nb ? py - 20 : py + 6, "class": "t-s" }, svg, nb ? "people: heat + moisture" : "people:");
    if (!nb) svgEl("text", { x: px + 22, y: py + 22, "class": "t-s" }, svg, "heat + moisture");
    // ---- connector
    var ox = stack ? 0 : pw + 30, oy = stack ? ph + 80 : 0;
    if (!stack) {
      arrow(svg, pw - 20, by + 120, ox + 10, by + 120, "s-green");
      svgEl("text", { x: pw - 16, y: by + 108, "class": "t-s f-green" }, svg, "air T, humidity,");
      svgEl("text", { x: pw - 16, y: by + 142, "class": "t-s f-green" }, svg, "air speed");
    } else {
      arrow(svg, 60, by + bh + 34, 60, oy + 4, "s-green");
      svgEl("text", { x: 72, y: by + bh + 62, "class": "t-s f-green" }, svg, "air T, humidity, air speed at people");
    }
    // ---- panel 2: two-node body
    var tight = bw < 520, R = tight ? 78 : 92, cx = tight ? ox + R + 40 : ox + Math.min(bw, 420) / 2 + 10, cy = oy + 175, arr = tight ? 34 : 70;
    svgEl("text", { x: ox + 10, y: oy + 18, "class": "t-b" }, svg, "Two-node body");
    svgEl("text", { x: ox + 10, y: oy + 36, "class": "t-s" }, svg, "core and skin temperatures are outputs");
    svgEl("circle", { cx: cx, cy: cy, r: R, fill: "none", "class": "s-ink", "stroke-width": 14, stroke: "currentColor" }, svg).setAttribute("style", "stroke:var(--green-tint)");
    svgEl("circle", { cx: cx, cy: cy, r: R + 7, fill: "none", "class": "s-ink", "stroke-width": 1 }, svg);
    svgEl("circle", { cx: cx, cy: cy, r: 50, "class": "f-green" }, svg);
    svgEl("text", { x: cx, y: cy - 4, "class": "t-b", "text-anchor": "middle", style: "fill:#fff" }, svg, "core");
    svgEl("text", { x: cx, y: cy + 14, "class": "t-s", "text-anchor": "middle", style: "fill:#fff" }, svg, "Tcr");
    svgEl("text", { x: cx, y: cy - R - 14, "class": "t-s", "text-anchor": "middle" }, svg, "skin, Tsk");
    arrow(svg, cx + 52, cy, cx + R - 10, cy, "s-ink", 7);
    svgEl("text", { x: cx + 54, y: cy - 8, "class": "t-s" }, svg, "blood");
    var side = cx + R + 12;
    arrow(svg, side, cy - 40, side + arr, cy - 40 - arr * 0.43, "s-ink");
    svgEl("text", { x: side + arr + 4, y: cy - 40 - arr * 0.43, "class": "t-s" }, svg, "dry heat C + R");
    arrow(svg, side, cy + 10, side + arr, cy + 10, "s-mid");
    svgEl("text", { x: side + arr + 4, y: cy + 14, "class": "t-s" }, svg, "sweat E");
    arrow(svg, Math.max(ox + 4, cx - R - 50), cy + 60, cx - 30, cy + 20, "s-ink");
    svgEl("text", { x: Math.max(ox + 2, cx - R - 54), y: cy + R + 2, "class": "t-s" }, svg, "metabolism M");
    var l1 = "comfort: w ≤ " + fmt(D.constants.w_comfort, "f2"), l2 = "danger: core rising > " + fmt(D.constants.rate_crit, "f1") + " K/h after " + fmt(D.constants.t_exp, "int") + " min, or " + fmt(D.constants.Tcr_lim, "int") + " °C";
    if (tight) { svgEl("text", { x: ox + 10, y: oy + ph - 24, "class": "t-s" }, svg, l1); svgEl("text", { x: ox + 10, y: oy + ph - 6, "class": "t-s" }, svg, l2); }
    else svgEl("text", { x: ox + 10, y: oy + ph - 6, "class": "t-s" }, svg, l1 + "  ·  " + l2);
  }

  /* ---------- generic horizontal bar rows ---------- */
  function hbar(svg, x, y, w, h, frac, cls) {
    svgEl("rect", { x: x, y: y, width: Math.max(0.5, w * Math.max(0, Math.min(1, frac))), height: h, "class": cls + " grow" }, svg);
  }

  /* ---------- R2a chart ---------- */
  function chartR2a() {
    var svg = $("chart-r2a"), W = widthOf(svg); clear(svg);
    var stack = W < 720, pw = stack ? W : (W - 48) / 2, lab = 150, rowH = 26, gap = 22;
    var sites = ["Phoenix", "Honolulu"], panelH = 30 + sites.length * (3 * rowH + gap);
    var H = stack ? panelH * 2 + 30 : panelH; sized(svg, W, H);
    var maxEta = 0; sites.forEach(function (s) { "ABC".split("").forEach(function (d) { maxEta = Math.max(maxEta, D.r2a[s].devices[d].eta_N); }); });
    [["eta_N", "Efficiency ηN", maxEta, "f3"], ["comfy_share", "Comfortable share of hot hours", 1, "pct0"]].forEach(function (m, pi) {
      var ox = stack ? 0 : pi * (pw + 48), oy = stack ? pi * (panelH + 30) : 0;
      svgEl("text", { x: ox, y: oy + 14, "class": "t-b" }, svg, m[1]);
      var bx = ox + lab, bw = pw - lab - 56, y = oy + 34;
      sites.forEach(function (s) {
        svgEl("text", { x: ox, y: y + 2, "class": "t-s" }, svg, s.toUpperCase());
        y += 8;
        "ABC".split("").forEach(function (d) {
          var v = D.r2a[s].devices[d][m[0]];
          svgEl("text", { x: ox, y: y + 15, "class": "t-m" }, svg, d + "  " + DEV[d].replace("Large evaporative cooler", "Large evap. cooler").replace("Evaporative cooler", "Evap. cooler"));
          hbar(svg, bx, y + 4, bw, 14, v / m[2], "f-" + DEV_CLASS[d]);
          svgEl("text", { x: bx + bw * (v / m[2]) + 6, y: y + 16, "class": "t-b" }, svg, fmt(v, m[3]));
          y += rowH;
        });
        y += gap - 8;
      });
      svgEl("line", { x1: bx, x2: bx, y1: oy + 30, y2: y - gap + 8, "class": "ax" }, svg);
    });
    animate(svg);
  }

  /* ---------- Explorer ---------- */
  var EX = D.explorer, exState = { space: Object.keys(EX.spaces)[0] };
  function bandOf(v, bands) {
    for (var i = 0; i < bands.length; i++) if (v >= bands[i].range[0] && v < bands[i].range[1]) return bands[i];
    return bands[bands.length - 1];
  }
  function wScale(w0, w1, safeOK) {
    // a small w ruler: comfort and danger limits, no device (hollow) and with device (filled)
    var Wd = 220, H = 34, max = 1.2, sc = function (w) { return 4 + (Wd - 8) * Math.min(w, max) / max; };
    var s = '<svg class="chart" viewBox="0 0 ' + Wd + ' ' + H + '" width="100%" height="' + H + '" aria-hidden="true">';
    s += '<rect x="' + sc(0) + '" y="12" width="' + (sc(D.constants.w_comfort) - sc(0)) + '" height="8" class="f-tint"/>';
    s += '<line x1="4" x2="' + (Wd - 4) + '" y1="16" y2="16" class="ax"/>';
    s += '<line x1="' + sc(D.constants.w_danger) + '" x2="' + sc(D.constants.w_danger) + '" y1="8" y2="24" class="s-signal" stroke-width="2"/>';
    s += '<circle cx="' + sc(w0) + '" cy="16" r="5" fill="var(--bg)" class="s-ink" stroke-width="1.5"/>';
    s += '<circle cx="' + sc(w1) + '" cy="16" r="5" class="' + (safeOK ? "f-green" : "f-signal") + '"/>';
    s += '<text x="4" y="33" class="t-s" style="font-size:10px">0</text><text x="' + sc(D.constants.w_comfort) + '" y="33" class="t-s" style="font-size:10px" text-anchor="middle">' + fmt(D.constants.w_comfort, "f2") + '</text>';
    s += '<text x="' + sc(D.constants.w_danger) + '" y="33" class="t-s" style="font-size:10px" text-anchor="middle">' + fmt(D.constants.w_danger, "f2") + '</text>';
    s += '<text x="' + (Wd - 4) + '" y="33" class="t-s" style="font-size:10px" text-anchor="end">' + (max).toFixed(1) + '+</text></svg>';
    return s;
  }
  function explorer() {
    var segs = $("ex-space"); segs.innerHTML = "";
    Object.keys(EX.spaces).forEach(function (k) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = k.charAt(0).toUpperCase() + k.slice(1);
      b.setAttribute("aria-pressed", k === exState.space ? "true" : "false");
      b.addEventListener("click", function () { exState.space = k; explorer(); });
      segs.appendChild(b);
    });
    var T = +$("ex-T").value, RH = +$("ex-RH").value;
    $("ex-T-out").textContent = T + " °C"; $("ex-RH-out").textContent = RH + "%";
    var tb = bandOf(T, EX.T_bands), rb = bandOf(RH, EX.RH_bands), key = tb.name + "|" + rb.name;
    var cell = EX.spaces[exState.space].cells[key];
    var n = tb.points.length * rb.points.length * EX.winds.length;
    var hrs = Object.keys(EX.real_hours).map(function (s) { return s + " " + EX.real_hours[s][key]; }).join(", ");
    $("ex-snap").innerHTML = "Snaps to the band <strong>" + esc(tb.name) + ", RH " + esc(rb.name) + "</strong>: the median of " + n + " simulated weather points (T " +
      tb.points.join(", ") + " °C; RH " + rb.points.join(", ") + " %; wind " + EX.winds.join(", ") + " m/s). Real hot hours in this band: " + esc(hrs) + ".";
    var out = $("ex-out"); out.innerHTML = "";
    "ABC".split("").forEach(function (d) {
      var x = cell.devices[d], unsafe = x.safe < SAFE_BAR, best = cell.best === d;
      var div = document.createElement("div"); div.className = "dev" + (best ? " best" : "") + (unsafe ? " unsafe" : "");
      div.innerHTML = '<div class="name"><span>' + d + " · " + DEV[d] + "</span>" + (best ? '<span class="tag">Best</span>' : unsafe ? '<span class="tag bad">Not safe</span>' : "") + "</div>" +
        '<div class="big num">' + fmt(x.eta_N, "f3") + '</div><div class="small">efficiency ηN (median)</div>' +
        wScale(x.w0_shown, x.w1_shown, !unsafe) +
        '<div class="row"><span>Skin wettedness w, none → with device</span><span class="num">' + fmt(x.w0_shown, "f2") + " → " + fmt(x.w1_shown, "f2") + "</span></div>" +
        '<div class="row"><span>Comfort tier</span><span>' + esc(x.tier) + "</span></div>" +
        '<div class="row"><span>Safe share of hot points</span><span class="num' + (unsafe ? " danger" : "") + '">' + fmt(x.safe, "pct0") + "</span></div>" +
        '<div class="row"><span>Air at people cooled by</span><span class="num">' + fmt(x.dT, "f1") + " K</span></div>" +
        '<div class="row"><span>Score in this table (0–100)</span><span class="num">' + fmt(x.score, "int") + "</span></div>";
      out.appendChild(div);
    });
    var v = cell.verdict, txt;
    if (/^[ABC]$/.test(v)) txt = "Best here: <strong class='green'>" + v + " · " + DEV[v] + "</strong>";
    else txt = "<strong>" + esc(v.charAt(0).toUpperCase() + v.slice(1)) + "</strong>" + (cell.best_safe_share < SAFE_BAR ? ' <span class="danger">: no device is safe here.</span>' : "");
    $("ex-verdict").innerHTML = txt;
    $("ex-note").textContent = "Dot scale is wettedness w. Hollow: no device. Filled: with device. Shaded: comfortable. Red: danger reference. Provisional.";
  }
  ["ex-T", "ex-RH"].forEach(function (id) { $(id).addEventListener("input", explorer); });

  /* ---------- Openness sweep ---------- */
  var OM = D.omega, omState = { site: "Honolulu" };
  var OM_DEV = ["A", "B_fresh", "C_fresh"];
  function omLabel(o) { return (o * 100 < 10 ? (o * 100).toFixed(1) : Math.round(o * 100)) + "%"; }
  function chartOm() {
    var svg = $("chart-om"), W = widthOf(svg); clear(svg);
    var H = W < 560 ? 280 : 360, L = 46, R = W < 560 ? 12 : 150, T = 20, B = 44; sized(svg, W, H);
    var site = OM.sites[omState.site], O = OM.Omega, i = +$("om-r").value;
    var lx = function (o) { return L + (W - L - R) * (Math.log(o) - Math.log(O[0])) / (Math.log(O[O.length - 1]) - Math.log(O[0])); };
    var ymax = 0; OM_DEV.forEach(function (d) { site.devices[d].eta_N.forEach(function (v) { ymax = Math.max(ymax, v); }); });
    ymax = Math.ceil(ymax * 10) / 10;
    var ly = function (v) { return T + (H - T - B) * (1 - v / ymax); };
    // axes
    svgEl("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, "class": "ax" }, svg);
    [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].forEach(function (t) {
      if (t < O[0] || t > 1) return;
      var x = lx(Math.min(t, O[O.length - 1]));
      svgEl("line", { x1: x, x2: x, y1: H - B, y2: H - B + 5, "class": "ax" }, svg);
      svgEl("text", { x: x, y: H - B + 19, "class": "t-s", "text-anchor": "middle" }, svg, omLabel(t));
    });
    svgEl("text", { x: W - R, y: H - 6, "class": "t-s", "text-anchor": "end" }, svg, "openness Ω →");
    [0, ymax / 2, ymax].forEach(function (v) {
      svgEl("text", { x: L - 8, y: ly(v) + 4, "class": "t-s", "text-anchor": "end" }, svg, v.toFixed(2));
      if (v > 0) svgEl("line", { x1: L, x2: W - R, y1: ly(v), y2: ly(v), "class": "hair" }, svg);
    });
    svgEl("text", { x: L, y: 10, "class": "t-s" }, svg, "efficiency ηN");
    // flip line
    var flips = site.flips_fresh.filter(function (f) { return f.counts; });
    flips.forEach(function (f) {
      var x = lx(f.Omega);
      svgEl("line", { x1: x, x2: x, y1: T, y2: H - B, "class": "s-ink", "stroke-dasharray": "3 4", "stroke-width": 1 }, svg);
      svgEl("text", { x: x + 6, y: T + 12, "class": "t-s" }, svg, f.above.charAt(0) + " overtakes " + (f.below === "A" ? "the fan" : f.below.charAt(0)));
    });
    // lines
    var ends = [];
    OM_DEV.forEach(function (d) {
      var pts = site.devices[d].eta_N.map(function (v, k) { return lx(O[k]).toFixed(1) + "," + ly(v).toFixed(1); }).join(" ");
      var pl = svgEl("polyline", { points: pts, fill: "none", "class": "s-" + DEV_CLASS[d] + " draw", "stroke-width": d === "A" ? 2 : 2.5 }, svg);
      ends.push({ d: d, y: ly(site.devices[d].eta_N[O.length - 1]) });
      svgEl("circle", { cx: lx(O[i]), cy: ly(site.devices[d].eta_N[i]), r: 5, "class": "f-" + DEV_CLASS[d] }, svg);
      try { var len = pl.getTotalLength(); pl.style.strokeDasharray = len; pl.style.strokeDashoffset = seen.has(svg) || !io ? 0 : len; pl.dataset.len = len; } catch (e) { /* not rendered yet */ }
    });
    // direct labels at the right end, de-collided
    // wide: labels at the right end; narrow: labels at the left start (where the lines are far apart)
    var wide = R > 100;
    if (!wide) ends = OM_DEV.map(function (d) { return { d: d, y: ly(site.devices[d].eta_N[0]) - 8 }; });
    ends.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 16) ends[k].y = ends[k - 1].y + 16;
    ends.forEach(function (e) {
      var name = e.d.charAt(0) + " " + DEV[e.d].replace("Large evaporative cooler", "Large cooler").replace("Evaporative cooler", "Cooler");
      svgEl("text", { x: wide ? W - R + 8 : L + 6, y: e.y + 4, "class": "t-m f-" + DEV_CLASS[e.d], style: wide ? null : "font-size:12px" }, svg, name);
    });
    svgEl("line", { x1: lx(O[i]), x2: lx(O[i]), y1: T, y2: H - B, "class": "s-green", "stroke-width": 1 }, svg);
    // reveal lines once
    if (io && !seen.has(svg)) {
      var obs = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting) { seen.add(svg); svg.querySelectorAll("polyline.draw").forEach(function (p) { p.style.strokeDashoffset = 0; }); obs.disconnect(); }
      }, { threshold: 0.3 });
      obs.observe(svg);
    }
  }
  function omRead() {
    var segs = $("om-site"); segs.innerHTML = "";
    Object.keys(OM.sites).forEach(function (k) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = SITE_NAME[k] || k;
      b.setAttribute("aria-pressed", k === omState.site ? "true" : "false");
      b.addEventListener("click", function () { omState.site = k; omRead(); chartOm(); });
      segs.appendChild(b);
    });
    var i = +$("om-r").value, site = OM.sites[omState.site];
    $("om-out").textContent = omLabel(OM.Omega[i]);
    var top = OM_DEV.reduce(function (a, d) { return site.devices[d].eta_N[i] > site.devices[a].eta_N[i] ? d : a; }, OM_DEV[0]);
    var out = $("om-read"); out.innerHTML = "";
    OM_DEV.forEach(function (d) {
      var x = site.devices[d], unsafe = x.safe_share[i] < SAFE_BAR;
      var div = document.createElement("div"); div.className = "dev" + (d === top ? " best" : "") + (unsafe ? " unsafe" : "");
      div.innerHTML = '<div class="name"><span>' + d.charAt(0) + " · " + DEV[d] + "</span>" + (d === top ? '<span class="tag">Most efficient</span>' : unsafe ? '<span class="tag bad">Not safe</span>' : "") + "</div>" +
        '<div class="big num">' + fmt(x.eta_N[i], "f3") + '</div><div class="small">efficiency ηN</div>' +
        '<div class="row"><span>Comfortable share of hot hours</span><span class="num">' + fmt(x.comfy_share[i], "pct0") + "</span></div>" +
        '<div class="row"><span>Safe share of hot hours</span><span class="num' + (unsafe ? " danger" : "") + '">' + fmt(x.safe_share[i], "pct1") + "</span></div>" +
        '<div class="row"><span>Air residence time τ</span><span class="num">' + fmt(x.tau[i], "int") + " s</span></div>" +
        '<div class="row"><span>Skin wettedness w, none → with</span><span class="num">' + fmt(x.w0[i], "f2") + " → " + fmt(x.w1[i], "f2") + "</span></div>";
      out.appendChild(div);
    });
  }
  $("om-r").addEventListener("input", function () { omRead(); chartOm(); });
  (function () {
    var parts = Object.keys(OM.sites).map(function (s) {
      var f = OM.sites[s].flips_fresh.filter(function (x) { return x.counts; })[0];
      return f ? "with " + (SITE_NAME[s] || s) + " weather at Ω ≈ " + omLabel(f.Omega) : null;
    }).filter(Boolean);
    $("om-flip").textContent = parts.length ? "In our runs the switch happens " + parts.join(", and ") + "." : "";
    var b = D.r2b.Phoenix.before, a = D.r2b.Phoenix.after["0.1"];
    $("r2b-worked").insertAdjacentHTML("beforeend",
      "As a bus stop: fan <b class='num'>" + fmt(b.A.eta_N, "f3") + "</b>, cooler B <b class='num'>" + fmt(b.B.eta_N, "f3") +
      "</b>.<br>As a station, Ω " + omLabel(0.1) + ": fan <b class='num'>" + fmt(a.A.eta_N, "f3") + "</b>, cooler B <b class='num'>" + fmt(a.B_fresh.eta_N, "f3") +
      "</b>.<br>Air stays <b class='num'>" + fmt(a.B_fresh.tau, "int") + " s</b> instead of <span class='num'>" + fmt(b.B.tau, "int") + " s</span>.");
  })();

  /* ---------- R3 venues ---------- */
  function shortVenue(s) { var i = s.search(/ \(|: /); return i > 0 ? s.slice(0, i) : s; }
  function venues() {
    var host = $("venues"); host.innerHTML = "";
    Object.keys(D.r3.venues).forEach(function (v) {
      var x = D.r3.venues[v], div = document.createElement("div"); div.className = "venue";
      div.innerHTML = "<h3><span>" + esc(SITE_NAME[v] || v) + '</span><span class="label">' + esc(x.kind) + (x.omega < 1 ? " · Ω " + omLabel(x.omega) : "") + "</span></h3>" +
        '<p class="meta">' + esc(shortVenue(x.venue)) + ". " + fmt(x.area_m2, "int") + " m², " + fmt(x.people, "int") + " people, " + fmt(x.n_dev, "int") + (x.n_dev === 1 ? " device" : " devices") + ".</p>" +
        '<svg class="chart" role="img" aria-label="Options at ' + esc(SITE_NAME[v] || v) + ': efficiency and comfortable share"></svg>' +
        '<p class="choice">Choice: <b>' + esc(x.choice) + "</b>" + (x.met_target ? "" : " (nothing reaches the comfort target)") + "</p>" +
        '<p class="small">Shaken: flips in <strong class="num">' + x.n_flips + " of " + x.n_swings + "</strong> input swings.</p>";
      host.appendChild(div);
      drawVenue(div.querySelector("svg"), x);
    });
  }
  function drawVenue(svg, x) {
    var W = Math.max(280, Math.floor(svg.parentNode.getBoundingClientRect().width)), opts = Object.keys(x.options);
    var lab = W < 420 ? 112 : 168, rowH = 24, T = 22, H = T + opts.length * rowH + 6; sized(svg, W, H);
    var colW = (W - lab - 20) / 2, maxE = 0;
    opts.forEach(function (o) { maxE = Math.max(maxE, x.options[o].eta_N); });
    svgEl("text", { x: lab, y: 12, "class": "t-s" }, svg, "efficiency ηN");
    svgEl("text", { x: lab + colW + 20, y: 12, "class": "t-s" }, svg, "comfortable hot hours");
    var tx = lab + colW + 20 + (colW - 40) * D.r3.target;
    opts.forEach(function (o, k) {
      var r = x.options[o], y = T + k * rowH, chosen = o === x.choice, unsafe = r.safe_share < SAFE_BAR;
      var name = o.replace("large evaporative cooler", "large evap.").replace("evaporative cooler", "evap.").replace("IEC indirect evap.", "Indirect evap. (IEC)");
      svgEl("text", { x: 0, y: y + 14, "class": chosen ? "t-b f-green" : "t-m" + (unsafe ? " f-signal" : ""), style: W < 420 ? "font-size:12px" : null }, svg, name + (unsafe ? " ×" : ""));
      hbar(svg, lab, y + 4, colW - 44, 12, r.eta_N / maxE, chosen ? "f-green" : unsafe ? "f-rule" : "f-ink");
      svgEl("text", { x: lab + (colW - 44) * r.eta_N / maxE + 4, y: y + 14, "class": "t-s" }, svg, fmt(r.eta_N, "s3"));
      hbar(svg, lab + colW + 20, y + 4, colW - 40, 12, r.comfy_share, chosen ? "f-green" : unsafe ? "f-rule" : "f-mid");
      svgEl("text", { x: lab + colW + 20 + (colW - 40) * r.comfy_share + 4, y: y + 14, "class": "t-s" }, svg, fmt(r.comfy_share, "pct0"));
    });
    svgEl("line", { x1: tx, x2: tx, y1: T - 2, y2: H - 4, "class": "s-ink", "stroke-dasharray": "2 3" }, svg);
    animate(svg);
  }
  function drivers() {
    var svg = $("chart-drv"), W = widthOf(svg); clear(svg);
    var stack = W < 620, pw = stack ? W : (W - 40) / 2, lab = 180, rowH = 22, n = 8, ph = 26 + n * rowH;
    var H = stack ? ph * 2 + 24 : ph; sized(svg, W, H);
    var max = 0; ["open", "hall"].forEach(function (k) { D.drivers[k].top.forEach(function (t) { max = Math.max(max, t.share); }); });
    [["open", "Open spaces"], ["hall", "Semi-open hall"]].forEach(function (p, pi) {
      var ox = stack ? 0 : pi * (pw + 40), oy = stack ? pi * (ph + 24) : 0;
      svgEl("text", { x: ox, y: oy + 14, "class": "t-b" }, svg, p[1]);
      D.drivers[p[0]].top.slice(0, n).forEach(function (t, k) {
        var y = oy + 24 + k * rowH, bw = pw - lab - 44;
        svgEl("text", { x: ox, y: y + 13, "class": "t-m", style: "font-size:13px" }, svg, t.label);
        hbar(svg, ox + lab, y + 3, bw, 12, t.share / max, k === 0 ? "f-green" : "f-mid");
        svgEl("text", { x: ox + lab + bw * t.share / max + 4, y: y + 13, "class": "t-s" }, svg, fmt(t.share, "pct0"));
      });
    });
    $("drv-note").textContent = "Leaving the crowd out, the order is: open — " + D.drivers.open.order_no_crowd.slice(0, 3).join(", ").toLowerCase() +
      "; semi-open — " + D.drivers.hall.order_no_crowd.slice(0, 3).join(", ").toLowerCase() + ".";
    animate(svg);
  }

  /* ---------- R4 ---------- */
  var r4State = { venue: Object.keys(D.r4.venues)[0] };
  function r4() {
    var segs = $("r4-tabs"); segs.innerHTML = "";
    Object.keys(D.r4.venues).forEach(function (k) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = SITE_NAME[k] || k;
      b.setAttribute("aria-pressed", k === r4State.venue ? "true" : "false");
      b.addEventListener("click", function () { r4State.venue = k; r4(); });
      segs.appendChild(b);
    });
    var v = D.r4.venues[r4State.venue], m = v.main_answer;
    // most efficient option among those that pass the safety step (status not "rejected"), computed from the table shown
    var passing = v.table.filter(function (t) { return !/^rejected/.test(t.status); });
    var me = passing.reduce(function (a, b) { return b.eta_N > a.eta_N ? b : a; }, passing[0]);
    $("r4-verdict").innerHTML = "Answer: <strong class='green'>" + esc(m.option) + "</strong> — USD <span class='num'>" + fmt(m.cost_per_comfy_ph, "s3") +
      "</span> per comfortable person-hour, comfortable in <span class='num'>" + fmt(m.comfy_share, "pct1") + "</span> of hot hours" + (m.met_target ? "." : " (target not reached; the cheapest way to comfort among what is safe).") +
      " Most efficient option that passes the safety step: " + esc(me.option) + " (ηN <span class='num'>" + fmt(me.eta_N, "s3") + "</span>, comfortable in <span class='num'>" + fmt(me.comfy_share, "pct1") + "</span> of hot hours). " +
      (me.option === m.option ? "Here the most efficient option is also the answer." : "<strong>Here the most efficient option is not the answer.</strong>");
    var rows = "<thead><tr><th>Option</th><th class='n'>Safe</th><th class='n'>Comfortable</th><th class='n' style='text-transform:none'>η<sub>N</sub></th><th class='n'>kWh</th><th class='n'>USD per comf. person-h</th><th>Status</th></tr></thead><tbody>";
    v.table.forEach(function (t) {
      var st = t.status, rej = /^rejected/.test(st), ch = /CHOSEN/.test(st);
      rows += "<tr class='" + (ch ? "chosen" : rej ? "rej" : "") + "'><td>" + esc(t.option) + "</td><td class='n num" + (t.safe_share < SAFE_BAR ? " st-bad" : "") + "'>" + fmt(t.safe_share, "pct1") +
        "</td><td class='n num'>" + fmt(t.comfy_share, "pct1") + "</td><td class='n num'>" + fmt(t.eta_N, "s3") + "</td><td class='n num'>" + fmt(t.kWh, "int") +
        "</td><td class='n num'>" + fmt(t.cost_per_comfy_ph, "s3") + "</td><td class='" + (rej ? "st-bad" : ch ? "st-good" : "") + "'>" + esc(st) + "</td></tr>";
    });
    $("r4-table").innerHTML = rows + "</tbody>";
    var sc = v.ahp.scores, topA = Object.keys(sc).reduce(function (a, b) { return sc[b] > sc[a] ? b : a; });
    $("r4-note").textContent = "Cross-check by weighted scoring (AHP): " + topA + " ranks first.";
  }

  /* ---------- Dehumidifier ---------- */
  var DH_ROWS = ["A fan", "B evaporative cooler", "C large evaporative cooler", "AC spot unit", "Dehumidifier (Quest 506)", "Dehumidifier (LGR145)", "Desiccant dehumidifier (M210X)",
    "A fan + dehumidifier (Quest 506)", "B evaporative cooler + dehumidifier (Quest 506)", "Quest 506: drying only (heat switched off)", "Quest 506: heat only (removal switched off)"];
  function dehum() {
    var svg = $("chart-dh"), W = widthOf(svg); clear(svg);
    var rows = D.dehum.Honolulu.rows, keys = DH_ROWS.filter(function (k) { return rows[k]; });
    var lab = W < 480 ? 150 : 250, rowH = 26, T = 10, H = T + keys.length * rowH + 12; sized(svg, W, H);
    var vals = keys.map(function (k) { return rows[k].eta_N; }), lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals);
    var x0 = lab + 50, x1 = W - 50, sc = (x1 - x0) / (hi - lo), zx = x0 - lo * sc;
    keys.forEach(function (k, i) {
      var v = rows[k].eta_N, y = T + i * rowH, neg = v < 0, diag = /only/.test(k);
      if (i === 9) svgEl("line", { x1: 0, x2: W, y1: y - 3, y2: y - 3, "class": "hair" }, svg);
      var name = k.replace("evaporative cooler", "evap. cooler").replace("dehumidifier", "dehum.").replace("Dehumidifier", "Dehumidifier").replace(" (heat switched off)", "").replace(" (removal switched off)", "");
      svgEl("text", { x: 0, y: y + 15, "class": "t-m" + (diag ? " f-mid" : ""), style: W < 480 ? "font-size:12px" : "font-size:13px" }, svg, name);
      var w = Math.abs(v) * sc;
      svgEl("rect", { x: neg ? zx - w : zx, y: y + 5, width: Math.max(0.5, w), height: 13, "class": (neg ? "f-signal" : diag ? "f-tint" : "f-green") + " grow", style: neg ? "transform-origin:right center" : null }, svg);
      svgEl("text", { x: neg ? zx - w - 4 : zx + w + 4, y: y + 16, "class": "t-s", "text-anchor": neg ? "end" : "start" }, svg, fmt(v, "signed3"));
    });
    svgEl("line", { x1: zx, x2: zx, y1: T, y2: H - 8, "class": "ax" }, svg);
    animate(svg);
    var q = rows["Dehumidifier (Quest 506)"], dry = rows["Quest 506: drying only (heat switched off)"], heat = rows["Quest 506: heat only (removal switched off)"];
    $("dehum-worked").innerHTML = '<span class="label">Honolulu station, ' + fmt(D.dehum.n_dev, "int") + " units</span>" +
      "Humidity <b class='num'>" + fmt(q.RH0, "f1") + "% → " + fmt(q.RH1, "f1") + "%</b>. Air <b class='num danger'>" + fmt(q.dT_air, "signed2") +
      " K</b>. Wettedness <b class='num danger'>" + fmt(q.w0, "f2") + " → " + fmt(q.w1, "f2") + "</b>. Efficiency <b class='num danger'>" + fmt(q.eta_N, "signed3") + "</b>.";
  }

  /* ---------- R5 decision grids ---------- */
  function r5() {
    var host = $("dgrids"); host.innerHTML = "";
    var cells = D.r5.cells, Tb = [], RHb = [];
    cells.forEach(function (c) { if (Tb.indexOf(c.T) < 0) Tb.push(c.T); if (RHb.indexOf(c.RH) < 0) RHb.push(c.RH); });
    ["open", "semi-open"].forEach(function (op) {
      var wrap = document.createElement("div");
      var h = '<h3 style="margin-bottom:12px">' + (op === "open" ? "Open spaces" : "Semi-open spaces") + '</h3><div class="dgrid" role="table" aria-label="' + op + ' decision chart">';
      h += '<div class="hd" role="columnheader">Air temp.</div>' + RHb.map(function (r) { return '<div class="hd" role="columnheader">RH ' + esc(r) + "</div>"; }).join("");
      Tb.forEach(function (t) {
        h += '<div class="rh" role="rowheader">' + esc(t) + "</div>";
        RHb.forEach(function (r) {
          var c = cells.filter(function (x) { return x.openness === op && x.T === t && x.RH === r; })[0];
          if (!c || !/^[ABC]$/.test(c.best)) {
            h += '<div class="cell none" role="cell"><div class="dv">' + (c ? esc(c.best.charAt(0).toUpperCase() + c.best.slice(1)) : "n/a") + '</div><div class="mini">' + (c ? fmt(c.hours, "int") : "0") + " service hours at our sites</div></div>";
            return;
          }
          var d = c.devices, b = c.best, warn = /shade and water/.test(c.action);
          h += '<div class="cell' + (warn ? " warn" : "") + '" role="cell"><div class="dv">' + b + '</div><div class="dn">' + DEV[b] + "</div>" +
            '<div class="mini">' + fmt(d[b].real_hot_hours, "int") + " hot hours<br>safe A/B/C " + ["A", "B", "C"].map(function (k) { return fmt(d[k].safe, "pct0"); }).join(" ") +
            "<br>comfortable with " + b + " " + fmt(d[b].comfy, "pct0") + "<br>no device: " + esc(c.tier_no_device) + "</div></div>";
        });
      });
      wrap.innerHTML = h + "</div>";
      host.appendChild(wrap);
    });
    var sites = Object.keys(cells[0].hours_by_site).map(function (s) { return SITE_NAME[s] || s; }).join(", ");
    $("dg-note").textContent = "Shares of real hot hours at " + sites + ", summer 2024. Hatched: never happened there. Provisional.";
    var g = D.r5.cap_by_group;
    $("cap-groups").textContent = Object.keys(g).map(function (k) { return fmt(g[k], "int") + " °C for " + k; }).join(", ");
    $("ladder").innerHTML = D.r5.ladder.map(function (s) { return "<li>" + esc(s.action) + "</li>"; }).join("");
  }

  /* ---------- validation ---------- */
  function validation() {
    var v = D.validation, h = v.holdout, li = [];
    var byKey = {}; h.forEach(function (x) { byKey[x.key] = x; });
    li.push("<strong>Danger test calibrated</strong> on Vecellio 2022's three warm-humid trials: best rate <span class='num'>" + fmt(v.calibration.best, "f1") + " K/h</span>, mean wet-bulb error <span class='num'>" + fmt(v.calibration.mean_abs_err, "f2") +
      " °C</span>. The old “core reaches " + fmt(D.constants.Tcr_lim, "int") + " °C” rule alone was off by <span class='num'>" + fmt(v.v8_rule_err, "f2") + " °C</span>.");
    li.push("<strong>Hold-out, hot-dry trials</strong> (not used to calibrate): mean error <span class='num'>" + fmt(byKey.V1_vecellio_hot_dry.mean_abs_err, "f2") + " °C</span> — <span class='green'>" + esc(byKey.V1_vecellio_hot_dry.verdict) + "</span>.");
    li.push("<strong>Hold-out, Wolf 2023:</strong> young adults at 34 °C, error <span class='num'>" + fmt(byKey.V3_wolf_young_34C.mean_abs_err, "f2") + " °C</span>; older adults <span class='num'>" + fmt(byKey.V4_wolf_older_minact.mean_abs_err, "f2") +
      "</span> and <span class='num'>" + fmt(byKey.V5_wolf_older_rest.mean_abs_err, "f2") + " °C</span> — verdicts " +
      ["V3_wolf_young_34C", "V4_wolf_older_minact", "V5_wolf_older_rest"].map(function (k) { var vd = byKey[k].verdict; return "<span class='" + (vd === "PASS" ? "green" : "danger") + "'>" + esc(vd) + "</span>"; }).join(", ") + ".");
    var mm = v.older_minus_young_measured, mo = v.older_minus_young_model;
    var rng = function (a) { var b = a.filter(function (x) { return x !== null; }).map(Math.abs); return fmt(Math.min.apply(null, b), "f1") + "–" + fmt(Math.max.apply(null, b), "f1"); };
    li.push("<strong>Older adults:</strong> measured, their wet-bulb limit is <span class='num'>" + rng(mm) + " °C</span> lower than young adults'. Our model puts it <span class='num'>" + rng(mo) + " °C</span> higher. So our safety verdicts are lenient for older people.");
    li.push("<strong>Freezer case:</strong> <span class='num'>" + D.r1.checks.chilled_passed + " of " + D.r1.checks.chilled_total + "</span> chilled and <span class='num'>" + D.r1.checks.frozen_passed + " of " + D.r1.checks.frozen_total + "</span> frozen outside checks pass.");
    $("valid").innerHTML = li.map(function (s) { return "<li>" + s + "</li>"; }).join("");
  }

  /* ---------- run ---------- */
  function drawAll() { chartR1(); diagram(); chartR2a(); chartOm(); venues(); drivers(); dehum(); }
  explorer(); omRead(); r4(); r5(); validation(); drawAll();
  var rt, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(drawAll, 150);
  });
})();
