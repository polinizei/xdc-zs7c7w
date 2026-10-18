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
    return { canvas: cv, pages: pdf.numPages };
  }

  async function loadFile(file, pageNo) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      return loadPdfFile(file, pageNo);
    }
    return { canvas: await loadImageFile(file), pages: 1 };
  }

  const api = { loadFile, MAX_DIM };
  global.XDCCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
