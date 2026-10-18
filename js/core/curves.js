// XDC - curves.js | Automatisches Finden aller Kurven im entzerrten Diagramm + Zuordnung Leistung/Drehmoment.
// Zuordnung ueber Physik: M[Nm] = P[PS] * 7023,5 / n. Passt die Pixelhoehe einer zweiten Kurve linear zu M,
// ist sie das Drehmoment des Laufs; daraus folgt auch die Nm-Skala, falls die OCR sie nicht liefert.
(function (global) {
  'use strict';

  const T = global.XDCTrace || (typeof require !== 'undefined' ? require('./trace.js') : null);
  const PS_NM = 7023.5;

  function colPeaks(img, diff, x, y0, y1) {
    const w = img.width, vals = [];
    for (let y = y0; y <= y1; y++) {
      const o = (y * w + x) * 3;
      const s = diff[o] + diff[o + 1] + diff[o + 2];
      vals.push(s > 0 ? Math.hypot(diff[o], diff[o + 1], diff[o + 2]) : 0);
    }
    const sorted = vals.slice().sort((a, b) => a - b);
    const thr = Math.max(10, sorted[Math.floor(sorted.length * 0.985)] * 0.35);
    const out = [];
    for (let i = 2; i < vals.length - 2; i++) {
      const v = vals[i];
      if (v < thr || v < vals[i - 1] || v < vals[i + 1]) continue;
      if (out.length && i + y0 - out[out.length - 1].y < 4) {
        if (v > out[out.length - 1].v) out[out.length - 1] = { y: i + y0, v };
        continue;
      }
      out.push({ y: i + y0, v });
    }
    return out;
  }

  function sameTrace(a, b) {
    let n = 0, s = 0;
    const x0 = Math.max(a.xStart, b.xStart), x1 = Math.min(a.xEnd, b.xEnd);
    for (let x = x0; x <= x1; x += 2) {
      if (isNaN(a.ys[x]) || isNaN(b.ys[x])) continue;
      s += Math.abs(a.ys[x] - b.ys[x]); n++;
    }
    const shorter = Math.min(a.xEnd - a.xStart, b.xEnd - b.xStart);
    return n * 2 > shorter * 0.3 && s / Math.max(1, n) < 2.5;
  }

  function meanColor(img, diff, tr) {
    const w = img.width, acc = [0, 0, 0];
    let n = 0;
    for (let x = tr.xStart; x <= tr.xEnd; x += 3) {
      const y = Math.round(tr.ys[x]);
      if (isNaN(y) || y < 0 || y >= img.height) continue;
      // dunkelsten Pixel +-1 nehmen (Linienmitte)
      let bi = -1, bl = 1e9;
      for (let k = -1; k <= 1; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= img.height) continue;
        const i = (yy * w + x) * 4;
        const l = img.data[i] + img.data[i + 1] + img.data[i + 2];
        if (l < bl) { bl = l; bi = i; }
      }
      acc[0] += img.data[bi]; acc[1] += img.data[bi + 1]; acc[2] += img.data[bi + 2]; n++;
    }
    return acc.map(v => Math.round(v / Math.max(1, n)));
  }

  // Farbname fuer Kurvenbeschriftung (nur Anzeige)
  function colorName(rgb) {
    const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 40) return 'schwarz';
    const h = (() => {
      const d = mx - mn;
      let hh;
      if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
      return (hh * 60 + 360) % 360;
    })();
    if (h < 20 || h >= 330) return 'rot';
    if (h < 50) return 'orange';
    if (h < 75) return 'gelb';
    if (h < 165) return 'grün';
    if (h < 200) return 'türkis';
    if (h < 265) return 'blau';
    return 'violett';
  }

  // Alle Kurven im Rahmen finden. frame im Bild; gibt Pixel-Traces zurueck.
  function findTraces(img, frame) {
    const diff = T.features(img);
    const fw = frame.x1 - frame.x0, fh = frame.y1 - frame.y0;
    const y0 = Math.round(frame.y0 + fh * 0.015), y1 = Math.round(frame.y1 - fh * 0.015);
    const traces = [];
    for (const fx of [0.3, 0.45, 0.6, 0.72, 0.85, 0.18]) {
      const x = Math.round(frame.x0 + fw * fx);
      for (const p of colPeaks(img, diff, x, y0, y1)) {
        if (traces.some(t => !isNaN(t.ys[x]) && Math.abs(t.ys[x] - p.y) < 3)) continue;
        const tr = T.traceCurve(img, x, p.y);
        if (!tr) continue;
        // auf Rahmeninneres beschneiden
        for (let xx = 0; xx < tr.ys.length; xx++) {
          if (xx < frame.x0 + 3 || xx > frame.x1 - 3 || tr.ys[xx] < frame.y0 + 2 || tr.ys[xx] > frame.y1 - 2) tr.ys[xx] = NaN;
        }
        let s = -1, e = -1;
        for (let xx = 0; xx < tr.ys.length; xx++) if (!isNaN(tr.ys[xx])) { if (s < 0) s = xx; e = xx; }
        if (s < 0 || e - s < fw * 0.25) continue;
        for (let xx = 0; xx < tr.found.length; xx++) if (isNaN(tr.ys[xx])) tr.found[xx] = NaN;
        tr.xStart = s; tr.xEnd = e;
        // Echte Treffer (vor Lueckenfuellen) muessen den Grossteil der Strecke tragen
        let hits = 0, nearEdge = 0;
        for (let xx = s; xx <= e; xx++) {
          if (!isNaN(tr.found[xx])) hits++;
          const yy = tr.ys[xx];
          if (!isNaN(yy) && (yy - frame.y0 < fh * 0.012 || frame.y1 - yy < fh * 0.012)) nearEdge++;
        }
        tr.coverage = hits / (e - s + 1);
        if (tr.coverage < 0.6) continue;
        // Rahmenkante oben/unten
        if (nearEdge > (e - s + 1) * 0.5) continue;
        // Gitter-/Rahmenlinie: fast konstante Hoehe ueber fast die ganze Breite
        let m = 0, q = 0, n = 0;
        for (let xx = s; xx <= e; xx += 3) if (!isNaN(tr.ys[xx])) { m += tr.ys[xx]; q += tr.ys[xx] ** 2; n++; }
        const sd = Math.sqrt(Math.max(0, q / n - (m / n) ** 2));
        if (sd < 2 && e - s > fw * 0.6) continue;
        // Leistungs-/Drehmomentverlaeufe sind nie flach: Hoehenumfang < 4 % = Rahmen, Text, Gitter
        let ymin = Infinity, ymax = -Infinity;
        for (let xx = s; xx <= e; xx++) if (!isNaN(tr.ys[xx])) { ymin = Math.min(ymin, tr.ys[xx]); ymax = Math.max(ymax, tr.ys[xx]); }
        if (ymax - ymin < fh * 0.04) continue;
        tr.rgb = meanColor(img, diff, tr);
        const dup = traces.findIndex(t => sameTrace(t, tr));
        if (dup >= 0) {
          if (tr.xEnd - tr.xStart > traces[dup].xEnd - traces[dup].xStart) traces[dup] = tr;
          continue;
        }
        traces.push(tr);
      }
    }
    return traces;
  }

  function samples(tr, step) {
    const out = [];
    for (let x = tr.xStart; x <= tr.xEnd; x += step) if (!isNaN(tr.ys[x])) out.push([x, tr.ys[x]]);
    return out;
  }

  // Lineare Regression y = alpha + beta * m, R^2
  function linfit(ms, ys) {
    const n = ms.length;
    if (n < 10) return null;
    const mm = ms.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let smm = 0, smy = 0, syy = 0;
    for (let i = 0; i < n; i++) { smm += (ms[i] - mm) ** 2; smy += (ms[i] - mm) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
    if (!smm || !syy) return null;
    const beta = smy / smm, alpha = my - beta * mm;
    const r2 = (smy * smy) / (smm * syy);
    return { alpha, beta, r2 };
  }

  function hue(rgb) {
    const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    let hh;
    if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
  }

  // Gleiche Farbe = gleicher Lauf. Farbstich verschiebt Namen, deshalb Farbton-Abstand statt Name.
  function colorClose(a, b) {
    const ca = a.rgb, cb = b.rgb;
    const chroma = c => Math.max(...c) - Math.min(...c);
    if (chroma(ca) < 40 && chroma(cb) < 40) return true; // beide schwarz/grau
    if (chroma(ca) < 40 || chroma(cb) < 40) return false;
    const dh = Math.abs(hue(ca) - hue(cb));
    return Math.min(dh, 360 - dh) < 28;
  }

  // Hauptfunktion: Traces -> Kurven mit Werten. cal = {x:{a,b}, power:{a,b,unit}, nm:{a,b}|null}
  function build(img, frame, cal, sourceName) {
    const traces = findTraces(img, frame);
    const rpm = x => cal.x.a + cal.x.b * x;
    const pw = y => cal.power.a + cal.power.b * y; // in cal.power.unit
    const toPS = v => cal.power.unit === 'kW' ? v / 0.7354988 : v;

    // negative Zweige (Auslauf, Schleppleistung) verwerfen
    const good = traces.filter(tr => {
      const vals = samples(tr, 4).map(([, y]) => pw(y)).sort((a, b) => a - b);
      return vals.length && vals[Math.floor(vals.length / 2)] > 0.5;
    });

    // Paarung Leistung/Drehmoment ueber Physik
    const pairs = [];
    for (let i = 0; i < good.length; i++) for (let j = 0; j < good.length; j++) {
      if (i === j || !colorClose(good[i], good[j])) continue;
      const P = good[i], M = good[j];
      const ms = [], ys = [];
      for (let x = Math.max(P.xStart, M.xStart); x <= Math.min(P.xEnd, M.xEnd); x += 3) {
        if (isNaN(P.ys[x]) || isNaN(M.ys[x])) continue;
        const n = rpm(x);
        if (n <= 100) continue;
        ms.push(toPS(pw(P.ys[x])) * PS_NM / n); ys.push(M.ys[x]);
      }
      const shorter = Math.min(P.xEnd - P.xStart, M.xEnd - M.xStart);
      if (ms.length * 3 < shorter * 0.4) continue;
      const f = linfit(ms, ys);
      if (f && f.beta < 0 && f.r2 > 0.97) pairs.push({ i, j, f });
    }
    pairs.sort((a, b) => b.f.r2 - a.f.r2);
    const role = new Map(); // index -> {kind, partner, fit}
    for (const p of pairs) {
      if (role.has(p.i) || role.has(p.j)) continue;
      role.set(p.i, { kind: 'P', partner: p.j });
      role.set(p.j, { kind: 'M', partner: p.i, fit: p.f });
    }

    // Nm-Skala: OCR bevorzugt, wenn konsistent mit Physik; sonst Physik
    const notes = [];
    let nmScale = cal.nm || null;
    const fits = Array.from(role.values()).filter(r => r.kind === 'M').map(r => r.fit);
    if (fits.length) {
      const phys = fits.reduce((s, f) => ({ alpha: s.alpha + f.alpha / fits.length, beta: s.beta + f.beta / fits.length }), { alpha: 0, beta: 0 });
      const physScale = { a: -phys.alpha / phys.beta, b: 1 / phys.beta, src: 'physik' }; // Nm = a + b*y
      if (nmScale) {
        const yMid = (frame.y0 + frame.y1) / 2, yTop = frame.y0;
        const d = Math.abs((nmScale.a + nmScale.b * yTop) - (physScale.a + physScale.b * yTop)) +
          Math.abs((nmScale.a + nmScale.b * yMid) - (physScale.a + physScale.b * yMid));
        const span = Math.abs(nmScale.b * (frame.y1 - frame.y0));
        if (d > span * 0.04) { notes.push('Nm-Skala aus Beschriftung weicht von Physik ab, Physik verwendet'); nmScale = physScale; }
        else nmScale = Object.assign({ src: 'ocr+physik' }, nmScale);
      } else { nmScale = physScale; notes.push('Nm-Skala aus Leistung berechnet (M = P·7023,5/n)'); }
    }

    // Kurven bauen
    const curves = [];
    const counts = {};
    good.forEach((tr, idx) => {
      const r = role.get(idx);
      const kind = r ? r.kind : 'P';
      if (kind === 'M' && !nmScale) return;
      const pts = [];
      for (let x = tr.xStart; x <= tr.xEnd; x++) {
        if (isNaN(tr.ys[x])) continue;
        const v = kind === 'P' ? pw(tr.ys[x]) : nmScale.a + nmScale.b * tr.ys[x];
        pts.push([rpm(x), v]);
      }
      const name = colorName(tr.rgb);
      const runKey = r ? Math.min(idx, r.partner) : idx;
      if (!(runKey in counts)) counts[runKey] = Object.keys(counts).length + 1;
      curves.push({
        kind, unit: kind === 'P' ? cal.power.unit : 'Nm',
        label: `${sourceName ? sourceName + ' ' : ''}${name}`.trim(),
        rgb: tr.rgb, run: counts[runKey], paired: !!r,
        points: pts, trace: { ys: tr.ys, xStart: tr.xStart, xEnd: tr.xEnd }
      });
    });
    // Reihenfolge: nach Lauf, Leistung vor Drehmoment
    curves.sort((a, b) => a.run - b.run || (a.kind === 'P' ? -1 : 1));
    // gleiche Farbe bei mehreren Laeufen (z.B. Schwarz-Weiss-Druck): Laufnummer anhaengen
    const byName = {};
    for (const c of curves) (byName[c.label] = byName[c.label] || new Set()).add(c.run);
    for (const c of curves) if (byName[c.label].size > 1) c.label += ' ' + c.run;
    return { curves, nmScale, notes, rawTraces: traces.length };
  }

  const api = { build, findTraces, colorName, linfit };
  global.XDCCurves = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
