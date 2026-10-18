// XDC - capture.js | Quelle laden: Kamera-Foto, Bilddatei oder PDF-Seite -> Canvas.
(function (global) {
  'use strict';

  const MAX_DIM = 2400; // Fotos begrenzen (Speicher + Warp-Tempo)

  function imageToCanvas(img, w, h) {
    const f = Math.min(1, MAX_DIM / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * f); cv.height = Math.round(h * f);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const cv = imageToCanvas(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
        resolve(cv);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild nicht lesbar')); };
      img.src = url;
    });
  }

  // PDF via lokalem pdf.js (app/vendor). pageNo 1-basiert. Gibt {canvas, pages}.
  async function loadPdfFile(file, pageNo) {
    if (!global.pdfjsLib) throw new Error('PDF-Modul nicht geladen');
    const buf = await file.arrayBuffer();
    const pdf = await global.pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(Math.min(Math.max(1, pageNo || 1), pdf.numPages));
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(MAX_DIM / Math.max(base.width, base.height), 4);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return { canvas: cv, pages: pdf.numPages, words: await pdfWords(page, vp) };
  }

  // Text der PDF-Seite als Woerter mit Canvas-Pixel-Box. Zusammengefasste Stuecke ("4500 [U/min] 5500 ...")
  // werden an Leerzeichen geteilt, Position ueber gemessene Schriftbreiten (Ziffern/Klammern sind ungleich breit).
  async function pdfWords(page, vp) {
    const out = [];
    const mctx = document.createElement('canvas').getContext('2d');
    mctx.font = '100px Arial, Helvetica, sans-serif';
    const mw = s => mctx.measureText(s).width;
    try {
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tr = it.transform, x = tr[4], y = tr[5];
        const w = it.width || 0, h = it.height || Math.hypot(tr[2], tr[3]) || 8;
        const p0 = vp.convertToViewportPoint(x, y), p1 = vp.convertToViewportPoint(x + w, y + h);
        const X0 = Math.min(p0[0], p1[0]), X1 = Math.max(p0[0], p1[0]);
        const Y0 = Math.min(p0[1], p1[1]), Y1 = Math.max(p0[1], p1[1]);
        const s = it.str, total = mw(s) || 1;
        const re = /\S+/g;
        let m;
        while ((m = re.exec(s))) {
          const a = mw(s.slice(0, m.index)) / total, b = mw(s.slice(0, m.index + m[0].length)) / total;
          out.push({ text: m[0], x0: X0 + (X1 - X0) * a, x1: X0 + (X1 - X0) * b, y0: Y0, y1: Y1 });
        }
      }
    } catch (e) { /* PDF ohne Textebene: OCR uebernimmt */ }
    return out;
  }

  async function loadFile(file, pageNo) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      return loadPdfFile(file, pageNo);
    }
    return { canvas: await loadImageFile(file), pages: 1, words: null };
  }

  const api = { loadFile, MAX_DIM };
  global.XDCCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
