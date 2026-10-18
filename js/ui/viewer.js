// XDC - viewer.js | Pan/Zoom-Bildbetrachter mit Punkt-Griffen, Lupe, Tap/Draw-Gesten.
// Wird fuer Kalibrierung (Eckpunkte) und Tracing (Antippen/Nachziehen) genutzt.
(function (global) {
  'use strict';

  function Viewer(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts || {};
    this.img = null;           // Quell-Canvas
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.pointers = new Map(); // pointerId -> {x,y}
    this.dragHandle = null;    // aktiver Griff (id) oder null
    this.drawing = false;      // Zeichen-Geste aktiv (mode draw/erase)
    this.mode = 'pan';         // 'pan' | 'draw' | 'erase'
    this.loupePos = null;      // Bildkoordinate fuer Lupe
    this.lastTap = null;
    this._pinch = null;
    this._bind();
  }

  Viewer.prototype.setImage = function (imgCanvas) {
    this.img = imgCanvas;
    this.fit();
  };

  Viewer.prototype.fit = function () {
    if (!this.img) return;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    this.scale = Math.min(cw / this.img.width, ch / this.img.height) * 0.98;
    this.tx = (cw - this.img.width * this.scale) / 2;
    this.ty = (ch - this.img.height * this.scale) / 2;
    this.draw();
  };

  Viewer.prototype.toScreen = function (p) { return { x: p.x * this.scale + this.tx, y: p.y * this.scale + this.ty }; };
  Viewer.prototype.toImage = function (p) { return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale }; };

  Viewer.prototype.draw = function () {
    const dpr = global.devicePixelRatio || 1;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(cw * dpr)) this.canvas.width = Math.round(cw * dpr);
    if (this.canvas.height !== Math.round(ch * dpr)) this.canvas.height = Math.round(ch * dpr);
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.opts.bg || '#1c1f23';
    ctx.fillRect(0, 0, cw, ch);
    if (!this.img) return;
    ctx.save();
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.scale, this.scale);
    ctx.imageSmoothingEnabled = this.scale < 3;
    ctx.drawImage(this.img, 0, 0);
    ctx.restore();
    if (this.opts.overlayDraw) this.opts.overlayDraw(ctx, this);
    this._drawLoupe(ctx, cw, ch);
  };

  Viewer.prototype._drawLoupe = function (ctx, cw, ch) {
    if (!this.loupePos || !this.img) return;
    const R = 64, Z = Math.max(this.scale * 3, 4);
    const s = this.toScreen(this.loupePos);
    // Lupe oben, auf der dem Finger gegenueberliegenden Haelfte
    const lx = s.x < cw / 2 ? cw - R - 14 : R + 14;
    const ly = R + 14;
    ctx.save();
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(lx - R, ly - R, 2 * R, 2 * R);
    ctx.translate(lx, ly);
    ctx.scale(Z, Z);
    ctx.translate(-this.loupePos.x, -this.loupePos.y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.img, 0, 0);
    ctx.restore();
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx - 10, ly); ctx.lineTo(lx + 10, ly);
    ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly + 10);
    ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 1; ctx.stroke();
    if (this.opts.loupeDraw) this.opts.loupeDraw(ctx, this, lx, ly, R, Z);
  };

  Viewer.prototype._pos = function (ev) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  Viewer.prototype._bind = function () {
    const cv = this.canvas, self = this;
    cv.style.touchAction = 'none';

    cv.addEventListener('pointerdown', function (ev) {
      cv.setPointerCapture(ev.pointerId);
      const p = self._pos(ev);
      self.pointers.set(ev.pointerId, p);
      if (self.pointers.size === 1) {
        const ip = self.toImage(p);
        const hitR = 24 / self.scale;
        const handle = self.opts.hitHandle ? self.opts.hitHandle(ip, hitR) : null;
        if (handle != null) {
          self.dragHandle = handle;
          self.loupePos = ip;
          if (self.opts.onHandleDrag) self.opts.onHandleDrag(handle, ip);
        } else if (self.mode === 'draw' || self.mode === 'erase') {
          self.drawing = true;
          if (self.opts.onDraw) self.opts.onDraw(self.mode, ip, 'start');
        } else {
          self.lastTap = { p, t: Date.now() };
        }
        self.draw();
      } else if (self.pointers.size === 2) {
        self.dragHandle = null; self.drawing = false; self.loupePos = null; self.lastTap = null;
        const pts = Array.from(self.pointers.values());
        self._pinch = {
          d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
          scale: self.scale, tx: self.tx, ty: self.ty
        };
      }
      ev.preventDefault();
    });

    cv.addEventListener('pointermove', function (ev) {
      if (!self.pointers.has(ev.pointerId)) return;
      const prev = self.pointers.get(ev.pointerId);
      const p = self._pos(ev);
      self.pointers.set(ev.pointerId, p);
      if (self.pointers.size === 2 && self._pinch) {
        const pts = Array.from(self.pointers.values());
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        const f = d / self._pinch.d;
        self.scale = Math.min(20, Math.max(0.05, self._pinch.scale * f));
        self.tx = cx - (self._pinch.cx - self._pinch.tx) * (self.scale / self._pinch.scale);
        self.ty = cy - (self._pinch.cy - self._pinch.ty) * (self.scale / self._pinch.scale);
        self.draw();
      } else if (self.dragHandle != null) {
        const ip = self.toImage(p);
        self.loupePos = ip;
        if (self.opts.onHandleDrag) self.opts.onHandleDrag(self.dragHandle, ip);
        self.draw();
      } else if (self.drawing) {
        if (self.opts.onDraw) self.opts.onDraw(self.mode, self.toImage(p), 'move');
        self.draw();
      } else if (self.pointers.size === 1) {
        if (self.lastTap && Math.hypot(p.x - self.lastTap.p.x, p.y - self.lastTap.p.y) > 8) self.lastTap = null;
        self.tx += p.x - prev.x; self.ty += p.y - prev.y;
        self.draw();
      }
      ev.preventDefault();
    });

    function up(ev) {
      if (!self.pointers.has(ev.pointerId)) return;
      const p = self._pos(ev);
      self.pointers.delete(ev.pointerId);
      self._pinch = null;
      if (self.dragHandle != null) {
        if (self.opts.onHandleDrop) self.opts.onHandleDrop(self.dragHandle, self.toImage(p));
        self.dragHandle = null;
      }
      if (self.drawing && self.pointers.size === 0) {
        self.drawing = false;
        if (self.opts.onDraw) self.opts.onDraw(self.mode, self.toImage(p), 'end');
      }
      if (self.lastTap && Date.now() - self.lastTap.t < 400) {
        if (self.opts.onTap) self.opts.onTap(self.toImage(self.lastTap.p));
        self.lastTap = null;
      }
      self.loupePos = null;
      self.draw();
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    cv.addEventListener('wheel', function (ev) {
      const p = self._pos(ev);
      const f = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(20, Math.max(0.05, self.scale * f));
      self.tx = p.x - (p.x - self.tx) * (ns / self.scale);
      self.ty = p.y - (p.y - self.ty) * (ns / self.scale);
      self.scale = ns;
      self.draw();
      ev.preventDefault();
    }, { passive: false });

    if (global.ResizeObserver) new ResizeObserver(() => self.draw()).observe(cv);
  };

  global.XDCViewer = Viewer;
  if (typeof module !== 'undefined' && module.exports) module.exports = Viewer;
})(typeof window !== 'undefined' ? window : globalThis);
