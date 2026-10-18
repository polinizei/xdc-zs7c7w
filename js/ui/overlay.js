// XDC - overlay.js | Konsolidiertes Vergleichs-Chart (Canvas 2D).
// Modi: 'P' nur Leistung, 'M' nur Drehmoment, 'PM' klassisches Leistungsdiagramm
// (Leistung links, Drehmoment rechts gestrichelt - bewusste Domaenen-Konvention).
(function (global) {
  'use strict';

  const U = global.XDCUnits;

  function visibleCurves(project) { return project.curves.filter(c => c.visible); }

  function domain(project, settings) {
    const vis = visibleCurves(project);
    let rMin = Infinity, rMax = -Infinity, pMax = 0, mMax = 0, anyM = false;
    for (const c of vis) {
      if (!c.points.length) continue;
      rMin = Math.min(rMin, c.points[0][0]);
      rMax = Math.max(rMax, c.points[c.points.length - 1][0]);
      if (c.kind === 'M') anyM = true;
      for (const [, v] of c.points) {
        if (c.kind === 'P') pMax = Math.max(pMax, U.convert(v, c.unit, settings.unitPower));
        else mMax = Math.max(mMax, v);
      }
    }
    if (!isFinite(rMin)) { rMin = 2000; rMax = 12000; }
    rMin = Math.floor(rMin / 500) * 500; rMax = Math.ceil(rMax / 500) * 500;
    return { rMin, rMax, pMax: pMax * 1.08 || 10, mMax: mMax * 1.08 || 10, anyM };
  }

  // Layout + Skalen fuer aktuellen Modus. Gibt Funktionen px(rpm), pyL(val), pyR(val).
  function layout(w, h, dom, settings) {
    const hasRight = settings.mode === 'PM' && dom.anyM;
    const m = { l: 48, r: hasRight ? 48 : 14, t: 12, b: 32 };
    const iw = w - m.l - m.r, ih = h - m.t - m.b;
    const px = rpm => m.l + (rpm - dom.rMin) / (dom.rMax - dom.rMin) * iw;
    const leftMax = settings.mode === 'M' ? dom.mMax : dom.pMax;
    const pyL = v => m.t + ih - v / leftMax * ih;
    const pyR = v => m.t + ih - v / dom.mMax * ih;
    return { m, iw, ih, px, pyL, pyR, leftMax, hasRight };
  }

  function drawCurve(ctx, c, L, settings) {
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.setLineDash(c.kind === 'M' && settings.mode === 'PM' ? [7, 5] : []);
    ctx.beginPath();
    let started = false;
    for (const [rpm, v] of c.points) {
      let y;
      if (c.kind === 'P') {
        if (settings.mode === 'M') continue;
        y = L.pyL(U.convert(v, c.unit, settings.unitPower));
      } else {
        if (settings.mode === 'P') continue;
        y = settings.mode === 'PM' ? L.pyR(v) : L.pyL(v);
      }
      const x = L.px(rpm);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function render(canvas, project, settings, theme, crosshairRpm) {
    const dpr = global.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600, cssH = canvas.clientHeight || 380;
    if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
    if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    drawInto(ctx, cssW, cssH, project, settings, theme, crosshairRpm);
    return layoutFor(canvas, project, settings);
  }

  function layoutFor(canvas, project, settings) {
    const dom = domain(project, settings);
    return { dom, L: layout(canvas.clientWidth || 600, canvas.clientHeight || 380, dom, settings) };
  }

  function drawInto(ctx, w, h, project, settings, theme, crosshairRpm) {
    const dom = domain(project, settings);
    const L = layout(w, h, dom, settings);
    const vis = visibleCurves(project);

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.font = '11px "Roboto Condensed","Segoe UI",sans-serif';

    // Gitter + X-Achse
    const xTicks = U.niceTicks(dom.rMin, dom.rMax, Math.max(4, Math.floor(L.iw / 70)));
    ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of xTicks) {
      const x = Math.round(L.px(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, L.m.t); ctx.lineTo(x, L.m.t + L.ih); ctx.stroke();
      ctx.fillText(String(t), L.px(t), L.m.t + L.ih + 6);
    }
    // Linke Achse
    const leftUnit = settings.mode === 'M' ? 'Nm' : settings.unitPower;
    const lTicks = U.niceTicks(0, L.leftMax, 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of lTicks) {
      const y = Math.round(L.pyL(t)) + 0.5;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath(); ctx.moveTo(L.m.l, y); ctx.lineTo(L.m.l + L.iw, y); ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(String(t), L.m.l - 6, y);
    }
    // Rechte Achse (Nm)
    if (L.hasRight) {
      const rTicks = U.niceTicks(0, dom.mMax, 6);
      ctx.textAlign = 'left';
      for (const t of rTicks) {
        ctx.fillStyle = theme.muted;
        ctx.fillText(String(t), L.m.l + L.iw + 6, L.pyL(0) - (t / dom.mMax) * L.ih);
      }
    }
    // Achs-Beschriftungen
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(leftUnit, 4, 2);
    if (L.hasRight) { ctx.textAlign = 'right'; ctx.fillText('Nm', w - 4, 2); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('U/min', L.m.l + L.iw, h - 2);

    // Rahmen
    ctx.strokeStyle = theme.axis;
    ctx.strokeRect(L.m.l + 0.5, L.m.t + 0.5, L.iw - 1, L.ih - 1);

    // Kurven
    for (const c of vis) drawCurve(ctx, c, L, settings);

    // Crosshair
    if (crosshairRpm != null && crosshairRpm >= dom.rMin && crosshairRpm <= dom.rMax) {
      const x = L.px(crosshairRpm);
      ctx.strokeStyle = theme.axis; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, L.m.t); ctx.lineTo(x, L.m.t + L.ih); ctx.stroke();
      ctx.setLineDash([]);
      for (const c of vis) {
        const v = U.valueAt(c.points, crosshairRpm);
        if (v == null) continue;
        let y;
        if (c.kind === 'P') {
          if (settings.mode === 'M') continue;
          y = L.pyL(U.convert(v, c.unit, settings.unitPower));
        } else {
          if (settings.mode === 'P') continue;
          y = settings.mode === 'PM' ? L.pyR(v) : L.pyL(v);
        }
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = theme.bg; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    return { dom, L };
  }

  // rpm aus Canvas-Pixelposition (CSS-Pixel), null wenn ausserhalb.
  function rpmAt(canvas, project, settings, cssX) {
    const { dom, L } = layoutFor(canvas, project, settings);
    if (cssX < L.m.l || cssX > L.m.l + L.iw) return null;
    return dom.rMin + (cssX - L.m.l) / L.iw * (dom.rMax - dom.rMin);
  }

  // PNG-Export: 2x Aufloesung, Legende unten eingebrannt.
  function exportPNG(project, settings, theme) {
    const vis = visibleCurves(project);
    const w = 1200, legendH = 26 + vis.length * 20, h = 700 + legendH;
    const cv = document.createElement('canvas');
    cv.width = w * 2; cv.height = h * 2;
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, w, h);
    drawInto(ctx, w, 700, project, settings, theme, null);
    ctx.font = '13px "Roboto Condensed","Segoe UI",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let y = 700 + 18;
    for (const c of vis) {
      ctx.strokeStyle = c.color; ctx.lineWidth = 3;
      ctx.setLineDash(c.kind === 'M' && settings.mode === 'PM' ? [7, 5] : []);
      ctx.beginPath(); ctx.moveTo(16, y); ctx.lineTo(48, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = theme.text;
      const pk = U.peak(c.points);
      const unit = c.kind === 'P' ? settings.unitPower : 'Nm';
      const pkVal = c.kind === 'P' ? U.convert(pk.value, c.unit, settings.unitPower) : pk.value;
      ctx.fillText(`${c.label}  ·  max ${pkVal.toFixed(1)} ${unit} @ ${Math.round(pk.rpm)} U/min`, 56, y);
      y += 20;
    }
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'right';
    ctx.fillText('XDC · Xyger Dyno Compare', w - 10, h - 12);
    return cv.toDataURL('image/png');
  }

  function buildCSV(project, settings) {
    const vis = visibleCurves(project);
    if (!vis.length) return '';
    let rMin = Infinity, rMax = -Infinity;
    for (const c of vis) {
      if (!c.points.length) continue;
      rMin = Math.min(rMin, c.points[0][0]); rMax = Math.max(rMax, c.points[c.points.length - 1][0]);
    }
    const step = 50;
    const head = ['U/min'].concat(vis.map(c =>
      `${c.label} [${c.kind === 'P' ? settings.unitPower : 'Nm'}]`));
    const rows = [head.join(';')];
    for (let r = Math.ceil(rMin / step) * step; r <= rMax; r += step) {
      const row = [r];
      for (const c of vis) {
        let v = U.valueAt(c.points, r);
        if (v != null && c.kind === 'P') v = U.convert(v, c.unit, settings.unitPower);
        row.push(v == null ? '' : v.toFixed(2).replace('.', ','));
      }
      rows.push(row.join(';'));
    }
    return rows.join('\r\n');
  }

  const api = { render, rpmAt, exportPNG, buildCSV, domain, layoutFor };
  global.XDCOverlay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
