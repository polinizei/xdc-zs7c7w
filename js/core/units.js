// XDC - units.js | Einheiten, Resampling, Achsen-Ticks.
(function (global) {
  'use strict';

  const KW_PER_PS = 0.7354988; // DIN-PS

  function psToKw(ps) { return ps * KW_PER_PS; }
  function kwToPs(kw) { return kw / KW_PER_PS; }

  // Wert einer Kurve (Original-Einheit) in Ziel-Anzeige-Einheit.
  function convert(value, from, to) {
    if (from === to) return value;
    if (from === 'PS' && to === 'kW') return psToKw(value);
    if (from === 'kW' && to === 'PS') return kwToPs(value);
    return value; // Nm bleibt Nm
  }

  // points: [[rpm, val], ...] aufsteigend -> gleichmaessiges Raster (step U/min), linear interpoliert.
  function resample(points, step) {
    if (!points || points.length < 2) return points ? points.slice() : [];
    step = step || 25;
    const out = [];
    const r0 = Math.ceil(points[0][0] / step) * step;
    const r1 = Math.floor(points[points.length - 1][0] / step) * step;
    let i = 0;
    for (let r = r0; r <= r1; r += step) {
      while (i < points.length - 2 && points[i + 1][0] < r) i++;
      const [xa, ya] = points[i], [xb, yb] = points[i + 1];
      const t = xb === xa ? 0 : (r - xa) / (xb - xa);
      out.push([r, ya + (yb - ya) * t]);
    }
    return out;
  }

  // Wert an beliebiger Drehzahl (linear interpoliert), null ausserhalb.
  function valueAt(points, rpm) {
    if (!points || points.length < 2) return null;
    if (rpm < points[0][0] || rpm > points[points.length - 1][0]) return null;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] <= rpm) lo = mid; else hi = mid;
    }
    const [xa, ya] = points[lo], [xb, yb] = points[hi];
    const t = xb === xa ? 0 : (rpm - xa) / (xb - xa);
    return ya + (yb - ya) * t;
  }

  function peak(points) {
    if (!points || !points.length) return null;
    let best = points[0];
    for (const p of points) if (p[1] > best[1]) best = p;
    return { rpm: best[0], value: best[1] };
  }

  // Huebsche Ticks: ca. count Schritte in 1/2/2.5/5 x 10^n.
  function niceTicks(min, max, count) {
    count = count || 6;
    const span = max - min;
    if (span <= 0) return [min];
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = mag;
    for (const m of [1, 2, 2.5, 5, 10]) { if (raw <= m * mag) { step = m * mag; break; } }
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6);
    }
    return ticks;
  }

  const api = { KW_PER_PS, psToKw, kwToPs, convert, resample, valueAt, peak, niceTicks };
  global.XDCUnits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
