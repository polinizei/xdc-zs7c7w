// XDC - calibrate.js | Schritt 2: 4 Rahmen-Ecken setzen + Achsenwerte eingeben.
// Entzerrung (Homographie) und Achsen-Kalibrierung sind EIN Schritt:
// die Ecken definieren zugleich Perspektive und Wertebereich.
(function (global) {
  'use strict';

  const H = global.XDCHomography;

  const PROFILES = {
    p4alt: {
      name: 'P4 Amerschläger (alt)',
      hint: 'Die 4 Ecken des GROSSEN Diagrammrahmens oben antippen (ohne AFR/°C-Panel unten). ' +
        'Linke Skala = PS (oben z.B. 30, unten z.B. -25, Werte vom Ausdruck ablesen). ' +
        'Drehzahl links/rechts von der obersten Zeile. Nm-Skala folgt im nächsten Schritt.',
      unit: 'PS'
    },
    p4neu: {
      name: 'P4 Amerschläger (neu)',
      hint: 'Die 4 Ecken des Leistungsdiagramm-Rahmens antippen. Achswerte vom Ausdruck ablesen. ' +
        'Falls die Nm-Skala separat liegt, folgt sie im nächsten Schritt.',
      unit: 'PS'
    },
    lutz: {
      name: 'Lutz Leistungsprüfstand',
      hint: 'Die 4 Ecken des Diagrammrahmens antippen. Linke Skala mit Einheit und Werten ' +
        'vom Ausdruck übernehmen. Zweite Skala (Nm) im nächsten Schritt.',
      unit: 'PS'
    },
    frei: {
      name: 'Freies Diagramm',
      hint: 'Die 4 Ecken des Diagrammrahmens antippen und die Achswerte an den Ecken eingeben.',
      unit: 'PS'
    }
  };

  function Calibrate(viewer, els, onDone) {
    this.viewer = viewer;
    this.els = els; // {profile, rpmL, rpmR, leftUnit, leftTop, leftBottom, hint, go, status}
    this.onDone = onDone;
    this.src = null;
    this.corners = null; // [{x,y} TL,TR,BR,BL]
    const self = this;

    viewer.opts.hitHandle = (p, r) => {
      if (!self.corners) return null;
      let best = null, bd = r * r;
      self.corners.forEach((c, i) => {
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    viewer.opts.onHandleDrag = (i, p) => {
      self.corners[i].x = Math.max(0, Math.min(self.src.width - 1, p.x));
      self.corners[i].y = Math.max(0, Math.min(self.src.height - 1, p.y));
    };
    viewer.opts.overlayDraw = (ctx, v) => self._overlay(ctx, v);

    els.profile.addEventListener('change', () => self.applyProfile());
    els.go.addEventListener('click', () => self.rectify());
  }

  Calibrate.prototype.start = function (srcCanvas, sourceName) {
    this.src = srcCanvas;
    this.sourceName = sourceName;
    const w = srcCanvas.width, h = srcCanvas.height;
    this.corners = [
      { x: w * 0.12, y: h * 0.12 }, { x: w * 0.88, y: h * 0.12 },
      { x: w * 0.88, y: h * 0.75 }, { x: w * 0.12, y: h * 0.75 }
    ];
    this.viewer.setImage(srcCanvas);
    this.applyProfile();
  };

  Calibrate.prototype.applyProfile = function () {
    const p = PROFILES[this.els.profile.value] || PROFILES.frei;
    this.els.hint.textContent = p.hint;
    if (!this.els.leftUnit.dataset.touched) this.els.leftUnit.value = p.unit;
  };

  Calibrate.prototype._overlay = function (ctx, v) {
    if (!this.corners) return;
    const pts = this.corners.map(c => v.toScreen(c));
    ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
    const names = ['1 oben links', '2 oben rechts', '3 unten rechts', '4 unten links'];
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(234,88,12,0.25)'; ctx.fill();
      ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fillStyle = '#ea580c'; ctx.fill();
      ctx.font = '12px "Roboto Condensed","Segoe UI",sans-serif';
      ctx.fillStyle = '#ea580c';
      ctx.textBaseline = 'bottom';
      const cw = ctx.canvas.clientWidth || ctx.canvas.width;
      if (p.x > cw - 90) { ctx.textAlign = 'right'; ctx.fillText(names[i], p.x - 14, p.y - 4); }
      else { ctx.textAlign = 'left'; ctx.fillText(names[i], p.x + 14, p.y - 4); }
    });
  };

  Calibrate.prototype.rectify = function () {
    const e = this.els;
    const rpmL = parseFloat(e.rpmL.value), rpmR = parseFloat(e.rpmR.value);
    const top = parseFloat(e.leftTop.value), bottom = parseFloat(e.leftBottom.value);
    if (!isFinite(rpmL) || !isFinite(rpmR) || rpmL === rpmR) { e.status.textContent = 'Drehzahl links/rechts fehlt oder gleich.'; return; }
    if (!isFinite(top) || !isFinite(bottom) || top === bottom) { e.status.textContent = 'Werte der linken Skala (oben/unten) fehlen.'; return; }
    e.status.textContent = 'Entzerre …';
    const self = this;
    setTimeout(() => {
      const c = self.corners;
      const wTop = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
      const wBot = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
      const hL = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
      const hR = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
      const W = 1500;
      const Hh = Math.max(500, Math.min(1400, Math.round(W * ((hL + hR) / (wTop + wBot)))));
      const dst = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Hh }, { x: 0, y: Hh }];
      const Hinv = H.compute(dst, c); // Ziel -> Quelle
      if (!Hinv) { e.status.textContent = 'Ecken ungültig (kollinear?).'; return; }
      const sctx = self.src.getContext('2d');
      const srcData = sctx.getImageData(0, 0, self.src.width, self.src.height);
      const out = H.warp(srcData.data, self.src.width, self.src.height, Hinv, W, Hh);
      const rect = document.createElement('canvas');
      rect.width = W; rect.height = Hh;
      rect.getContext('2d').putImageData(new ImageData(out, W, Hh), 0, 0);
      e.status.textContent = '';
      self.onDone({
        rect,
        calib: {
          rpmL, rpmR,
          leftUnit: e.leftUnit.value, leftTop: top, leftBottom: bottom,
          nm: null, W, H: Hh
        },
        sourceName: self.sourceName
      });
    }, 30);
  };

  Calibrate.PROFILES = PROFILES;
  global.XDCCalibrate = Calibrate;
  if (typeof module !== 'undefined' && module.exports) module.exports = Calibrate;
})(typeof window !== 'undefined' ? window : globalThis);
