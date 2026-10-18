// XDC - trace.js | Halbautomatisches Kurven-Tracing auf dem entzerrten Bild.
// Robust gegen Gitternetz, Marker-Punkte, Luecken und leichte Stoerungen:
// Farbcluster um den Antipp-Punkt, spaltenweiser Marsch mit Steigungs-Vorhersage,
// adaptives Suchfenster, Lueckenueberbrueckung, Median- + Boxglaettung.
(function (global) {
  'use strict';

  function pix(img, x, y) {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  function dist2(a, b) {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function chroma(c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); }
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

  // Dominanter Kanal-Fingerabdruck (z.B. "r>g>b") fuer chromatische Seeds.
  function order(c) {
    return [0, 1, 2].sort((a, b) => c[b] - c[a]).join('');
  }

  // Seed-Farbe: im Umkreis des Antipp-Punkts den dunkelsten/buntesten Cluster mitteln.
  function seedColor(img, sx, sy, r) {
    r = r || 5;
    let best = null, bestScore = -1;
    for (let y = Math.max(0, sy - r); y <= Math.min(img.height - 1, sy + r); y++) {
      for (let x = Math.max(0, sx - r); x <= Math.min(img.width - 1, sx + r); x++) {
        const c = pix(img, x, y);
        const score = chroma(c) + (255 - lum(c)) * 0.6; // bunt oder dunkel = Kurve
        if (score > bestScore) { bestScore = score; best = { x, y, c }; }
      }
    }
    // Mitteln ueber Nachbarn, die dem besten Pixel aehneln
    let n = 0, acc = [0, 0, 0];
    for (let y = Math.max(0, best.y - 2); y <= Math.min(img.height - 1, best.y + 2); y++) {
      for (let x = Math.max(0, best.x - 2); x <= Math.min(img.width - 1, best.x + 2); x++) {
        const c = pix(img, x, y);
        if (dist2(c, best.c) < 55 * 55) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++; }
      }
    }
    return { color: [acc[0] / n, acc[1] / n, acc[2] / n], x: best.x, y: best.y };
  }

  function makeMatcher(seed, tol) {
    const t2 = tol * tol;
    const sChroma = chroma(seed), sOrder = order(seed), sLum = lum(seed);
    const chromatic = sChroma > 45;
    return function (c) {
      if (dist2(c, seed) > t2) return false;
      if (chromatic) {
        // Gleiche Farbfamilie verlangen: Kanalreihenfolge identisch, Chroma nicht kollabiert
        if (chroma(c) < sChroma * 0.35) return false;
        if (order(c) !== sOrder) return false;
      } else {
        // Dunkler Seed (schwarze Kurve): hell genug = Gitter/Papier, raus
        if (lum(c) > sLum + 70) return false;
      }
      return true;
    };
  }

  // Findet in Spalte x alle zusammenhaengenden Match-Laeufe in [yMin,yMax], gibt deren Zentren+Laengen.
  function runsInColumn(img, match, x, yMin, yMax) {
    const runs = [];
    let start = -1;
    yMin = Math.max(0, Math.round(yMin)); yMax = Math.min(img.height - 1, Math.round(yMax));
    for (let y = yMin; y <= yMax + 1; y++) {
      const ok = y <= yMax && match(pix(img, x, y));
      if (ok && start < 0) start = y;
      if (!ok && start >= 0) { runs.push({ c: (start + y - 1) / 2, len: y - start }); start = -1; }
    }
    return runs;
  }

  // Marsch in eine Richtung. ys wird in-place gefuellt (Index = x).
  function march(img, match, ys, sx, sy, dir, opts) {
    let y = sy, slope = 0, gap = 0;
    for (let x = sx + dir; x >= 0 && x < img.width; x += dir) {
      const pred = y + slope;
      const win = Math.min(opts.winMax, opts.win + gap * 2);
      const runs = runsInColumn(img, match, x, pred - win, pred + win)
        .filter(r => r.len <= opts.maxRun); // fette Blobs (Legende, Logo) ignorieren
      if (runs.length) {
        runs.sort((a, b) => Math.abs(a.c - pred) - Math.abs(b.c - pred));
        const ny = runs[0].c;
        slope = Math.max(-opts.slopeMax, Math.min(opts.slopeMax, 0.6 * slope + 0.4 * (ny - y)));
        y = ny; ys[x] = y; gap = 0;
      } else {
        gap++;
        y = pred; // weiterschieben entlang der Vorhersage
        if (gap > opts.gapMax) break;
      }
    }
  }

  function fillGaps(ys) {
    const xs = [];
    for (let x = 0; x < ys.length; x++) if (!isNaN(ys[x])) xs.push(x);
    if (!xs.length) return;
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

  // Hauptfunktion. img: {width,height,data(RGBA)}. Rueckgabe: {ys, xStart, xEnd, seed}
  function traceCurve(img, sx, sy, options) {
    const opts = Object.assign(
      { tol: 95, win: 14, winMax: 48, gapMax: 60, slopeMax: 4, maxRun: 14 },
      options || {});
    sx = Math.round(sx); sy = Math.round(sy);
    const seed = seedColor(img, sx, sy);
    const match = makeMatcher(seed.color, opts.tol);

    // Startpunkt in der Seed-Spalte praezisieren
    const startRuns = runsInColumn(img, match, seed.x, seed.y - 20, seed.y + 20)
      .filter(r => r.len <= opts.maxRun);
    if (!startRuns.length) return null;
    startRuns.sort((a, b) => Math.abs(a.c - seed.y) - Math.abs(b.c - seed.y));
    const y0 = startRuns[0].c;

    const ys = new Array(img.width).fill(NaN);
    ys[seed.x] = y0;
    march(img, match, ys, seed.x, y0, +1, opts);
    march(img, match, ys, seed.x, y0, -1, opts);

    fillGaps(ys);
    let sm = medianSmooth(ys, 5);
    sm = boxSmooth(sm, 7);

    let xStart = -1, xEnd = -1;
    for (let x = 0; x < sm.length; x++) if (!isNaN(sm[x])) { if (xStart < 0) xStart = x; xEnd = x; }
    if (xStart < 0 || xEnd - xStart < 20) return null;
    return { ys: sm, xStart, xEnd, seed: seed.color.map(Math.round) };
  }

  const api = { traceCurve, seedColor, makeMatcher, medianSmooth, boxSmooth, fillGaps };
  global.XDCTrace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
