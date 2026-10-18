// XDC - app.js | App-Steuerung: Screens, Projekt, Chart-Interaktion, Import/Export.
(function () {
  'use strict';

  const M = window.XDCModel, U = window.XDCUnits, O = window.XDCOverlay;
  const $ = id => document.getElementById(id);

  let project = M.load();
  let settings = M.loadSettings();
  let crosshair = null;

  // ---------- Theme ----------
  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    $('btn-theme').textContent = settings.theme === 'dark' ? 'Hell' : 'Dunkel';
    renderHome();
  }
  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue('--chart-bg').trim(),
      grid: cs.getPropertyValue('--chart-grid').trim(),
      axis: cs.getPropertyValue('--chart-axis').trim(),
      text: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim()
    };
  }

  // ---------- Screens ----------
  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = true;
    $(name).hidden = false;
    $('bar-home').hidden = name !== 'scr-home';
    $('bar-analyse').hidden = name !== 'scr-analyse';
    window.scrollTo(0, 0);
    if (name === 'scr-home') renderHome();
    if (name === 'scr-analyse') requestAnimationFrame(() => analyse.viewer.fit());
  }

  // ---------- Home: Chart + Liste ----------
  function renderChart() {
    O.render($('chart'), project, settings, themeColors(), crosshair);
    renderReadout();
  }

  function renderHome() {
    const canvas = $('chart');
    O.render(canvas, project, settings, themeColors(), crosshair);
    renderReadout();
    renderList();
    $('btn-unit').textContent = settings.unitPower;
    for (const b of document.querySelectorAll('[data-mode]')) {
      b.classList.toggle('active', b.dataset.mode === settings.mode);
    }
    $('empty-hint').hidden = project.curves.length > 0;
    $('chart-card').hidden = project.curves.length === 0;
  }

  function fmt(v, d) { return v == null ? '-' : v.toFixed(d == null ? 1 : d).replace('.', ','); }

  function renderReadout() {
    const el = $('readout');
    if (crosshair == null) { el.innerHTML = ''; el.hidden = true; return; }
    const ref = project.curves.find(c => c.ref && c.visible);
    let html = `<div class="ro-rpm">${Math.round(crosshair)} U/min</div>`;
    for (const c of project.curves) {
      if (!c.visible) continue;
      if (settings.mode === 'P' && c.kind !== 'P') continue;
      if (settings.mode === 'M' && c.kind !== 'M') continue;
      let v = U.valueAt(c.points, crosshair);
      const unit = c.kind === 'P' ? settings.unitPower : 'Nm';
      if (v != null && c.kind === 'P') v = U.convert(v, c.unit, settings.unitPower);
      let diff = '';
      if (ref && ref.id !== c.id && ref.kind === c.kind && v != null) {
        let rv = U.valueAt(ref.points, crosshair);
        if (rv != null) {
          if (c.kind === 'P') rv = U.convert(rv, ref.unit, settings.unitPower);
          const d = v - rv;
          diff = ` <span class="ro-diff">(${d >= 0 ? '+' : ''}${fmt(d)})</span>`;
        }
      }
      html += `<div class="ro-row"><span class="dot" style="background:${c.color}"></span>` +
        `<span class="ro-name">${esc(c.label)}</span><span class="ro-val">${fmt(v)} ${unit}${diff}</span></div>`;
    }
    el.innerHTML = html; el.hidden = false;
  }

  function esc(s) { return String(s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])); }

  function renderList() {
    const el = $('curve-list');
    el.innerHTML = '';
    for (const c of project.curves) {
      const pk = U.peak(c.points);
      const unit = c.kind === 'P' ? settings.unitPower : 'Nm';
      const pkv = c.kind === 'P' ? U.convert(pk.value, c.unit, settings.unitPower) : pk.value;
      const li = document.createElement('div');
      li.className = 'curve-item' + (c.visible ? '' : ' off');
      li.innerHTML =
        `<button class="dot-btn" title="Farbe ändern" style="background:${c.color}"></button>` +
        `<div class="ci-main"><div class="ci-name">${esc(c.label)} <span class="badge">${c.kind === 'P' ? 'Leistung' : 'Drehmoment'}</span></div>` +
        `<div class="ci-sub">max ${fmt(pkv)} ${unit} @ ${Math.round(pk.rpm)} U/min</div></div>` +
        `<button class="ib" data-a="ref" title="Referenz für Differenz">${c.ref ? '★' : '☆'}</button>` +
        `<button class="ib" data-a="vis" title="Ein-/Ausblenden">${c.visible ? '👁' : '◌'}</button>` +
        `<button class="ib" data-a="edit" title="Umbenennen">✎</button>` +
        `<button class="ib" data-a="del" title="Löschen">✕</button>`;
      li.querySelector('.dot-btn').addEventListener('click', () => {
        const i = M.PALETTE.indexOf(c.color);
        c.color = M.PALETTE[(i + 1) % M.PALETTE.length];
        persist();
      });
      li.querySelector('[data-a=ref]').addEventListener('click', () => { M.setRef(project, c.id); persist(); });
      li.querySelector('[data-a=vis]').addEventListener('click', () => { c.visible = !c.visible; persist(); });
      // Umbenennen direkt in der Liste (keine Browser-Dialoge: in Android-App-Ansichten wirkungslos)
      li.querySelector('[data-a=edit]').addEventListener('click', () => {
        const nameEl = li.querySelector('.ci-name');
        nameEl.innerHTML = `<input class="ci-edit" value="${esc(c.label)}" aria-label="Name der Kurve">`;
        const inp = nameEl.querySelector('input');
        inp.focus(); inp.select();
        const done = save => {
          if (save && inp.value.trim()) c.label = inp.value.trim();
          persist();
        };
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
      });
      // Loeschen in zwei Tipps: erster Tipp scharf schalten ("Löschen?"), zweiter loescht
      const del = li.querySelector('[data-a=del]');
      if (armed === c.id) { del.textContent = 'Löschen?'; del.classList.add('danger'); }
      del.addEventListener('click', () => {
        if (armed === c.id) { armed = null; M.removeCurve(project, c.id); persist(); toast(`"${c.label}" gelöscht`); return; }
        arm(c.id);
      });
      el.appendChild(li);
    }
  }

  // Zwei-Tipp-Bestaetigung: nach 3 s ohne zweiten Tipp zurueck
  let armed = null, armT = null;
  function arm(id) {
    armed = id;
    clearTimeout(armT);
    armT = setTimeout(() => { armed = null; renderList(); renderClear(); }, 3000);
    renderList(); renderClear();
  }
  function renderClear() {
    const b = $('btn-clear');
    b.textContent = armed === 'ALL' ? 'Wirklich alle löschen? Nochmal tippen' : 'Alle Kurven löschen';
    b.classList.toggle('danger', armed === 'ALL');
  }

  function persist() { M.save(project); renderHome(); }

  // ---------- Chart-Crosshair ----------
  (function bindChart() {
    const cv = $('chart');
    function move(ev) {
      const r = cv.getBoundingClientRect();
      const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      crosshair = O.rpmAt(cv, project, settings, x);
      renderChart();
      if (ev.cancelable && ev.touches) ev.preventDefault();
    }
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerdown', move);
    cv.addEventListener('pointerleave', () => { crosshair = null; renderChart(); });
    cv.addEventListener('touchmove', move, { passive: false });
  })();

  // ---------- Import (Warteschlange: mehrere Bilder/PDFs nacheinander pruefen) ----------
  const queue = { files: [], pos: 0, added: 0 };

  function handleFiles(list) {
    const files = Array.from(list || []).filter(Boolean);
    if (!files.length) return;
    queue.files = files.map(f => ({ file: f, page: 1 })); queue.pos = 0; queue.added = 0;
    nextFile();
  }

  function nextFile() {
    if (queue.pos >= queue.files.length) {
      const n = queue.files.length;
      queue.files = [];
      show('scr-home');
      if (n > 1) toast(`${n} Bilder bearbeitet, ${queue.added} Kurven übernommen.`);
      return;
    }
    setQueueInfo();
    handleFile(queue.files[queue.pos], queue.pos + 1);
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 4000);
  }

  function setQueueInfo() {
    const total = queue.files.length;
    analyse.setQueueInfo(total > 1 ? `Bild ${queue.pos + 1} von ${total}` : '', total - queue.pos - 1);
  }

  async function handleFile(item, nr) {
    const file = item && item.file;
    if (!file) return;
    try {
      const pageNo = item.page;
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (isPdf && !window.pdfjsLib) {
        throw new Error('PDF-Modul fehlt, bitte Screenshot der Seite laden');
      }
      const res = await window.XDCCapture.loadFile(file, pageNo);
      // Mehrseitiges PDF: weitere Seiten direkt hinter dieser in die Warteschlange (keine Seitenabfrage)
      if (res.pages > 1 && pageNo === 1 && !item.expanded) {
        item.expanded = true;
        const more = [];
        for (let pg = 2; pg <= res.pages; pg++) more.push({ file, page: pg, expanded: true });
        queue.files.splice(queue.pos + 1, 0, ...more);
        setQueueInfo();
      }
      // Kamera-/Galerie-Namen sind nichtssagend: bei mehreren Bildern "Bild N", sonst leer
      const generic = /^(image|IMG|PXL|Screenshot|photo|DSC)[-_]?\d/i.test(file.name);
      let name = generic ? (queue.files.length > 1 ? `Bild ${nr}` : '') : file.name.replace(/\.[^.]+$/, '');
      if (res.pages > 1) name = `${name || 'PDF'} S.${pageNo}`;
      show('scr-analyse');
      analyse.start(res.canvas, name, res.words);
    } catch (err) {
      toast(`${file.name}: konnte nicht geladen werden (${err.message})`);
      queue.pos++;
      nextFile();
    }
  }
  $('file-foto').addEventListener('change', ev => { handleFiles(ev.target.files); ev.target.value = ''; });
  $('file-bild').addEventListener('change', ev => { handleFiles(ev.target.files); ev.target.value = ''; });

  // ---------- Export ----------
  function download(name, href) {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('btn-png').addEventListener('click', () => {
    download('xdc-vergleich.png', O.exportPNG(project, settings, themeColors()));
  });
  $('btn-csv').addEventListener('click', () => {
    const csv = O.buildCSV(project, settings);
    download('xdc-vergleich.csv', 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv));
  });
  $('btn-clear').addEventListener('click', () => {
    if (!project.curves.length) return;
    if (armed === 'ALL') {
      armed = null; clearTimeout(armT);
      project = M.blank(); persist(); renderClear();
      toast('Alle Kurven gelöscht');
      return;
    }
    arm('ALL');
  });

  // ---------- Einstellungen ----------
  $('btn-unit').addEventListener('click', () => {
    settings.unitPower = settings.unitPower === 'PS' ? 'kW' : 'PS';
    M.saveSettings(settings); renderHome();
  });
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => { settings.mode = b.dataset.mode; M.saveSettings(settings); renderHome(); });
  }
  $('btn-theme').addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    M.saveSettings(settings); applyTheme();
  });

  // ---------- Analyse (Autopilot) ----------
  const analyse = new window.XDCAnalyse({
    canvas: $('an-canvas'), status: $('an-status'), list: $('an-list'),
    barMsg: $('bar-msg'), barBack: $('bar-back'), barFix: $('bar-fix'), barOk: $('bar-ok'),
    barInput: $('bar-input'), barValue: $('bar-value'), barSign: $('bar-sign'), barApply: $('bar-apply'),
    fixMenu: $('fix-menu')
  }, {
    onAccept: curves => {
      for (const c of curves) M.addCurve(project, c);
      M.save(project);
      queue.added += curves.length;
      queue.pos++;
      nextFile();
    },
    // Zurueck: dieses Bild ueberspringen, weiter mit dem naechsten (oder zur Uebersicht)
    onBack: () => { queue.pos++; nextFile(); }
  });

  // Bei Groessenwechsel Chart in neuer Aufloesung rendern
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(renderHome, 120);
  });

  // ---------- PWA ----------
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-Cache optional */ });
  }
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  applyTheme();
  show('scr-home');

  // Test-Hooks (nur fuer automatisierte Pruefung, keine UI-Funktion)
  window.XDCApp = {
    analyse, show,
    getProject: () => project,
    resetProject: () => { project = M.blank(); persist(); }
  };
})();
