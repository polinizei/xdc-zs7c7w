// XDC - autopilot.js | Verkettet: Rahmen finden -> entzerren (mit Rand) -> Achsen lesen -> Kurven finden.
// Jeder Schritt meldet Status ok | unsicher | fehlt, damit die Oberflaeche gezielt um Hilfe bitten kann.
(function (global) {
  'use strict';

  const H = global.XDCHomography;
  const MARGIN = { l: 0.16, r: 0.13, t: 0.1, b: 0.1 };
  const FW = 1600;

  function imageData(cv) { return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); }

  // Entzerrt so, dass der Rahmen (corners) achsparallel bei frame{x0..y1} liegt, mit Rand fuer Beschriftung.
  function rectify(src, corners) {
    const c = corners;
    const wTop = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), wBot = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
    const hL = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y), hR = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
    const FH = Math.max(400, Math.min(1600, Math.round(FW * (hL + hR) / (wTop + wBot))));
    const x0 = Math.round(FW * MARGIN.l), y0 = Math.round(FH * MARGIN.t);
    const W = x0 + FW + Math.round(FW * MARGIN.r), Hh = y0 + FH + Math.round(FH * MARGIN.b);
    const frame = { x0, y0, x1: x0 + FW, y1: y0 + FH };
    const dst = [{ x: x0, y: y0 }, { x: frame.x1, y: y0 }, { x: frame.x1, y: frame.y1 }, { x: x0, y: frame.y1 }];
    const Hinv = H.compute(dst, c);    // Ziel -> Quelle
    const Hfwd = H.compute(c, dst);    // Quelle -> Ziel
    const sd = imageData(src);
    const out = H.warp(sd.data, src.width, src.height, Hinv, W, Hh);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    cv.getContext('2d').putImageData(new ImageData(out, W, Hh), 0, 0);
    return { canvas: cv, frame, Hfwd, Hinv };
  }

  function defaultCorners(src) {
    const w = src.width, h = src.height;
    return [{ x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.7 }, { x: w * 0.1, y: h * 0.7 }];
  }

  // PDF-Textstuecke (Canvas-Pixel der Quelle) in entzerrte Koordinaten umrechnen.
  function mapPdfWords(items, Hfwd) {
    return items.map(it => {
      const a = H.apply(Hfwd, it.x0, it.y0), b = H.apply(Hfwd, it.x1, it.y1);
      return { text: it.text, x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
    });
  }

  // Zeile mit der staerksten waagerechten Linie (auch punktiert) zwischen ya..yb im Rahmenbereich x0..x1
  function bestLineRow(cv, x0, x1, ya, yb) {
    const w = cv.width;
    ya = Math.max(4, Math.round(ya)); yb = Math.min(cv.height - 5, Math.round(yb));
    if (yb <= ya) return null;
    const id = cv.getContext('2d').getImageData(0, ya - 4, w, yb - ya + 9).data;
    const L = (x, y) => { const i = ((y - ya + 4) * w + x) * 4; return 0.299 * id[i] + 0.587 * id[i + 1] + 0.114 * id[i + 2]; };
    let best = null;
    const mean = [];
    for (let y = ya - 4; y <= yb + 4; y++) {
      let s = 0, k = 0;
      for (let x = Math.round(x0); x <= Math.round(x1); x += 2) { s += L(x, y); k++; }
      mean[y] = s / Math.max(1, k);
    }
    let step = null;
    for (let y = ya; y <= yb; y++) {
      let n = 0, tot = 0;
      for (let x = Math.round(x0); x <= Math.round(x1); x += 2) {
        const c = L(x, y), up = Math.max(L(x, y - 3), L(x, y - 4)), dn = Math.max(L(x, y + 3), L(x, y + 4));
        if (Math.min(up, dn) - c > 10) n++;
        tot++;
      }
      const f = n / Math.max(1, tot);
      if (!best || f > best.f) best = { y, f };
      // verschwommene Kante: Helligkeitsstufe zwischen Beschriftungsband und Diagrammflaeche
      const st = Math.abs(mean[y - 3] - mean[y + 3]);
      if (!step || st > step.s) step = { y, s: st };
    }
    if (best && best.f > 0.2) return best.y;
    return step && step.s > 25 ? step.y : null;
  }

  // Rahmen an die Beschriftung nachfuehren: liegen die Drehzahl-Zahlen INNERHALB des Rahmens (Rahmen wurde an
  // einer Fensterkante statt an der Diagrammkante erkannt), Kante auf die naechste Linie hinter der Beschriftung.
  function refineFrame(R, ax) {
    const f = R.frame, fh = f.y1 - f.y0;
    if (!ax.x) return false;
    const inl = [].concat(...(ax.xFits || [ax.x]).map(s => s.inliers));
    const top = inl.filter(it => it.cy < (f.y0 + f.y1) / 2), bot = inl.filter(it => it.cy >= (f.y0 + f.y1) / 2);
    let changed = false;
    if (top.length >= 3) {
      const lb = Math.max(...top.map(it => it.cy + it.h / 2));
      if (lb > f.y0 + fh * 0.003) {
        const y = bestLineRow(R.canvas, f.x0, f.x1, lb + 1, lb + fh * 0.08);
        if (y != null) { f.y0 = y; changed = true; }
      }
    }
    if (bot.length >= 3) {
      const lt = Math.min(...bot.map(it => it.cy - it.h / 2));
      if (lt < f.y1 - fh * 0.003) {
        const y = bestLineRow(R.canvas, f.x0, f.x1, lt - fh * 0.08, lt - 1);
        if (y != null) { f.y1 = y; changed = true; }
      }
    }
    return changed;
  }

  function powerScale(ax) {
    if (ax.ps) return { a: ax.ps.a, b: ax.ps.b, unit: 'PS', sure: true };
    if (ax.kw) return { a: ax.kw.a, b: ax.kw.b, unit: 'kW', sure: true };
    if (ax.unknown) return { a: ax.unknown.a, b: ax.unknown.b, unit: 'PS', sure: false };
    return null;
  }

  // Schritt 1: Rahmen. Gibt {corners, found, quality}
  function findFrame(src) {
    const r = global.XDCVision.detectFrame(imageData(src));
    return r ? { corners: r.corners, found: true, quality: r.quality } : { corners: defaultCorners(src), found: false, quality: 0 };
  }

  // Schritte 2-4 ab gegebenen Ecken (auch nach Korrektur durch den Menschen).
  async function analyze(src, corners, opts) {
    opts = opts || {};
    const step = opts.onStep || (() => {});
    const res = { steps: {}, notes: [] };
    step('Entzerre');
    await new Promise(r => setTimeout(r, 0));
    const R = rectify(src, corners);
    res.rect = R;

    step('Lese Achsen');
    let words = [], units = [], ax;
    if (opts.pdfWords && opts.pdfWords.length) {
      const all = mapPdfWords(opts.pdfWords, R.Hfwd);
      words = all;
      units = all.map(w => {
        const t = String(w.text).toUpperCase();
        const unit = /\bNM\b|\[NM\]/.test(t) ? 'Nm' : /KW/.test(t) ? 'kW' : /\[PS\]|^PS$/.test(t) ? 'PS' : null;
        return unit && { unit, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, side: (w.x0 + w.x1) / 2 < (R.frame.x0 + R.frame.x1) / 2 ? 'left' : 'right' };
      }).filter(Boolean);
      res.axSource = 'pdf';
      ax = global.XDCAxes.calibrate(words, R.frame, units);
    } else {
      try {
        const O = global.XDCOcr;
        words = await O.readAxes(R.canvas, R.frame, step);
        step('Lese Einheiten');
        units = await O.readUnits(R.canvas, R.frame);
        ax = global.XDCAxes.calibrate(words, R.frame, units);
        // Wiederholung nur fuer fehlende/unsichere Achsen (gute Bilder bleiben schnell)
        const redo = [];
        if (!ax.x || ax.x.n < 5) redo.push('oben', 'unten');
        if (!ax.ps && !ax.kw) redo.push('links', 'rechts');
        if (redo.length) {
          words = words.concat(await O.readAxes(R.canvas, R.frame, step, redo, 1));
          ax = global.XDCAxes.calibrate(words, R.frame, units);
        }
        res.axSource = 'ocr';
      } catch (e) {
        res.notes.push('Texterkennung nicht verfügbar: ' + e.message); res.axSource = 'keine';
        ax = global.XDCAxes.calibrate([], R.frame, []);
      }
    }
    res.words = words;
    res.units = units;
    // Kalibrierung bleibt gueltig (gleiche entzerrte Koordinaten), nur der Kurvenbereich wird korrigiert
    if (refineFrame(R, ax)) res.notes.push('Rahmen an Beschriftung nachgeführt');
    res.axes = ax;
    res.notes.push(...ax.notes);
    const ps = powerScale(ax);
    res.steps.x = ax.x ? (ax.x.n >= 5 ? 'ok' : 'unsicher') : 'fehlt';
    res.steps.power = ps ? (ps.sure ? 'ok' : 'unsicher') : 'fehlt';
    // Override durch Menschen (manuell gesetzte Skalen)
    const cal = {
      x: opts.override && opts.override.x || (ax.x && { a: ax.x.a, b: ax.x.b }),
      power: opts.override && opts.override.power || ps,
      nm: opts.override && opts.override.nm || (ax.nm && { a: ax.nm.a, b: ax.nm.b })
    };
    if (opts.override && opts.override.x) res.steps.x = 'ok';
    if (opts.override && opts.override.power) res.steps.power = 'ok';
    res.cal = cal;
    if (!cal.x || !cal.power) { res.steps.curves = 'wartet'; return res; }

    step('Suche Kurven');
    await new Promise(r => setTimeout(r, 0));
    const id = imageData(R.canvas);
    const cv = global.XDCCurves.build({ width: id.width, height: id.height, data: id.data }, R.frame, cal, opts.sourceName || '');
    res.curves = cv.curves;
    res.cal.nm = cv.nmScale || cal.nm;
    res.notes.push(...cv.notes);
    if (cv.unitConfirmed && cal.power && !cal.power.sure) {
      cal.power.sure = true;
      res.steps.power = 'ok';
      res.notes = res.notes.filter(n => !/Einheit der Leistungsskala unsicher/.test(n));
      res.notes.push(`Einheit ${cal.power.unit} über die Drehmoment-Skala bestätigt`);
    }
    res.steps.curves = cv.curves.length ? 'ok' : 'fehlt';
    return res;
  }

  const api = { findFrame, analyze, rectify, defaultCorners, MARGIN };
  global.XDCAutopilot = api;
})(typeof window !== 'undefined' ? window : globalThis);
