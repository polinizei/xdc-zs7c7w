// XDC - vision.js | Automatische Rahmenerkennung (Autopilot Schritt 1).
// Linien-Detektor: Grat-Filter (Pixel dunkler als BEIDE Nachbarn quer zur Linie) -> nur duenne Striche,
// Hell-Dunkel-Kanten (Blattrand, Monitor) zaehlen nicht. Hough fuer fast-waagerechte und fast-senkrechte
// Geraden, dann das Viereck mit bester Kantenbelegung, ohne starke durchgehende Innenlinie (AFR-Panel).
(function (global) {
  'use strict';

  function gray(img, maxDim) {
    const f = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * f)), h = Math.max(1, Math.round(img.height * f));
    const L = new Float32Array(w * h);
    const sx = img.width / w, sy = img.height / h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Flaechenmittel (Box) beim Verkleinern, damit duenne Linien nicht verschwinden
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        let acc = 0, mn = 255, n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
          acc += l; if (l < mn) mn = l; n++;
        }
        L[y * w + x] = 0.5 * (acc / n) + 0.5 * mn; // Minimum mischen: Striche bleiben sichtbar
      }
    }
    return { L, w, h, f };
  }

  // Grat-Staerke fuer waagerechte (dir='h': Nachbarn oben/unten) bzw. senkrechte Linien.
  function ridge(G, dir, k) {
    const { L, w, h } = G;
    const R = new Float32Array(w * h);
    for (let y = k; y < h - k; y++) {
      for (let x = k; x < w - k; x++) {
        const i = y * w + x;
        let a, b;
        if (dir === 'h') { a = Math.max(L[i - k * w], L[i - (k - 1) * w]); b = Math.max(L[i + k * w], L[i + (k - 1) * w]); }
        else { a = Math.max(L[i - k], L[i - k + 1]); b = Math.max(L[i + k], L[i + k - 1]); }
        const v = Math.min(a, b) - L[i];
        R[i] = v > 0 ? v : 0;
      }
    }
    return R;
  }

  // Normiert auf robuste Skala (95%-Quantil der Nicht-Null-Werte) -> vergleichbar zwischen Bildern.
  function normalize(R) {
    const s = [];
    for (let i = 0; i < R.length; i += 7) if (R[i] > 1) s.push(R[i]);
    s.sort((a, b) => a - b);
    const q = s.length ? s[Math.floor(s.length * 0.95)] : 1;
    for (let i = 0; i < R.length; i++) R[i] = Math.min(1, R[i] / q);
    return R;
  }

  // Hough fuer Geraden y = c + t*x (dir 'h') bzw. x = c + t*y (dir 'v'), |t| <= tMax.
  function hough(R, w, h, dir, tMax, tSteps) {
    const len = dir === 'h' ? w : h, span = dir === 'h' ? h : w;
    const cMin = -Math.ceil(tMax * len), cMax = span + Math.ceil(tMax * len);
    const nc = cMax - cMin + 1;
    const acc = new Float32Array(tSteps * nc);
    const ts = [];
    for (let s = 0; s < tSteps; s++) ts.push(-tMax + 2 * tMax * s / (tSteps - 1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = R[y * w + x];
        if (v < 0.25) continue;
        const u = dir === 'h' ? x : y, c0 = dir === 'h' ? y : x;
        for (let s = 0; s < tSteps; s++) {
          const c = Math.round(c0 - ts[s] * u) - cMin;
          if (c >= 0 && c < nc) acc[s * nc + c] += v;
        }
      }
    }
    return { acc, ts, cMin, nc, tSteps };
  }

  function peaks(H, count, minDist) {
    const { acc, ts, cMin, nc, tSteps } = H;
    const cand = [];
    for (let s = 0; s < tSteps; s++) {
      for (let c = 1; c < nc - 1; c++) {
        const v = acc[s * nc + c];
        if (v < 8) continue;
        if (v >= acc[s * nc + c - 1] && v >= acc[s * nc + c + 1]) cand.push({ t: ts[s], c: c + cMin, v });
      }
    }
    cand.sort((a, b) => b.v - a.v);
    const out = [];
    for (const p of cand) {
      if (out.every(q => Math.abs(q.c - p.c) > minDist || Math.abs(q.t - p.t) > 0.08)) out.push(p);
      if (out.length >= count) break;
    }
    return out;
  }

  // Schnittpunkt waagerechte Linie (y = ch + th*x) mit senkrechter (x = cv + tv*y)
  function intersect(lh, lv) {
    const y = (lh.c + lh.t * lv.c) / (1 - lh.t * lv.t);
    const x = lv.c + lv.t * y;
    return { x, y };
  }

  // Anteil belegter Stuetzpunkte entlang Strecke a->b (Grat in +-2 px quer)
  function coverage(R, w, h, a, b, dir) {
    const n = Math.max(10, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    let hit = 0, sum = 0;
    for (let i = 0; i <= n; i++) {
      const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
      let best = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = Math.round(dir === 'v' ? x + k : x), yy = Math.round(dir === 'h' ? y + k : y);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        best = Math.max(best, R[yy * w + xx]);
      }
      if (best > 0.2) hit++;
      sum += best;
    }
    return { frac: hit / (n + 1), mean: sum / (n + 1) };
  }

  // Hauptfunktion: liefert Ecken (TL,TR,BR,BL) in Original-Bildkoordinaten + Guete 0..1, oder null.
  function detectFrame(img) {
    const G = gray(img, 900);
    const k = 3;
    const RH = normalize(ridge(G, 'h', k)), RV = normalize(ridge(G, 'v', k));
    const { w, h } = G;
    const HH = hough(RH, w, h, 'h', 0.25, 41), HV = hough(RV, w, h, 'v', 0.25, 41);
    const hs = peaks(HH, 14, 6), vs = peaks(HV, 14, 6);
    let best = null;
    for (let i = 0; i < hs.length; i++) for (let j = 0; j < hs.length; j++) {
      const top = hs[i], bot = hs[j];
      if (top.c >= bot.c) continue;
      for (let a = 0; a < vs.length; a++) for (let b = 0; b < vs.length; b++) {
        const lef = vs[a], rig = vs[b];
        if (lef.c >= rig.c) continue;
        const TL = intersect(top, lef), TR = intersect(top, rig), BR = intersect(bot, rig), BL = intersect(bot, lef);
        const pts = [TL, TR, BR, BL];
        if (pts.some(p => p.x < -5 || p.y < -5 || p.x > w + 5 || p.y > h + 5)) continue;
        const wTop = TR.x - TL.x, hL = BL.y - TL.y;
        if (wTop < w * 0.25 || hL < h * 0.12) continue;
        const ct = coverage(RH, w, h, TL, TR, 'h'), cb = coverage(RH, w, h, BL, BR, 'h');
        const cl = coverage(RV, w, h, TL, BL, 'v'), cr = coverage(RV, w, h, TR, BR, 'v');
        const minFrac = Math.min(ct.frac, cb.frac, cl.frac, cr.frac);
        if (minFrac < 0.55) continue;
        // Innenlinie, die so stark wie der Rahmen durchgeht -> zusammengesetzter Kasten (z.B. + AFR-Panel)
        let inner = false;
        const edgeMean = (ct.mean + cb.mean + cl.mean + cr.mean) / 4;
        for (const m of hs) {
          if (m === top || m === bot) continue;
          const pL = intersect(m, lef), pR = intersect(m, rig);
          if (pL.y < TL.y + hL * 0.08 || pL.y > BL.y - hL * 0.08) continue;
          const cm = coverage(RH, w, h, pL, pR, 'h');
          if (cm.frac > 0.85 && cm.mean > edgeMean * 0.75) { inner = true; break; }
        }
        if (inner) continue;
        const area = wTop * hL / (w * h);
        const score = minFrac * 0.6 + Math.min(1, edgeMean * 2) * 0.2 + Math.min(1, area * 2) * 0.2;
        if (!best || score > best.score) best = { score, pts };
      }
    }
    if (!best) return null;
    const inv = 1 / G.f;
    return {
      corners: best.pts.map(p => ({ x: p.x * inv, y: p.y * inv })),
      quality: Math.round(best.score * 100) / 100
    };
  }

  const api = { detectFrame, gray, ridge, normalize, hough, peaks, coverage, intersect };
  global.XDCVision = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
