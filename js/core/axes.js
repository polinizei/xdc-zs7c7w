// XDC - axes.js | Achsen-Kalibrierung aus erkannten Zahlen (OCR-Woerter oder PDF-Text).
// Eingabe: Woerter {text, x0,y0,x1,y1} in Koordinaten des entzerrten Bildes, Rahmen {x0,y0,x1,y1}.
// RANSAC-Geradenanpassung je Randstreifen (bis zu 3 Skalen pro Seite, z.B. KW + PS links, PS + Nm rechts),
// Einheiten ueber Steigungsverhaeltnis (kW = 0,7355 * PS) und Lage bestimmt.
(function (global) {
  'use strict';

  const KW_PER_PS = 0.7354988;

  function parseNum(t) {
    if (!t) return null;
    // Tick-Striche neben der Zahl (z.B. "14-", "-12-") entfernen: nur ein fuehrendes Minus ist Vorzeichen
    let s = String(t).replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
    s = s.replace(/-+$/, '').replace(/^-+/, '-').replace(/\.+$/, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const v = parseFloat(s);
    return isFinite(v) && Math.abs(v) < 100000 ? v : null;
  }

  function toItems(words) {
    const out = [];
    for (const w of words) {
      const v = parseNum(w.text);
      if (v == null) continue;
      out.push({ v, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: Math.max(4, w.y1 - w.y0), w: w.x1 - w.x0, text: w.text });
    }
    return out;
  }

  // RANSAC: Wert = a + b * pos.  pos = 'cx' oder 'cy'. sign = +1 (steigend) oder -1.
  function fitScale(items, pos, sign, minInl) {
    let best = null;
    const n = items.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const A = items[i], B = items[j];
      const dp = B[pos] - A[pos];
      if (Math.abs(dp) < 8 || A.v === B.v) continue;
      const b = (B.v - A.v) / dp;
      if (Math.sign(b) !== sign) continue;
      const a = A.v - b * A[pos];
      const inl = items.filter(it => Math.abs((it.v - a) / b - it[pos]) < Math.max(6, it.h * 0.8));
      const distinct = new Set(inl.map(it => it.v)).size;
      if (distinct < minInl) continue;
      const span = Math.max(...inl.map(it => it[pos])) - Math.min(...inl.map(it => it[pos]));
      const score = distinct * 1000 + span * 0.01;
      if (!best || score > best.score) best = { score, inl };
    }
    if (!best) return null;
    // Kleinste Quadrate auf den Inliern
    const inl = best.inl;
    const mx = inl.reduce((s, it) => s + it[pos], 0) / inl.length;
    const mv = inl.reduce((s, it) => s + it.v, 0) / inl.length;
    let sxx = 0, sxv = 0;
    for (const it of inl) { sxx += (it[pos] - mx) ** 2; sxv += (it[pos] - mx) * (it.v - mv); }
    const b = sxv / sxx, a = mv - b * mx;
    let rmsPx = 0;
    for (const it of inl) rmsPx += ((it.v - a) / b - it[pos]) ** 2;
    rmsPx = Math.sqrt(rmsPx / inl.length);
    const col = inl.reduce((s, it) => s + (pos === 'cy' ? it.cx : it.cy), 0) / inl.length;
    return { a, b, n: new Set(inl.map(it => it.v)).size, rmsPx, col, inliers: inl };
  }

  function multiScales(items, pos, sign, max) {
    const scales = [];
    let rest = items.slice();
    for (let k = 0; k < max; k++) {
      const s = fitScale(rest, pos, sign, 3);
      if (!s) break;
      scales.push(s);
      const used = new Set(s.inliers);
      rest = rest.filter(it => !used.has(it));
    }
    return scales;
  }

  function sameScale(s1, s2, frame) {
    const yA = frame.y0, yB = frame.y1;
    const v = (s, y) => s.a + s.b * y;
    const tol = Math.abs(v(s1, yA) - v(s1, yB)) * 0.015;
    return Math.abs(v(s1, yA) - v(s2, yA)) < tol && Math.abs(v(s1, yB) - v(s2, yB)) < tol;
  }

  // Ist s1 = 0,7355 * s2 an allen Hoehen? -> s1 kW, s2 PS
  function isKwOf(s1, s2, frame) {
    const v = (s, y) => s.a + s.b * y;
    const span = Math.abs(v(s2, frame.y0) - v(s2, frame.y1));
    return [frame.y0, (frame.y0 + frame.y1) / 2, frame.y1]
      .every(y => Math.abs(v(s1, y) - KW_PER_PS * v(s2, y)) < span * KW_PER_PS * 0.025);
  }

  // words: alle Zahl-Woerter, frame: Rahmen im entzerrten Bild, units: Kopfzeilen [{unit,cx,side}]
  function calibrate(words, frame, units) {
    units = units || [];
    const items = toItems(words);
    const fw = frame.x1 - frame.x0, fh = frame.y1 - frame.y0;
    const top = items.filter(it => it.cy < frame.y0 + fh * 0.02 && it.cy > frame.y0 - fh * 0.12 && it.cx > frame.x0 - fw * 0.03 && it.cx < frame.x1 + fw * 0.03);
    const bot = items.filter(it => it.cy > frame.y1 - fh * 0.02 && it.cy < frame.y1 + fh * 0.12 && it.cx > frame.x0 - fw * 0.03 && it.cx < frame.x1 + fw * 0.03);
    const left = items.filter(it => it.cx < frame.x0 + fw * 0.02 && it.cy > frame.y0 - fh * 0.03 && it.cy < frame.y1 + fh * 0.03);
    // rechts auch knapp innerhalb (eingerueckte Nm-Skala)
    const right = items.filter(it => it.cx > frame.x1 - fw * 0.06 && it.cy > frame.y0 - fh * 0.03 && it.cy < frame.y1 + fh * 0.03);

    const res = { x: null, ps: null, kw: null, nm: null, unknown: null, notes: [] };
    // X: oben und unten getrennt anpassen, beste nehmen (unten kann ein anderes Panel sein)
    const xs = [fitScale(top, 'cx', +1, 3), fitScale(bot, 'cx', +1, 3)].filter(Boolean)
      .filter(s => s.a + s.b * frame.x0 > 0 && s.a + s.b * frame.x1 < 30000);
    xs.sort((p, q) => q.n - p.n || p.rmsPx - q.rmsPx);
    if (xs[0]) res.x = xs[0];

    const L = multiScales(left, 'cy', -1, 3).map(s => Object.assign(s, { side: 'left' }));
    const R = multiScales(right, 'cy', -1, 3).map(s => Object.assign(s, { side: 'right' }));
    // Duplikate (PS links = PS rechts) zusammenfassen
    const all = [];
    for (const s of L.concat(R)) {
      const dup = all.find(t => sameScale(t, s, frame));
      if (dup) { dup.n += s.n; dup.both = true; } else all.push(s);
    }
    // Einheit aus Kopfzeile: naechste Kopfbeschriftung derselben Seite ueber der Skalenspalte
    for (const s of all) {
      const cand = units.filter(u => u.side === s.side && Math.abs(u.cx - s.col) < fw * 0.06)
        .sort((p, q) => Math.abs(p.cx - s.col) - Math.abs(q.cx - s.col));
      if (cand[0]) s.unit = cand[0].unit;
    }
    // kW/PS-Paar ueber Steigungsverhaeltnis (bestaetigt oder ersetzt Kopfzeile)
    for (const s1 of all) for (const s2 of all) {
      if (s1 !== s2 && !res.kw && isKwOf(s1, s2, frame)) { res.kw = s1; res.ps = s2; s1.unit = 'kW'; s2.unit = 'PS'; }
    }
    if (!res.ps) res.ps = all.find(s => s.unit === 'PS') || null;
    if (!res.kw) res.kw = all.find(s => s.unit === 'kW') || null;
    if (!res.nm) res.nm = all.find(s => s.unit === 'Nm') || null;
    const restS = all.filter(s => s !== res.kw && s !== res.ps && s !== res.nm);
    if (!res.ps && res.kw) { res.notes.push('Leistung aus kW-Skala'); }
    if (!res.ps && !res.kw) {
      // Kein Paar, keine Kopfzeile: beidseitig vorhandene oder linke Skala ist die Leistungsskala, Einheit unsicher
      restS.sort((p, q) => (q.both ? 1 : 0) - (p.both ? 1 : 0) || (p.side === 'left' ? -1 : 1) || q.n - p.n);
      if (restS.length) { res.unknown = restS.shift(); res.notes.push('Einheit der Leistungsskala unsicher'); }
    }
    // Nm-Kandidat: rechte Skala, die nicht Leistung ist
    if (!res.nm) {
      const nm = restS.filter(s => s !== res.unknown && s.side === 'right').sort((p, q) => q.n - p.n)[0];
      if (nm) res.nm = nm;
    }
    res.counts = { top: top.length, bot: bot.length, left: left.length, right: right.length };
    return res;
  }

  const api = { calibrate, parseNum, fitScale, multiScales, toItems, KW_PER_PS };
  global.XDCAxes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
