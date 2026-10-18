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

  // Duplikat: deckungsgleich ueber einen Teil, oder weitgehend ueberlappend mit kleiner mittlerer Abweichung
  // (eine wacklige Zweitspur derselben Linie).
  function sameTrace(a, b) {
    let n = 0, s = 0;
    const ds = [];
    const x0 = Math.max(a.xStart, b.xStart), x1 = Math.min(a.xEnd, b.xEnd);
    for (let x = x0; x <= x1; x += 2) {
      if (isNaN(a.ys[x]) || isNaN(b.ys[x])) continue;
      const d = Math.abs(a.ys[x] - b.ys[x]);
      s += d; n++; ds.push(d);
    }
    const shorter = Math.min(a.xEnd - a.xStart, b.xEnd - b.xStart);
    const mean = s / Math.max(1, n), frac = n * 2 / Math.max(1, shorter);
    ds.sort((p, q) => p - q);
    const median = ds.length ? ds[Math.floor(ds.length / 2)] : Infinity;
    // Duplikat nur bei gleicher Farbe: Kurven verschiedener Laeufe liegen oft wenige Pixel nebeneinander
    const c = seedCos(a, b);
    // Fast pixelgleich ueber den Grossteil: Duplikat unabhaengig von der Farbe (Startpunkt an einer Kreuzung
    // liefert eine Mischfarbe). Kurven verschiedener Laeufe sind nie ueber 80 % ihrer Laenge deckungsgleich.
    return (frac > 0.8 && median < 1.2) || (frac > 0.3 && mean < 2.5 && c > 0.9) || (frac > 0.6 && mean < 5 && c > 0.97);
  }

  function seedCos(a, b) {
    const p = a.seed, q = b.seed;
    const mp = Math.hypot(...p), mq = Math.hypot(...q);
    return mp && mq ? (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (mp * mq) : 0;
  }

  // Gleichfarbige Stuecke, die nahtlos aneinander anschliessen (Kurve riss an Gitterlinie/Cursor ab), verbinden.
  function mergeSegments(traces, fw, frame) {
    const fh = frame.y1 - frame.y0;
    const nearTop = y => y - frame.y0 < fh * 0.025;
    let merged = true;
    while (merged) {
      merged = false;
      traces.sort((p, q) => p.xStart - q.xStart);
      outer:
      for (let i = 0; i < traces.length; i++) for (let j = 0; j < traces.length; j++) {
        const a = traces[i], b = traces[j];
        const cs = i === j ? 0 : seedCos(a, b);
        if (cs < 0.85) continue;
        const gap = b.xStart - a.xEnd;
        // Spitze oben abgeschnitten (Kurve laeuft ueber das Skalenende): beide Enden an der Oberkante.
        // Die Geometrie ist hier ein starkes Indiz, deshalb lockerere Farbschwelle als beim normalen Anschluss.
        if (gap > 0 && gap < fw * 0.15 && nearTop(a.ys[a.xEnd]) && nearTop(b.ys[b.xStart])) {
          const ys = a.ys.slice(), found = a.found.slice();
          for (let x = b.xStart; x <= b.xEnd; x++) { ys[x] = b.ys[x]; found[x] = b.found[x]; }
          for (let x = a.xEnd + 1; x < b.xStart; x++) ys[x] = frame.y0 + 2;
          const m = Object.assign({}, a, { ys, found, xEnd: b.xEnd, clipped: true });
          traces.splice(Math.max(i, j), 1); traces.splice(Math.min(i, j), 1, m);
          merged = true;
          break outer;
        }
        if (cs < 0.95 || gap < -fw * 0.03 || gap > fw * 0.08) continue;
        // Steigung am Ende von a schaetzen und auf den Anfang von b fortsetzen
        const k = Math.min(20, a.xEnd - a.xStart);
        const slope = (a.ys[a.xEnd] - a.ys[a.xEnd - k]) / Math.max(1, k);
        const xb = Math.max(b.xStart, a.xEnd);
        const pred = a.ys[a.xEnd] + slope * (xb - a.xEnd);
        if (isNaN(b.ys[xb]) || Math.abs(pred - b.ys[xb]) > Math.max(10, Math.abs(gap) * 0.5)) continue;
        // a bis zum Anschluss, dann b; Luecke linear fuellen
        const ys = a.ys.slice(), found = a.found.slice();
        for (let x = xb; x <= b.xEnd; x++) { ys[x] = b.ys[x]; found[x] = b.found[x]; }
        for (let x = a.xEnd + 1; x < xb; x++) ys[x] = a.ys[a.xEnd] + (b.ys[xb] - a.ys[a.xEnd]) * (x - a.xEnd) / (xb - a.xEnd);
        const m = Object.assign({}, a, { ys, found, xEnd: b.xEnd });
        traces.splice(Math.max(i, j), 1); traces.splice(Math.min(i, j), 1, m);
        merged = true;
        break outer;
      }
    }
    return traces;
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

  // Grau-Anteil einer Abweichung: 1 = alle Kanaele gleich (Gitter/Text/Rahmen), klein = farbig (Kurve).
  // Spannweite statt Winkel: (89,38,89) ist klar gruen, hat aber einen kleinen Winkel zu (1,1,1).
  function grayness(d0, d1, d2) {
    const mx = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
    if (!mx) return 0;
    const spread = Math.max(d0, d1, d2) - Math.min(d0, d1, d2);
    return 1 - spread / mx;
  }

  // Gitterzeilen/-spalten finden (graue Abweichung ueber grossen Teil der Breite/Hoehe, auch punktiert)
  // und dort graue Pixel neutralisieren. Farbige Kurven, die das Gitter kreuzen, bleiben erhalten.
  function suppressGrid(img, diff, frame) {
    const w = img.width;
    const x0 = Math.round(frame.x0) + 3, x1 = Math.round(frame.x1) - 3;
    const y0 = Math.round(frame.y0) + 3, y1 = Math.round(frame.y1) - 3;
    const isGrayLine = (o) => {
      const d0 = diff[o], d1 = diff[o + 1], d2 = diff[o + 2];
      return d0 + d1 + d2 > 18 && grayness(d0, d1, d2) > 0.75;
    };
    const rows = [], cols = [];
    for (let y = y0; y <= y1; y++) {
      let n = 0;
      for (let x = x0; x <= x1; x++) if (isGrayLine((y * w + x) * 3)) n++;
      rows.push(n / (x1 - x0 + 1));
    }
    for (let x = x0; x <= x1; x++) {
      let n = 0;
      for (let y = y0; y <= y1; y++) if (isGrayLine((y * w + x) * 3)) n++;
      cols.push(n / (y1 - y0 + 1));
    }
    // Zeile ist Gitter, wenn deutlich ueber dem Umfeld und ueber 15 % belegt (punktierte Linien ~30-60 %)
    const pick = (arr) => {
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        let loc = 0, n = 0;
        for (let k = -8; k <= 8; k++) if (Math.abs(k) > 2 && arr[i + k] !== undefined) { loc += arr[i + k]; n++; }
        loc /= Math.max(1, n);
        if (arr[i] > 0.15 && arr[i] > loc * 2.2) out.push(i);
      }
      return out;
    };
    const gr = pick(rows).map(i => i + y0), gc = pick(cols).map(i => i + x0);
    // Maske der Gitterlinien: das Tracing zaehlt Fehlstellen AUF einer Gitterlinie nicht als Luecke
    const mask = new Uint8Array(w * img.height);
    img._xdcGridMask = mask;
    const zero = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= img.height) return;
      mask[y * w + x] = 1;
      const o = (y * w + x) * 3;
      if (grayness(diff[o], diff[o + 1], diff[o + 2]) > 0.7) { diff[o] = 0; diff[o + 1] = 0; diff[o + 2] = 0; }
    };
    for (const y of gr) for (let x = x0 - 3; x <= x1 + 3; x++) for (let k = -1; k <= 1; k++) zero(x, y + k);
    for (const x of gc) for (let y = y0 - 3; y <= y1 + 3; y++) for (let k = -1; k <= 1; k++) zero(x + k, y);
    return { rows: gr.length, cols: gc.length };
  }

  // Zweiter Durchgang: Spur auf die Linienmitte der eigenen Farbe einrasten. Die Kurvenfarbe wird ueber die
  // ganze erste Spur gemittelt (zuverlaessiger als ein Startpunkt). Je Spalte gewinnt im Umkreis der Pixel mit
  // der staerksten Farbuebereinstimmung; so loest sich die Spur von Gitterlinien mit aehnlicher Mischfarbe.
  function refineTrace(img, diff, tr, frame, R) {
    const w = img.width;
    const acc = [0, 0, 0];
    let wsum = 0;
    for (let x = tr.xStart; x <= tr.xEnd; x += 2) {
      if (isNaN(tr.found[x])) continue;
      const y = Math.round(tr.found[x]);
      const o = (y * w + x) * 3, m = Math.hypot(diff[o], diff[o + 1], diff[o + 2]);
      acc[0] += diff[o] * m; acc[1] += diff[o + 1] * m; acc[2] += diff[o + 2] * m; wsum += m;
    }
    if (!wsum) return;
    const sf = acc.map(v => v / wsum), sm = Math.hypot(...sf);
    if (!sm) return;
    const y1 = tr.ys;
    const yTop = Math.ceil(frame.y0 + 2), yBot = Math.floor(frame.y1 - 2);
    // bester Farbtreffer in Spalte x im Fenster um yc (nur sehr hohe Farbuebereinstimmung)
    const strict = (x, yc, r) => {
      let best = null;
      for (let y = Math.max(yTop, Math.round(yc - r)); y <= Math.min(yBot, Math.round(yc + r)); y++) {
        const o = (y * w + x) * 3;
        const d0 = diff[o], d1 = diff[o + 1], d2 = diff[o + 2];
        const m = Math.hypot(d0, d1, d2);
        if (m < sm * 0.35) continue;
        const cs = (d0 * sf[0] + d1 * sf[1] + d2 * sf[2]) / (m * sm);
        if (cs < 0.95) continue;
        // Farbe vor Staerke: Linienpixel ~0,97-0,99, Gitter-Mischpixel ~0,90-0,93
        const score = Math.pow(cs, 40) * Math.min(m, sm) * (1 - Math.abs(y - yc) / (r * 4));
        if (!best || score > best.s) best = { y, s: score };
      }
      return best;
    };
    // Anker: Spalte nahe der Mitte, an der die erste Spur sicher auf der Linie liegt
    let anchor = -1, ay = 0;
    const mid = Math.round((tr.xStart + tr.xEnd) / 2);
    for (let k = 0; k < (tr.xEnd - tr.xStart) / 2 && anchor < 0; k++) {
      for (const x of [mid + k, mid - k]) {
        if (x < tr.xStart || x > tr.xEnd || isNaN(y1[x])) continue;
        const b = strict(x, y1[x], 2);
        if (b) { anchor = x; ay = b.y; break; }
      }
    }
    if (anchor < 0) { tr.seed = sf.map(Math.round); return; }
    const ys = tr.ys.slice();
    ys[anchor] = ay;
    // Folgespur je Richtung: Fenster um eigene Position + Steigung der ersten Spur; ohne Treffer der Steigung folgen
    for (const dir of [1, -1]) {
      let y = ay, miss = 0;
      for (let x = anchor + dir; x >= tr.xStart && x <= tr.xEnd; x += dir) {
        if (isNaN(y1[x]) || isNaN(y1[x - dir])) { ys[x] = y1[x]; continue; }
        const pred = y + (y1[x] - y1[x - dir]);
        const b = strict(x, pred, 6);
        if (b) { y = b.y; miss = 0; } else { y = pred; miss++; }
        // nach langer Fehlstrecke wieder auf die erste Spur setzen
        if (miss > 40) { y = y1[x]; miss = 0; }
        ys[x] = Math.max(yTop, Math.min(yBot, y));
      }
    }
    // Median gegen Einzelausreisser, leichte Glaettung
    tr.ys = T.boxSmooth(T.medianSmooth(ys, 7), 5);
    tr.seed = sf.map(Math.round);
  }

  // Alle Kurven im Rahmen finden. frame im Bild; gibt Pixel-Traces zurueck.
  function findTraces(img, frame) {
    const diff = T.features(img);
    if (!img._xdcGrid) img._xdcGrid = suppressGrid(img, diff, frame);
    const fw = frame.x1 - frame.x0, fh = frame.y1 - frame.y0;
    const y0 = Math.round(frame.y0 + fh * 0.015), y1 = Math.round(frame.y1 - fh * 0.015);
    const traces = [];
    const dbg = img._xdcDbg; // optionales Diagnose-Protokoll: [{x, y, grund}]
    const why = (x, y, g) => { if (dbg) dbg.push({ x, y: Math.round(y), g }); };
    for (const fx of [0.3, 0.45, 0.6, 0.72, 0.85, 0.18]) {
      const x = Math.round(frame.x0 + fw * fx);
      for (const p of colPeaks(img, diff, x, y0, y1)) {
        if (traces.some(t => !isNaN(t.ys[x]) && Math.abs(t.ys[x] - p.y) < 3)) { why(x, p.y, 'schon erfasst'); continue; }
        const tr = T.traceCurve(img, x, p.y);
        if (!tr) { why(x, p.y, 'kein Trace'); continue; }
        // zu schwaches Merkmal = Rauschen (echte Kurven liegen deutlich darueber)
        if (Math.hypot(tr.seed[0], tr.seed[1], tr.seed[2]) < 14) { why(x, p.y, 'schwach'); continue; }
        // auf Rahmeninneres beschneiden
        for (let xx = 0; xx < tr.ys.length; xx++) {
          if (xx < frame.x0 + 3 || xx > frame.x1 - 3 || tr.ys[xx] < frame.y0 + 2 || tr.ys[xx] > frame.y1 - 2) tr.ys[xx] = NaN;
        }
        let s = -1, e = -1;
        for (let xx = 0; xx < tr.ys.length; xx++) if (!isNaN(tr.ys[xx])) { if (s < 0) s = xx; e = xx; }
        if (s < 0 || e - s < fw * 0.25) { why(x, p.y, 'zu kurz'); continue; }
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
        if (tr.coverage < 0.6) { why(x, p.y, 'Abdeckung ' + tr.coverage.toFixed(2)); continue; }
        // Rahmenkante oben/unten
        if (nearEdge > (e - s + 1) * 0.5) { why(x, p.y, 'Rahmenkante'); continue; }
        // Gitter-/Rahmenlinie: fast konstante Hoehe ueber fast die ganze Breite
        let m = 0, q = 0, n = 0;
        for (let xx = s; xx <= e; xx += 3) if (!isNaN(tr.ys[xx])) { m += tr.ys[xx]; q += tr.ys[xx] ** 2; n++; }
        const sd = Math.sqrt(Math.max(0, q / n - (m / n) ** 2));
        if (sd < 2 && e - s > fw * 0.6) { why(x, p.y, 'Gitterlinie'); continue; }
        // Leistungs-/Drehmomentverlaeufe sind nie flach: Hoehenumfang < 4 % = Rahmen, Text, Gitter
        let ymin = Infinity, ymax = -Infinity;
        for (let xx = s; xx <= e; xx++) if (!isNaN(tr.ys[xx])) { ymin = Math.min(ymin, tr.ys[xx]); ymax = Math.max(ymax, tr.ys[xx]); }
        if (ymax - ymin < fh * 0.04) { why(x, p.y, 'flach'); continue; }
        tr.rgb = meanColor(img, diff, tr);
        const dup = traces.findIndex(t => sameTrace(t, tr));
        if (dup >= 0) {
          why(x, p.y, 'Duplikat von ' + dup);
          if (tr.xEnd - tr.xStart > traces[dup].xEnd - traces[dup].xStart) traces[dup] = tr;
          continue;
        }
        why(x, p.y, 'neu ' + traces.length + ' seed ' + tr.seed.join(','));
        traces.push(tr);
      }
    }
    // Gibt es farbige Kurven, sind graue Spuren Gitter, Text oder Rahmen. Bewertet wird die Abweichung
    // vom Hintergrund (Seed-Merkmal), nicht die Pixelfarbe: Farbstich macht sonst auch Gitter "bunt".
    const colored = traces.filter(t => grayness(t.seed[0], t.seed[1], t.seed[2]) < 0.65);
    const kept = mergeSegments(colored.length ? colored : traces, fw, frame);
    // nach dem Verbinden koennen neue Duplikate entstehen: laengere Spur behalten
    kept.sort((p, q) => (q.xEnd - q.xStart) - (p.xEnd - p.xStart));
    const out = [];
    for (const t of kept) if (!out.some(o => sameTrace(o, t))) out.push(t);
    for (const t of out) refineTrace(img, diff, t, frame, 12);
    return out;
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
  // Passung ohne die schlechtesten 15 % (Ausreisser an Engstellen, Wackler der Spur)
  function robustFit(ms, ys) {
    const f0 = linfit(ms, ys);
    if (!f0) return null;
    const res = ms.map((m, i) => Math.abs(ys[i] - (f0.alpha + f0.beta * m)));
    const lim = res.slice().sort((a, b) => a - b)[Math.floor(res.length * 0.85)];
    const m2 = [], y2 = [];
    ms.forEach((m, i) => { if (res[i] <= lim) { m2.push(m); y2.push(ys[i]); } });
    return linfit(m2, y2) || f0;
  }

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
      // gleiche Farbe: ueber Pixelfarbe ODER ueber das Abweichungs-Merkmal (blasse Kurven haben kaum Pixelsaettigung)
      if (i === j || !(colorClose(good[i], good[j]) || seedCos(good[i], good[j]) > 0.85)) continue;
      const P = good[i], M = good[j];
      const ms = [], ys = [];
      const fhh = frame.y1 - frame.y0;
      for (let x = Math.max(P.xStart, M.xStart); x <= Math.min(P.xEnd, M.xEnd); x += 3) {
        if (isNaN(P.ys[x]) || isNaN(M.ys[x])) continue;
        // an der Oberkante gekappte Leistung (Skalenende) verfaelscht die Physik: auslassen
        if (P.ys[x] - frame.y0 < fhh * 0.02) continue;
        const n = rpm(x);
        if (n <= 100) continue;
        ms.push(toPS(pw(P.ys[x])) * PS_NM / n); ys.push(M.ys[x]);
      }
      const shorter = Math.min(P.xEnd - P.xStart, M.xEnd - M.xStart);
      if (ms.length * 3 < shorter * 0.4) continue;
      const f = robustFit(ms, ys);
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
    let nmScale = cal.nm || null, unitConfirmed = false;
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
        else {
          nmScale = Object.assign({ src: 'ocr+physik' }, nmScale);
          // gelesene Nm-Skala passt zur Physik unter der angenommenen Einheit -> Einheit bestaetigt
          unitConfirmed = true;
        }
      } else { nmScale = physScale; notes.push('Nm-Skala aus Leistung berechnet (M = P·7023,5/n)'); }
    }

    // Bruchstuecke ohne Partner: kurz und groesstenteils auf einer anderen Kurve liegend (Mischtreffer an Engstellen)
    const longest = Math.max(...good.map(t => t.xEnd - t.xStart));
    const fragment = new Set();
    good.forEach((t, idx) => {
      if (role.has(idx) || t.xEnd - t.xStart > longest * 0.5) return;
      const onOther = good.some((o, k) => {
        if (k === idx) return false;
        let n = 0, near = 0;
        for (let x = t.xStart; x <= t.xEnd; x += 2) {
          if (isNaN(t.ys[x]) || isNaN(o.ys[x])) continue;
          n++; if (Math.abs(t.ys[x] - o.ys[x]) < 4) near++;
        }
        return n && near / ((t.xEnd - t.xStart) / 2 + 1) > 0.6;
      });
      if (onOther) fragment.add(idx);
    });

    // Kurven bauen
    const curves = [];
    const counts = {};
    good.forEach((tr, idx) => {
      if (fragment.has(idx)) return;
      const r = role.get(idx);
      const kind = r ? r.kind : 'P';
      if (kind === 'M' && !nmScale) return;
      const pts = [];
      for (let x = tr.xStart; x <= tr.xEnd; x++) {
        if (isNaN(tr.ys[x])) continue;
        const v = kind === 'P' ? pw(tr.ys[x]) : nmScale.a + nmScale.b * tr.ys[x];
        pts.push([rpm(x), v]);
      }
      // Farbname aus der Abweichung vom Hintergrund (blasse Kurven haben kaum Pixelsaettigung):
      // Linienfarbe ~ Gegenrichtung der Abweichung, auf den kleinsten Kanal verschoben
      const inv = tr.seed.map(v => -v), lo = Math.min(...inv);
      const dirRGB = inv.map(v => v - lo);
      const strong = Math.max(...dirRGB) > Math.hypot(...tr.seed) * 0.35;
      const name = strong ? colorName(dirRGB.map(v => Math.round(v * 255 / Math.max(1, Math.max(...dirRGB))))) : colorName(tr.rgb);
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
    return { curves, nmScale, notes, unitConfirmed, rawTraces: traces.length };
  }

  const api = { build, findTraces, colorName, linfit };
  global.XDCCurves = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
