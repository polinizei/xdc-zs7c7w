// XDC - trace.js | Halbautomatisches Kurven-Tracing auf dem entzerrten Bild.
// Merkmal je Pixel = Abweichung vom LOKALEN Hintergrund (Box-Mittel), nicht die absolute Farbe.
// Dadurch robust gegen Farbstich, Helligkeitsverlauf und Bildschirmfotos; farbige Kurven
// bleiben ueber die Richtung der Abweichung unterscheidbar (Kosinus zum Seed-Merkmal).
// Danach spaltenweiser Marsch mit Steigungs-Vorhersage, adaptives Fenster, Lueckenueberbrueckung.
(function (global) {
  'use strict';

  const BG_R = 14; // Radius des Hintergrund-Mittels (px)

  // Hintergrund (Box-Mittel je Kanal) ueber Integralbilder, Ergebnis am img gecacht.
  function features(img) {
    if (img._xdcFeat) return img._xdcFeat;
    const w = img.width, h = img.height, d = img.data;
    const W1 = w + 1;
    const ints = [0, 1, 2].map(() => new Float64Array(W1 * (h + 1)));
    for (let y = 0; y < h; y++) {
      const rs = [0, 0, 0];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          rs[c] += d[i + c];
          ints[c][(y + 1) * W1 + x + 1] = ints[c][y * W1 + x + 1] + rs[c];
        }
      }
    }
    // diff = Hintergrund - Pixel (positiv = dunkler als Umgebung)
    const diff = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - BG_R), y1 = Math.min(h, y + BG_R + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - BG_R), x1 = Math.min(w, x + BG_R + 1);
        const n = (x1 - x0) * (y1 - y0);
        const i = (y * w + x) * 4, o = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) {
          const I = ints[c];
          const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
          diff[o + c] = s / n - d[i + c];
        }
      }
    }
    img._xdcFeat = diff;
    return diff;
  }

  function fAt(diff, w, x, y) {
    const o = (y * w + x) * 3;
    return [diff[o], diff[o + 1], diff[o + 2]];
  }
  function mag(v) { return Math.hypot(v[0], v[1], v[2]); }

  // Seed: im Umkreis den Pixel mit groesster Abweichung, dann Mittel ueber aehnliche Nachbarn.
  function seedFeature(img, diff, sx, sy, r) {
    r = r || 6;
    const w = img.width, h = img.height;
    let best = null, bm = -1;
    for (let y = Math.max(0, sy - r); y <= Math.min(h - 1, sy + r); y++) {
      for (let x = Math.max(0, sx - r); x <= Math.min(w - 1, sx + r); x++) {
        const f = fAt(diff, w, x, y);
        const m = (f[0] + f[1] + f[2]) > 0 ? mag(f) : 0; // nur dunkler/farbiger als Umgebung
        if (m > bm) { bm = m; best = { x, y, f }; }
      }
    }
    if (!best || bm < 8) return null;
    const acc = [0, 0, 0]; let n = 0;
    for (let y = Math.max(0, best.y - 2); y <= Math.min(h - 1, best.y + 2); y++) {
      for (let x = Math.max(0, best.x - 2); x <= Math.min(w - 1, best.x + 2); x++) {
        const f = fAt(diff, w, x, y);
        if (mag(f) > bm * 0.6 && cosine(f, best.f) > 0.85) { acc[0] += f[0]; acc[1] += f[1]; acc[2] += f[2]; n++; }
      }
    }
    return { x: best.x, y: best.y, f: acc.map(v => v / n), mag: mag(acc) / n };
  }

  function cosine(a, b) {
    const ma = mag(a), mb = mag(b);
    if (!ma || !mb) return 0;
    return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (ma * mb);
  }

  function makeMatcher(seed, opts) {
    const minMag = Math.max(6, seed.mag * opts.magFrac);
    const sf = seed.f;
    return function (f) {
      const m = mag(f);
      if (m < minMag) return false;
      if (f[0] + f[1] + f[2] <= 0) return false; // heller als Umgebung = kein Strich
      return cosine(f, sf) >= opts.cosMin;
    };
  }

  // Zusammenhaengende Match-Laeufe in Spalte x zwischen yMin..yMax (mit mittlerer Farbaehnlichkeit zum Seed).
  function runsInColumn(img, diff, match, x, yMin, yMax, sf) {
    const runs = [], w = img.width;
    let start = -1, wsum = 0, ysum = 0, csum = 0;
    yMin = Math.max(0, Math.round(yMin)); yMax = Math.min(img.height - 1, Math.round(yMax));
    for (let y = yMin; y <= yMax + 1; y++) {
      let ok = false, m = 0, f = null;
      if (y <= yMax) { f = fAt(diff, w, x, y); ok = match(f); m = mag(f); }
      if (ok) {
        if (start < 0) { start = y; wsum = 0; ysum = 0; csum = 0; }
        wsum += m; ysum += m * y; csum += sf ? cosine(f, sf) * m : 0;
      } else if (start >= 0) {
        runs.push({ c: ysum / wsum, len: y - start, s: wsum / (y - start), cos: sf ? csum / wsum : 1 });
        start = -1;
      }
    }
    return runs;
  }

  function march(img, diff, match, ys, sx, sy, dir, opts, sf) {
    let y = sy, slope = 0, gap = 0;
    for (let x = sx + dir; x >= 0 && x < img.width; x += dir) {
      const pred = y + slope;
      const win = Math.min(opts.winMax, opts.win + gap * 1.5);
      const runs = runsInColumn(img, diff, match, x, pred - win, pred + win, sf)
        .filter(r => r.len <= opts.maxRun);
      if (runs.length) {
        // Kosten: Abstand zur Vorhersage + Farbabweichung zum Seed (trennt eng liegende Kurven verschiedener Farbe)
        const cost = r => Math.abs(r.c - pred) + (1 - r.cos) * opts.colorW - r.s * 0.02;
        runs.sort((a, b) => cost(a) - cost(b));
        const ny = runs[0].c;
        slope = Math.max(-opts.slopeMax, Math.min(opts.slopeMax, 0.7 * slope + 0.3 * (ny - y) * (gap ? 1 / (gap + 1) : 1)));
        y = ny; ys[x] = y; gap = 0;
      } else {
        gap++;
        y = pred;
        if (gap > opts.gapMax) break;
      }
    }
  }

  // Kurze Inseln am Rand (nach grosser Luecke) sind meist Fremdlinien -> abschneiden.
  function trimIslands(ys, minLen, gapBig) {
    const segs = [];
    let s = -1;
    for (let x = 0; x <= ys.length; x++) {
      const ok = x < ys.length && !isNaN(ys[x]);
      if (ok && s < 0) s = x;
      if (!ok && s >= 0) { segs.push([s, x - 1]); s = -1; }
    }
    if (segs.length < 2) return;
    // groesstes zusammenhaengendes Cluster (Segmente mit Luecke < gapBig) behalten
    const clusters = [];
    let cur = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
      if (segs[i][0] - cur[cur.length - 1][1] < gapBig) cur.push(segs[i]);
      else { clusters.push(cur); cur = [segs[i]]; }
    }
    clusters.push(cur);
    const size = c => c.reduce((a, sg) => a + sg[1] - sg[0] + 1, 0);
    clusters.sort((a, b) => size(b) - size(a));
    const keep = clusters[0];
    const k0 = keep[0][0], k1 = keep[keep.length - 1][1];
    for (let x = 0; x < ys.length; x++) if (x < k0 || x > k1) ys[x] = NaN;
    // Randsegmente unter minLen innerhalb des Clusters ebenfalls weg
    for (const sg of [keep[0], keep[keep.length - 1]]) {
      if (keep.length > 1 && sg[1] - sg[0] + 1 < minLen) for (let x = sg[0]; x <= sg[1]; x++) ys[x] = NaN;
    }
  }

  function fillGaps(ys) {
    const xs = [];
    for (let x = 0; x < ys.length; x++) if (!isNaN(ys[x])) xs.push(x);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1];
      for (let x = a + 1; x < b; x++) ys[x] = ys[a] + (ys[b] - ys[a]) * (x - a) / (b - a);
    }
  }

  function medianSmooth(ys, w) {
    const out = ys.slice(), half = Math.floor(w / 2);
    for (let x = 0; x < ys.length; x++) {
      if (isNaN(ys[x])) continue;
      const win = [];
      for (let k = -half; k <= half; k++) {
        const v = ys[x + k];
        if (v !== undefined && !isNaN(v)) win.push(v);
      }
      win.sort((a, b) => a - b);
      out[x] = win[Math.floor(win.length / 2)];
    }
    return out;
  }

  function boxSmooth(ys, w) {
    const out = ys.slice(), half = Math.floor(w / 2);
    for (let x = 0; x < ys.length; x++) {
      if (isNaN(ys[x])) continue;
      let acc = 0, n = 0;
      for (let k = -half; k <= half; k++) {
        const v = ys[x + k];
        if (v !== undefined && !isNaN(v)) { acc += v; n++; }
      }
      out[x] = acc / n;
    }
    return out;
  }

  // img: {width,height,data(RGBA)}. Rueckgabe: {ys, xStart, xEnd, seed}
  function traceCurve(img, sx, sy, options) {
    const opts = Object.assign({
      magFrac: 0.4, cosMin: 0.8, win: 10, winMax: 40, gapMax: 45,
      slopeMax: 5, maxRun: 18, minIsland: 25, gapBig: 30, colorW: 60
    }, options || {});
    sx = Math.round(sx); sy = Math.round(sy);
    const diff = features(img);
    const seed = seedFeature(img, diff, sx, sy);
    if (!seed) return null;
    const match = makeMatcher(seed, opts);
    const startRuns = runsInColumn(img, diff, match, seed.x, seed.y - 12, seed.y + 12)
      .filter(r => r.len <= opts.maxRun);
    if (!startRuns.length) return null;
    startRuns.sort((a, b) => Math.abs(a.c - seed.y) - Math.abs(b.c - seed.y));
    const y0 = startRuns[0].c;

    const ys = new Array(img.width).fill(NaN);
    ys[seed.x] = y0;
    march(img, diff, match, ys, seed.x, y0, +1, opts, seed.f);
    march(img, diff, match, ys, seed.x, y0, -1, opts, seed.f);
    trimIslands(ys, opts.minIsland, opts.gapBig);
    const found = ys.slice(); // echte Treffer vor dem Lueckenfuellen

    fillGaps(ys);
    let sm = medianSmooth(ys, 5);
    sm = boxSmooth(sm, 7);

    let xStart = -1, xEnd = -1;
    for (let x = 0; x < sm.length; x++) if (!isNaN(sm[x])) { if (xStart < 0) xStart = x; xEnd = x; }
    if (xStart < 0 || xEnd - xStart < 20) return null;
    const c = seed.f.map(v => Math.round(v));
    return { ys: sm, found, xStart, xEnd, seed: c };
  }

  const api = { traceCurve, features, seedFeature, medianSmooth, boxSmooth, fillGaps };
  global.XDCTrace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
