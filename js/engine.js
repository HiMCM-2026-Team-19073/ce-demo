/* The team's box model and two-node body, ported line by line from the Python model (r2/common.py, r2/sources.py,
   r2/box.py, r2/tool.py). Every number it returns is computed here from the exported parameters and fitted closures;
   nothing is looked up. Scalar version of box.simulate for one space and one device at a time, default switches only
   (level aim, run on hot hours, no occupancy sensor, motor heat on, real moisture, the 3-D oblique "f3" route for the
   open space). Works in a browser (window.Engine) and in node (module.exports) for the validation run. */
(function (root) {
  "use strict";

  function makeEngine(MODEL) {
    var PV = MODEL.params, K = MODEL.consts, CL = MODEL.closures;
    function pv(n) { var v = PV[n]; if (v === undefined) throw new Error("unknown parameter " + n); return v; }
    var RHO = K.RHO, CP = K.CP, LV = K.LV, GRAV = K.G, PATM = K.P_ATM, EFL = K.E_FLOOR_KPA, SBC = K.SBC, KMM = K.KPA_MMHG, LAG = K.TN_RATE_LAG;
    var exp = Math.exp, log = Math.log, sqrt = Math.sqrt, max = Math.max, min = Math.min, abs = Math.abs, pow = Math.pow, PI = Math.PI;
    var F3_ANGLES = [0, 45, 90, 135, 180];

    function interp(x, xp, fp) {
      if (x <= xp[0]) return fp[0];
      var n = xp.length;
      if (x >= xp[n - 1]) return fp[n - 1];
      for (var i = 1; i < n; i++) if (x <= xp[i]) return fp[i - 1] + (fp[i] - fp[i - 1]) * (x - xp[i - 1]) / (xp[i] - xp[i - 1]);
      return fp[n - 1];
    }
    function clip(x, a, b) { return x < a ? a : x > b ? b : x; }

    /* ---------- moist air (common.py) ---------- */
    function psat(T) { return 0.61094 * exp(17.625 * T / (T + 243.04)); }
    function Wsat(T) { var ps = psat(T); return 0.622 * ps / (PATM - ps); }
    function WfromRH(T, RH) { var p = RH / 100 * psat(T); return 0.622 * p / (PATM - p); }
    function pFromW(W) { return W * PATM / (0.622 + W); }
    function enth(T, W) { return CP * T + W * (2.501e6 + 1860 * T); }
    function Twb(T, W) {
      var h = enth(T, W), Tw = T - 5;
      for (var i = 0; i < 12; i++) {
        var Ws = 0.622 * psat(Tw) / (PATM - psat(Tw));
        var f = enth(Tw, Ws) - h;
        var Ws2 = 0.622 * psat(Tw + 0.01) / (PATM - psat(Tw + 0.01));
        var df = (enth(Tw + 0.01, Ws2) - enth(Tw, Ws)) / 0.01;
        Tw = Tw - f / df;
      }
      return Tw;
    }
    function RHof(T, W) { return 100 * pFromW(W) / psat(T); }
    function saturate(T, W) {
      if (W > Wsat(min(T, 90))) { var tw = Twb(T, W); return [tw, Wsat(tw)]; }
      return [T, W];
    }
    function coolerExit(Tin, Win, eps) {
      var tw = Twb(Tin, Win), Te = Tin - eps * (Tin - tw), h = enth(Tin, Win);
      return [Te, (h - CP * Te) / (2.501e6 + 1860 * Te), tw];
    }
    function indirectExit(Tin, Win, eps) {
      var tw = Twb(Tin, Win);
      return [Tin - eps * (Tin - tw), Win, tw];
    }
    function acExit(Tin, Win, Qc, Q, Tcoil) {
      var he = enth(Tin, Win) - Qc * 1000 / (RHO * Q);
      var Tdry = Tin - Qc * 1000 / (RHO * CP * Q);
      var Ws = 0.622 * psat(Tdry) / (PATM - psat(Tdry));
      var lo = Tdry, hi = Tin;
      for (var i = 0; i < 40; i++) {
        var mid = 0.5 * (lo + hi), hs = enth(mid, 0.622 * psat(mid) / (PATM - psat(mid)));
        if (hs > he) hi = mid; else lo = mid;
      }
      var Tw = 0.5 * (lo + hi), Wwet = 0.622 * psat(Tw) / (PATM - psat(Tw)), dry = Win <= Ws;
      var Te = max(dry ? Tdry : Tw, min(Tcoil, Tin));
      return [Te, min(dry ? Win : min(Wwet, Win), Wsat(Te))];
    }

    /* ---------- wind (common.py) ---------- */
    function windAt(z, U10) {
      var z0s = pv("z0_site"), z0m = pv("z0_met"), zb = pv("z_blend");
      var Ub = U10 * log(zb / z0m) / log(10 / z0m);
      return Ub * log(max(z, 1.01 * z0s) / z0s) / log(zb / z0s);
    }

    /* ---------- devices (common.py) ---------- */
    function fanFromPower(P, A) {
      var eta = pv("eta_w2a"), U = pow(eta * P * 1000 / (2 * RHO * A), 1 / 3);
      return { kind: "fan", P_kW: P, A: A, U: U, U_wake: 2 * U, Q: A * U, T: 2 * RHO * A * U * U };
    }
    function coolerFromPower(P, A, dp, eps, q) {
      var Q = q * P, U = Q / A;
      return { kind: "jet", P_kW: P, A: A, U: U, Q: Q, T: RHO * Q * U, eps: eps, eta_w2a: Q * (dp + 0.5 * RHO * U * U) / (P * 1000), dp_pad: dp, q_kW: q };
    }
    function device(name, space) {
      if (name === "A") return fanFromPower(pv("P_A"), pv("A_fan"));
      if (name === "B" || name === "C") return coolerFromPower(pv("P_" + name), pv("A_" + name), pv("dp_pad"), pv("eps_pad"), pv("q_kW_" + name));
      if (name === "IEC") { var d = coolerFromPower(pv("P_IEC"), pv("A_IEC"), pv("dp_iec"), pv("eps_iec"), pv("q_kW_IEC")); d.indirect = true; return d; }
      if (name === "AC") {
        var Q = pv("ac_Q");
        return { kind: "ac", Qc_kW: pv("ac_Qc"), P_kW: pv("ac_P"), Q: Q, A: 0.1, U: Q / 0.1, T: RHO * Q * Q / 0.1, eps: 0, Tmax: pv("ac_Tmax"),
          r_local: pv("ac_r_local"), slope: pv("ac_cop_slope"), P_heat_kW: 0 };
      }
      if (name === "Mist") {
        var area = space.D * space.span, n = space.n_dev || 1, Lh = pv("mist_Lh_m2") * area;
        return { kind: "mist", m_w: Lh / 3600 / n, f_e: pv("f_evap"), P_kW: pv("mist_W_m2") * area / 1000 / n, Q: 0, U: 0, T: 0, A: 1, area: area };
      }
      throw new Error("unknown device " + name);
    }

    /* ---------- spaces (box.py) ---------- */
    function shelterSpace(o) {
      o = o || {};
      var D = o.D != null ? o.D : 1.5, H = o.H != null ? o.H : 2.5, span = o.span != null ? o.span : 4.0;
      var cEnd = o.c_end != null ? o.c_end : pv("c_end"), lam = o.lam != null ? o.lam : pv("lambda_arr"), hw = o.headway != null ? o.headway : pv("headway");
      var x = lam * hw, present = 1 - (1 - exp(-x)) / x, Nm = x / 2;
      return { kind: "open", D: D, H: H, span: span, V: D * 1.7 * span, front_az: (o.front_az_deg || 0) * PI / 180, c_end: cEnd,
        N_present: Nm / present, present: present, f_svv: 0.3, Omega: 1, wind_fixed: false };
    }
    function hallSpace(Omega, o) {
      o = o || {};
      var D = o.D != null ? o.D : 8, H = o.H != null ? o.H : 4, span = o.span != null ? o.span : 20;
      return { kind: "hall", D: D, H: H, span: span, V: D * H * span, Omega: Omega, N_present: o.N != null ? o.N : 40, present: 1, f_svv: 0.3 * Omega,
        n_dev: o.n_dev != null ? o.n_dev : 4, intake: "out", wind_fixed: true, A_wall: 2 * H * span, split: 0.5, theta: 0, front_az: 0 };
    }

    function devType(space, dev) {
      if (space.kind === "open") { if (dev.kind === "ac") return "ac"; return dev.kind === "fan" ? "fan" : "jet"; }
      if (dev.kind === "fan") return "fan";
      if (dev.kind === "ac") return "ac_in";
      return "jet_" + space.intake;
    }
    function cpRatio(a0) {
      var G = pv("cp_G"), a = abs(((a0 + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI), s = Math.sin, c = Math.cos;
      return log(1.248 - 0.703 * s(a / 2) - 1.175 * pow(s(a), 2) - 0.131 * pow(s(2 * a * G), 3) + 0.769 * c(a / 2) + 0.071 * G * G * pow(s(a / 2), 2) + 0.717 * pow(c(a / 2), 2));
    }
    function directionFactor(th) { return abs(cpRatio(th) - cpRatio(th + PI)) / abs(cpRatio(0) - cpRatio(PI)); }
    function sEff(space, th) { var s = space.split != null ? space.split : 0.5, cs = Math.cos(th); return s * (1 + cs) / 2 + (1 - s) * (1 - cs) / 2; }
    function dirMult(space, th, name) {
      var t = CL.hall && CL.hall.dir;
      if (!t || space.kind !== "hall") return 1;
      return interp(sEff(space, th), t.s, t[name]);
    }
    function cosInterp(xp, xm, ca, o) { return ca * (o > 0 ? xp : xm) + (1 - ca) * 0.5 * (xp + xm); }
    function thetaDeg(ca, o) { return Math.acos(clip((o > 0 ? 1 : -1) * ca, -1, 1)) * 180 / PI; }
    function f3i(name, ca, o, dev) { var t = CL.open3d.f3.main; return interp(thetaDeg(ca, o), F3_ANGLES, dev ? t[dev][name] : t[name]); }
    function cosAbs(Up, Ut) { return min(Up / max(Ut, 1e-9), 1); }
    function phi3d(t, Qd, H, span, U, ca, o) {
      var q = Qd / (H * span), size = pow(q / t.q_ref, t.g_size);
      var em = t.e_m * pow(clip(U, 1, 3), -t.m_wind) * size, ep = t.e_p * size, e = cosInterp(ep, em, ca, o);
      return q / (q + e);
    }
    function phiF3(t, nodes, Qd, H, span, U, ca, o) {
      var q = Qd / (H * span), size = pow(q / t.q_ref, t.g_size), wf = pow(clip(U, 1, 3), -t.m_wind), th = thetaDeg(ca, o);
      var base = interp(th, F3_ANGLES, nodes), w180 = interp(th, F3_ANGLES, [0, 0, 0, 0, 1]);
      var e = (base + w180 * nodes[4] * (wf - 1)) * size;
      return q / (q + e);
    }
    function roofRatioField(H) { var z0 = pv("z0_site"); return log((H + z0) / z0) / log((2 + z0) / z0); }

    function windFlow(space, Up, Upar, o, theta, rH) {
      var H = space.H, span = space.span;
      if (space.kind === "open") {
        var U = sqrt(Up * Up + Upar * Upar);
        return f3i("a_o", cosAbs(Up, U), o) * U * H * span;
      }
      var Cd = pv("Cd"), dCp = CL.hall.dCp, c1 = pv("c_single"), Ao = 2 * space.Omega * H * span, sh = space.split != null ? space.split : 0.5;
      var Aw = sh * Ao, Al = (1 - sh) * Ao, Aeff = Aw * Al / max(sqrt(Aw * Aw + Al * Al), 1e-12);
      var r = CL.hall.dCp_ref === "roof" ? (rH == null ? roofRatioField(H) : rH) : 1;
      var Qor = Cd * Aeff * Up * r * sqrt(dCp * directionFactor(theta));
      var Qmax = CL.hall.a_o * Up * H * span;
      var Qs = 1 / sqrt(1 / pow(max(Qor, 1e-9), 2) + 1 / pow(max(Qmax, 1e-9), 2));
      return dirMult(space, theta, "m_Q") * sqrt(Qs * Qs + pow(c1 * Ao * Up, 2));
    }
    function stackFlow(space, dT, T) {
      var H = space.H;
      return (2 / 3) * pv("Cd") * space.Omega * H * space.span * sqrt(GRAV * abs(dT) / (T + 273.15) * H);
    }
    function deviceFlow(space, dev) {
      var n = space.n_dev || 1, Q = dev.Q * n;
      if (space.kind !== "hall" || dev.kind === "fan" || dev.kind === "ac" || dev.kind === "mist" || space.intake !== "out") return Q;
      var Cd = pv("Cd"), Ao = space.Omega * 2 * space.H * space.span;
      var Pa = (dev.eta_w2a != null ? dev.eta_w2a : pv("eta_w2a")) * dev.P_kW * 1000 * n, q = Q, dp = dev.dp_pad != null ? dev.dp_pad : pv("dp_pad");
      for (var i = 0; i < 40; i++) {
        var back = 0.5 * RHO * pow(q / (Cd * Ao), 2);
        q = 0.6 * q + 0.4 * Pa / (dp + 0.5 * RHO * pow(q / (dev.A * n), 2) + back);
      }
      return q;
    }
    /* total exchange Qt, device air share at people phi, air speed at people v */
    function closures(space, dev, kindKey, Qw, Up, o, theta, Ut) {
      var n = space.n_dev || 1, H = space.H, span = space.span, open3 = space.kind === "open" ? CL.open3d : null;
      var ca = cosAbs(Up, Ut), Qt, phi, J = 0, aj = null;
      if (!dev || dev.kind === "mist") { Qt = Qw; phi = 0; dev = null; }
      else {
        var Qd = deviceFlow(space, dev);
        J = (Qd / span) * dev.U * (Qd / (dev.Q * n));
        if (open3 && open3.dev[kindKey]) {
          var t3 = open3.dev[kindKey];
          if (open3.f3.main[kindKey]) {
            phi = phiF3(t3, open3.f3.main[kindKey].e, Qd, H, span, Ut, ca, o);
            Qt = sqrt(Qw * Qw + pow(f3i("a_d", ca, o, kindKey) * Qd, 2));
            aj = f3i("a_j", ca, o, kindKey);
          } else {
            phi = phi3d(t3, Qd, H, span, Ut, ca, o);
            Qt = sqrt(Qw * Qw + pow(cosInterp(t3.a_d_p, t3.a_d_m, ca, o) * Qd, 2));
            aj = cosInterp(t3.a_j_p, t3.a_j_m, ca, o);
          }
        } else {
          var t = CL[space.kind].dev[kindKey];
          var pick = function (nm) { return (nm + "_p") in t ? (o > 0 ? t[nm + "_p"] : t[nm + "_m"]) : t[nm]; };
          var X = Qw / max(Qd, 1e-9);
          phi = pick("phi0") / (1 + pick("b") * dirMult(space, theta, "m_b") * X);
          Qt = sqrt(Qw * Qw + pow(pick("a_d") * Qd, 2));
          aj = pick("a_j");
        }
      }
      var v2;
      if (open3) v2 = open3.cap_v * open3.cap_v + pow(f3i("a_w", ca, o) * Ut, 2);
      else {
        var aw = CL.hall.a_w * (1 - exp(-space.Omega / CL.hall.om_v));
        v2 = K.CAP_V * K.CAP_V + pow(aw * dirMult(space, theta, "m_v") * Up * abs(Math.cos(theta)), 2);
      }
      if (dev) v2 += aj * J / H;
      return { Qt: Qt, phi: phi, v: sqrt(v2) };
    }

    /* ---------- sources (sources.py) ---------- */
    function roofBalance(G, To, U, alpha) {
      var hb = pv("h_roof_bot"), ht = 5.7 + 3.8 * max(U, 0), dT = alpha * G / (ht + hb);
      return [To + dT, hb * dT];
    }
    function roofConductance(U) { var hb = pv("h_roof_bot"), ht = 5.7 + 3.8 * max(U, 0); return ht * hb / (ht + hb); }
    function absorbedRadiation(Ih, Idir, Idiff, fsun, fsvv, Troof, Tair, Froof, asw) {
      var sw = pv("f_eff") * (0.5 * fsvv * Idiff + 0.5 * Ih * pv("rho_ground") + pv("fp") * fsun * Idir);
      return asw * sw + pv("h_r") * Froof * (Troof - Tair);
    }
    function hConv(v) { return max(pv("hc_nat"), pv("hc_a") * pow(max(v, 1e-3), pv("hc_b"))); }
    function crowdConductance(N, v) { return N * pv("A_body") / (1 / (hConv(v) + pv("h_r")) + pv("R_cl")); }
    function sunFraction(space, h) {
      if (space.kind !== "open") return 0;
      if (space.roofless) return h.sin_alt > 0.05 ? 1 : 0;
      var rel = h.sun_az - space.front_az, tanAlt = Math.tan(Math.asin(clip(h.sin_alt, 1e-3, 0.999))), frac = 0;
      var reach = (space.H - 1.1) / tanAlt * max(Math.cos(rel), 0);
      [0.25, 0.5, 0.75].forEach(function (d) { if (reach > d * space.D && h.sin_alt > 0.05) frac += 1 / 3; });
      return frac;
    }

    /* ---------- the body (common.py) ---------- */
    function bodyFixed(T, W, v, S) {
      var A = pv("A_body"), Rcl = pv("R_cl"), hc = hConv(v), h = hc + pv("h_r");
      var C = (pv("T_skin") - T) * A / (1 / h + Rcl), Rsun = S * A / (1 + h * Rcl);
      var he = pv("LR") * hc, Re = Rcl / (pv("LR") * pv("i_cl"));
      var gap = psat(pv("T_skin")) - pFromW(W);
      var EmaxAir = max(gap, EFL) * A / (1 / he + Re), Esw = pv("SW_max") * A, Emax = min(EmaxAir, Esw);
      var Ereq = pv("M") * A + Rsun - C;
      return { w: max(Ereq, 0) / Emax, E_req: Ereq, E_max: Emax, E_max_air: EmaxAir, E_sw: Esw, C: C, R_sun: Rsun };
    }
    function psatMm(T) { return exp(18.6686 - 4030.183 / (T + 235)); }

    /* Gagge two-node loop (common.two_node), scalar. trace: record core and skin each minute. */
    function twoNode(T, pa, v, S, o) {
      var M = o.M, clo = o.clo, A = o.A, mass = 70, hc = o.hc, csw = o.c_sw, cap = o.sw_cap_g;
      var met = M / 58.2, air = max(v, 0.1);
      var wmax = clo > 0 ? 0.59 * pow(air, -0.08) : 0.38 * pow(air, -0.29);
      var rclo = 0.155 * clo, fa = 1 + 0.15 * clo, lr = 2.2, icl = clo > 0 ? o.i_cl : 1, rm = M, m = rm;
      var tsk = o.Tsk0, tcr = o.Tcr0, mbl = 6.3, eskin = 0.1 * met, alfa = 0.1, tbn = 0.1 * 33.7 + 0.9 * 36.8;
      var hr = 4.7, ht = hr + hc, ra = 1 / (fa * ht), tr = T, top = (hr * tr + hc * T) / ht;
      var qres = 0.0023 * rm * (44 - pa), cres = 0.0014 * rm * (34 - T), rea = 1 / (lr * fa * hc), recl = rclo / (lr * icl);
      var qs = 0, ereq = 0, emax = 0, ersw = 0, mrsw = 0, w = 0, score = 0, sskin = 0;
      var nRun = max(o.n_steps, o.n_total || 0), tcrLag = tcr, res = null, tr_ = o.trace ? [[0, tcr, tsk]] : null;
      for (var step = 0; step < nRun; step++) {
        var tcl = (ra * tsk + rclo * top + S * ra * rclo) / (ra + rclo), k;
        for (k = 0; k < 151; k++) {
          var hrn = 4 * 0.95 * SBC * pow((tcl + tr) / 2 + 273.15, 3) * 0.73, htn = hrn + hc, ran = 1 / (fa * htn);
          var topn = (hrn * tr + hc * T) / htn, tcln = (ran * tsk + rclo * topn + S * ran * rclo) / (ran + rclo);
          var conv = abs(tcln - tcl) <= 0.01;
          hr = hrn; ht = htn; ra = ran; top = topn; tcl = tcln;
          if (conv) break;
        }
        if (k === 151) throw new Error("two_node: clothing temperature did not converge");
        qs = (tsk - top - S * ra) / (ra + rclo);
        var hfcs = (tcr - tsk) * (5.28 + 1.163 * mbl);
        score = m - hfcs - qres - cres;
        sskin = hfcs - qs - eskin;
        var tcsk = 0.97 * alfa * mass, tccr = 0.97 * (1 - alfa) * mass;
        tsk = tsk + sskin * A / (tcsk * 60);
        tcr = tcr + score * A / (tccr * 60);
        var tb = alfa * tsk + (1 - alfa) * tcr, sksig = tsk - 33.7, warmsk = max(sksig, 0), colds = max(-sksig, 0);
        var creg = tcr - 36.8, cwarm = max(creg, 0), ccold = max(-creg, 0), warmb = max(tb - tbn, 0);
        mbl = max(min((6.3 + 120 * cwarm) / (1 + 0.5 * colds), 90), 0.5);
        mrsw = min(csw * warmb * exp(warmsk / 10.7), cap);
        ersw = 0.68 * mrsw;
        ereq = rm - qres - cres - qs;
        emax = (psatMm(tsk) - pa) / (rea + recl);
        if (emax === 0) emax = 0.001;
        var prsw = ersw / emax;
        w = 0.06 + 0.94 * prsw;
        var ediff = w * emax - ersw;
        if (w > wmax) { w = wmax; prsw = (wmax - 0.06) / 0.94; ersw = prsw * emax; ediff = 0.06 * (1 - prsw) * emax; }
        if (emax < 0) { ediff = 0; ersw = 0; w = wmax; }
        eskin = ersw + ediff;
        mrsw = ersw / 0.68;
        m = rm + 19.4 * colds * ccold;
        alfa = 0.0417737 + 0.7451833 / (mbl + 0.585417);
        if (tr_) tr_.push([step + 1, tcr, tsk]);
        if (step + 1 === nRun - LAG) tcrLag = tcr;
        if (step + 1 === o.n_steps) res = { t_core: tcr, t_skin: tsk, w: w, e_req: ereq, e_max: emax, q_res: qres, c_res: cres, m_rsw: mrsw, t_op: top, r_a: ra, r_clo: rclo, r_e: rea + recl, pa: pa };
      }
      res.t_core_bal = tcr; res.rate_K_h = (tcr - tcrLag) * 60 / LAG; res.trace = tr_;
      return res;
    }
    /* common.two_node_body: judged after one wait of tn_t_exp minutes. */
    function twoNodeBody(T, W, v, S, group, trace) {
      var M = pv("M"), Rcl = pv("R_cl"), A = pv("A_body");
      var cut = group === "older" ? pv("older_sweat_cut") : 0;
      var csw = pv("tn_c_sw") * (1 - cut), swg = pv("SW_max") / 0.68 * (1 - cut);
      var texp = pv("tn_t_exp"), lim = pv("tn_Tcr_lim"), tb = max(texp, pv("tn_t_bal"));
      var pa = pFromW(W) * KMM;
      var r = twoNode(T, pa, v, S, { M: M, clo: Rcl / 0.155, i_cl: pv("i_cl"), A: A, hc: hConv(v), c_sw: csw, sw_cap_g: swg, Tcr0: pv("tn_Tcr0"), Tsk0: pv("tn_Tsk0"),
        n_steps: Math.round(texp), n_total: Math.round(tb), trace: trace });
      var den = r.r_a + r.r_clo, C = (r.t_skin - r.t_op) / den * A, Rsun = S * r.r_a / den * A;
      var Ereq = r.e_req * A, gap = (psatMm(r.t_skin) - r.pa) / KMM;
      var EmaxAir = max(gap, EFL) * KMM / r.r_e * A, Esw = swg * 0.68 * A, Emax = min(EmaxAir, Esw);
      var d38 = r.t_core >= lim, drate = r.rate_K_h > pv("tn_rate_crit");
      var rule = pv("tn_danger_rule");
      return { w: max(Ereq, 0) / Emax, E_req: Ereq, E_max: Emax, E_max_air: EmaxAir, E_sw: Esw, C: C, R_sun: Rsun, T_sk: r.t_skin, T_cr: r.t_core,
        rate_K_h: r.rate_K_h, danger: rule === "uncompensable" ? (d38 || drate) : d38, danger38: d38, danger_rate: drate, trace: r.trace, sweat_g_h: r.m_rsw * A };
    }
    function need(b, wc) { return max(b.E_req - wc * b.E_max, 0); }
    function bad(T, W, w) { return !(isFinite(T) && isFinite(W) && isFinite(w)) || W < 0 || T < -30 || T > 100 || W > 1.001 * Wsat(min(T, 90)); }

    /* step the air with the crowd's sweat solved together with the humidity it makes (box._sweat_step) */
    function sweatStep(advance, N, b, W, psk) {
      var Ereq = max(b.E_req, 0), Kc = b.E_max_air / max(psk - pFromW(W), EFL);
      var allowed = function (Wn) { return N * min(Kc * max(psk - pFromW(Wn), EFL), b.E_sw) / LV; };
      var Gf = N * Ereq / LV, r = advance(Gf);
      if (!(allowed(r[1]) < Gf)) return r;
      var lo = 0, hi = Gf;
      for (var i = 0; i < 10; i++) { var mid = 0.5 * (lo + hi); if (mid > allowed(advance(mid)[1])) hi = mid; else lo = mid; }
      return advance(0.5 * (lo + hi));
    }

    /* ---------- weather ---------- */
    function constantWeather(T, RH, U2, hours, sun, windFrom) {
      hours = hours || 3;
      var sa = sun ? K.SUN_ALT : 0, G = sun ? pv("ghi_a") * sa * exp(-pv("ghi_b") / sa) : 0, fd = 0.2 / (sa + 0.2);
      var W = WfromRH(T, RH), U10 = U2 / windAt(2, 1), list = [];
      for (var i = 0; i < hours; i++) list.push({ T: T, W: W, U10: U10, dir: windFrom == null ? 180 : windFrom, hour: 12, sin_alt: sa, sun_az: K.SUN_AZ_SIDE, G: G, I_diff: G * fd, I_dir: sun ? G * (1 - fd) / sa : 0 });
      return list;
    }
    /* stored real hours: temperature, dew point, 10 m wind, direction and cloud as recorded; sun and humidity ratio rebuilt as weather.py does */
    function siteWeather(rec) {
      if (rec._wx) return rec._wx;
      var out = [], lat = rec.lat * PI / 180;
      for (var i = 0; i < rec.T.length; i++) {
        var doy = rec.doy[i], hour = rec.hour[i], okta = rec.okta[i];
        var B = 2 * PI * (doy - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
        var decl = 23.45 * PI / 180 * Math.sin(B), lst = hour + (4 * (rec.lon - 15 * rec.utc) + eot) / 60, ha = 15 * (lst - 12) * PI / 180;
        var sa = clip(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha), 0, 1);
        var az = Math.atan2(Math.sin(ha) * Math.cos(decl), Math.cos(ha) * Math.cos(decl) * Math.sin(lat) - Math.sin(decl) * Math.cos(lat));
        var cs = sa > 0.01 ? pv("ghi_a") * sa * exp(-pv("ghi_b") / max(sa, 0.01)) : 0, G = cs * (1 - pv("cloud_a") * pow(okta / 8, 3.4));
        var fdc = 0.2 / (max(sa, 0.05) + 0.2), fd = fdc + (1 - fdc) * (okta / 8);
        var T = rec.T[i] / 10, Dp = rec.Dp[i] / 10;
        out.push({ T: T, W: WfromRH(Dp, 100), U10: rec.U10[i] / 10, dir: rec.dir[i] < 0 ? null : rec.dir[i], hour: hour, doy: doy, sin_alt: sa, sun_az: az,
          G: G, I_diff: G * fd, I_dir: sa > 0.05 ? G * (1 - fd) / max(sa, 0.05) : 0 });
      }
      rec._wx = out;
      return out;
    }

    /* ---------- the box model (box.simulate), split in two: the no-device air is marched once and shared by every device ---------- */
    function baseTrack(space, wx, p) {
      p = p || {};
      var alpha = p.alpha_roof != null ? p.alpha_roof : pv("alpha_roof"), Froof = p.F_roof != null ? p.F_roof : pv("F_roof"), asw = pv("asw");
      var wc = pv("w_comfort"), group = p.group || pv("group"), Tsk = pv("T_skin"), psk = psat(Tsk), dt = 3600;
      var V = space.V, H = space.H, span = space.span, n = wx.length, rH = windAt(H, 1) / windAt(2, 1);
      var Tm = 0; for (var i = 0; i < min(24, n); i++) Tm += wx[i].T; Tm /= min(24, n);
      var Qm = 0, am = 1;
      if (space.kind === "hall") {
        var Am = space.D * span + (1 - space.Omega) * space.A_wall, dm = pv("d_mass");
        Qm = pv("h_mass") * Am / (RHO * CP) * (dm > 0 ? 1 : 0);
        am = exp(-dt * pv("h_mass") / max(pv("rho_conc") * pv("cp_conc") * dm, 1e-9));
      }
      var T0 = wx[0].T, W0 = wx[0].W, hrs = [];
      for (var ih = 0; ih < n; ih++) {
        var h = wx[ih], To = h.T, Wo = h.W, Uf = windAt(2, h.U10), Ur = windAt(H, h.U10), Up, Upar, o, theta = 0;
        if (space.kind === "hall") { Up = Uf; Upar = 0; o = 1; theta = space.theta; }
        else {
          var wd = ((h.dir == null || isNaN(h.dir)) ? 180 : h.dir) * PI / 180 - PI, cs = Math.cos(wd - space.front_az);
          Up = Uf * abs(cs); Upar = Uf * sqrt(1 - cs * cs); o = cs >= 0 ? 1 : -1;
        }
        var Ut = sqrt(Up * Up + Upar * Upar), rb = roofBalance(h.G, To, Ur, alpha), Tr = rb[0], qr = rb[1], Aroof = space.D * span;
        var fs = sunFraction(space, h);
        var Sabs = absorbedRadiation(h.G, h.I_dir, h.I_diff, fs, space.f_svv, Tr, To, Froof, asw);
        var service = h.hour >= pv("service_start") && h.hour < pv("service_end");
        var N = space.N_present * (space.kind !== "hall" ? space.present : 1) * (service ? 1 : 0.25);
        var Qw = windFlow(space, Up, Upar, o, theta, rH);
        var Qr = space.kind === "hall" ? roofConductance(Ur) * Aroof / (RHO * CP) : 0;
        var dTb = max(abs(T0 - To), 0.2), Qb = stackFlow(space, dTb, To);
        var Qmix = space.kind === "hall" ? sqrt(Qw * Qw + Qb * Qb) : Qw + Qb;
        if (space.kind === "open") Qmix = max(Qw, CL.open3d.q_floor * H * span);
        Qmix = max(Qmix, 1e-3);
        var c0 = closures(space, null, null, Qmix, Up, o, theta, Ut), Qt0 = c0.Qt, v0 = c0.v;
        var Qp0 = crowdConductance(N, v0) / (RHO * CP), lam0 = Qt0 + Qm + Qp0 + Qr;
        var Teq0 = (Qt0 * To + qr * Aroof / (RHO * CP) + Qm * Tm + Qp0 * Tsk + Qr * To) / lam0;
        var T0n = Teq0 + (T0 - Teq0) * exp(-dt * lam0 / V), a0 = exp(-dt * Qt0 / V), Wold = W0;
        var adv0 = function (G) { return [T0n, Wo + G / (RHO * Qt0) + (Wold - Wo - G / (RHO * Qt0)) * a0]; };
        var s0 = sweatStep(adv0, N, bodyFixed(T0, W0, v0, Sabs), W0, psk);
        s0 = saturate(s0[0], s0[1]); T0 = s0[0]; W0 = s0[1];
        Tm = T0 + (Tm - T0) * am;
        var b0 = null, hot = false;
        if (service) { b0 = twoNodeBody(T0, W0, v0, Sabs, group); hot = b0.w > wc; }
        hrs.push({ To: To, Wo: Wo, Up: Up, Upar: Upar, Ut: Ut, o: o, theta: theta, Ur: Ur, qr: qr, Aroof: Aroof, Sabs: Sabs, N: N, service: service,
          Qmix: Qmix, Qr: Qr, Qt0: Qt0, v0: v0, T0: T0, W0: W0, b0: b0, hot: hot, U2: Uf });
      }
      return { space: space, wx: wx, p: p, hours: hrs, Qm: Qm, am: am, Tm_init: (function () { var s = 0; for (var i = 0; i < min(24, n); i++) s += wx[i].T; return s / min(24, n); })(), group: group };
    }

    function runDevice(base, dev, keepAll) {
      var space = base.space, hrs = base.hours, wc = pv("w_comfort"), Tsk = pv("T_skin"), psk = psat(Tsk), dt = 3600, V = space.V, nd = space.n_dev || 1;
      var kindKey = devType(space, dev), Qd = deviceFlow(space, dev), Pbase = dev.P_kW * nd, eps = dev.eps != null ? dev.eps : pv("eps_pad");
      var T1 = base.wx[0].T, W1 = base.wx[0].W, Tm1 = base.Tm_init, Qm = base.Qm, am = base.am;
      var tot = { hot: 0, E: 0, NdN: 0, NdQ: 0, comfy: 0, safe: 0, w0: 0, w1: 0, dT: 0, water: 0, phi: 0, invalid: 0, danger0: 0, uncomp1: 0 }, out = [];
      var Np = space.N_present, pres = space.present;
      for (var ih = 0; ih < hrs.length; ih++) {
        var h = hrs[ih], To = h.To, Wo = h.Wo, hot = h.hot, on = hot;
        var c1 = closures(space, dev, kindKey, h.Qmix, h.Up, h.o, h.theta, h.Ut), Qt = c1.Qt, phi = c1.phi, v1 = c1.v, Pnow = Pbase;
        if (dev.kind === "ac") { on = hot && To <= dev.Tmax; Pnow = Pbase / max(1 - dev.slope * max(To - 35, 0), 0.3); }
        if (dev.kind === "mist") phi = phi + ((CL[space.kind] && CL[space.kind].dev && CL[space.kind].dev.mist) ? CL[space.kind].dev.mist.chi : 1);
        var onN = on ? 1 : 0;
        Qt = on ? Qt : h.Qt0;
        var veff = on ? v1 : h.v0;
        var Gh = h.qr * h.Aroof + onN * (dev.P_heat_kW != null ? dev.P_heat_kW : Pnow) * 1000;
        var Qp1 = crowdConductance(h.N, veff) / (RHO * CP), Qn = Qm + Qp1 + h.Qr;
        var Tnode = (Qm * Tm1 + Qp1 * Tsk + h.Qr * To) / max(Qn, 1e-12);
        var water = 0, sinkT = 0, sinkW = 0, dTex = 0, lam = Qt + Qn, advance = null, T1o = T1, W1o = W1;
        if (dev.kind === "mist") {
          var mall = dev.m_w * nd, aW = exp(-dt * Qt / V), aT = exp(-dt * lam / V);
          var Tn = (Qt * To + Gh / (RHO * CP) + Qn * Tnode) / lam; Tn = Tn + (T1o - Tn) * aT;
          var me = onN * phi * dev.f_e * mall;
          advance = function (G) {
            var Wn = Wo + G / (RHO * Qt); Wn = Wn + (W1o - Wn) * aW;
            var want = me / (RHO * Qt) * (1 - aW), room = max(Wsat(Twb(Tn, Wn)) - Wn, 0), f = want > room ? room / max(want, 1e-30) : 1;
            return [Tn - f * me * LV / (RHO * CP * lam) * (1 - aT), Wn + f * want];
          };
          water = onN * mall * 3600;
        } else if (dev.kind === "ac") {
          var fresh = space.kind === "open", Ti = fresh ? To : T1o, Wi = fresh ? Wo : W1o, ex = acExit(Ti, Wi, dev.Qc_kW, dev.Q, pv("ac_T_coil"));
          dTex = Ti - ex[0];
          Gh = Gh + onN * dev.r_local * (dev.Qc_kW * nd + Pnow) * 1000;
          if (fresh) { var Da = phi * Qt; sinkT = onN * Da * dTex; sinkW = onN * Da * (ex[1] - Wi); }
          else {
            var Dr = (CL.hall.dev[kindKey].mix != null ? CL.hall.dev[kindKey].mix : 1) * Qd, Tc = pv("ac_T_coil"), Te0 = ex[0], We0 = ex[1], Gha = Gh;
            advance = function (G) {
              var drop = T1o - Te0, l = Qt + Qn;
              var Teq = (Qt * To + Gha / (RHO * CP) - onN * Dr * drop + Qn * Tnode) / l, Tcap = Teq + (T1o - Teq) * exp(-dt * l / V);
              var l2 = l + onN * Dr, Teq2 = (Qt * To + Gha / (RHO * CP) + onN * Dr * Tc + Qn * Tnode) / l2, Tlim = Teq2 + (T1o - Teq2) * exp(-dt * l2 / V);
              var Tn2 = (on && Tcap - drop < Tc) ? Tlim : Tcap, wet = onN * (We0 < W1o ? 1 : 0), lw = Qt + wet * Dr;
              var Weq = (Qt * Wo + G / RHO + wet * Dr * We0) / lw;
              return [Tn2, Weq + (W1o - Weq) * exp(-dt * lw / V)];
            };
          }
        } else if (dev.kind === "jet") {
          var e = dev.indirect ? indirectExit(To, Wo, eps) : coolerExit(To, Wo, eps), Dj = phi * Qt;
          dTex = To - e[0]; sinkT = onN * Dj * dTex; sinkW = onN * Dj * (e[1] - Wo);
          water = dev.indirect ? onN * RHO * Qd * CP * dTex / LV * 3600 : onN * RHO * Qd * max(e[1] - Wo, 0) * 3600;
        }
        if (!advance) {
          var Teq = (Qt * To + Gh / (RHO * CP) - sinkT + Qn * Tnode) / lam, Tgen = Teq + (T1o - Teq) * exp(-dt * lam / V), aWg = exp(-dt * Qt / V);
          var sT = sinkW;
          advance = function (G) { return [Tgen, Wo + (G / RHO + sT) / Qt + (W1o - Wo - (G / RHO + sT) / Qt) * aWg]; };
        }
        var s1 = sweatStep(advance, h.N, bodyFixed(T1o, W1o, veff, h.Sabs), W1o, psk);
        s1 = saturate(s1[0], s1[1]); T1 = s1[0]; W1 = s1[1];
        Tm1 = T1 + (Tm1 - T1) * am;
        var rec = { T1: T1, W1: W1, v1: veff, phi: phi, Qt: Qt, on: on, P: Pnow, water: water, dTex: dTex, hot: hot };
        var isBad = bad(T1, W1, 0) || bad(h.T0, h.W0, 0);
        if (isBad) tot.invalid += 1;
        if (hot || keepAll) {
          var b1 = twoNodeBody(T1, W1, veff, h.Sabs, base.group), b0 = h.b0;
          rec.b1 = b1;
          if (b0) {
            var safe = !b1.danger, dN = need(b0, wc) - need(b1, wc), dQ = (b1.C + b1.E_max) - (b0.C + b0.E_max);
            if (bad(T1, W1, b1.w)) isBad = true;
            var Ns = isBad ? NaN : (safe ? dN : 0), Qs = isBad ? NaN : (safe ? dQ : 0);
            rec.dN = dN; rec.safe = safe; rec.need0 = need(b0, wc); rec.need1 = need(b1, wc);
            rec.eta_N_h = Np * Ns * pres / max(Pbase * 1000, 1e-9);
          }
          if (hot) {
            tot.hot += 1; tot.NdN += Np * Ns * pres; tot.NdQ += Np * Qs * pres;
            tot.comfy += b1.w <= wc ? 1 : 0; tot.safe += safe ? 1 : 0; tot.w0 += b0.w; tot.w1 += b1.w; tot.dT += h.T0 - T1; tot.phi += phi;
            tot.danger0 += b0.danger ? 1 : 0; tot.uncomp1 += b1.w > 1 ? 1 : 0;
          }
        }
        tot.E += onN * Pnow; tot.water += water;
        out.push(rec);
      }
      var hh = max(tot.hot, 1), E = max(tot.E, 1e-9);
      return {
        summary: { eta_N: tot.NdN / (1000 * E), eta_Q: tot.NdQ / (1000 * E), comfy_share: tot.comfy / hh, safe_share: tot.safe / hh, hot: tot.hot, E_kWh: tot.E,
          w0: tot.w0 / hh, w1: tot.w1 / hh, dT: tot.dT / hh, water_L: tot.water, phi: tot.phi / hh, danger0_share: tot.danger0 / hh, uncompensable_share: tot.uncomp1 / hh,
          invalid_hours: tot.invalid, P_kW: Pbase, Qd: Qd, kind_key: kindKey },
        hours: out
      };
    }

    function tier(w) {
      for (var i = 0; i < K.TIERS.length; i++) if (K.TIERS[i][0] === null || w <= K.TIERS[i][0]) return K.TIERS[i][1];
      return K.TIERS[K.TIERS.length - 1][1];
    }

    /* tool.choose, with its tie rule. rows: ordered list of [name, row]. */
    function choose(rows, target) {
      target = target == null ? K.TARGET_COMFORT : target;
      var BAR = K.SAFE_BAR, PP = K.TIE_COMFORT_PP, REL = K.TIE_ETA_REL;
      if (!rows.some(function (r) { return r[1].hot > 0; })) return { choice: null, reason: "No hot hours: no cooling is needed.", met_target: true, rejected_unsafe: [], ties: [], fallback_to_safest: false, safe: [] };
      var safe = rows.filter(function (r) { return r[1].safe_share >= BAR - 1e-9; });
      var fallback = safe.length === 0;
      if (fallback) { var best = Math.max.apply(null, rows.map(function (r) { return r[1].safe_share; })); safe = rows.filter(function (r) { return r[1].safe_share >= best - 1e-9; }); }
      var safeNames = safe.map(function (r) { return r[0]; });
      var rejected = rows.map(function (r) { return r[0]; }).filter(function (n) { return safeNames.indexOf(n) < 0; }).sort();
      var meets = safe.filter(function (r) { return r[1].comfy_share >= target - PP - 1e-12; });
      if (meets.length) {
        var top = Math.max.apply(null, meets.map(function (r) { return r[1].eta_N; }));
        var tied = meets.filter(function (r) { return r[1].eta_N >= top - REL * abs(top) - 1e-12; });
        var pick;
        if (tied.length > 1) pick = tied.reduce(function (a, b) { return (b[1].E_kWh < a[1].E_kWh || (b[1].E_kWh === a[1].E_kWh && -b[1].eta_N < -a[1].eta_N)) ? b : a; });
        else pick = tied[0];
        var near = meets.filter(function (r) { return r[1].comfy_share < target - 1e-12; }).map(function (r) { return r[0]; });
        return { choice: pick[0], met_target: true, rejected_unsafe: rejected, ties: tied.map(function (r) { return r[0]; }), near: near, fallback_to_safest: fallback,
          target_met_by_tie: near.indexOf(pick[0]) >= 0, safe: safeNames, meets: meets.map(function (r) { return r[0]; }), rule: "efficiency" };
      }
      var topc = Math.max.apply(null, safe.map(function (r) { return r[1].comfy_share; }));
      var tc = safe.filter(function (r) { return r[1].comfy_share >= topc - PP - 1e-12; });
      var p2 = tc.reduce(function (a, b) { return (b[1].eta_N > a[1].eta_N || (b[1].eta_N === a[1].eta_N && -b[1].w1 > -a[1].w1)) ? b : a; });
      return { choice: p2[0], met_target: false, rejected_unsafe: rejected, ties: tc.length > 1 ? tc.map(function (r) { return r[0]; }) : [], fallback_to_safest: fallback,
        target_met_by_tie: false, safe: safeNames, meets: [], rule: "comfort" };
    }

    return {
      pv: pv, psat: psat, WfromRH: WfromRH, RHof: RHof, pFromW: pFromW, Twb: Twb, windAt: windAt, hConv: hConv,
      device: device, shelterSpace: shelterSpace, hallSpace: hallSpace, deviceFlow: deviceFlow, devType: devType,
      constantWeather: constantWeather, siteWeather: siteWeather, baseTrack: baseTrack, runDevice: runDevice,
      twoNodeBody: twoNodeBody, bodyFixed: bodyFixed, need: need, tier: tier, choose: choose, coolerExit: coolerExit
    };
  }

  if (typeof module === "object" && module.exports) module.exports = makeEngine;
  else root.makeEngine = makeEngine;
})(this);
