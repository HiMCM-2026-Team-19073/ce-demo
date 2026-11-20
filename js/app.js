/* Workstation: the scenario rail drives five stations. Every number shown is computed here by the engine (js/engine.js)
   from the model's parameters; the only stored results used are the published values printed beside live ones. */
(function () {
  "use strict";
  var M = window.MODEL, WXD = window.WEATHER, VAL = window.VALIDATION;
  var checkLine = document.getElementById("check-line");
  if (!M || !WXD || !window.makeEngine) { checkLine.textContent = "The model data did not load, so nothing can be computed."; return; }
  var E = window.makeEngine(M), pv = E.pv, K = M.consts;
  var NS = "http://www.w3.org/2000/svg";

  /* ---------------- formatting ---------------- */
  function $(id) { return document.getElementById(id); }
  function f(x, d) {
    if (x == null || !isFinite(x)) return "&ndash;";
    if (Math.abs(x) < 0.5 * Math.pow(10, -d)) x = 0;
    var s = x.toFixed(d);
    return s.charAt(0) === "-" ? "&minus;" + s.slice(1) : s;
  }
  function ft(x, d) { return f(x, d).replace("&minus;", "−").replace("&ndash;", "–"); }
  function n0(x) { return Math.round(x).toLocaleString("en-US").replace(/,/g, " "); }
  function pct(x, d) { return f(x * 100, d || 0) + "%"; }
  function sci(x) {
    if (x === 0) return "0";
    var e = Math.floor(Math.log10(Math.abs(x))), m = x / Math.pow(10, e);
    return m.toFixed(0) + "&thinsp;&times;&thinsp;10<sup>&minus;" + Math.abs(e) + "</sup>";
  }
  function dur(s) { return s < 90 ? f(s, 0) + " s" : s < 5400 ? f(s / 60, 1) + " min" : f(s / 3600, 1) + " h"; }
  function svg(tag, a, p, t) { var e = document.createElementNS(NS, tag); for (var k in a) if (a[k] != null) e.setAttribute(k, a[k]); if (t != null) e.textContent = t; if (p) p.appendChild(e); return e; }
  function eq(m, w) { return "<div class='eq'><span class='m'>" + m + "</span><span class='w'>" + w + "</span></div>"; }

  var DEV = {
    A: { s: "A", name: "Fan", P: function () { return pv("P_A"); } },
    B: { s: "B", name: "Evaporative cooler", P: function () { return pv("P_B"); } },
    C: { s: "C", name: "Large evaporative cooler", P: function () { return pv("P_C"); } },
    AC: { s: "AC", name: "Spot air conditioner", P: function () { return pv("ac_P"); } },
    Mist: { s: "Mist", name: "Mist, no fan", P: null },
    IEC: { s: "IEC", name: "Indirect evaporative cooler", P: function () { return pv("P_IEC"); } }
  };
  var DEV_ORDER = ["A", "B", "C", "AC", "Mist", "IEC"];
  var SITES = { Phoenix: "Phoenix", Honolulu: "Honolulu", Kona: "Kona", LosAngeles: "Los Angeles", NewYork: "New York" };
  var WIND_FROM = { front: 180, side: 270, back: 0 };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dateOf(doy, hour) { var d = new Date(Date.UTC(2024, 0, doy)); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + (hour != null ? ", " + (hour < 10 ? "0" : "") + hour + ":00" : ""); }
  function devLabel(id) { return "<b>" + DEV[id].s + "</b> " + DEV[id].name; }

  /* ---------------- scenario state ---------------- */
  function presetById(id) { for (var i = 0; i < M.presets.length; i++) if (M.presets[i].id === id) return M.presets[i]; return M.presets[0]; }
  function hottest(site) {
    var wx = E.siteWeather(WXD[site]), k = 0;
    for (var i = 1; i < wx.length; i++) if (wx[i].T > wx[k].T) k = i;
    var h = wx[k], side = "front";
    if (h.dir != null) { var cs = Math.cos((h.dir - 180) * Math.PI / 180); side = cs >= 0.7071 ? "front" : cs <= -0.7071 ? "back" : "side"; }
    return { T: Math.round(h.T * 10) / 10, RH: Math.round(E.RHof(h.T, h.W)), U2: Math.round(E.windAt(2, h.U10) * 10) / 10, sun: h.sin_alt > 0.05, windSide: side,
      hourSrc: { site: site, doy: h.doy, hour: h.hour } };
  }
  function stateFromPreset(pr) {
    var sp = pr.space, open = sp.kind === "open";
    var s = { kind: sp.kind, D: sp.D, H: sp.H, span: sp.span, omegaPct: open ? 10 : sp.Omega * 100,
      people: (open && sp.present < 1) ? null : sp.N_present, n_dev: sp.n_dev || 1, c_end: open ? sp.c_end : pv("c_end"),
      roofless: !!sp.roofless, params: JSON.parse(JSON.stringify(pr.params || {})), group: "young", devices: pr.devices.slice(), site: pr.site };
    var h = hottest(pr.site);
    for (var k in h) s[k] = h[k];
    return s;
  }
  function buildSpace(s) {
    if (s.kind === "open") {
      var sp = E.shelterSpace({ D: s.D, H: s.H, span: s.span, c_end: s.c_end });
      if (s.people != null) { sp.N_present = s.people; sp.present = 1; sp.n_dev = s.n_dev; }
      if (s.roofless) { sp.f_svv = 1; sp.roofless = true; }
      return sp;
    }
    return E.hallSpace(s.omegaPct / 100, { D: s.D, H: s.H, span: s.span, N: s.people != null ? s.people : 40, n_dev: s.n_dev });
  }
  // the presets must rebuild exactly the spaces the published runs used
  M.presets.forEach(function (pr) {
    var a = buildSpace(stateFromPreset(pr)), b = pr.space, keys = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var x = a[k], y = b[k];
      var same = (typeof x === "number" && typeof y === "number") ? Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y)) : x === y;
      if (!same) console.error("preset " + pr.id + ": space field " + k + " differs", x, y);
    });
  });

  var preset = M.presets[0], st = stateFromPreset(preset);
  var SEASON_KEYS = ["kind", "D", "H", "span", "omegaPct", "people", "n_dev", "c_end", "roofless", "group", "site", "params", "devices"];
  var HOUR_KEYS = ["T", "RH", "U2", "sun", "windSide"];
  function keyOf(s, keys) { return JSON.stringify(keys.map(function (k) { return k === "devices" ? s[k].slice().sort() : s[k]; })); }
  function isPublished(s) { var p = stateFromPreset(preset); return keyOf(s, SEASON_KEYS.filter(function (k) { return k !== "devices"; })) === keyOf(p, SEASON_KEYS.filter(function (k) { return k !== "devices"; })); }

  /* ---------------- rail controls ---------------- */
  var fields = {};
  document.querySelectorAll(".fld").forEach(function (el) {
    var key = el.getAttribute("data-key"), lab = el.querySelector("label"), id = "f-" + key;
    var box = document.createElement("span"); box.className = "num-in";
    box.innerHTML = "<button type='button' aria-label='Decrease " + lab.textContent + "'>&minus;</button><input id='" + id + "' type='text' inputmode='decimal' spellcheck='false'><span class='u'>" + el.getAttribute("data-unit") + "</span><button type='button' aria-label='Increase " + lab.textContent + "'>+</button>";
    el.appendChild(box);
    var inp = box.querySelector("input"), bs = box.querySelectorAll("button");
    var cfg = { el: el, inp: inp, key: key, step: +el.getAttribute("data-step"), min: +el.getAttribute("data-min"), max: +el.getAttribute("data-max"), dec: +el.getAttribute("data-dec") };
    fields[key] = cfg;
    function commit(v, now) {
      if (!isFinite(v) || v < cfg.min || v > cfg.max) {
        el.classList.add("bad"); inp.setAttribute("aria-invalid", "true");
        inp.setAttribute("title", "Allowed: " + cfg.min + " to " + cfg.max + " " + el.getAttribute("data-unit").replace("&deg;", "°"));
        return false;
      }
      el.classList.remove("bad"); inp.removeAttribute("aria-invalid"); inp.removeAttribute("title");
      setVal(key, v, now);
      return true;
    }
    var tmr = null;
    inp.addEventListener("input", function () { clearTimeout(tmr); tmr = setTimeout(function () { commit(parseFloat(inp.value.replace("−", "-")), false); }, 250); });
    inp.addEventListener("change", function () { clearTimeout(tmr); if (commit(parseFloat(inp.value.replace("−", "-")), true)) syncRail(); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); step(e.key === "ArrowUp" ? 1 : -1); }
    });
    function step(sg) {
      var cur = currentFieldValue(key), v = Math.round((cur + sg * cfg.step) / cfg.step) * cfg.step;
      v = Math.min(cfg.max, Math.max(cfg.min, +v.toFixed(Math.max(cfg.dec, 2))));
      el.classList.remove("bad"); inp.removeAttribute("aria-invalid");
      setVal(key, v, true); syncRail(true);
      inp.value = ft(v, cfg.dec);
    }
    bs[0].addEventListener("click", function () { step(-1); });
    bs[1].addEventListener("click", function () { step(1); });
  });
  function currentFieldValue(key) {
    if (key === "people") return st.people != null ? st.people : buildSpace(st).N_present;
    return st[key];
  }
  function setVal(key, v, now) {
    if (key === "people") { st.people = Math.round(v); }
    else if (key === "n_dev") st.n_dev = Math.round(v);
    else st[key] = v;
    if (HOUR_KEYS.indexOf(key) >= 0) st.hourSrc = null;
    update(now);
  }
  document.querySelectorAll(".seg[data-key]").forEach(function (g) {
    var key = g.getAttribute("data-key");
    g.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        if (key === "sun") v = v === "1";
        if (key === "kind" && v !== st.kind) {
          if (v === "hall") { if (st.people == null) st.people = 40; if (st.n_dev <= 1) st.n_dev = Math.max(1, Math.round(st.people / 10)); st.roofless = false; }
        }
        st[key] = v;
        if (HOUR_KEYS.indexOf(key) >= 0) st.hourSrc = null;
        syncRail(); update(true);
      });
    });
  });
  var pick = $("devpick");
  DEV_ORDER.forEach(function (id) {
    var b = document.createElement("button"); b.type = "button"; b.setAttribute("data-dev", id);
    b.innerHTML = "<b>" + DEV[id].s + "</b>" + DEV[id].name;
    b.addEventListener("click", function () {
      var i = st.devices.indexOf(id);
      if (i >= 0) { if (st.devices.length === 1) return; st.devices.splice(i, 1); }
      else st.devices = DEV_ORDER.filter(function (d) { return d === id || st.devices.indexOf(d) >= 0; });
      syncRail(); update(true);
    });
    pick.appendChild(b);
  });
  var sel = $("preset"), groups = {};
  M.presets.forEach(function (p) {
    if (!groups[p.group]) { groups[p.group] = document.createElement("optgroup"); groups[p.group].label = p.group; sel.appendChild(groups[p.group]); }
    var o = document.createElement("option"); o.value = p.id; o.textContent = p.label; groups[p.group].appendChild(o);
  });
  sel.addEventListener("change", function () { preset = presetById(sel.value); st = stateFromPreset(preset); syncRail(true); update(true); });
  $("reset").addEventListener("click", function () { st = stateFromPreset(preset); syncRail(true); update(true); });
  $("hottest").addEventListener("click", function () { var h = hottest(st.site); for (var k in h) st[k] = h[k]; syncRail(true); update(true); });
  $("arrivals").addEventListener("click", function () { st.people = null; st.n_dev = 1; syncRail(true); update(true); });
  var siteSel = $("site");
  Object.keys(SITES).forEach(function (s) { var o = document.createElement("option"); o.value = s; o.textContent = SITES[s]; siteSel.appendChild(o); });
  siteSel.addEventListener("change", function () { st.site = siteSel.value; syncRail(); update(true); });

  var LABELS = { kind: "space type", D: "depth", H: "height", span: "length", omegaPct: "openness", people: "people", n_dev: "units", c_end: "end openings", roofless: "roof",
    group: "person", site: "summer weather", params: "roof heat", devices: "devices", T: "temperature", RH: "humidity", U2: "wind", sun: "sun", windSide: "wind side" };
  function syncRail(force) {
    sel.value = preset.id; siteSel.value = st.site;
    var sp = buildSpace(st);
    Object.keys(fields).forEach(function (k) {
      var c = fields[k];
      if (!force && (document.activeElement === c.inp || c.el.classList.contains("bad"))) return;
      c.inp.removeAttribute("aria-invalid");
      var v = k === "people" ? (st.people != null ? st.people : sp.N_present) : st[k];
      c.inp.value = ft(v, k === "people" && st.people == null ? 1 : c.dec);
      c.el.classList.remove("bad");
    });
    document.querySelectorAll(".seg[data-key]").forEach(function (g) {
      var key = g.getAttribute("data-key"), cur = key === "sun" ? (st.sun ? "1" : "0") : st[key];
      g.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-v") === String(cur) ? "true" : "false"); });
    });
    pick.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", st.devices.indexOf(b.getAttribute("data-dev")) >= 0 ? "true" : "false"); });
    var open = st.kind === "open";
    fields.omegaPct.el.hidden = open;
    $("row-wind").hidden = !open;
    fields.n_dev.el.hidden = open && st.people == null;
    $("arrivals").hidden = !(open && st.people != null);
    $("crowd-note").innerHTML = open && st.people == null
      ? "Bus-stop arrivals: " + f(pv("lambda_arr"), 0) + " people an hour, a bus every " + f(pv("headway") * 60, 0) + " min. Someone is waiting " + pct(sp.present) + " of the time, on average " + f(sp.N_present, 1) + " people then. Type a number to fix the crowd instead."
      : (open ? "" : "One unit per ten people is the default the published runs used.");
    $("space-note").innerHTML = (open ? "Air volume " + f(sp.V, 0) + " m&sup3; (the air under the roof). " + (st.roofless ? "No roof: people are in full sun and no roof heat. " : "") +
        "The open-space air factors come from 3-D simulations of a 1.5 m &times; 4 m shelter, scaled by front area for other sizes."
      : "Air volume " + n0(sp.V) + " m&sup3;. The hall's air factors were fitted for 2&ndash;25&thinsp;% open; outside that range they are extrapolated.");
    var h = st.hourSrc;
    $("hour-src").innerHTML = h ? "Loaded: the hottest recorded hour at " + SITES[h.site] + ", " + dateOf(h.doy, h.hour) + " local time, held for three hours." : "Typed weather, held steady for three hours.";
    // what differs from the published case
    var p = stateFromPreset(preset), diff = [];
    SEASON_KEYS.concat(HOUR_KEYS).forEach(function (k) { if (keyOf(st, [k]) !== keyOf(p, [k])) diff.push(LABELS[k]); });
    $("preset-state").innerHTML = diff.length ? "<span class='mod'>Changed:</span> " + diff.join(", ") + "." : "As in the published run. Weather for stations 01&ndash;04: its hottest hour.";
  }

  /* ---------------- computing ---------------- */
  var HR = null, seasonKey = null, seasonTimer = null;
  function update(now) {
    try { computeHour(); } catch (e) { console.error(e); showError(e); return; }
    var k = keyOf(st, SEASON_KEYS);
    if (k !== seasonKey) {
      seasonKey = k;
      clearTimeout(seasonTimer);
      $("body5").setAttribute("aria-busy", "true");
      seasonTimer = setTimeout(function () { try { computeSeason(); } catch (e) { console.error(e); showError(e); } $("body5").removeAttribute("aria-busy"); }, now ? 30 : 200);
    }
    syncRail();
  }
  function showError(e) { $("body1").innerHTML = "<p class='say danger-t'>The model stopped on these inputs: " + String(e.message || e) + "</p>"; }

  function computeHour() {
    var sp = buildSpace(st);
    var wx = E.constantWeather(st.T, st.RH, st.U2, 3, st.sun, WIND_FROM[st.windSide]);
    var p = {}; for (var k in st.params) p[k] = st.params[k]; p.group = st.group;
    var base = E.baseTrack(sp, wx, p);
    var runs = st.devices.map(function (id) { var dev = E.device(id, sp); return { id: id, dev: dev, r: E.runDevice(base, dev, true) }; });
    var rows = runs.map(function (x) { return [x.id, x.r.summary]; });
    HR = { sp: sp, wx: wx, base: base, runs: runs, rows: rows, ch: E.choose(rows), b: base.hours[2] };
    render1(); render2(); render3(); render4();
  }

  /* ---------------- 01 air ---------------- */
  function render1() {
    var sp = HR.sp, b = HR.b, To = b.To, Wo = b.Wo, twb = E.Twb(To, Wo);
    $("eq1").innerHTML =
      eq("<var>Q</var><sub>t</sub> = &radic;( <var>Q</var><sub>wind</sub><sup>2</sup> + (<var>a</var><sub>d</sub> <var>Q</var><sub>dev</sub>)<sup>2</sup> )",
        "Air leaving the space each second. The wind's flushing flow and the device's own push add like the two sides of a right triangle; <var>a</var><sub>d</sub> is fitted from our air-flow simulations.") +
      eq("<var>V</var> d<var>T</var>/d<var>t</var> = <var>Q</var><sub>t</sub>(<var>T</var><sub>out</sub> &minus; <var>T</var>) + heat &minus; &phi; <var>Q</var><sub>t</sub>(<var>T</var><sub>out</sub> &minus; <var>T</var><sub>exit</sub>)",
        "One well-mixed box of air. Each hour it relaxes towards balance: outside air flows in, the roof, the sun and the crowd add heat, and the device's cooled air is a sink. &phi; is the share of the air at people that came from the device.") +
      eq("<var>T</var><sub>exit</sub> = <var>T</var><sub>out</sub> &minus; &epsilon;(<var>T</var><sub>out</sub> &minus; <var>T</var><sub>wb</sub>)",
        "An evaporative pad cools air towards its wet-bulb temperature; &epsilon; = " + f(pv("eps_pad"), 2) + ". Now <var>T</var><sub>wb</sub> = " + f(twb, 1) + " &deg;C, so the coldest a pad can make this air is " + f(To - pv("eps_pad") * (To - twb), 1) + " &deg;C.");
    var shape = sp.kind === "open" ? (sp.roofless ? "Open, no roof, " : "Open, roofed, ") + f(sp.D, 1) + " m deep &times; " + f(sp.span, 1) + " m long, " + f(sp.H, 1) + " m high"
      : "Hall " + f(sp.D, 0) + " &times; " + f(sp.span, 0) + " m, " + f(sp.H, 1) + " m high, " + f(sp.Omega * 100, 1) + "% of its walls open";
    var h = "<p class='ctx'>Outside <b>" + f(To, 1) + " &deg;C</b>, <b>" + f(E.RHof(To, Wo), 0) + "%</b> humidity, wind <b>" + f(b.U2, 1) + " m/s</b> at 2 m" + (st.sun ? ", sun out" : ", no sun") +
      ". " + shape + ", air volume " + n0(sp.V) + " m&sup3;. Shown: the third hour of steady weather, after the air has settled.</p>";
    h += "<div class='tbl-scroll'><table class='live'><thead><tr><th>Device</th><th>Device air<span class='unit'>m&sup3;/s</span></th><th>Air exchange <span class='nt'><var>Q</var><sub>t</sub></span><span class='unit'>m&sup3;/s</span></th><th>Air renewed<span class='unit'>every</span></th><th>Device air at people <span class='nt'>&phi;</span></th><th>Leaving device<span class='unit'>&deg;C</span></th><th>Air at people<span class='unit'>&deg;C</span></th><th>Humidity<span class='unit'>%</span></th><th>Air speed<span class='unit'>m/s</span></th></tr></thead><tbody>";
    h += "<tr class='none'><td>No device</td><td>&ndash;</td><td>" + f(b.Qt0, 2) + "</td><td>" + dur(sp.V / b.Qt0) + "</td><td>&ndash;</td><td>&ndash;</td><td>" + f(b.T0, 2) + "</td><td>" + f(E.RHof(b.T0, b.W0), 0) + "</td><td>" + f(b.v0, 2) + "</td></tr>";
    var lead = null;
    HR.runs.forEach(function (x) {
      var r = x.r.hours[2], s = x.r.summary, on = r.on;
      var exitT = (x.dev.kind === "jet" || (x.dev.kind === "ac" && sp.kind === "open")) && on ? f(To - r.dTex, 1) : "&ndash;";
      h += "<tr><td>" + devLabel(x.id) + (on ? "" : " <span class='pub'>off: hour not hot</span>") + "</td><td>" + (x.dev.kind === "mist" ? "&ndash;" : f(s.Qd, 2)) + "</td><td>" + f(r.Qt, 2) + "</td><td>" + dur(sp.V / r.Qt) +
        "</td><td>" + (on && x.dev.kind !== "fan" ? pct(r.phi, 0) : on ? pct(r.phi, 0) : "&ndash;") + "</td><td>" + exitT + "</td><td>" + f(r.T1, 2) + "</td><td>" + f(E.RHof(r.T1, r.W1), 0) + "</td><td>" + f(r.v1, 2) + "</td></tr>";
      if (on && x.dev.kind !== "fan" && (!lead || (b.T0 - r.T1) > (b.T0 - lead.r.hours[2].T1))) lead = x;
    });
    h += "</tbody></table></div>";
    var anyOn = HR.runs.some(function (x) { return x.r.hours[2].on; });
    var say;
    if (!anyOn) say = "This hour is not hot for a waiting person (without a device, <var>w</var> &le; " + f(pv("w_comfort"), 2) + "), so the model leaves every device off. Raise the temperature or humidity.";
    else {
      say = "Without a device the wind replaces the air here every <b>" + dur(sp.V / b.Qt0) + "</b>.";
      if (lead) {
        var r = lead.r.hours[2];
        say += " " + DEV[lead.id].s + " pushes <b>" + f(lead.r.summary.Qd, 2) + " m&sup3;/s</b>" + (r.dTex ? " of air " + f(r.dTex, 1) + " K colder than outside" : "") +
          ", but device air is only <b>" + pct(r.phi, 0) + "</b> of the air at people, so the air there falls from " + f(b.T0, 2) + " to <b class='g'>" + f(r.T1, 2) + " &deg;C</b> (" + f(b.T0 - r.T1, 2) + " K).";
      }
      var fan = HR.runs.filter(function (x) { return x.dev.kind === "fan" && x.r.hours[2].on; })[0];
      if (fan) say += " The fan cools no air: it raises the air speed at people from " + f(b.v0, 2) + " to <b>" + f(fan.r.hours[2].v1, 2) + " m/s</b>" + (fan.r.hours[2].T1 > b.T0 ? ", and its motor heat warms the air " + f(fan.r.hours[2].T1 - b.T0, 2) + " K" : "") + ".";
    }
    $("body1").innerHTML = h + "<p class='say'>" + say + "</p>";
  }

  /* ---------------- 02 body ---------------- */
  var CLS = {};
  function render2() {
    var b = HR.b, wc = pv("w_comfort"), g = st.group;
    var b0 = E.twoNodeBody(b.T0, b.W0, b.v0, b.Sabs, g, true);
    var lines = [{ id: "none", lab: "No device", body: b0 }];
    HR.runs.forEach(function (x, i) {
      var r = x.r.hours[2];
      CLS[x.id] = "d" + DEV_ORDER.indexOf(x.id);
      lines.push({ id: x.id, lab: DEV[x.id].s, body: E.twoNodeBody(r.T1, r.W1, r.v1, b.Sabs, g, true), on: r.on });
    });
    var need0 = E.need(b0, wc);
    $("eq2").innerHTML =
      eq("<var>w</var> = <var>E</var><sub>req</sub> / <var>E</var><sub>max</sub>",
        "<var>E</var><sub>req</sub>: heat the body must lose by sweating to stay in balance. <var>E</var><sub>max</sub>: the most sweat this air can evaporate. <var>w</var> is the share of sweating capacity in use; comfortable while <var>w</var> &le; " + f(wc, 2) + ".") +
      eq("need = max(0, <var>E</var><sub>req</sub> &minus; " + f(wc, 2) + " <var>E</var><sub>max</sub>)",
        "The heat the body cannot shed comfortably, in watts. Without a device now: max(0, " + f(b0.E_req, 0) + " &minus; " + f(wc, 2) + " &times; " + f(b0.E_max, 0) + ") = <b>" + f(need0, 0) + " W</b>.") +
      eq("danger: core still rising &gt; " + f(pv("tn_rate_crit"), 1) + " K/h at minute " + f(Math.max(pv("tn_t_exp"), pv("tn_t_bal")), 0) + ", or core &ge; " + f(pv("tn_Tcr_lim"), 0) + " &deg;C",
        "A two-node body (core and skin, Gagge's model) is stepped minute by minute through a " + f(pv("tn_t_exp"), 0) + "-minute wait from a neutral start. " + (g === "older" ? "Older adult: sweating cut by " + pct(pv("older_sweat_cut")) + "." : "Young adult; an older adult sweats " + pct(pv("older_sweat_cut")) + " less."));
    var h = "<figure class='fig'><svg class='plot' id='p2' role='img' aria-labelledby='p2t'><title id='p2t'>Core temperature during the wait, with and without each device</title></svg>" +
      "<figcaption>Core temperature (top) and skin temperature (bottom) of one person through the wait. Dashed: no device. A red line is a device under which the person ends in danger.</figcaption></figure>";
    h += "<div class='tbl-scroll'><table class='live'><thead><tr><th>Device</th><th>Skin, end<span class='unit'>&deg;C</span></th><th>Core, end<span class='unit'>&deg;C</span></th><th>Core rising<span class='unit'>K/h</span></th><th><span class='nt'><var>w</var></span></th><th>need<span class='unit'>W</span></th><th>Verdict</th><th>Feels</th></tr></thead><tbody>";
    lines.forEach(function (L) {
      var bd = L.body, n = E.need(bd, wc), dz = bd.danger;
      h += "<tr" + (L.id === "none" ? " class='none'" : "") + "><td>" + (L.id === "none" ? "No device" : devLabel(L.id)) + "</td><td>" + f(bd.T_sk, 2) + "</td><td>" + f(bd.T_cr, 2) + "</td><td>" + f(bd.rate_K_h, 2) +
        "</td><td>" + (bd.w > K.W_SHOW_MAX ? "&gt;" + f(K.W_SHOW_MAX, 0) : f(bd.w, 2)) + "</td><td>" + f(n, 0) + "</td><td class='" + (dz ? "bad" : "ok") + "'>" + (dz ? (bd.danger38 ? "danger: core 38" : "danger: still rising") : "safe") +
        "</td><td>" + E.tier(bd.w) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    var say = "Without a device, after " + f(pv("tn_t_exp"), 0) + " minutes the core is <b>" + f(b0.T_cr, 2) + " &deg;C</b> and " + (b0.rate_K_h > 0.005 ? "still rising " + f(b0.rate_K_h, 2) + " K/h" : "steady") + ": " +
      (b0.danger ? "<span class='danger-t'>danger</span>" : "safe") + ", and <var>w</var> = " + f(Math.min(b0.w, K.W_SHOW_MAX), 2) + " (" + E.tier(b0.w) + ").";
    var best = null;
    lines.slice(1).forEach(function (L) { if (!best || E.need(L.body, wc) < E.need(best.body, wc)) best = L; });
    if (best && best.on) {
      var nb = E.need(best.body, wc);
      say += " " + DEV[best.id].s + " lowers the need most, from " + f(need0, 0) + " W to <b class='g'>" + f(nb, 0) + " W</b>.";
    }
    var harm = lines.slice(1).filter(function (L) { return L.on && E.need(L.body, wc) > need0 + 0.5; });
    if (harm.length) say += " " + harm.map(function (L) { return DEV[L.id].s; }).join(", ") + " <b>raises</b> the need: air hotter than skin adds heat when it moves faster.";
    $("body2").innerHTML = h + "<p class='say'>" + say + "</p>";
    plotBody($("p2"), lines);
  }
  function plotBody(el, lines) {
    var W = Math.max(300, Math.floor(el.parentNode.getBoundingClientRect().width)), H = 330, L = 42, R = 56, T = 10, gap = 34, h1 = 170, h2 = H - T - gap - h1 - 22;
    el.setAttribute("viewBox", "0 0 " + W + " " + H); el.setAttribute("height", H);
    while (el.childNodes.length > 1) el.removeChild(el.lastChild);
    var tEnd = 60, x = function (t) { return L + (W - L - R) * t / tEnd; };
    var cmin = 36.6, cmax = 38.2, smin = 99, smax = 0;
    lines.forEach(function (Ln) { Ln.body.trace.forEach(function (p) { cmin = Math.min(cmin, p[1]); cmax = Math.max(cmax, p[1] + 0.05); smin = Math.min(smin, p[2]); smax = Math.max(smax, p[2]); }); });
    smin = Math.floor(smin * 2) / 2 - 0.25; smax = Math.ceil(smax * 2) / 2 + 0.25;
    var y1 = function (v) { return T + h1 * (cmax - v) / (cmax - cmin); }, top2 = T + h1 + gap, y2 = function (v) { return top2 + h2 * (smax - v) / (smax - smin); };
    function axisY(lo, hi, yf, stepv, label, x0) {
      for (var v = Math.ceil(lo / stepv) * stepv; v <= hi + 1e-9; v += stepv) { svg("line", { x1: L, x2: W - R, y1: yf(v), y2: yf(v), "class": "grid" }, el); svg("text", { x: L - 6, y: yf(v) + 4, "text-anchor": "end", "class": "t-s" }, el, v.toFixed(1)); }
      svg("text", { x: x0, y: yf(hi) - 0, "class": "t-s", "text-anchor": "start", dy: "-2" }, el, label);
    }
    axisY(cmin, cmax, y1, cmax - cmin > 1.6 ? 0.5 : 0.25, "core °C", L);
    axisY(smin, smax, y2, smax - smin > 4 ? 2 : 1, "skin °C", L);
    var lim = pv("tn_Tcr_lim");
    svg("line", { x1: L, x2: W - R, y1: y1(lim), y2: y1(lim), "class": "lim" }, el);
    svg("text", { x: W - R - 2, y: y1(lim) - 4, "text-anchor": "end", "class": "t-s lim-t" }, el, "38 °C limit");
    [0, 10, 20, 30, 40, 50, 60].forEach(function (t) { svg("text", { x: x(t), y: top2 + h2 + 16, "text-anchor": "middle", "class": "t-s" }, el, t === 60 ? "60 min" : String(t)); });
    svg("line", { x1: L, x2: W - R, y1: T + h1, y2: T + h1, "class": "ax" }, el);
    svg("line", { x1: L, x2: W - R, y1: top2 + h2, y2: top2 + h2, "class": "ax" }, el);
    var ends1 = [], ends2 = [];
    lines.forEach(function (Ln) {
      var cls = "ln " + (Ln.id === "none" ? "none" : (Ln.body.danger ? "dz" : CLS[Ln.id]));
      svg("polyline", { points: Ln.body.trace.map(function (p) { return x(p[0]).toFixed(1) + "," + y1(p[1]).toFixed(1); }).join(" "), "class": cls }, el);
      svg("polyline", { points: Ln.body.trace.map(function (p) { return x(p[0]).toFixed(1) + "," + y2(p[2]).toFixed(1); }).join(" "), "class": cls }, el);
      var e = Ln.body.trace[Ln.body.trace.length - 1];
      ends1.push({ y: y1(e[1]), t: Ln.id === "none" ? "none" : DEV[Ln.id].s, dz: Ln.body.danger });
      ends2.push({ y: y2(e[2]), t: Ln.id === "none" ? "none" : DEV[Ln.id].s, dz: Ln.body.danger });
    });
    [ends1, ends2].forEach(function (ends) {
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
      ends.forEach(function (e) { svg("text", { x: W - R + 6, y: e.y + 4, "class": e.dz ? "t-s lim-t" : "t-s" }, el, e.t); });
    });
  }

  /* ---------------- 03 efficiency ---------------- */
  function render3() {
    var sp = HR.sp, wc = pv("w_comfort"), Np = sp.N_present, pres = sp.present;
    $("eq3").innerHTML =
      eq("&eta;<sub>N</sub> = <var>N</var> &times; (need<sub>without</sub> &minus; need<sub>with</sub>) / <var>P</var>",
        "<var>N</var>: people the device serves (average present). need in watts per person (station 02). <var>P</var>: the device's electric power in watts. No units: watts of uncomfortable body heat removed per watt drawn.") +
      eq("an hour counts only if it is hot and the person is safe with the device",
        "Hot: without a device <var>w</var> &gt; " + f(wc, 2) + " during service hours. If the device leaves the person in danger, that hour counts as 0.");
    var Nt = pres < 1 ? f(Np, 2) + " &times; " + f(pres, 3) : n0(Np);
    var h = "<div class='fills'>";
    HR.runs.forEach(function (x) {
      var r = x.r.hours[2], P = x.r.summary.P_kW * 1000;
      h += "<p class='fill'><span class='who'>" + DEV[x.id].s + "</span> ";
      if (!r.on) h += "device off: this hour is not hot.";
      else if (!r.safe) h += "&eta;<sub>N</sub> counted as <b class='danger-t'>0</b>: the person ends in danger with it (need " + f(r.need0, 0) + " &rarr; " + f(r.need1, 0) + " W).";
      else h += "&eta;<sub>N</sub> = " + Nt + " &times; (" + f(r.need0, 1) + " &minus; " + f(r.need1, 1) + ") W &divide; " + n0(P) + " W = <b class='res" + (r.eta_N_h < 0 ? " neg" : "") + "'>" + f(r.eta_N_h, 3) + "</b>";
      h += "</p>";
    });
    h += "</div><figure class='fig'><svg class='plot' id='p3' role='img' aria-labelledby='p3t'><title id='p3t'>Efficiency of each device over the three steady hours</title></svg><figcaption>&eta;<sub>N</sub> over the three steady hours (the value station 04 uses). Bars left of zero (grey): the device makes the person's heat load worse.</figcaption></figure>";
    var ranked = HR.rows.slice().sort(function (a, b) { return b[1].eta_N - a[1].eta_N; });
    var say = ranked[0][1].hot > 0 ? "Ranked by &eta;<sub>N</sub>: " + ranked.map(function (r) { return DEV[r[0]].s + " " + f(r[1].eta_N, 3); }).join(", ") + ". Efficiency alone would pick <b>" + DEV[ranked[0][0]].s + "</b>; station 04 checks safety and comfort first."
      : "No hot hour, so there is nothing to score.";
    $("body3").innerHTML = h + "<p class='say'>" + say + "</p>";
    plotBars($("p3"), HR.rows.map(function (r) { return { t: DEV[r[0]].s, v: r[1].eta_N }; }));
  }
  function plotBars(el, items) {
    var W = Math.max(300, Math.floor(el.parentNode.getBoundingClientRect().width)), rowH = 26, H = items.length * rowH + 26, L = 48, R = 64;
    el.setAttribute("viewBox", "0 0 " + W + " " + H); el.setAttribute("height", H);
    while (el.childNodes.length > 1) el.removeChild(el.lastChild);
    var lo = Math.min(0, Math.min.apply(null, items.map(function (i) { return i.v; }))), hi = Math.max(0, Math.max.apply(null, items.map(function (i) { return i.v; })));
    if (hi - lo < 1e-9) hi = lo + 1;
    var x = function (v) { return L + (W - L - R) * (v - lo) / (hi - lo); };
    items.forEach(function (it, i) {
      var y = 6 + i * rowH;
      svg("text", { x: 0, y: y + 14, "class": "t-s" }, el, it.t);
      svg("rect", { x: Math.min(x(0), x(it.v)), y: y + 3, width: Math.max(1, Math.abs(x(it.v) - x(0))), height: rowH - 10, "class": "bar-h" + (it.v < 0 ? " neg" : "") }, el);
      svg("text", { x: it.v < 0 ? x(0) + 6 : x(it.v) + 6, y: y + 14, "class": "t-s" }, el, ft(it.v, 3));
    });
    svg("line", { x1: x(0), x2: x(0), y1: 2, y2: H - 18, "class": "ax" }, el);
  }

  /* ---------------- 04 decision ---------------- */
  function statusOf(id, row, ch) {
    if (!ch.choice) return ["no hot hours", "muted"];
    if (ch.rejected_unsafe.indexOf(id) >= 0) return ["rejected: not safe enough", "bad"];
    if (id === ch.choice) return ["chosen", "ok"];
    if (ch.rule === "efficiency") {
      if (ch.meets.indexOf(id) < 0) return ["below the comfort target", "muted"];
      if (ch.ties.indexOf(id) >= 0) return ["tied on efficiency, more energy", "muted"];
      return ["less efficient", "muted"];
    }
    if (ch.ties.indexOf(id) >= 0) return ["tied on comfort, less efficient", "muted"];
    return ["less comfortable", "muted"];
  }
  function decisionSentence(ch, rows, where) {
    var R = {}; rows.forEach(function (r) { R[r[0]] = r[1]; });
    if (!ch.choice) return "No " + where + " is hot for a waiting person (without a device <var>w</var> stays at or below " + f(pv("w_comfort"), 2) + "), so the rule switches nothing on.";
    var c = R[ch.choice], s = "<b>" + DEV[ch.choice].s + "</b> (" + DEV[ch.choice].name.toLowerCase() + ") is chosen. ";
    if (ch.rejected_unsafe.length) s += ch.rejected_unsafe.map(function (n) { return DEV[n].s + " is safe in only " + pct(R[n].safe_share, 0); }).join("; ") + " of hot hours, below the " + pct(K.SAFE_BAR, 0) + " bar, so " + (ch.rejected_unsafe.length > 1 ? "they are" : "it is") + " out. ";
    if (ch.fallback_to_safest) {
      var bestSafe = Math.max.apply(null, rows.map(function (r) { return r[1].safe_share; }));
      s = "<span class='danger-t'>No device keeps the person safe in " + pct(K.SAFE_BAR, 0) + " of hot hours</span> (the best manages " + pct(bestSafe, 0) + "). The rule keeps the safest and goes on, so the pick below is the least bad, not a safe answer. " + s;
    }
    if (ch.rule === "efficiency") {
      s += "It keeps people comfortable in " + pct(c.comfy_share, 0) + " of hot hours (target " + pct(K.TARGET_COMFORT, 0) + (ch.target_met_by_tie ? ", reached within the 1-point tie" : "") + ")";
      var others = ch.meets.filter(function (n) { return n !== ch.choice; });
      s += others.length ? " and has the highest &eta;<sub>N</sub> of those that do, " + f(c.eta_N, 3) + "." : ", the only safe device that does; &eta;<sub>N</sub> = " + f(c.eta_N, 3) + ".";
      var tied = ch.ties.filter(function (n) { return n !== ch.choice; });
      if (tied.length) s += " " + tied.map(function (n) { return DEV[n].s; }).join(", ") + " is within " + pct(K.TIE_ETA_REL, 0) + " on &eta;<sub>N</sub>, a tie, so the one using less energy is taken.";
      var better = rows.filter(function (r) { return r[1].eta_N > c.eta_N && ch.safe.indexOf(r[0]) >= 0 && ch.meets.indexOf(r[0]) < 0; });
      if (better.length) s += " " + better.map(function (r) { return DEV[r[0]].s + " scores higher (" + f(r[1].eta_N, 3) + ") but is comfortable in only " + pct(r[1].comfy_share, 0); }).join("; ") + ".";
    } else {
      s += "No " + (ch.fallback_to_safest ? "remaining" : "safe") + " device makes " + pct(K.TARGET_COMFORT, 0) + " of hot hours comfortable, so the most comfortable is taken: " + pct(c.comfy_share, 0) + " of hours";
      var tc = ch.ties.filter(function (n) { return n !== ch.choice; });
      s += tc.length ? ", tied within 1 point with " + tc.map(function (n) { return DEV[n].s; }).join(", ") + ", and the most efficient of them (&eta;<sub>N</sub> " + f(c.eta_N, 3) + ")." : ".";
    }
    return s;
  }
  function render4() {
    var ch = HR.ch, rows = HR.rows;
    $("eq4").innerHTML =
      eq("1. safe in &ge; " + pct(K.SAFE_BAR, 0) + " of hot hours", "A hard limit, not traded against anything. If no device reaches it, only the safest are kept.") +
      eq("2. comfortable (<var>w</var> &le; " + f(pv("w_comfort"), 2) + ") in &ge; " + pct(K.TARGET_COMFORT, 0) + " of hot hours", "Within 1 percentage point counts as reaching it. If none reaches it, the most comfortable safe device wins.") +
      eq("3. highest &eta;<sub>N</sub>", "Within " + pct(K.TIE_ETA_REL, 0) + " of the best counts as a tie, and the one using less energy is taken.");
    var h = "<p class='ctx'>Applied to the three steady hours of station 01: safety from station 02's danger test, comfort from <var>w</var> after the device, efficiency from station 03. Station 05 applies the same rule to a whole summer.</p>";
    h += decisionTable(rows, ch, null);
    h += chosenBlock(ch, "hour");
    // guidance layer: the fan cap
    var cap = M.fan_cap.cap_C, txt;
    if (ch.choice === "A" && st.T >= cap) {
      var rest = rows.filter(function (r) { return r[0] !== "A"; }), ch2 = rest.length ? E.choose(rest) : null;
      txt = "<b>Guidance layer: fan cap.</b> At " + f(st.T, 1) + " &deg;C a fan alone is not used in public venues (cap " + f(cap, 0) + " &deg;C, the lowest of the published limits, " + f(M.fan_cap.by_group["healthy young adults"], 0) + " / " + f(M.fan_cap.by_group["healthy older adults"], 0) + " / " + f(cap, 0) + " &deg;C for young, older, and older adults on some medicines). " +
        (ch2 && ch2.choice ? "Run without the fan, the same rule picks <b>" + DEV[ch2.choice].s + "</b>." : "No other device is in the comparison.");
      h += "<p class='capnote on'>" + txt + "</p>";
    } else h += "<p class='capnote'>Guidance layer: a fan alone is not used where the air is at or above " + f(cap, 0) + " &deg;C. Not triggered here.</p>";
    $("body4").innerHTML = h;
  }
  function decisionTable(rows, ch, pub) {
    var h = "<div class='tbl-scroll'><table class='live'><thead><tr><th>Device</th><th>Hot hours</th><th>Safe<span class='unit'>share</span></th><th>Comfortable<span class='unit'>share</span></th><th><span class='nt'>&eta;<sub>N</sub></span></th><th>Energy<span class='unit'>kWh</span></th>" + (pub ? "<th>Water<span class='unit'>L</span></th>" : "") + "<th>Result</th></tr></thead><tbody>";
    rows.forEach(function (r) {
      var id = r[0], s = r[1], stt = statusOf(id, s, ch), p = pub && pub[id];
      var cell = function (v, txt, key, rel) {
        if (!p || p[key] == null) return txt;
        var same = rel ? Math.abs(v - p[key]) <= 1e-6 * Math.max(Math.abs(p[key]), 1e-6) : Math.abs(v - p[key]) <= 1e-6;
        return txt + "<span class='pub" + (same ? " same" : "") + "' title='published value'>" + (same ? "published" : "published " + (key === "eta_N" ? f(p[key], 3) : key === "E_kWh" ? n0(p[key]) : pct(p[key], 1))) + "</span>";
      };
      h += "<tr class='" + (id === ch.choice ? "pick" : "") + "'><td>" + devLabel(id) + "</td><td>" + n0(s.hot) + "</td><td class='" + (s.safe_share < K.SAFE_BAR - 1e-9 ? "bad" : "") + "'>" + cell(s.safe_share, pct(s.safe_share, 1), "safe_share") +
        "</td><td>" + cell(s.comfy_share, pct(s.comfy_share, 1), "comfy_share") + "</td><td>" + cell(s.eta_N, f(s.eta_N, 3), "eta_N", true) + "</td><td>" + cell(s.E_kWh, s.E_kWh < 100 ? f(s.E_kWh, 1) : n0(s.E_kWh), "E_kWh", true) + "</td>" +
        (pub ? "<td>" + n0(s.water_L) + "</td>" : "") + "<td class='" + stt[1] + "'>" + stt[0] + "</td></tr>";
    });
    return h + "</tbody></table></div>";
  }
  function chosenBlock(ch, where, extra) {
    return "<div class='chosen'><span class='lab'>Chosen</span><span class='big" + (ch.choice ? "" : " none") + "'>" + (ch.choice ? DEV[ch.choice].s + " &middot; " + DEV[ch.choice].name : "nothing needed") + "</span>" + (extra || "") + "</div>" +
      "<p class='say'>" + decisionSentence(ch, where === "hour" ? HR.rows : SR.rows, where === "hour" ? "hour" : "hour of this summer") + "</p>";
  }

  /* ---------------- 05 summer ---------------- */
  var SR = null;
  function computeSeason() {
    var t0 = performance.now();
    var sp = buildSpace(st), wx = E.siteWeather(WXD[st.site]);
    var p = {}; for (var k in st.params) p[k] = st.params[k]; p.group = st.group;
    var base = E.baseTrack(sp, wx, p);
    var rows = st.devices.map(function (id) { return [id, E.runDevice(base, E.device(id, sp), false).summary]; });
    var ch = E.choose(rows), ms = performance.now() - t0;
    SR = { sp: sp, wx: wx, base: base, rows: rows, ch: ch, ms: ms };
    render5();
  }
  function render5() {
    var b = SR.base, nh = b.hours.length, hot = 0, d0 = 0;
    b.hours.forEach(function (h) { if (h.hot) { hot++; if (h.b0.danger) d0++; } });
    $("eq5").innerHTML =
      eq("share = (hours that pass) / (hot hours)", "Every recorded hour is marched in order, so the air carries over from one hour to the next. Devices run only in hot service hours (" + f(pv("service_start"), 0) + ":00&ndash;" + f(pv("service_end"), 0) + ":00).") +
      eq("&eta;<sub>N</sub> = &Sigma; <var>N</var> &Delta;need / &Sigma; <var>P</var>", "Summed over the summer's hot hours: total uncomfortable heat removed over total electricity used.");
    var pubOK = isPublished(st) && st.site === preset.site;
    var pub = pubOK ? preset.published : null;
    var h = "<p class='ctx'>" + SITES[st.site] + ", " + n0(nh) + " recorded hours from " + dateOf(SR.wx[0].doy) + " to " + dateOf(SR.wx[nh - 1].doy) + ". <b>" + n0(hot) + "</b> are hot for a waiting person" +
      (hot ? "; without a device, " + n0(d0) + " of them (" + pct(d0 / hot, 1) + ") end in danger." : ".") + "</p>";
    h += "<figure class='fig'><svg class='plot' id='p5' role='img' aria-labelledby='p5t'><title id='p5t'>Hot hours per day and daily maximum temperature, June to August 2024</title></svg><figcaption>Top: the day's highest air temperature. Bottom: hot hours per day; red, the part in which a person without a device ends in danger.</figcaption></figure>";
    h += decisionTable(SR.rows, SR.ch, pub);
    var mark = pubOK && preset.published_choice ? (SR.ch.choice === preset.published_choice ? "<span class='mark'>same as published</span>" : "<span class='pub'>published: " + DEV[preset.published_choice].s + "</span>") : "";
    h += chosenBlock(SR.ch, "season", mark);
    var vals = [];
    if (pub) Object.keys(pub).forEach(function (d) { var row = SR.rows.filter(function (r) { return r[0] === d; })[0]; if (row) Object.keys(pub[d]).forEach(function (k) { vals.push(Math.abs(row[1][k] - pub[d][k]) / Math.max(Math.abs(pub[d][k]), 1e-9)); }); });
    h += "<p class='timing'>" + n0(nh) + " hours &times; " + SR.rows.length + " device" + (SR.rows.length > 1 ? "s" : "") + " computed in this browser in " + f(SR.ms, 0) + " ms." +
      (pub ? " These settings are the published case: " + (vals.length ? "the published values marked above are reproduced (largest relative difference " + (Math.max.apply(null, vals) === 0 ? "0" : sci(Math.max.apply(null, vals))) + ")." : "") :
        " Not a published case; &ldquo;Reset to published case&rdquo; brings one back for comparison.") + "</p>";
    var vk = { "r3-phoenix": "Phoenix", "r3-kona": "Kona", "r3-losangeles": "LosAngeles", "r3-newyork": "NewYork" }[preset.id];
    if (vk && M.r4 && M.r4.venues[vk]) {
      var t = M.r4.venues[vk].table;
      h += "<details class='pubd'><summary>Requirement 4 extension devices at this venue (published, not recomputed here)</summary><p>These devices were run by the team's full model in Requirement 4. They are not in this page's engine, so their numbers are the stored published ones.</p><div class='tbl-scroll'><table class='live'><thead><tr><th>Option</th><th>Safe</th><th>Comfortable</th><th><span class='nt'>&eta;<sub>N</sub></span></th><th>Energy<span class='unit'>kWh</span></th><th>Status</th></tr></thead><tbody>";
      t.forEach(function (r) { h += "<tr><td>" + r.option + "</td><td>" + pct(r.safe_share, 1) + "</td><td>" + pct(r.comfy_share, 1) + "</td><td>" + f(r.eta_N, 3) + "</td><td>" + n0(r.kWh) + "</td><td>" + String(r.status).replace(/_/g, " ") + "</td></tr>"; });
      h += "</tbody></table></div></details>";
    }
    $("body5").innerHTML = h;
    plotSeason($("p5"));
  }
  function plotSeason(el) {
    var W = Math.max(300, Math.floor(el.parentNode.getBoundingClientRect().width)), H = 230, L = 34, R = 10, T = 12, h1 = 82, gap = 22, h2 = 80;
    el.setAttribute("viewBox", "0 0 " + W + " " + H); el.setAttribute("height", H);
    while (el.childNodes.length > 1) el.removeChild(el.lastChild);
    var days = {}, order = [];
    SR.base.hours.forEach(function (h, i) {
      var d = SR.wx[i].doy;
      if (!days[d]) { days[d] = { tmax: -99, hot: 0, dz: 0 }; order.push(d); }
      var D = days[d]; D.tmax = Math.max(D.tmax, h.To); if (h.hot) { D.hot++; if (h.b0.danger) D.dz++; }
    });
    var n = order.length, bw = (W - L - R) / n, tmin = 99, tmax = -99;
    order.forEach(function (d) { tmin = Math.min(tmin, days[d].tmax); tmax = Math.max(tmax, days[d].tmax); });
    tmin = Math.floor(tmin / 5) * 5; tmax = Math.ceil(tmax / 5) * 5; if (tmax - tmin < 10) tmax = tmin + 10;
    var y1 = function (v) { return T + h1 * (tmax - v) / (tmax - tmin); }, top2 = T + h1 + gap, hmax = 16, y2 = function (v) { return top2 + h2 * (1 - v / hmax); };
    [tmin, (tmin + tmax) / 2, tmax].forEach(function (v) { svg("line", { x1: L, x2: W - R, y1: y1(v), y2: y1(v), "class": "grid" }, el); svg("text", { x: L - 4, y: y1(v) + 4, "text-anchor": "end", "class": "t-s" }, el, String(v)); });
    svg("text", { x: L, y: T - 2, "class": "t-s" }, el, "daily max °C");
    svg("polyline", { points: order.map(function (d, i) { return (L + (i + 0.5) * bw).toFixed(1) + "," + y1(days[d].tmax).toFixed(1); }).join(" "), "class": "ln d0" }, el);
    [0, 8, 16].forEach(function (v) { svg("line", { x1: L, x2: W - R, y1: y2(v), y2: y2(v), "class": "grid" }, el); svg("text", { x: L - 4, y: y2(v) + 4, "text-anchor": "end", "class": "t-s" }, el, String(v)); });
    svg("text", { x: L, y: top2 - 4, "class": "t-s" }, el, "hot hours per day");
    order.forEach(function (d, i) {
      var D = days[d], x = L + i * bw + 0.5, w = Math.max(1, bw - 1);
      if (D.hot) svg("rect", { x: x, y: y2(D.hot), width: w, height: y2(0) - y2(D.hot), "class": "bar hot" }, el);
      if (D.dz) svg("rect", { x: x, y: y2(D.dz), width: w, height: y2(0) - y2(D.dz), "class": "f-signal" }, el);
    });
    svg("line", { x1: L, x2: W - R, y1: y2(0), y2: y2(0), "class": "ax" }, el);
    order.forEach(function (d, i) {
      var dt = new Date(Date.UTC(2024, 0, d));
      if (dt.getUTCDate() === 1 && L + i * bw + 26 < W - R) { var x = L + i * bw; svg("line", { x1: x, x2: x, y1: y2(0), y2: y2(0) + 5, "class": "ax" }, el); svg("text", { x: x + 3, y: y2(0) + 16, "class": "t-s" }, el, MONTHS[dt.getUTCMonth()]); }
    });
  }

  /* ---------------- validation line ---------------- */
  if (VAL) {
    var mx = 0;
    Object.keys(VAL.point_max).forEach(function (k) { mx = Math.max(mx, VAL.point_max[k]); });
    Object.keys(VAL.season_max).forEach(function (k) { mx = Math.max(mx, VAL.season_max[k]); });
    checkLine.innerHTML = "<b>Checked against the full model</b>: " + VAL.points + " one-hour cases (3 devices, 2 spaces, 7 weathers, young and older people) and " + VAL.season_values + " published summer values at " + VAL.season_presets + " places; largest difference " + sci(mx) + " (rounding), and the same choice at " + VAL.season_choices_same + " of " + VAL.season_choices + " venues" +
      (VAL.choose_cases ? ". The decision rule gives the same answer in " + VAL.choose_same + " of " + VAL.choose_cases + " random cases built to force ties." : ".") + (VAL.passed ? "" : " <span class='danger-t'>The last check did not pass.</span>");
  } else checkLine.textContent = "The check against the full model has not been run for this version.";

  var rz = null;
  window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (HR) { render2(); render3(); } if (SR) plotSeason($("p5")); }, 150); });
  // on a phone the rail sits above the stations: keep only the case open there, the rest folds
  if (window.matchMedia && window.matchMedia("(max-width: 640px)").matches) document.querySelectorAll("details.grp").forEach(function (d, i) { if (i > 0) d.open = false; });
  syncRail();
  update(true);
})();
