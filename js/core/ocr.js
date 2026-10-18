// XDC - ocr.js | Zahlen an den Achsen lesen (Tesseract.js lokal, offline) + PDF-Text-Uebernahme.
(function (global) {
  'use strict';

  let workerP = null;

  function abs(p) { return new URL((global.XDC_BASE || '') + p, global.location.href).href; }

  function getWorker() {
    if (!global.Tesseract) return Promise.reject(new Error('OCR-Modul nicht geladen'));
    if (!workerP) {
      workerP = global.Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/'),
        langPath: abs('vendor/tesseract/'),
        gzip: true,
        logger: () => {}
      }).then(async w => {
        await w.setParameters({
          tessedit_char_whitelist: '0123456789-.,',
          tessedit_pageseg_mode: '11', // verstreuter Text
          user_defined_dpi: '150'
        });
        return w;
      }).catch(e => { workerP = null; throw e; });
    }
    return workerP;
  }

  // Gleitendes Maximum (separierbar) = lokale Papierhelligkeit
  function maxFilter(L, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (L[y * w + k] > m) m = L[y * w + k];
      tmp[y * w + x] = m;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
    return out;
  }

  // Streifen normiert auf lokale Papierhelligkeit (Farbstich/Verlauf weg), per Perzentil gespreizt, hochskaliert.
  function prepStrip(src, x, y, w, h, scale) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.max(1, Math.min(src.width - x, Math.round(w))); h = Math.max(1, Math.min(src.height - y, Math.round(h)));
    const id = src.getContext('2d').getImageData(x, y, w, h);
    const n = w * h, L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.299 * id.data[i * 4] + 0.587 * id.data[i * 4 + 1] + 0.114 * id.data[i * 4 + 2];
    const bg = maxFilter(L, w, h, 9);
    const norm = new Float32Array(n);
    for (let i = 0; i < n; i++) norm[i] = bg[i] > 1 ? L[i] / bg[i] : 1;
    const s = [];
    for (let i = 0; i < n; i += 5) s.push(norm[i]);
    s.sort((a, b) => a - b);
    const lo = s[Math.floor(s.length * 0.005)], hi = Math.max(lo + 0.05, s[Math.floor(s.length * 0.6)] * 0.97);
    const out = new ImageData(w, h);
    for (let i = 0; i < n; i++) {
      const g = Math.max(0, Math.min(255, (norm[i] - lo) / (hi - lo) * 255));
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = g; out.data[i * 4 + 3] = 255;
    }
    const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
    c1.getContext('2d').putImageData(out, 0, 0);
    const c2 = document.createElement('canvas'); c2.width = Math.round(w * scale); c2.height = Math.round(h * scale);
    const ctx = c2.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c1, 0, 0, c2.width, c2.height);
    return { canvas: c2, ox: x, oy: y, scale };
  }

  async function readStrip(worker, strip, params) {
    if (params) await worker.setParameters(params);
    const { data } = await worker.recognize(strip.canvas);
    const words = [];
    for (const wd of (data.words || [])) {
      if (!wd.text || wd.confidence < 30) continue;
      const b = wd.bbox;
      words.push({
        text: wd.text, conf: wd.confidence,
        x0: strip.ox + b.x0 / strip.scale, y0: strip.oy + b.y0 / strip.scale,
        x1: strip.ox + b.x1 / strip.scale, y1: strip.oy + b.y1 / strip.scale
      });
    }
    return words;
  }

  const NUM_PARAMS = { tessedit_char_whitelist: '0123456789-.,', tessedit_pageseg_mode: '11' };
  const UNIT_PARAMS = { tessedit_char_whitelist: '[]()PSKWkwNmM/', tessedit_pageseg_mode: '11' };

  function stripBoxes(rect, frame) {
    const fw = frame.x1 - frame.x0, fh = frame.y1 - frame.y0;
    return {
      oben: [frame.x0 - fw * 0.04, frame.y0 - fh * 0.1, fw * 1.08, fh * 0.11],
      links: [0, frame.y0 - fh * 0.04, frame.x0 + fw * 0.025, fh * 1.08],
      rechts: [frame.x1 - fw * 0.07, frame.y0 - fh * 0.04, rect.width - frame.x1 + fw * 0.07, fh * 1.08],
      unten: [frame.x0 - fw * 0.04, frame.y1 - fh * 0.01, fw * 1.08, fh * 0.1],
      // Einheiten-Kopfzeilen ueber den Skalen
      kopfL: [0, frame.y0 - fh * 0.09, frame.x0 + fw * 0.02, fh * 0.1],
      kopfR: [frame.x1 - fw * 0.07, frame.y0 - fh * 0.2, rect.width - frame.x1 + fw * 0.07, fh * 0.35]
    };
  }

  function baseScale(frame) {
    const fh = frame.y1 - frame.y0;
    return Math.max(1, Math.min(3, 40 / Math.max(8, fh * 0.022)));
  }

  // Liest Zahlen in den genannten Randstreifen. pass 0 = Standard, pass 1 = andere Groesse (Wiederholung).
  async function readAxes(rect, frame, onStep, names, pass) {
    const worker = await getWorker();
    const boxes = stripBoxes(rect, frame);
    const scale = baseScale(frame) * (pass ? 1.6 : 1);
    let words = [];
    for (const name of (names || ['oben', 'links', 'rechts', 'unten'])) {
      if (onStep) onStep('Lese Beschriftung ' + name + (pass ? ' (2. Versuch)' : ''));
      const [x, y, w, h] = boxes[name];
      const ws = await readStrip(worker, prepStrip(rect, x, y, w, h, scale), NUM_PARAMS);
      ws.forEach(wd => { wd.strip = name; });
      words = words.concat(ws);
    }
    return words;
  }

  // Einheiten-Kopfzeilen: [{unit:'PS'|'kW'|'Nm', cx, cy}]
  async function readUnits(rect, frame) {
    const worker = await getWorker();
    const boxes = stripBoxes(rect, frame);
    const out = [];
    for (const name of ['kopfL', 'kopfR']) {
      const [x, y, w, h] = boxes[name];
      const ws = await readStrip(worker, prepStrip(rect, x, y, w, h, baseScale(frame) * 1.4), UNIT_PARAMS);
      for (const wd of ws) {
        const t = wd.text.toUpperCase();
        const unit = /NM/.test(t) ? 'Nm' : /KW/.test(t) ? 'kW' : /PS/.test(t) ? 'PS' : null;
        if (unit) out.push({ unit, cx: (wd.x0 + wd.x1) / 2, cy: (wd.y0 + wd.y1) / 2, side: name === 'kopfL' ? 'left' : 'right' });
      }
    }
    await worker.setParameters(NUM_PARAMS);
    return out;
  }

  const api = { readAxes, readUnits, getWorker, prepStrip };
  global.XDCOcr = api;
})(typeof window !== 'undefined' ? window : globalThis);
