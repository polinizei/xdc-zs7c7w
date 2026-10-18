// XDC - analyse.js | Autopilot-Oberflaeche: Ergebnis zeigen, Mensch prueft und korrigiert nur bei Bedarf.
// Modi: 'run' (Autopilot laeuft), 'review' (Ergebnis), 'corners' (Ecken ziehen), 'axis' (Achse per 2 Taps),
//       'add' (Kurve antippen). Die Fussleiste (bar) ist immer sichtbar und traegt Anweisung + Eingaben.
(function (global) {
  'use strict';

  const AP = () => global.XDCAutopilot;
  const U = global.XDCUnits;
  const PAL = () => global.XDCModel.PALETTE;
  const colOf = i => PAL()[i % PAL().length];

  function esc(s) { return String(s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])); }

  function Analyse(els, cb) {
    // els: {canvas, status, list, barMsg, barBack, barFix, barOk, barInput, barValue, barSign, barApply, fixMenu}
    this.els = els; this.cb = cb; // cb: {onAccept(curves), onBack()}
    this.viewer = new global.XDCViewer(els.canvas, { bg: '#1c1f23' });
    this.mode = 'run';
    this.src = null; this.res = null; this.corners = null; this.override = {};
    this.sel = new Set(); this.hi = -1;
    const self = this, v = this.viewer;

    v.opts.hitHandle = (p, r) => {
      if (self.mode !== 'corners') return null;
      let best = null, bd = r * r;
      self.corners.forEach((c, i) => { const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    };
    v.opts.onHandleDrag = (i, p) => {
      self.corners[i] = { x: Math.max(0, Math.min(self.src.width - 1, p.x)), y: Math.max(0, Math.min(self.src.height - 1, p.y)) };
    };
    v.opts.onTap = p => self._tap(p);
    v.opts.overlayDraw = (ctx, vw) => self._overlay(ctx, vw);

    els.barBack.addEventListener('click', () => self._back());
    els.barOk.addEventListener('click', () => self._primary());
    els.barFix.addEventListener('click', () => { els.fixMenu.hidden = !els.fixMenu.hidden; });
    els.fixMenu.addEventListener('click', ev => {
      const b = ev.target.closest('[data-fix]');
      if (!b) return;
      els.fixMenu.hidden = true;
      self._fix(b.dataset.fix);
    });
    els.barSign.addEventListener('click', () => {
      const t = els.barValue.value.trim();
      els.barValue.value = t.startsWith('-') ? t.slice(1) : '-' + t;
    });
    els.barApply.addEventListener('click', () => self._valueEntered());
    els.barValue.addEventListener('keydown', ev => { if (ev.key === 'Enter') self._valueEntered(); });
  }

  // ---------- Ablauf ----------
  Analyse.prototype.start = async function (srcCanvas, name, pdfWords) {
    this.src = srcCanvas; this.name = name; this.pdfWords = pdfWords || null;
    this.override = {}; this.res = null; this.sel = new Set(); this.hi = -1;
    this.els.list.innerHTML = '';
    this.els.status.innerHTML = '';
    this._setMode('run');
    this._msg('Suche Diagrammrahmen …');
    await new Promise(r => setTimeout(r, 30));
    const fr = AP().findFrame(srcCanvas);
    this.corners = fr.corners;
    this.frameFound = fr.found;
    if (!fr.found) {
      this.viewer.setImage(srcCanvas);
      this._setMode('corners');
      this._msg('Rahmen nicht sicher erkannt. Ziehe die 4 Punkte auf die Ecken des Diagrammrahmens.', true);
      this._renderStatus();
      return;
    }
    await this.analyze();
  };

  Analyse.prototype.analyze = async function () {
    this._setMode('run');
    const self = this;
    try {
      this.res = await AP().analyze(this.src, this.corners, {
        pdfWords: this.pdfWords, sourceName: this.name, override: this.override,
        onStep: t => self._msg(t + ' …')
      });
    } catch (e) {
      this._msg('Analyse fehlgeschlagen: ' + e.message, true);
      return;
    }
    this.viewer.setImage(this.res.rect.canvas);
    this.sel = new Set((this.res.curves || []).map((c, i) => i));
    this._setMode('review');
    this._renderStatus();
    this._renderList();
    this._askNext();
  };

  // Naechste offene Frage stellen (Achse fehlt) oder Ergebnis zur Pruefung anbieten.
  Analyse.prototype._askNext = function () {
    const s = this.res.steps;
    if (s.x === 'fehlt') return this._startAxis('x');
    if (s.power === 'fehlt') return this._startAxis('power');
    const n = (this.res.curves || []).length;
    if (!n) {
      this._msg('Keine Kurve gefunden. Tippe direkt auf eine Kurve im Bild.', true);
      this.mode = 'add';
      return;
    }
    const unsure = Object.values(s).includes('unsicher');
    this._msg(unsure ? `${n} Kurven erkannt. Bitte Werte prüfen (gelb markiert), dann übernehmen.`
      : `${n} Kurven erkannt. Passt das? Dann übernehmen.`, unsure);
  };

  Analyse.prototype._setMode = function (m) {
    this.mode = m;
    const e = this.els;
    e.barInput.hidden = m !== 'axis';
    e.barFix.hidden = !(m === 'review' || m === 'add');
    e.barOk.disabled = m === 'run';
    e.barOk.textContent = m === 'corners' ? 'Analysieren' : m === 'axis' ? 'Überspringen' : 'Übernehmen';
    e.fixMenu.hidden = true;
    this.viewer.draw();
  };

  Analyse.prototype._msg = function (t, warn) {
    this.els.barMsg.textContent = t;
    this.els.barMsg.classList.toggle('warn', !!warn);
  };

  // Zurueck bricht die laufende Korrektur ab (ohne sofort neu zu fragen); im Ergebnis zurueck zur Uebersicht.
  Analyse.prototype._back = function () {
    if (this.mode === 'corners' && this.res) { this.viewer.setImage(this.res.rect.canvas); this._setMode('review'); this._msgAbort(); return; }
    if (this.mode === 'axis' || this.mode === 'add') { this._setMode('review'); this._msgAbort(); return; }
    this.cb.onBack();
  };

  Analyse.prototype._msgAbort = function () {
    const n = (this.res && this.res.curves || []).length;
    this._msg(n ? `Korrektur abgebrochen. ${n} Kurven bereit zum Übernehmen.` : 'Korrektur abgebrochen. Zurück = zur Übersicht, Korrigieren = neu versuchen.', !n);
  };

  Analyse.prototype._primary = function () {
    if (this.mode === 'corners') { this.override = {}; this.frameFound = false; this.analyze(); return; }
    if (this.mode === 'axis') { this._setMode('review'); this._msgAbort(); return; }
    if (this.mode === 'review' || this.mode === 'add') {
      const curves = (this.res && this.res.curves || []).filter((c, i) => this.sel.has(i));
      if (!curves.length) { this._msg('Keine Kurve ausgewählt.', true); return; }
      this.cb.onAccept(curves.map(c => ({
        label: c.label, kind: c.kind, unit: c.unit,
        points: U.smooth(U.resample(c.points, 25), 7),
        source: { type: 'autopilot', name: this.name || '', date: new Date().toISOString().slice(0, 10) }
      })));
    }
  };

  Analyse.prototype._fix = function (what) {
    if (what === 'corners') {
      this.viewer.setImage(this.src);
      this._setMode('corners');
      this._msg('Ziehe die 4 Punkte auf die Ecken des Diagrammrahmens, dann Analysieren.');
    } else if (what === 'x' || what === 'power') {
      this._startAxis(what);
    } else if (what === 'add') {
      this.mode = 'add';
      this._msg('Tippe auf die fehlende Kurve.');
    }
  };

  // ---------- Achse per zwei Taps ----------
  Analyse.prototype._startAxis = function (which) {
    this.axis = { which, taps: [] };
    this._setMode('axis');
    this.els.barValue.value = '';
    const what = which === 'x' ? 'Drehzahl' : 'Leistungs';
    this._msg(`${what}-Achse nicht lesbar. Tippe auf eine beschriftete ${which === 'x' ? 'senkrechte Linie oder Zahl der Drehzahl-Achse' : 'waagerechte Linie oder Zahl der PS-Skala'} (1 von 2).`, true);
  };

  Analyse.prototype._valueEntered = function () {
    if (this.mode !== 'axis' || !this.axis.pending) return;
    const v = parseFloat(this.els.barValue.value.replace(',', '.'));
    if (!isFinite(v)) { this._msg('Bitte eine Zahl eingeben.', true); return; }
    this.axis.taps.push({ p: this.axis.pending, v });
    this.axis.pending = null;
    this.els.barValue.value = '';
    if (this.axis.taps.length < 2) {
      this._msg('Gut. Jetzt eine zweite, möglichst weit entfernte Beschriftung antippen (2 von 2).');
      this.viewer.draw();
      return;
    }
    const [a, b] = this.axis.taps;
    const pos = this.axis.which === 'x' ? 'x' : 'y';
    if (Math.abs(a.p[pos] - b.p[pos]) < 10 || a.v === b.v) { this.axis.taps = []; this._msg('Die beiden Punkte liegen zu dicht. Nochmal (1 von 2).', true); return; }
    const k = (b.v - a.v) / (b.p[pos] - a.p[pos]);
    const sc = { a: a.v - k * a.p[pos], b: k };
    // Override in Koordinaten des entzerrten Bildes; bleibt bei Neuanalyse gleich, solange die Ecken bleiben
    if (this.axis.which === 'x') this.override.x = sc;
    else this.override.power = Object.assign(sc, { unit: 'PS', sure: true });
    this.analyze();
  };

  Analyse.prototype._tap = async function (p) {
    if (this.mode === 'axis') {
      this.axis.pending = p;
      this._msg(`Welcher Wert steht dort? Unten eingeben und OK.`);
      this.els.barValue.focus();
      this.viewer.draw();
      return;
    }
    if (this.mode === 'add' && this.res) {
      const R = this.res.rect;
      const id = R.canvas.getContext('2d').getImageData(0, 0, R.canvas.width, R.canvas.height);
      const img = { width: id.width, height: id.height, data: id.data };
      const tr = global.XDCTrace.traceCurve(img, p.x, p.y);
      if (!tr || !this.res.cal.x || !this.res.cal.power) { this._msg('Dort keine Kurve gefunden. Genauer auf die Linie tippen (vorher zoomen).', true); return; }
      const cal = this.res.cal, pts = [];
      for (let x = tr.xStart; x <= tr.xEnd; x++) {
        if (isNaN(tr.ys[x]) || x < R.frame.x0 || x > R.frame.x1) continue;
        pts.push([cal.x.a + cal.x.b * x, cal.power.a + cal.power.b * tr.ys[x]]);
      }
      if (pts.length < 20) { this._msg('Kurve zu kurz.', true); return; }
      this.res.curves.push({ kind: 'P', unit: cal.power.unit, label: `${this.name || ''} Kurve ${this.res.curves.length + 1}`.trim(), rgb: [234, 88, 12], points: pts, trace: tr, added: true });
      this.sel.add(this.res.curves.length - 1);
      this._renderList();
      this._setMode('review');
      this._msg('Kurve hinzugefügt. Bei Drehmoment in der Liste auf "Leistung" tippen, um umzuschalten.');
      return;
    }
    if (this.mode === 'review' && this.res && this.res.curves) {
      // Antippen einer Kurve hebt sie in der Liste hervor
      let best = -1, bd = 14 / this.viewer.scale;
      this.res.curves.forEach((c, i) => {
        const y = c.trace.ys[Math.round(p.x)];
        if (y != null && !isNaN(y) && Math.abs(y - p.y) < bd) { bd = Math.abs(y - p.y); best = i; }
      });
      this.hi = best;
      this._renderList();
      this.viewer.draw();
    }
  };

  // ---------- Darstellung ----------
  Analyse.prototype._overlay = function (ctx, v) {
    if (this.mode === 'corners' && this.corners) {
      const pts = this.corners.map(c => v.toScreen(c));
      ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2;
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
      pts.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(234,88,12,0.3)'; ctx.fill(); ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fillStyle = '#ea580c'; ctx.fill();
      });
      return;
    }
    if (!this.res) return;
    const R = this.res.rect;
    const badges = [];
    const f0 = v.toScreen({ x: R.frame.x0, y: R.frame.y0 }), f1 = v.toScreen({ x: R.frame.x1, y: R.frame.y1 });
    ctx.strokeStyle = 'rgba(234,88,12,0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(f0.x, f0.y, f1.x - f0.x, f1.y - f0.y); ctx.setLineDash([]);
    (this.res.curves || []).forEach((c, i) => {
      const on = this.sel.has(i);
      // weisser Saum, damit die Spur auf jedem Untergrund sichtbar bleibt
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = (i === this.hi ? 5 : 3) + 3;
      ctx.setLineDash(c.kind === 'M' ? [9, 5] : []);
      ctx.beginPath(); let s0 = false;
      for (let x = c.trace.xStart; x <= c.trace.xEnd; x += 2) {
        const y = c.trace.ys[x];
        if (isNaN(y)) { s0 = false; continue; }
        const s = v.toScreen({ x, y });
        s0 ? ctx.lineTo(s.x, s.y) : (ctx.moveTo(s.x, s.y), s0 = true);
      }
      if (on) ctx.stroke();
      ctx.strokeStyle = on ? colOf(i) : 'rgba(150,150,150,0.6)';
      ctx.lineWidth = i === this.hi ? 5 : 3;
      ctx.setLineDash(c.kind === 'M' ? [9, 5] : []);
      ctx.beginPath(); let st = false;
      for (let x = c.trace.xStart; x <= c.trace.xEnd; x += 2) {
        const y = c.trace.ys[x];
        if (isNaN(y)) { st = false; continue; }
        const s = v.toScreen({ x, y });
        st ? ctx.lineTo(s.x, s.y) : (ctx.moveTo(s.x, s.y), st = true);
      }
      ctx.stroke(); ctx.setLineDash([]);
      // Nummer: am Kurvenmaximum, bei Kollision entlang der Kurve nach links versetzt
      let xm = c.trace.xStart, ym = Infinity;
      for (let x = c.trace.xStart; x <= c.trace.xEnd; x++) { const y = c.trace.ys[x]; if (!isNaN(y) && y < ym) { ym = y; xm = x; } }
      const span = c.trace.xEnd - c.trace.xStart;
      let s = null;
      for (let k = 0; k < 8; k++) {
        const x = Math.round(xm - k * span * 0.07);
        if (x < c.trace.xStart || isNaN(c.trace.ys[x])) break;
        const cand = v.toScreen({ x, y: c.trace.ys[x] });
        cand.y -= 13;
        s = cand;
        if (badges.every(b => Math.hypot(b.x - cand.x, b.y - cand.y) > 21)) break;
      }
      if (s) {
        badges.push(s);
        ctx.fillStyle = on ? colOf(i) : '#999'; ctx.beginPath(); ctx.arc(s.x, s.y, 9.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px "Roboto Condensed",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), s.x, s.y + 0.5);
      }
    });
    if (this.mode === 'axis') {
      for (const t of this.axis.taps.map(t => t.p).concat(this.axis.pending ? [this.axis.pending] : [])) {
        const s = v.toScreen(t);
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (this.axis.which === 'x') { ctx.moveTo(s.x, 0); ctx.lineTo(s.x, ctx.canvas.height); }
        else { ctx.moveTo(0, s.y); ctx.lineTo(ctx.canvas.width, s.y); }
        ctx.stroke();
      }
    }
  };

  Analyse.prototype._renderStatus = function () {
    const r = this.res, el = this.els.status;
    const row = (state, text) => `<div class="st st-${state}"><span class="st-i">${state === 'ok' ? '✓' : state === 'unsicher' ? '!' : '✕'}</span><span>${esc(text)}</span></div>`;
    let h = row(this.frameFound ? 'ok' : 'unsicher', this.frameFound ? 'Diagrammrahmen erkannt' : 'Rahmen von Hand gesetzt');
    if (r) {
      const fr = r.rect.frame, cal = r.cal;
      if (cal.x) h += row(r.steps.x, `Drehzahl ${Math.round(cal.x.a + cal.x.b * fr.x0)} bis ${Math.round(cal.x.a + cal.x.b * fr.x1)} U/min` + (r.axes.x ? ` (${r.axes.x.n} Zahlen gelesen)` : ' (von Hand)'));
      else h += row('fehlt', 'Drehzahl-Achse nicht lesbar');
      if (cal.power) h += row(r.steps.power, `Leistung ${(cal.power.a + cal.power.b * fr.y1).toFixed(0)} bis ${(cal.power.a + cal.power.b * fr.y0).toFixed(0)} ${cal.power.unit}` + (cal.power.sure ? '' : ' (Einheit geschätzt)'));
      else h += row('fehlt', 'Leistungs-Skala nicht lesbar');
      if (cal.nm) h += row('ok', 'Drehmoment-Skala ' + (cal.nm.src === 'physik' ? 'aus Leistung berechnet' : 'gelesen'));
      if (r.curves) {
        const nP = r.curves.filter(c => c.kind === 'P').length, nM = r.curves.length - nP;
        h += row(r.curves.length ? 'ok' : 'fehlt', `${r.curves.length} Kurven: ${nP} Leistung, ${nM} Drehmoment`);
      }
    }
    el.innerHTML = h;
  };

  Analyse.prototype._renderList = function () {
    const el = this.els.list, self = this;
    const cs = (this.res && this.res.curves) || [];
    el.innerHTML = '';
    if (!cs.length) el.innerHTML = '<p class="hint" style="margin:0">Noch keine Kurven.</p>';
    cs.forEach((c, i) => {
      const pk = U.peak(c.points);
      const d = document.createElement('div');
      d.className = 'ac-item' + (this.sel.has(i) ? '' : ' off') + (i === this.hi ? ' hi' : '');
      d.innerHTML = `<label class="ac-chk"><input type="checkbox" ${this.sel.has(i) ? 'checked' : ''}><span class="ac-no">${i + 1}</span></label>` +
        `<span class="dot" style="background:${colOf(i)}" title="Originalfarbe rgb(${c.rgb.join(',')})"></span>` +
        `<input class="ac-name" value="${esc(c.label)}">` +
        `<button class="btn small ac-kind" type="button">${c.kind === 'P' ? 'Leistung' : 'Drehmoment'}</button>` +
        `<span class="ac-pk">${pk ? pk.value.toFixed(1) + ' ' + c.unit : ''}</span>`;
      d.querySelector('input[type=checkbox]').addEventListener('change', ev => {
        ev.target.checked ? self.sel.add(i) : self.sel.delete(i);
        d.classList.toggle('off', !ev.target.checked); self.viewer.draw();
      });
      d.querySelector('.ac-name').addEventListener('change', ev => { c.label = ev.target.value.trim() || c.label; });
      d.querySelector('.ac-kind').addEventListener('click', () => self._toggleKind(i));
      el.appendChild(d);
    });
  };

  // Umschalten Leistung <-> Drehmoment: Werte aus Pixelhoehe mit der jeweiligen Skala neu berechnen
  Analyse.prototype._toggleKind = function (i) {
    const c = this.res.curves[i], cal = this.res.cal;
    const to = c.kind === 'P' ? 'M' : 'P';
    if (to === 'M' && !cal.nm) { this._msg('Keine Drehmoment-Skala bekannt (kein Leistungs-Partner gefunden).', true); return; }
    const pts = [];
    for (let x = c.trace.xStart; x <= c.trace.xEnd; x++) {
      const y = c.trace.ys[x];
      if (isNaN(y) || x < this.res.rect.frame.x0 || x > this.res.rect.frame.x1) continue;
      pts.push([cal.x.a + cal.x.b * x, to === 'P' ? cal.power.a + cal.power.b * y : cal.nm.a + cal.nm.b * y]);
    }
    c.kind = to; c.unit = to === 'P' ? cal.power.unit : 'Nm'; c.points = pts;
    this._renderList(); this._renderStatus(); this.viewer.draw();
  };

  global.XDCAnalyse = Analyse;
})(typeof window !== 'undefined' ? window : globalThis);
