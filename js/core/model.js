// XDC - model.js | Datenmodell + Persistenz (localStorage).
// Kurve: {id, label, kind:'P'|'M', unit:'PS'|'kW'|'Nm', color, visible, ref,
//         source:{type,name,date}, points:[[rpm,val],...]}  (points aufsteigend, resampled)
(function (global) {
  'use strict';

  const STORE_KEY = 'xdc.project';
  const SETTINGS_KEY = 'xdc.settings';

  // Feste Reihenfolge, nie zyklisch neu wuerfeln (Farbe folgt der Kurve, nicht dem Rang).
  const PALETTE = ['#ea580c', '#2563eb', '#059669', '#9333ea', '#db2777', '#b45309', '#0891b2', '#dc2626'];

  function blank() {
    return { version: 1, name: 'Vergleich', curves: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return blank();
      const p = JSON.parse(raw);
      if (!p || !Array.isArray(p.curves)) return blank();
      return p;
    } catch (e) { return blank(); }
  }

  function save(project) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(project));
      return true;
    } catch (e) { return false; }
  }

  function loadSettings() {
    try { return Object.assign({ unitPower: 'PS', mode: 'PM', theme: 'light' }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch (e) { return { unitPower: 'PS', mode: 'PM', theme: 'light' }; }
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* voll/privat */ }
  }

  function nextColor(project) {
    const used = project.curves.map(c => c.color);
    for (const c of PALETTE) if (!used.includes(c)) return c;
    return PALETTE[project.curves.length % PALETTE.length];
  }

  function addCurve(project, curve) {
    curve.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    curve.visible = true;
    curve.ref = curve.ref || false;
    curve.color = curve.color || nextColor(project);
    project.curves.push(curve);
    return curve;
  }

  function removeCurve(project, id) {
    project.curves = project.curves.filter(c => c.id !== id);
  }

  function setRef(project, id) {
    for (const c of project.curves) c.ref = (c.id === id) ? !c.ref : false;
  }

  const api = { PALETTE, blank, load, save, loadSettings, saveSettings, addCurve, removeCurve, setRef, nextColor };
  global.XDCModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
