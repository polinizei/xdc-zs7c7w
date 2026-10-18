// XDC - homography.js | Perspektiv-Entzerrung (4-Punkt-Homographie)
// Pixel-Koordinaten des schiefen Fotos -> rechtwinkliger Diagrammraum.
(function (global) {
  'use strict';

  // Loest A*h = b (n x n) per Gauss-Elimination mit Spaltenpivot.
  function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        if (f === 0) continue;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // H: 3x3 (als Array mit 9 Eintraegen, h33=1), bildet src[i] auf dst[i] ab (je 4 Punkte {x,y}).
  function compute(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], X = dst[i].x, Y = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
    }
    const h = solveLinear(A, b);
    return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
  }

  function apply(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }

  // Warpt srcImageData in ein Ziel (outW x outH). Hinv bildet Ziel->Quelle ab. Bilinear.
  function warp(srcData, srcW, srcH, Hinv, outW, outH) {
    const out = new Uint8ClampedArray(outW * outH * 4);
    for (let v = 0; v < outH; v++) {
      for (let u = 0; u < outW; u++) {
        const p = apply(Hinv, u, v);
        const o = (v * outW + u) * 4;
        if (p.x < 0 || p.y < 0 || p.x >= srcW - 1 || p.y >= srcH - 1) {
          out[o] = out[o + 1] = out[o + 2] = 247; out[o + 3] = 255; continue;
        }
        const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
        const fx = p.x - x0, fy = p.y - y0;
        const i00 = (y0 * srcW + x0) * 4, i10 = i00 + 4, i01 = i00 + srcW * 4, i11 = i01 + 4;
        for (let c = 0; c < 3; c++) {
          out[o + c] =
            srcData[i00 + c] * (1 - fx) * (1 - fy) + srcData[i10 + c] * fx * (1 - fy) +
            srcData[i01 + c] * (1 - fx) * fy + srcData[i11 + c] * fx * fy;
        }
        out[o + 3] = 255;
      }
    }
    return out;
  }

  const api = { compute, apply, warp, solveLinear };
  global.XDCHomography = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
