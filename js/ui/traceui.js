// XDC - traceui.js | Schritt 3: Kurven antippen, automatisch verfolgen, nachziehen, uebernehmen.
(function (global) {
  'use strict';

  const T = global.XDCTrace;
  const U = global.XDCUnits;

  function TraceUI(viewer, els, callbacks) {
    // els: {toolTap, toolDraw, toolErase, toolNm, name, kind, scaleSel, apply, discard, done, status, nmInfo}
    this.viewer = viewer;
    this.els = els;
    this.cb = callbacks; // {onCurve(curveData), onFinish()}
    this.rect = null; this.rectData = null; this.calib = null;
    this.cur = null;        // {ys, xStart, xEnd}
    this.nmClicks = [];     // Nm-Skala: [{y, v}]
    this.lastDraw = null;
    const self = this;

    viewer.opts.hitHandle = () => null;
    viewer.opts.onTap = p => self._tap(p);
    viewer.opts.onDraw = (mode, p, phase) => self._draw(mode, p, phase);
    viewer.opts.overlayDraw = (ctx, v) => self._overlay(ctx, v);

    els.toolTap.addEventListener('click', () => self.setTool('tap'));
    els.toolDraw.addEventListener('click', () => self.setTool('draw'));
    els.toolErase.addEventListener('click', () => self.setTool('erase'));
    els.toolNm.addEventListener('click', () => self.setTool('nm'));
    els.apply.addEventListener('click', () => self.apply());
    els.discard.addEventListener('click', () => { self.cur = null; self.viewer.draw(); self._status('Kurve verworfen. Neue Kurve antippen.'); });
    els.done.addEventListener('click', () => self.cb.onFinish());
  }

  TraceUI.prototype.start = function (rect, calib, sourceName) {
    this.rect = rect; this.calib = calib; this.sourceName = sourceName;
    this.rectData = rect.getContext('2d').getImageData(0, 0, rect.width, rect.height);
    this.cur = null; this.nmClicks = []; this.tool = 'tap';
    this.viewer.mode = 'pan';
    this.viewer.setImage(rect);
    this.setTool('tap');
    this.els.name.value = '';
    this._status('Kurve antippen (ggf. erst zoomen). Zum Verschieben ziehen, Finger-Pinch zoomt.');
  };

  TraceUI.prototype.setTool = function (tool) {
    this.tool = tool;
    this.viewer.mode = (tool === 'draw' || tool === 'erase') ? tool : 'pan';
    const map = { tap: 'toolTap', draw: 'toolDraw', erase: 'toolErase', nm: 'toolNm' };
    for (const k of Object.values(map)) this.els[k].classList.remove('active');
    this.els[map[tool]].classList.add('active');
    if (tool === 'nm') {
      this.nmClicks = [];
      this._status('Nm-Skala: ZWEI Striche der Nm-Skala antippen (weit auseinander), Wert wird je abgefragt.');
    } else if (tool === 'draw') {
      this._status('Nachziehen: mit dem Finger entlang der Kurve zeichnen, ersetzt den Trace in dem Bereich.');
    } else if (tool === 'erase') {
      this._status('Radieren: über fehlerhafte Bereiche streichen, Enden werden gekürzt.');
    } else {
      this._status('Kurve antippen für automatisches Verfolgen.');
    }
  };

  TraceUI.prototype._status = function (msg) { this.els.status.textContent = msg; };

  TraceUI.prototype._tap = function (p) {
    if (p.x < 0 || p.y < 0 || p.x >= this.rect.width || p.y >= this.rect.height) return;
    if (this.tool === 'nm') {
      const v = parseFloat((global.prompt('Wert dieses Nm-Strichs:') || '').replace(',', '.'));
      if (!isFinite(v)) { this._status('Kein gültiger Wert.'); return; }
      this.nmClicks.push({ y: p.y, v });
      if (this.nmClicks.length >= 2) {
        const [a, b] = this.nmClicks;
        if (a.y === b.y) { this.nmClicks = []; this._status('Beide Punkte auf gleicher Höhe, nochmal.'); return; }
        this.calib.nm = { y1: a.y, v1: a.v, y2: b.y, v2: b.v };
        this.els.nmInfo.textContent = `Nm-Skala gesetzt (${a.v} … ${b.v})`;
        this.setTool('tap');
      } else {
        this._status('Zweiten Nm-Strich antippen.');
      }
      this.viewer.draw();
      return;
    }
    if (this.tool !== 'tap') return;
    this._status('Verfolge Kurve …');
    const res = T.traceCurve(this.rectData, p.x, p.y);
    if (!res) { this._status('Keine Kurve gefunden. Näher an die Linie tippen oder stärker zoomen.'); return; }
    this.cur = res;
    const px = res.xEnd - res.xStart;
    this._status(`Kurve verfolgt (${px}px breit). Prüfen, bei Bedarf nachziehen, dann übernehmen.`);
    this.viewer.draw();
  };

  TraceUI.prototype._draw = function (mode, p, phase) {
    if (!this.cur && mode === 'draw' && phase === 'start') {
      this.cur = { ys: new Array(this.rect.width).fill(NaN), xStart: Math.round(p.x), xEnd: Math.round(p.x) };
    }
    if (!this.cur) return;
    const x = Math.round(Math.max(0, Math.min(this.rect.width - 1, p.x)));
    const y = Math.max(0, Math.min(this.rect.height - 1, p.y));
    if (phase === 'start') { this.lastDraw = { x, y }; }
    const from = this.lastDraw || { x, y };
    const x0 = Math.min(from.x, x), x1 = Math.max(from.x, x);
    for (let xi = x0; xi <= x1; xi++) {
      const t = x1 === x0 ? 0 : (xi - x0) / (x1 - x0);
      const yi = from.x <= x ? from.y + (y - from.y) * t : y + (from.y - y) * t;
      if (mode === 'draw') this.cur.ys[xi] = yi;
      else this.cur.ys[xi] = NaN;
    }
    this.lastDraw = { x, y };
    if (phase === 'end') {
      this.lastDraw = null;
      // Grenzen neu bestimmen
      let s = -1, e2 = -1;
      for (let xi = 0; xi < this.cur.ys.length; xi++) {
        if (!isNaN(this.cur.ys[xi])) { if (s < 0) s = xi; e2 = xi; }
      }
      if (s < 0) { this.cur = null; this._status('Kurve leer.'); return; }
      this.cur.xStart = s; this.cur.xEnd = e2;
      if (mode === 'draw') {
        T.fillGaps(this.cur.ys);
        this.cur.ys = T.boxSmooth(this.cur.ys, 5);
      }
    }
  };

  TraceUI.prototype._overlay = function (ctx, v) {
    // Nm-Skala-Markierungen
    if (this.calib && this.calib.nm) {
      for (const yk of [this.calib.nm.y1, this.calib.nm.y2]) {
        const s = v.toScreen({ x: this.rect.width - 10, y: yk });
        ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#2563eb'; ctx.fill();
      }
    }
    if (!this.cur) return;
    ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (let x = this.cur.xStart; x <= this.cur.xEnd; x++) {
      const y = this.cur.ys[x];
      if (isNaN(y)) { started = false; continue; }
      const s = v.toScreen({ x, y });
      if (!started) { ctx.moveTo(s.x, s.y); started = true; } else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
  };

  TraceUI.prototype.apply = function () {
    if (!this.cur) { this._status('Erst eine Kurve antippen.'); return; }
    const kind = this.els.kind.value;           // 'P' | 'M'
    const scaleSel = this.els.scaleSel.value;   // 'left' | 'nm'
    const c = this.calib;
    if (scaleSel === 'nm' && !c.nm) { this._status('Erst die Nm-Skala setzen (Werkzeug "Nm-Skala").'); return; }
    const ys = this.cur.ys.slice();
    global.XDCTrace.fillGaps(ys);
    const pts = [];
    for (let x = this.cur.xStart; x <= this.cur.xEnd; x++) {
      const y = ys[x];
      if (isNaN(y)) continue;
      const rpm = c.rpmL + (x / c.W) * (c.rpmR - c.rpmL);
      let val;
      if (scaleSel === 'nm') {
        val = c.nm.v1 + (y - c.nm.y1) * (c.nm.v2 - c.nm.v1) / (c.nm.y2 - c.nm.y1);
      } else {
        val = c.leftTop + (y / c.H) * (c.leftBottom - c.leftTop);
      }
      pts.push([rpm, val]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    const points = U.resample(pts, 25);
    if (points.length < 5) { this._status('Zu wenig Kurve erfasst.'); return; }
    const unit = kind === 'M' ? 'Nm' : (scaleSel === 'nm' ? 'Nm' : c.leftUnit);
    const label = this.els.name.value.trim() ||
      `${this.sourceName || 'Kurve'} ${kind === 'P' ? 'Leistung' : 'Drehmoment'}`;
    this.cb.onCurve({
      label, kind, unit, points,
      source: { type: 'trace', name: this.sourceName || '', date: new Date().toISOString().slice(0, 10) }
    });
    const pk = U.peak(points);
    this._status(`Übernommen: ${label}, max ${pk.value.toFixed(1)} ${unit} @ ${Math.round(pk.rpm)} U/min. Nächste Kurve antippen oder "Fertig".`);
    this.cur = null;
    this.els.name.value = '';
    this.viewer.draw();
  };

  global.XDCTraceUI = TraceUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = TraceUI;
})(typeof window !== 'undefined' ? window : globalThis);
