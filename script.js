/* ===== The Meadow — Drag & Drop + Persistence ===== */

(function () {
  'use strict';

  const STORAGE_KEY   = 'cozydesk-widgets';
  const NOTES_KEY     = 'cozydesk-notes';
  const ARCHIVE_KEY   = 'cozydesk-archive';
  const TIMER_SETTINGS_KEY = 'cozydesk-timer-settings';
  const WIDGET_VISIBILITY_KEY = 'cozydesk-widget-visibility';
  const WIDGET_CATALOG = [
    { id: 'ambience', label: 'Ambience' },
    { id: 'noise', label: 'Noise Meter' },
    { id: 'timer', label: 'Timer' },
    { id: 'fact', label: 'Fact of the Day' },
    { id: 'note', label: 'Sticky Notes' },
    { id: 'links', label: 'Quick Links' },
    { id: 'search', label: 'Google Search' },
    { id: 'namepicker', label: 'Name Picker' },
  ];
  const canvas = document.getElementById('canvas');

  function defaultWidgetVisibility() {
    const o = {};
    WIDGET_CATALOG.forEach(({ id }) => { o[id] = true; });
    return o;
  }

  function getWidgetVisibility() {
    try {
      const raw = localStorage.getItem(WIDGET_VISIBILITY_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { ...defaultWidgetVisibility(), ...parsed };
    } catch {
      return defaultWidgetVisibility();
    }
  }

  function saveWidgetVisibility(vis) {
    localStorage.setItem(WIDGET_VISIBILITY_KEY, JSON.stringify(vis));
  }

  // ── Z-index counter ──
  let topZ = 10;

  // ── Restore saved positions + sizes ──
  function clampWidget(el) {
    const margin = 40;
    const cW = canvas.offsetWidth;
    const cH = canvas.offsetHeight;
    let x = parseInt(el.style.left, 10) || 0;
    let y = parseInt(el.style.top, 10) || 0;
    const elW = el.offsetWidth;
    const elH = el.offsetHeight;
    x = Math.max(-elW + margin, Math.min(x, cW - margin));
    y = Math.max(-elH + margin, Math.min(y, cH - margin));
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  }

  function loadPositions() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) return;
      saved.forEach(({ id, x, y, w, h }) => {
        const el = document.querySelector(`[data-widget-id="${id}"]`);
        if (el) {
          el.style.left = x + 'px';
          el.style.top  = y + 'px';
          if (w) el.style.width  = w + 'px';
          if (h) el.style.height = h + 'px';
          clampWidget(el);
        }
      });
    } catch { /* first visit or corrupt data — use defaults */ }
  }

  function savePositions() {
    const widgets = [...document.querySelectorAll('.widget')];
    const data = widgets.map(el => ({
      id: el.dataset.widgetId,
      x: parseInt(el.style.left, 10) || 0,
      y: parseInt(el.style.top, 10) || 0,
      w: el.style.width  ? parseInt(el.style.width, 10)  : null,
      h: el.style.height ? parseInt(el.style.height, 10) : null,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // ── Inject resize handles into every widget ──
  function injectResizeHandles() {
    document.querySelectorAll('.widget').forEach(widget => {
      ['se', 'sw', 'ne', 'nw'].forEach(dir => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-handle--${dir}`;
        handle.dataset.resize = dir;
        widget.appendChild(handle);
      });
    });
  }

  // ── Show only the nearest corner handle on mousemove ──
  let lastNearest = null;

  canvas.addEventListener('mousemove', (e) => {
    // Skip while dragging or resizing
    if (dragging || resizing) return;

    const widget = e.target.closest('.widget');

    // Clear previous if we left a widget
    if (lastNearest && (!widget || lastNearest.closest('.widget') !== widget)) {
      lastNearest.classList.remove('nearest');
      lastNearest = null;
    }
    if (!widget) return;

    const rect = widget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    // Distances to each corner (skip nw for the visible dot)
    const cornerRadius = 60; // px – pin only shows within this distance from corner
    const corners = [
      { dir: 'ne', d: Math.sqrt((w - mx) * (w - mx) + my * my) },
      { dir: 'sw', d: Math.sqrt(mx * mx + (h - my) * (h - my)) },
      { dir: 'se', d: Math.sqrt((w - mx) * (w - mx) + (h - my) * (h - my)) },
    ];
    corners.sort((a, b) => a.d - b.d);

    const closestCorner = corners[0];
    const nearest = closestCorner.d <= cornerRadius
      ? widget.querySelector(`.resize-handle--${closestCorner.dir}`)
      : null;

    if (nearest !== lastNearest) {
      if (lastNearest) lastNearest.classList.remove('nearest');
      if (nearest) nearest.classList.add('nearest');
      lastNearest = nearest;
    }
  });

  // Clear handle when mouse leaves the canvas
  canvas.addEventListener('mouseleave', () => {
    if (lastNearest) {
      lastNearest.classList.remove('nearest');
      lastNearest = null;
    }
  });

  // ── Drag handling (Pointer Events) ──
  let dragging = null;  // { el, offsetX, offsetY }
  let didDrag = false;
  let didResize = false;

  // ── Resize handling ──
  let resizing = null;  // { el, dir, startX, startY, startW, startH, startLeft, startTop }
  const MIN_W = 160;
  const MIN_H = 80;

  canvas.addEventListener('pointerdown', (e) => {
    // ── Check for resize handle first ──
    const handle = e.target.closest('.resize-handle');
    if (handle) {
      const widget = handle.closest('.widget');
      const dir = handle.dataset.resize;
      const rect = widget.getBoundingClientRect();

      widget.setPointerCapture(e.pointerId);
      widget.classList.add('resizing');
      didResize = true;

      // Hide the handle dot during resize
      if (lastNearest) { lastNearest.classList.remove('nearest'); lastNearest = null; }

      // Bring to front
      topZ++;
      widget.style.zIndex = topZ;

      resizing = {
        el: widget,
        dir,
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
        startLeft: parseInt(widget.style.left, 10) || 0,
        startTop:  parseInt(widget.style.top, 10)  || 0,
      };
      e.preventDefault();
      return;
    }

    // ── Normal drag ──
    const widget = e.target.closest('.widget');
    if (!widget) return;

    // Don't drag when clicking interactive elements
    if (e.target.closest('a') || e.target.closest('button') || e.target.closest('input')
        || e.target.closest('.note-preview-check')
        || e.target.closest('.timer-btn') || e.target.closest('.timer-btn-sm')
        || e.target.closest('.timer-display') || e.target.closest('iframe')) return;

    didDrag = false;
    widget.setPointerCapture(e.pointerId);

    const rect = widget.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    dragging = {
      el: widget,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      canvasLeft: canvasRect.left,
      canvasTop: canvasRect.top,
    };

    // Bring to front
    topZ++;
    widget.style.zIndex = topZ;
    widget.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    // ── Resize move ──
    if (resizing) {
      const r = resizing;
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;

      let newW = r.startW;
      let newH = r.startH;
      let newLeft = r.startLeft;
      let newTop  = r.startTop;

      // Horizontal
      if (r.dir.includes('e')) {
        newW = Math.max(MIN_W, r.startW + dx);
      } else if (r.dir.includes('w')) {
        newW = Math.max(MIN_W, r.startW - dx);
        newLeft = r.startLeft + (r.startW - newW);
      }

      // Vertical
      if (r.dir.includes('s')) {
        newH = Math.max(MIN_H, r.startH + dy);
      } else if (r.dir.includes('n')) {
        newH = Math.max(MIN_H, r.startH - dy);
        newTop = r.startTop + (r.startH - newH);
      }

      r.el.style.width  = newW + 'px';
      r.el.style.height  = newH + 'px';
      r.el.style.left   = newLeft + 'px';
      r.el.style.top    = newTop + 'px';
      return;
    }

    // ── Drag move ──
    if (!dragging) return;

    let x = e.clientX - dragging.canvasLeft - dragging.offsetX;
    let y = e.clientY - dragging.canvasTop - dragging.offsetY;

    // Keep at least 40px of the widget visible on each edge
    const elW = dragging.el.offsetWidth;
    const elH = dragging.el.offsetHeight;
    const cW = canvas.offsetWidth;
    const cH = canvas.offsetHeight;
    const margin = 40;
    x = Math.max(-elW + margin, Math.min(x, cW - margin));
    y = Math.max(-elH + margin, Math.min(y, cH - margin));

    didDrag = true;
    dragging.el.style.left = x + 'px';
    dragging.el.style.top = y + 'px';
  });

  canvas.addEventListener('pointerup', (e) => {
    // ── Resize end ──
    if (resizing) {
      resizing.el.classList.remove('resizing');
      resizing = null;
      savePositions();
      setTimeout(() => { didResize = false; }, 50);
      return;
    }

    // ── Drag end ──
    if (!dragging) return;
    const el = dragging.el;
    el.classList.remove('dragging');
    dragging = null;
    savePositions();

    // (notes modal is now handled via its own click listener below)
  });


  // ═══════════════════════════════════════
  // ── Sticky Notes CRUD + Modal + Archive ──
  // ═══════════════════════════════════════

  const notesModal     = document.getElementById('notesModal');
  const modalClose     = document.getElementById('modalClose');
  const noteInput      = document.getElementById('noteInput');
  const noteAddBtn     = document.getElementById('noteAddBtn');
  const modalNotesList = document.getElementById('modalNotesList');
  const notesEmpty     = document.getElementById('notesEmpty');
  const notesList      = document.getElementById('notesList');
  const archiveToggle  = document.getElementById('archiveToggle');
  const archiveList    = document.getElementById('archiveList');
  const archiveCount   = document.getElementById('archiveCount');

  const CHECK_SVG = '<svg viewBox="0 0 12 12"><polyline points="2.5 6 5 8.5 9.5 3.5"/></svg>';

  // ── Data helpers ──
  function getNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; }
    catch { return []; }
  }
  function saveNotes(notes) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }
  function getArchive() {
    try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY)) || []; }
    catch { return []; }
  }
  function saveArchive(archive) {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
  }

  // Seed default note on first visit
  function initNotes() {
    if (localStorage.getItem(NOTES_KEY) === null) {
      saveNotes([
        { id: Date.now(), text: 'Print out worksheets for Spanish II activity' }
      ]);
    }
  }

  function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Complete a note (animate on widget, then archive) ──
  function completeNote(id, previewItem) {
    const checkbox = previewItem.querySelector('.note-preview-check');
    if (checkbox) checkbox.classList.add('checked');

    // Lock exact current height so collapse animates from real size, not a large max-height
    previewItem.style.maxHeight = previewItem.scrollHeight + 'px';

    // 1. Strikethrough appears instantly; fade starts after 0.2s CSS delay (0.3s duration)
    previewItem.classList.add('completing');

    // 2. After strike + fade finishes (0.2s delay + 0.3s fade = 0.5s), collapse height
    setTimeout(() => {
      previewItem.classList.add('collapsing');
    }, 500);

    // 3. After collapse finishes (0.5s + 0.25s = 0.75s), archive and re-render
    setTimeout(() => {
      const notes = getNotes();
      const idx = notes.findIndex(n => n.id === id);
      if (idx === -1) return;

      const [completed] = notes.splice(idx, 1);
      completed.completedAt = Date.now();
      const archive = getArchive();
      archive.unshift(completed);

      saveNotes(notes);
      saveArchive(archive);
      renderWidgetPreview();

      if (notesModal && notesModal.classList.contains('open')) {
        renderModalNotes();
        renderArchive();
      }
    }, 750);
  }

  // ── Widget preview (compact card list with hover checkboxes) ──
  function renderWidgetPreview() {
    const notes = getNotes();
    notesList.innerHTML = '';

    if (notes.length === 0) {
      notesList.innerHTML = '<p class="note-preview-empty">Click to add notes…</p>';
      return;
    }

    notes.slice(0, 4).forEach(n => {
      const div = document.createElement('div');
      div.className = 'note-preview-item';
      div.dataset.noteId = n.id;

      const check = document.createElement('button');
      check.className = 'note-preview-check';
      check.innerHTML = CHECK_SVG;
      check.title = 'Mark complete';

      const text = document.createElement('span');
      text.className = 'note-preview-text';
      text.textContent = n.text;

      div.appendChild(check);
      div.appendChild(text);
      notesList.appendChild(div);
    });

    if (notes.length > 4) {
      const more = document.createElement('div');
      more.className = 'note-preview-item';
      const moreText = document.createElement('span');
      moreText.className = 'note-preview-text';
      moreText.style.color = '#b8a88a';
      moreText.textContent = `+ ${notes.length - 4} more…`;
      more.appendChild(moreText);
      notesList.appendChild(more);
    }
  }

  // Handle checkbox clicks on the widget preview
  notesList.addEventListener('click', (e) => {
    const check = e.target.closest('.note-preview-check');
    if (!check) return;

    e.stopPropagation();
    e.preventDefault();

    const item = check.closest('.note-preview-item');
    const id = Number(item.dataset.noteId);
    if (!id) return;

    completeNote(id, item);
  });

  // ── Modal: active notes list ──
  function renderModalNotes() {
    const notes = getNotes();
    modalNotesList.innerHTML = '';
    notesEmpty.classList.toggle('hidden', notes.length > 0);

    notes.forEach(n => {
      const li = document.createElement('li');
      li.className = 'note-row';
      li.innerHTML = `
        <span class="note-text">${escapeHTML(n.text)}</span>
        <div class="note-actions">
          <button class="note-btn complete" data-id="${n.id}" title="Mark complete">&#10003;</button>
          <button class="note-btn edit" data-id="${n.id}" title="Edit">&#9998;</button>
          <button class="note-btn delete" data-id="${n.id}" title="Delete">&#10005;</button>
        </div>
      `;
      modalNotesList.appendChild(li);
    });
  }

  // ── Modal: archive section ──
  function renderArchive() {
    const archive = getArchive();
    archiveCount.textContent = archive.length > 0 ? `(${archive.length})` : '';
    archiveList.innerHTML = '';

    if (archive.length === 0) {
      archiveList.innerHTML = '<li class="archive-empty">No completed notes yet.</li>';
      return;
    }

    archive.forEach(n => {
      const li = document.createElement('li');
      li.className = 'archive-row';

      const dateStr = new Date(n.completedAt).toLocaleDateString([], {
        month: 'short', day: 'numeric',
      });

      li.innerHTML = `
        <span class="archive-text">${escapeHTML(n.text)}</span>
        <span class="archive-date">${dateStr}</span>
        <div class="archive-actions">
          <button class="archive-btn restore" data-id="${n.id}" title="Restore">&#8634;</button>
          <button class="archive-btn perm-delete" data-id="${n.id}" title="Delete forever">&#10005;</button>
        </div>
      `;
      archiveList.appendChild(li);
    });
  }

  // Archive toggle
  archiveToggle.addEventListener('click', () => {
    archiveToggle.classList.toggle('open');
    archiveList.classList.toggle('open');
    if (archiveList.classList.contains('open')) renderArchive();
  });

  // Archive actions (restore / permanent delete)
  archiveList.addEventListener('click', (e) => {
    const btn = e.target.closest('.archive-btn');
    if (!btn) return;
    const id = Number(btn.dataset.id);

    if (btn.classList.contains('restore')) {
      const archive = getArchive();
      const idx = archive.findIndex(n => n.id === id);
      if (idx === -1) return;
      const [restored] = archive.splice(idx, 1);
      delete restored.completedAt;
      const notes = getNotes();
      notes.unshift(restored);
      saveNotes(notes);
      saveArchive(archive);
      renderModalNotes();
      renderArchive();
      renderWidgetPreview();
    } else if (btn.classList.contains('perm-delete')) {
      const archive = getArchive().filter(n => n.id !== id);
      saveArchive(archive);
      renderArchive();
    }
  });

  // ── Add note ──
  function addNote() {
    const text = noteInput.value.trim();
    if (!text) return;
    const notes = getNotes();
    notes.unshift({ id: Date.now(), text });
    saveNotes(notes);
    noteInput.value = '';
    renderModalNotes();
    renderWidgetPreview();
    noteInput.focus();
  }

  // ── Delete note (not archive — just remove) ──
  function deleteNote(id) {
    const notes = getNotes().filter(n => n.id !== id);
    saveNotes(notes);
    renderModalNotes();
    renderWidgetPreview();
  }

  // ── Complete note from modal ──
  function completeNoteFromModal(id) {
    const notes = getNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return;
    const [completed] = notes.splice(idx, 1);
    completed.completedAt = Date.now();
    const archive = getArchive();
    archive.unshift(completed);
    saveNotes(notes);
    saveArchive(archive);
    renderModalNotes();
    renderArchive();
    renderWidgetPreview();
  }

  // ── Inline edit note ──
  function startEditNote(id) {
    const notes = getNotes();
    const note = notes.find(n => n.id === id);
    if (!note) return;

    const row = modalNotesList.querySelector(`[data-id="${id}"]`).closest('.note-row');
    const span = row.querySelector('.note-text');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-text editing';
    input.value = note.text;
    span.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
      const newText = input.value.trim();
      if (newText && newText !== note.text) {
        note.text = newText;
        saveNotes(notes);
        renderWidgetPreview();
      }
      renderModalNotes();
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') renderModalNotes();
    });
  }

  // ── Modal open/close ──
  function openNotesModal() {
    renderModalNotes();
    renderArchive();
    notesModal.classList.add('open');
    setTimeout(() => noteInput.focus(), 100);
  }

  function closeNotesModal() {
    notesModal.classList.remove('open');
    // Collapse archive when closing
    archiveToggle.classList.remove('open');
    archiveList.classList.remove('open');
  }

  // Open notes modal when clicking on the notes widget (not during drag/resize)
  const noteWidget = document.querySelector('.widget-note');
  noteWidget.addEventListener('click', (e) => {
    if (didDrag || didResize) return;
    if (e.target.closest('.resize-handle')) return;
    openNotesModal();
  });

  modalClose.addEventListener('click', closeNotesModal);

  notesModal.addEventListener('click', (e) => {
    if (e.target === notesModal) closeNotesModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && notesModal.classList.contains('open')) {
      closeNotesModal();
    }
  });

  noteAddBtn.addEventListener('click', addNote);
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNote();
  });

  // Delegate edit/delete/complete clicks in modal
  modalNotesList.addEventListener('click', (e) => {
    const btn = e.target.closest('.note-btn');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.classList.contains('delete')) deleteNote(id);
    else if (btn.classList.contains('edit')) startEditNote(id);
    else if (btn.classList.contains('complete')) completeNoteFromModal(id);
  });

  // ═══════════════════════════════════════
  // ── Timer Widget ──
  // ═══════════════════════════════════════

  const TIMER_DEFAULT = 300; // 5 minutes in seconds
  let timerTotal    = TIMER_DEFAULT;
  let timerRemain   = TIMER_DEFAULT;
  let timerInterval = null;
  let timerRunning  = false;
  let timerDone     = false;

  // ── Timer settings ──
  const defaultTimerSettings = {
    sound: 'chime',        // 'none' | 'chime' | 'bell' | 'buzzer'
    flash: true,
    autoRestart: false,
    showDesc: false,
    description: '',
    wakeLock: false,
  };
  let timerSettings = { ...defaultTimerSettings };

  function loadTimerSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(TIMER_SETTINGS_KEY));
      if (saved) timerSettings = { ...defaultTimerSettings, ...saved };
    } catch { /* use defaults */ }
  }

  function saveTimerSettings() {
    localStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(timerSettings));
  }

  // ── Wake Lock API ──
  let wakeLockSentinel = null;

  async function requestWakeLock() {
    if (!timerSettings.wakeLock || !('wakeLock' in navigator)) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } catch { /* browser denied or unsupported */ }
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  }

  // ── Sound generation via Web Audio API ──
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playChime() {
    const ctx = getAudioCtx();
    const notes = [659, 784, 988]; // E5, G5, B5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.8);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.8);
    });
  }

  function playBell() {
    const ctx = getAudioCtx();
    [0, 0.6, 1.2].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.4, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.5);
    });
  }

  function playBuzzer() {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 220;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1);
  }

  function playTimerSoundOnce() {
    switch (timerSettings.sound) {
      case 'chime':  playChime(); break;
      case 'bell':   playBell();  break;
      case 'buzzer': playBuzzer(); break;
    }
  }

  // Play sound on preview (single shot) — used by settings dropdown
  function playTimerSound() { playTimerSoundOnce(); }

  // Loop sound + flash for a duration (ms). Returns a stop function.
  let endAlertTimer = null;

  function startEndAlert(duration) {
    // Stop any previous alert
    stopEndAlert();

    const widget = document.querySelector('.widget-timer');
    const SOUND_INTERVAL = 1400; // repeat sound every 1.4s
    const FLASH_CYCLE    = 500;  // one flash cycle duration (matches CSS)

    // ── Sound loop ──
    if (timerSettings.sound !== 'none') {
      playTimerSoundOnce();
      var soundLoop = setInterval(playTimerSoundOnce, SOUND_INTERVAL);
    }

    // ── Flash loop ──
    let flashLoop = null;
    if (timerSettings.flash) {
      function doFlash() {
        widget.classList.remove('flash-red');
        timerFsOverlay.classList.remove('flash-red');
        // Force reflow to restart animation
        void widget.offsetWidth;
        widget.classList.add('flash-red');
        timerFsOverlay.classList.add('flash-red');
      }
      doFlash();
      flashLoop = setInterval(doFlash, FLASH_CYCLE * 3 + 100); // restart after 3-cycle animation
    }

    // ── Auto-stop after duration ──
    endAlertTimer = setTimeout(() => {
      stopEndAlert();
    }, duration);

    // Store references for cleanup
    endAlertTimer._soundLoop = soundLoop || null;
    endAlertTimer._flashLoop = flashLoop;
    endAlertTimer._widget = widget;
  }

  function stopEndAlert() {
    if (endAlertTimer) {
      clearTimeout(endAlertTimer);
      if (endAlertTimer._soundLoop) clearInterval(endAlertTimer._soundLoop);
      if (endAlertTimer._flashLoop) clearInterval(endAlertTimer._flashLoop);
      if (endAlertTimer._widget) {
        endAlertTimer._widget.classList.remove('flash-red');
        timerFsOverlay.classList.remove('flash-red');
      }
      endAlertTimer = null;
    }
  }

  // ── Elements — widget ──
  const timerDisplay    = document.getElementById('timerDisplay');
  const timerPlayBtn    = document.getElementById('timerPlay');
  const timerMinusBtn   = document.getElementById('timerMinus');
  const timerPlusBtn    = document.getElementById('timerPlus');
  const timerResetBtn   = document.getElementById('timerReset');
  const timerFsBtn      = document.getElementById('timerFullscreen');
  const timerSettingsBtn = document.getElementById('timerSettings');
  const timerDescWidget = document.getElementById('timerDescWidget');

  // ── Elements — fullscreen ──
  const timerFsOverlay  = document.getElementById('timerFullscreenOverlay');
  const timerFsDisplay  = document.getElementById('timerFsDisplay');
  const timerFsPlayBtn  = document.getElementById('timerFsPlay');
  const timerFsMinusBtn = document.getElementById('timerFsMinus');
  const timerFsPlusBtn  = document.getElementById('timerFsPlus');
  const timerFsResetBtn = document.getElementById('timerFsReset');
  const timerFsExitBtn  = document.getElementById('timerFsExit');
  const timerFsProgress = document.getElementById('timerFsProgress');
  const timerFsSettingsBtn = document.getElementById('timerFsSettings');
  const timerDescFs     = document.getElementById('timerDescFs');

  // ── Elements — settings modal ──
  const tsModal         = document.getElementById('timerSettingsModal');
  const tsCloseBtn      = document.getElementById('timerSettingsClose');
  const tsSoundSelect   = document.getElementById('tsSound');
  const tsFlashToggle   = document.getElementById('tsFlash');
  const tsAutoRestart   = document.getElementById('tsAutoRestart');
  const tsShowDesc      = document.getElementById('tsShowDesc');
  const tsDescRow       = document.getElementById('tsDescRow');
  const tsDescInput     = document.getElementById('tsDescInput');
  const tsWakeLock      = document.getElementById('tsWakeLock');

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + String(sec).padStart(2, '0');
  }

  function renderDescription() {
    const text = timerSettings.showDesc ? timerSettings.description : '';
    timerDescWidget.textContent = text;
    timerDescFs.textContent = text;
  }

  function renderTimer() {
    const text = formatTime(timerRemain);
    timerDisplay.textContent = text;
    timerFsDisplay.textContent = text;

    // Done state
    timerDisplay.classList.toggle('done', timerDone);
    timerFsDisplay.classList.toggle('done', timerDone);

    // Play/pause button state
    timerPlayBtn.classList.toggle('running', timerRunning);
    timerFsPlayBtn.classList.toggle('running', timerRunning);

    timerPlayBtn.title = timerRunning ? 'Pause' : 'Start';
    timerFsPlayBtn.title = timerRunning ? 'Pause' : 'Start';

    // Progress bar
    const pct = timerTotal > 0 ? ((timerTotal - timerRemain) / timerTotal) * 100 : 0;
    timerFsProgress.style.width = pct + '%';
    timerFsProgress.classList.toggle('done', timerDone);

    // Description
    renderDescription();
  }

  const END_ALERT_DURATION = 7000; // 7 seconds of sound + flash

  function onTimerEnd() {
    timerDone = true;
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;

    // Release wake lock
    releaseWakeLock();

    renderTimer();

    // Sound + flash for 7 seconds
    startEndAlert(END_ALERT_DURATION);

    // Auto-restart after the alert finishes
    if (timerSettings.autoRestart) {
      setTimeout(() => {
        timerDone = false;
        timerRemain = timerTotal;
        timerRunning = true;
        timerInterval = setInterval(timerTick, 1000);
        requestWakeLock();
        renderTimer();
      }, END_ALERT_DURATION + 500);
    }
  }

  function timerTick() {
    if (timerRemain <= 0) {
      onTimerEnd();
      return;
    }
    timerRemain--;
    renderTimer();
  }

  function toggleTimer() {
    if (timerDone) {
      // If done, stop alert and restart from the same total
      stopEndAlert();
      timerDone = false;
      timerRemain = timerTotal;
      renderTimer();
      return;
    }

    if (timerRunning) {
      // Pause
      clearInterval(timerInterval);
      timerInterval = null;
      timerRunning = false;
      releaseWakeLock();
    } else {
      // Start
      if (timerRemain <= 0) timerRemain = timerTotal;
      timerRunning = true;
      timerInterval = setInterval(timerTick, 1000);
      requestWakeLock();
    }
    renderTimer();
  }

  // Smart increment: step size depends on current value
  function getStep(seconds) {
    if (seconds < 10)  return 1;
    if (seconds < 60)  return 5;
    if (seconds < 120) return 10;
    return 30;
  }

  function adjustTimer(direction) {
    // direction: +1 or -1
    if (timerRunning) return; // don't adjust while running
    timerDone = false;

    if (direction > 0) {
      const step = getStep(timerRemain);
      timerRemain = timerRemain + step;
    } else {
      const step = getStep(Math.max(0, timerRemain - 1));
      timerRemain = Math.max(0, timerRemain - step);
    }

    timerTotal = timerRemain;
    renderTimer();
  }

  function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning = false;
    timerDone = false;
    timerRemain = timerTotal;
    releaseWakeLock();
    stopEndAlert();
    renderTimer();
  }

  function openTimerFullscreen() {
    timerFsOverlay.classList.add('open');
    renderTimer();
  }

  function closeTimerFullscreen() {
    timerFsOverlay.classList.remove('open');
  }

  // ── Settings modal helpers ──
  function toggleSwitch(btn) {
    const on = btn.dataset.on === 'true';
    btn.dataset.on = String(!on);
    btn.setAttribute('aria-checked', String(!on));
    return !on;
  }

  function setSwitchState(btn, val) {
    btn.dataset.on = String(val);
    btn.setAttribute('aria-checked', String(val));
  }

  function syncSettingsUI() {
    tsSoundSelect.value = timerSettings.sound;
    setSwitchState(tsFlashToggle, timerSettings.flash);
    setSwitchState(tsAutoRestart, timerSettings.autoRestart);
    setSwitchState(tsShowDesc, timerSettings.showDesc);
    setSwitchState(tsWakeLock, timerSettings.wakeLock);
    tsDescInput.value = timerSettings.description;
    tsDescRow.style.display = timerSettings.showDesc ? 'block' : 'none';
  }

  function openTimerSettings() {
    syncSettingsUI();
    tsModal.classList.add('open');
  }

  function closeTimerSettings() {
    tsModal.classList.remove('open');
  }

  // Settings event listeners
  tsCloseBtn.addEventListener('click', closeTimerSettings);
  tsModal.addEventListener('click', (e) => { if (e.target === tsModal) closeTimerSettings(); });

  tsSoundSelect.addEventListener('change', () => {
    timerSettings.sound = tsSoundSelect.value;
    saveTimerSettings();
    // Preview the sound
    playTimerSound();
  });

  tsFlashToggle.addEventListener('click', () => {
    timerSettings.flash = toggleSwitch(tsFlashToggle);
    saveTimerSettings();
  });

  tsAutoRestart.addEventListener('click', () => {
    timerSettings.autoRestart = toggleSwitch(tsAutoRestart);
    saveTimerSettings();
  });

  tsShowDesc.addEventListener('click', () => {
    timerSettings.showDesc = toggleSwitch(tsShowDesc);
    tsDescRow.style.display = timerSettings.showDesc ? 'block' : 'none';
    saveTimerSettings();
    renderDescription();
    if (timerSettings.showDesc) setTimeout(() => tsDescInput.focus(), 50);
  });

  tsDescInput.addEventListener('input', () => {
    timerSettings.description = tsDescInput.value.trim();
    saveTimerSettings();
    renderDescription();
  });

  tsWakeLock.addEventListener('click', () => {
    timerSettings.wakeLock = toggleSwitch(tsWakeLock);
    saveTimerSettings();
    // If timer is currently running, acquire/release accordingly
    if (timerRunning) {
      timerSettings.wakeLock ? requestWakeLock() : releaseWakeLock();
    }
  });

  // Widget buttons
  timerPlayBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleTimer(); });
  timerMinusBtn.addEventListener('click', (e) => { e.stopPropagation(); adjustTimer(-1); });
  timerPlusBtn.addEventListener('click', (e) => { e.stopPropagation(); adjustTimer(1); });
  timerResetBtn.addEventListener('click', (e) => { e.stopPropagation(); resetTimer(); });
  timerFsBtn.addEventListener('click', (e) => { e.stopPropagation(); openTimerFullscreen(); });
  timerSettingsBtn.addEventListener('click', (e) => { e.stopPropagation(); openTimerSettings(); });

  // Fullscreen buttons
  timerFsPlayBtn.addEventListener('click', toggleTimer);
  timerFsMinusBtn.addEventListener('click', () => adjustTimer(-1));
  timerFsPlusBtn.addEventListener('click', () => adjustTimer(1));
  timerFsResetBtn.addEventListener('click', resetTimer);
  timerFsExitBtn.addEventListener('click', closeTimerFullscreen);
  timerFsSettingsBtn.addEventListener('click', openTimerSettings);

  // Escape to exit fullscreen timer or close settings
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (tsModal.classList.contains('open')) { closeTimerSettings(); return; }
      if (timerFsOverlay.classList.contains('open')) { closeTimerFullscreen(); }
    }
  });

  // ── Time-input popover ──
  const timerInputPopover = document.getElementById('timerInputPopover');
  const timerInputMin     = document.getElementById('timerInputMin');
  const timerInputSec     = document.getElementById('timerInputSec');
  const timerInputSetBtn  = document.getElementById('timerInputSet');
  let timeInputOpen = false;

  function openTimeInput(anchorEl) {
    if (timerRunning || timerDone) return; // only allow editing when stopped

    // Position the popover near the clicked display
    const rect = anchorEl.getBoundingClientRect();
    const popW = 220; // approximate popover width
    let left = rect.left + rect.width / 2 - popW / 2;
    let top = rect.bottom + 8;

    // Keep in viewport
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    if (top + 60 > window.innerHeight) top = rect.top - 60;

    timerInputPopover.style.left = left + 'px';
    timerInputPopover.style.top = top + 'px';

    // Fill current values
    const mins = Math.floor(timerRemain / 60);
    const secs = timerRemain % 60;
    timerInputMin.value = String(mins);
    timerInputSec.value = String(secs).padStart(2, '0');

    timerInputPopover.classList.add('open');
    timeInputOpen = true;

    // Select the minutes field
    setTimeout(() => { timerInputMin.focus(); timerInputMin.select(); }, 50);
  }

  function closeTimeInput() {
    timerInputPopover.classList.remove('open');
    timeInputOpen = false;
  }

  function commitTimeInput() {
    const m = parseInt(timerInputMin.value, 10) || 0;
    const s = parseInt(timerInputSec.value, 10) || 0;
    const total = Math.max(0, m * 60 + Math.min(59, s));
    timerRemain = total;
    timerTotal = total;
    timerDone = false;
    renderTimer();
    closeTimeInput();
  }

  // Only allow digits in the inputs
  function filterDigits(e) {
    const input = e.target;
    input.value = input.value.replace(/[^0-9]/g, '');
  }

  timerInputMin.addEventListener('input', filterDigits);
  timerInputSec.addEventListener('input', filterDigits);

  // Auto-select all text on focus so user can just type to overwrite
  timerInputMin.addEventListener('focus', () => timerInputMin.select());
  timerInputSec.addEventListener('focus', () => timerInputSec.select());

  // Tab from minutes to seconds
  timerInputMin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commitTimeInput(); return; }
    if (e.key === 'Escape') { closeTimeInput(); return; }
    if (e.key === ':' || e.key === 'Tab') {
      e.preventDefault();
      timerInputSec.focus();
      timerInputSec.select();
    }
  });

  timerInputSec.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commitTimeInput(); return; }
    if (e.key === 'Escape') { closeTimeInput(); return; }
  });

  timerInputSetBtn.addEventListener('click', commitTimeInput);

  // Click the display to open
  timerDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    if (timeInputOpen) { closeTimeInput(); return; }
    openTimeInput(timerDisplay);
  });

  timerFsDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    if (timeInputOpen) { closeTimeInput(); return; }
    openTimeInput(timerFsDisplay);
  });

  // Close popover when clicking outside
  document.addEventListener('pointerdown', (e) => {
    if (!timeInputOpen) return;
    if (timerInputPopover.contains(e.target)) return;
    if (e.target === timerDisplay || e.target === timerFsDisplay) return;
    closeTimeInput();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && timeInputOpen) closeTimeInput();
  });

  // Initial render
  loadTimerSettings();
  renderTimer();

  // ═══════════════════════════════════════
  // ── Fact of the Day ──
  // ═══════════════════════════════════════

  const FACTS = [
    { text: "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.", category: "Nature" },
    { text: "Octopuses have three hearts, nine brains, and blue blood.", category: "Biology" },
    { text: "A group of flamingos is called a \"flamboyance.\"", category: "Animals" },
    { text: "The Eiffel Tower can grow by up to 6 inches in summer due to thermal expansion of the iron.", category: "Engineering" },
    { text: "Bananas are naturally radioactive because they contain potassium-40.", category: "Science" },
    { text: "Venus is the only planet in our solar system that spins clockwise.", category: "Space" },
    { text: "The shortest war in history lasted 38 minutes, between Britain and Zanzibar in 1896.", category: "History" },
    { text: "A jiffy is an actual unit of time — it equals 1/100th of a second.", category: "Science" },
    { text: "The Great Wall of China is not visible from space with the naked eye, but highways are.", category: "Geography" },
    { text: "Cows have best friends and get stressed when they are separated.", category: "Animals" },
    { text: "There are more stars in the universe than grains of sand on all of Earth's beaches.", category: "Space" },
    { text: "The inventor of the Pringles can is buried in one.", category: "History" },
    { text: "Sharks existed before trees. Sharks are around 400 million years old, while trees are 350 million.", category: "Nature" },
    { text: "Your brain uses about 20% of your body's total energy, despite being only 2% of your body weight.", category: "Biology" },
    { text: "Scotland's national animal is the unicorn.", category: "Culture" },
    { text: "A bolt of lightning is five times hotter than the surface of the sun.", category: "Science" },
    { text: "The entire world's population could fit inside Los Angeles if standing shoulder to shoulder.", category: "Geography" },
    { text: "Sea otters hold hands while sleeping so they don't drift apart.", category: "Animals" },
    { text: "The first computer programmer was Ada Lovelace, who wrote the first algorithm in the 1840s.", category: "Technology" },
    { text: "An astronaut's footprint on the Moon could last for 100 million years because there's no wind.", category: "Space" },
    { text: "The average person walks about 100,000 miles in their lifetime — that's four trips around the Earth.", category: "Health" },
    { text: "Wombat droppings are cube-shaped to prevent them from rolling away.", category: "Animals" },
    { text: "The human nose can detect over 1 trillion different scents.", category: "Biology" },
    { text: "There's a basketball court on the top floor of the U.S. Supreme Court building.", category: "Culture" },
    { text: "Water can boil and freeze at the same time in a process called the triple point.", category: "Science" },
    { text: "The world's oldest known living tree is over 5,000 years old and lives in California.", category: "Nature" },
    { text: "Ancient Romans used crushed mouse brains as toothpaste.", category: "History" },
    { text: "Butterflies taste with their feet.", category: "Biology" },
    { text: "If you could fold a piece of paper 42 times, it would reach the Moon.", category: "Math" },
    { text: "The Hawaiian alphabet has only 13 letters: 5 vowels and 8 consonants.", category: "Language" },
    { text: "A cloud can weigh more than a million pounds.", category: "Science" },
    { text: "Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.", category: "History" },
    { text: "Dolphins have names for each other and respond when called.", category: "Animals" },
    { text: "The total weight of all ants on Earth is roughly equal to the total weight of all humans.", category: "Nature" },
    { text: "Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.", category: "Space" },
    { text: "The longest hiccuping spree lasted 68 years, from 1922 to 1990.", category: "Health" },
    { text: "Greenland sharks can live for over 400 years, making them the longest-lived vertebrates.", category: "Biology" },
    { text: "A day on Venus is longer than a year on Venus.", category: "Space" },
    { text: "The tallest mountain in our solar system is Olympus Mons on Mars — three times taller than Everest.", category: "Space" },
    { text: "Humans share about 60% of their DNA with bananas.", category: "Biology" },
    { text: "Oxford University is older than the Aztec Empire.", category: "History" },
    { text: "The tongue of a blue whale weighs as much as an elephant.", category: "Animals" },
    { text: "There are more possible iterations of a game of chess than there are atoms in the observable universe.", category: "Math" },
    { text: "A teaspoon of a neutron star would weigh about 6 billion tons.", category: "Space" },
    { text: "Sloths can hold their breath longer than dolphins — up to 40 minutes.", category: "Animals" },
    { text: "The dot over the letters 'i' and 'j' is called a tittle.", category: "Language" },
    { text: "Strawberries are not actually berries, but bananas, avocados, and watermelons are.", category: "Nature" },
    { text: "An individual blood cell takes about 60 seconds to make a complete circuit of the body.", category: "Biology" },
    { text: "The world's largest desert is Antarctica, not the Sahara.", category: "Geography" },
    { text: "Astronauts grow up to 2 inches taller in space because their spines expand without gravity.", category: "Space" },
    { text: "A group of porcupines is called a prickle.", category: "Animals" },
    { text: "The first email was sent in 1971 by Ray Tomlinson — he doesn't remember what it said.", category: "Technology" },
    { text: "More people in the world have mobile phones than have access to a toilet.", category: "Technology" },
    { text: "The longest word in the English language without a vowel is 'rhythms.'", category: "Language" },
    { text: "Glass balls can bounce higher than rubber balls.", category: "Science" },
    { text: "The Moon is slowly drifting away from Earth at a rate of about 1.5 inches per year.", category: "Space" },
    { text: "Polar bear fur is not white — it's transparent. Their skin underneath is black.", category: "Animals" },
    { text: "Your body contains about 0.2 milligrams of gold, mostly in your blood.", category: "Biology" },
    { text: "The original name for the search engine Google was Backrub.", category: "Technology" },
    { text: "A single bolt of lightning contains enough energy to toast 100,000 slices of bread.", category: "Science" },
    { text: "Rats laugh when tickled. They make ultrasonic chirping sounds that scientists associate with joy.", category: "Animals" },
    { text: "The first oranges weren't orange — they were green.", category: "Nature" },
    { text: "There are more public libraries in the U.S. than McDonald's restaurants.", category: "Culture" },
    { text: "The human body produces about 25 million new cells each second.", category: "Biology" },
    { text: "A photon of light takes about 170,000 years to travel from the Sun's core to its surface.", category: "Science" },
    { text: "The total length of all blood vessels in the human body is about 60,000 miles.", category: "Biology" },
  ];

  function getDailyFact() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / 86400000);
    return FACTS[dayOfYear % FACTS.length];
  }

  function renderFact() {
    const fact = getDailyFact();
    document.getElementById('factText').textContent = fact.text;
    document.getElementById('factCategory').textContent = fact.category;

    const query = encodeURIComponent(fact.text);
    document.getElementById('factLearnMore').href = 'https://www.google.com/search?q=' + query;
  }

  renderFact();

  // ── Quick Links ──
  const LINKS_KEY = 'cozydesk-quicklinks';
  const DEFAULT_LINKS = [
    { name: 'Google Docs',   url: 'https://docs.google.com',   icon: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' },
    { name: 'Google Slides', url: 'https://slides.google.com', icon: 'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico' },
    { name: 'Google Sheets', url: 'https://sheets.google.com', icon: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico' },
    { name: 'Gmail',         url: 'https://mail.google.com',   icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
  ];

  const PRESET_LINKS = [
    { name: 'Google Docs',     url: 'https://docs.google.com',     icon: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' },
    { name: 'Google Slides',   url: 'https://slides.google.com',   icon: 'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico' },
    { name: 'Google Sheets',   url: 'https://sheets.google.com',   icon: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico' },
    { name: 'Gmail',           url: 'https://mail.google.com',     icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
    { name: 'Google Sites',    url: 'https://sites.google.com',    icon: 'https://ssl.gstatic.com/atari/images/favicon-2023q3.ico' },
    { name: 'Google Calendar', url: 'https://calendar.google.com', icon: 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico' },
    { name: 'Kahoot',          url: 'https://kahoot.com',          icon: 'https://www.google.com/s2/favicons?domain=kahoot.com&sz=32' },
    { name: 'Google Gemini',   url: 'https://gemini.google.com',   icon: 'https://www.gstatic.com/lamda/images/gemini_favicon_f069958c85030456e93de685481c559f160ea06b.png' },
    { name: 'Google Search',   url: 'https://google.com',          icon: 'https://www.google.com/favicon.ico' },
  ];

  function faviconUrl(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch { return ''; }
  }

  function loadLinks() {
    const stored = localStorage.getItem(LINKS_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_LINKS;
  }
  function saveLinks(links) {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links));
  }

  // Pointer-based drag-to-reorder
  let reorderState = null; // { fromIndex, el, placeholder, startY }
  let suppressNextClick = false;

  function renderLinks() {
    const list = document.getElementById('quickLinksList');
    const links = loadLinks();
    list.innerHTML = '';
    links.forEach((link, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      const iconSrc = link.icon || faviconUrl(link.url);
      li.innerHTML =
        `<a class="link-item" href="${link.url}" target="_blank">` +
          `<span class="link-drag-grip" title="Drag to reorder">⠿</span>` +
          `<img class="link-favicon" src="${iconSrc}" alt="" width="16" height="16" />` +
          `<span>${link.name}</span>` +
          `<button class="link-remove" data-index="${i}" title="Remove">&times;</button>` +
        `</a>`;

      // Start reorder from grip only
      li.querySelector('.link-drag-grip').addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = li.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const placeholder = document.createElement('li');
        placeholder.className = 'link-placeholder';
        placeholder.style.height = rect.height + 'px';

        list.insertBefore(placeholder, li);

        li.classList.add('link-dragging');
        li.style.position = 'absolute';
        li.style.width = rect.width + 'px';
        li.style.left = (rect.left - listRect.left) + 'px';
        li.style.top = (rect.top - listRect.top) + 'px';
        li.style.zIndex = '100';
        li.style.pointerEvents = 'none';

        reorderState = { fromIndex: i, el: li, placeholder, startY: e.clientY, origTop: rect.top - listRect.top, listEl: list };
        li.setPointerCapture(e.pointerId);
      });

      li.addEventListener('pointermove', (e) => {
        if (!reorderState || reorderState.el !== li) return;
        const dy = e.clientY - reorderState.startY;
        li.style.top = (reorderState.origTop + dy) + 'px';
        li.style.left = '0px';

        // Find which item we're over
        const items = [...list.querySelectorAll('li:not(.link-dragging)')];
        for (const item of items) {
          const r = item.getBoundingClientRect();
          const mid = r.top + r.height / 2;
          if (e.clientY < mid) {
            list.insertBefore(reorderState.placeholder, item);
            return;
          }
        }
        list.appendChild(reorderState.placeholder);
      });

      li.addEventListener('pointerup', () => {
        if (!reorderState || reorderState.el !== li) return;
        // Calculate new index from placeholder position
        const allItems = [...list.children];
        const toIndex = allItems.indexOf(reorderState.placeholder);

        // Clean up: put li back in the list
        li.classList.remove('link-dragging');
        li.style.cssText = '';
        list.insertBefore(li, reorderState.placeholder);
        reorderState.placeholder.remove();

        const fromIndex = reorderState.fromIndex;
        reorderState = null;
        suppressNextClick = true;
        setTimeout(() => { suppressNextClick = false; }, 50);

        if (fromIndex !== toIndex && toIndex >= 0) {
          const all = loadLinks();
          const [moved] = all.splice(fromIndex, 1);
          all.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, moved);
          saveLinks(all);
          renderLinks();
        }
      });

      // prevent remove button from navigating
      li.querySelector('.link-remove').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const all = loadLinks();
        all.splice(i, 1);
        saveLinks(all);
        renderLinks();
      });

      list.appendChild(li);
    });
  }

  // Modal
  const addLinkModal  = document.getElementById('addLinkModal');
  const addLinkClose  = document.getElementById('addLinkModalClose');
  const addLinkCancel = document.getElementById('addLinkCancel');
  const addLinkSave   = document.getElementById('addLinkSave');
  const linkNameInput = document.getElementById('linkNameInput');
  const linkUrlInput  = document.getElementById('linkUrlInput');
  function renderPresets() {
    const container = document.getElementById('presetLinks');
    const currentLinks = loadLinks();
    const currentUrls = new Set(currentLinks.map(l => l.url));
    container.innerHTML = '';

    const available = PRESET_LINKS.filter(p => !currentUrls.has(p.url));
    if (available.length === 0) {
      container.innerHTML = '<span class="preset-empty">All suggestions added!</span>';
      return;
    }
    available.forEach(preset => {
      const btn = document.createElement('button');
      btn.className = 'preset-chip';
      btn.innerHTML = `<img class="preset-chip-icon" src="${preset.icon}" alt="" width="14" height="14" /> ${preset.name}`;
      btn.addEventListener('click', () => {
        const links = loadLinks();
        links.push({ name: preset.name, url: preset.url, icon: preset.icon });
        saveLinks(links);
        renderLinks();
        renderPresets();
      });
      container.appendChild(btn);
    });
  }

  function openLinkModal() {
    linkNameInput.value = '';
    linkUrlInput.value  = '';
    renderPresets();
    addLinkModal.classList.add('open');
    linkNameInput.focus();
  }
  function closeLinkModal() {
    addLinkModal.classList.remove('open');
  }

  // Open modal when clicking on the widget body (not on a link, grip, or after a drag/reorder)
  const linksWidget = document.querySelector('.widget-links');
  linksWidget.addEventListener('click', (e) => {
    if (suppressNextClick || didDrag || didResize) return;
    if (e.target.closest('.link-item') || e.target.closest('.resize-handle')) return;
    openLinkModal();
  });
  addLinkClose.addEventListener('click', closeLinkModal);
  addLinkCancel.addEventListener('click', closeLinkModal);
  addLinkModal.addEventListener('click', (e) => {
    if (e.target === addLinkModal) closeLinkModal();
  });

  addLinkSave.addEventListener('click', () => {
    const name = linkNameInput.value.trim();
    let url    = linkUrlInput.value.trim();
    if (!name || !url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const links = loadLinks();
    links.push({ name, url });
    saveLinks(links);
    renderLinks();
    closeLinkModal();
  });

  // ── Noise Meter ──
  const noiseLevelEl    = document.getElementById('noiseLevel');
  const noiseLabelEl    = document.getElementById('noiseLabel');
  const noiseToggleBtn  = document.getElementById('noiseToggle');
  const noiseFsBtn      = document.getElementById('noiseFullscreen');
  const noiseFsOverlay  = document.getElementById('noiseFullscreenOverlay');
  const noiseHorseEl    = document.getElementById('noiseHorse');
  const noiseFsHorseEl  = document.getElementById('noiseFsHorse');

  // Horse states mapped to noise thresholds (0-100)
  const horseStates = [
    { max: 7,   src: 'assets/horsesleep.png' },
    { max: 14,  src: 'assets/horselightsleep.png' },
    { max: 21,  src: 'assets/horsewakingup.png' },
    { max: 28,  src: 'assets/horsedisturbed.png' },
    { max: 35,  src: 'assets/horsegettingup.png' },
    { max: 42,  src: 'assets/horsestandinggroggy.png' },
    { max: 49,  src: 'assets/horsestandingannoyed.png' },
    { max: 57,  src: 'assets/horsestomping.png' },
    { max: 100, src: 'assets/horsefedup.png' },
  ];
  // Preload horse images
  horseStates.forEach(s => { const img = new Image(); img.src = s.src; });
  let currentHorseIndex = 0;
  const HYSTERESIS = 5; // must drop this many points below threshold to go back down

  function updateHorseState(vol) {
    let targetIndex = horseStates.findIndex(s => vol <= s.max);
    if (targetIndex === -1) targetIndex = horseStates.length - 1;

    if (targetIndex > currentHorseIndex) {
      // Going up — switch immediately
      currentHorseIndex = targetIndex;
    } else if (targetIndex < currentHorseIndex) {
      // Going down — only drop if vol is below current threshold minus hysteresis
      const currentThreshold = currentHorseIndex > 0 ? horseStates[currentHorseIndex - 1].max : 0;
      if (vol <= currentThreshold - HYSTERESIS) {
        currentHorseIndex = targetIndex;
      }
    }

    const src = horseStates[currentHorseIndex].src;
    if (noiseHorseEl.src !== src && !noiseHorseEl.src.endsWith(src)) {
      noiseHorseEl.src = src;
      noiseFsHorseEl.src = src;
    }
  }
  const noiseFsLevelEl  = document.getElementById('noiseFsLevel');
  const noiseFsLabelEl  = document.getElementById('noiseFsLabel');
  const noiseFsToggle   = document.getElementById('noiseFsToggle');
  const noiseFsExit     = document.getElementById('noiseFsExit');

  let noiseAudioCtx = null;
  let noiseAnalyser = null;
  let noiseStream   = null;
  let noiseRaf      = null;
  let noiseListening = false;
  let smoothedVol = 0;

  function getLevelClass(vol) {
    if (vol < 30) return 'level-quiet';
    if (vol < 65) return 'level-moderate';
    return 'level-loud';
  }
  function getLevelLabel(vol) {
    if (vol < 30) return 'Quiet';
    if (vol < 65) return 'Moderate';
    return 'Loud';
  }

  function noiseLoop() {
    if (!noiseListening) return;
    const bufferLength = noiseAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    noiseAnalyser.getByteFrequencyData(dataArray);

    // Calculate volume (RMS-ish from frequency data)
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    const rawVol = (sum / bufferLength) * (100 / 255);

    // Smooth: rise faster, fall slower
    const rise = 0.1, fall = 0.03;
    const alpha = rawVol > smoothedVol ? rise : fall;
    smoothedVol += (rawVol - smoothedVol) * alpha;
    const vol = Math.round(smoothedVol);

    // Update level displays
    const levelClass = getLevelClass(vol);
    const label = getLevelLabel(vol);

    noiseLevelEl.textContent = vol;
    noiseLevelEl.className = 'noise-level ' + levelClass;
    noiseLabelEl.textContent = label;

    noiseFsLevelEl.textContent = vol;
    noiseFsLevelEl.className = 'noise-fs-level ' + levelClass;
    noiseFsLabelEl.textContent = label;

    // Update horse character
    updateHorseState(vol);

    noiseRaf = requestAnimationFrame(noiseLoop);
  }

  async function startNoise() {
    try {
      noiseStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      noiseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = noiseAudioCtx.createMediaStreamSource(noiseStream);
      noiseAnalyser = noiseAudioCtx.createAnalyser();
      noiseAnalyser.fftSize = 256;
      noiseAnalyser.smoothingTimeConstant = 0.8;
      source.connect(noiseAnalyser);

      noiseListening = true;
      noiseToggleBtn.classList.add('listening');
      noiseFsToggle.classList.add('listening');
      noiseLoop();
    } catch (err) {
      noiseLabelEl.textContent = 'Mic denied';
      noiseFsLabelEl.textContent = 'Mic denied';
    }
  }

  function stopNoise() {
    noiseListening = false;
    if (noiseRaf) cancelAnimationFrame(noiseRaf);
    if (noiseStream) {
      noiseStream.getTracks().forEach(t => t.stop());
      noiseStream = null;
    }
    if (noiseAudioCtx) {
      noiseAudioCtx.close();
      noiseAudioCtx = null;
    }
    noiseToggleBtn.classList.remove('listening');
    noiseFsToggle.classList.remove('listening');
    noiseLevelEl.textContent = '--';
    noiseLevelEl.className = 'noise-level';
    noiseLabelEl.textContent = 'Click to start';
    noiseFsLevelEl.textContent = '--';
    noiseFsLevelEl.className = 'noise-fs-level';
    noiseFsLabelEl.textContent = 'Click to start';
    smoothedVol = 0;
    currentHorseIndex = 0;
    noiseHorseEl.src = horseStates[0].src;
    noiseFsHorseEl.src = horseStates[0].src;
  }

  function toggleNoise() {
    if (noiseListening) stopNoise();
    else startNoise();
  }

  noiseToggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleNoise(); });
  noiseFsToggle.addEventListener('click', toggleNoise);
  noiseFsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    noiseFsOverlay.classList.add('open');
  });
  noiseFsExit.addEventListener('click', () => {
    noiseFsOverlay.classList.remove('open');
  });

  // Escape closes noise fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && noiseFsOverlay.classList.contains('open')) {
      noiseFsOverlay.classList.remove('open');
    }
  });


  // ── Name Picker ──
  const NAMEPICKER_KEY = 'cozydesk-namepicker';

  function loadNamePickerData() {
    try {
      return JSON.parse(localStorage.getItem(NAMEPICKER_KEY)) || [];
    } catch { return []; }
  }

  function saveNamePickerData(data) {
    localStorage.setItem(NAMEPICKER_KEY, JSON.stringify(data));
  }

  const npGroupSelect = document.getElementById('namePickerGroup');
  const npReel        = document.getElementById('namePickerReel');
  const npSpinBtn     = document.getElementById('namePickerSpin');
  const npManageBtn   = document.getElementById('namePickerManage');
  const npModal       = document.getElementById('namePickerModal');
  const npModalClose  = document.getElementById('namePickerModalClose');
  const npNewGroupIn  = document.getElementById('namePickerNewGroup');
  const npAddGroupBtn = document.getElementById('namePickerAddGroup');
  const npGroupsList  = document.getElementById('namePickerGroupsList');
  const npSlotMask    = document.querySelector('.namepicker-slot-mask');

  let npSpinning = false;

  function renderNamePickerSelect() {
    const data = loadNamePickerData();
    const prev = npGroupSelect.value;
    npGroupSelect.innerHTML = '<option value="" disabled>Select a group</option>';
    data.forEach((g, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = g.name + ' (' + g.names.length + ')';
      npGroupSelect.appendChild(opt);
    });
    if (prev && npGroupSelect.querySelector(`option[value="${prev}"]`)) {
      npGroupSelect.value = prev;
    }
    updateSpinButton();
  }

  function updateSpinButton() {
    const data = loadNamePickerData();
    const idx = parseInt(npGroupSelect.value, 10);
    const group = data[idx];
    npSpinBtn.disabled = !group || group.names.length < 2 || npSpinning;
  }

  function buildReelItems(names) {
    npReel.innerHTML = '';
    if (!names || names.length === 0) {
      const div = document.createElement('div');
      div.className = 'namepicker-slot-item namepicker-slot-placeholder';
      div.textContent = '--';
      npReel.appendChild(div);
      return;
    }
    names.forEach(name => {
      const div = document.createElement('div');
      div.className = 'namepicker-slot-item';
      div.textContent = name;
      npReel.appendChild(div);
    });
  }

  npGroupSelect.addEventListener('change', () => {
    const data = loadNamePickerData();
    const group = data[parseInt(npGroupSelect.value, 10)];
    if (group) {
      buildReelItems(group.names);
      npSlotMask.classList.remove('winner');
    }
    updateSpinButton();
  });

  function spinNamePicker() {
    if (npSpinning) return;
    const data = loadNamePickerData();
    const idx = parseInt(npGroupSelect.value, 10);
    const group = data[idx];
    if (!group || group.names.length < 2) return;

    npSpinning = true;
    npSpinBtn.disabled = true;
    npSpinBtn.classList.add('spinning');
    npSlotMask.classList.remove('winner');

    const names = group.names;
    const itemH = 52;
    const winnerIndex = Math.floor(Math.random() * names.length);

    // Build a long reel: repeat names many times then end on winner
    const totalSpins = 4; // full cycles before landing
    const reelNames = [];
    for (let s = 0; s < totalSpins; s++) {
      for (let i = 0; i < names.length; i++) {
        reelNames.push(names[i]);
      }
    }
    // Add names up to and including winner
    for (let i = 0; i <= winnerIndex; i++) {
      reelNames.push(names[i]);
    }

    buildReelItems(reelNames);

    // Target position: the final winner item should be centered
    const finalIndex = reelNames.length - 1;
    const targetY = -(finalIndex * itemH);

    // Start from top
    npReel.style.transition = 'none';
    npReel.style.transform = 'translateY(0)';

    // Force reflow
    npReel.offsetHeight;

    // Animate with easing
    const totalItems = reelNames.length;
    const duration = 2500 + (totalItems * 8);

    npReel.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.85, 0.35, 1)`;
    npReel.style.transform = `translateY(${targetY}px)`;

    setTimeout(() => {
      npSpinning = false;
      npSpinBtn.classList.remove('spinning');
      npSlotMask.classList.add('winner');
      updateSpinButton();

      // Replace reel with just the winner for clean state
      buildReelItems([names[winnerIndex]]);
      npReel.style.transition = 'none';
      npReel.style.transform = 'translateY(0)';
    }, duration + 100);
  }

  npSpinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    spinNamePicker();
  });

  // Manage modal
  npManageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderNamePickerGroups();
    npModal.classList.add('open');
  });

  npModalClose.addEventListener('click', () => npModal.classList.remove('open'));
  npModal.addEventListener('click', (e) => {
    if (e.target === npModal) npModal.classList.remove('open');
  });

  npAddGroupBtn.addEventListener('click', () => {
    const name = npNewGroupIn.value.trim();
    if (!name) return;
    const data = loadNamePickerData();
    data.push({ name, names: [] });
    saveNamePickerData(data);
    npNewGroupIn.value = '';
    renderNamePickerGroups();
    renderNamePickerSelect();
  });

  npNewGroupIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') npAddGroupBtn.click();
  });

  function renderNamePickerGroups() {
    const data = loadNamePickerData();
    npGroupsList.innerHTML = '';

    if (data.length === 0) {
      npGroupsList.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-style:italic;font-size:0.85rem;padding:16px 0;">No groups yet. Add one above!</p>';
      return;
    }

    data.forEach((group, gi) => {
      const card = document.createElement('div');
      card.className = 'namepicker-group-card';

      // Header
      const header = document.createElement('div');
      header.className = 'namepicker-group-header';
      header.innerHTML = `
        <span>
          <span class="namepicker-group-name">${group.name}</span>
          <span class="namepicker-group-count">${group.names.length} names</span>
        </span>
        <button class="namepicker-group-delete" title="Delete group">&times;</button>
      `;
      header.querySelector('.namepicker-group-delete').addEventListener('click', () => {
        data.splice(gi, 1);
        saveNamePickerData(data);
        renderNamePickerGroups();
        renderNamePickerSelect();
      });
      card.appendChild(header);

      // Names list
      const namesList = document.createElement('div');
      namesList.className = 'namepicker-names-list';
      group.names.forEach((name, ni) => {
        const row = document.createElement('div');
        row.className = 'namepicker-name-row';
        row.innerHTML = `
          <span class="namepicker-name-text">${name}</span>
          <button class="namepicker-name-remove" title="Remove">&times;</button>
        `;
        row.querySelector('.namepicker-name-remove').addEventListener('click', () => {
          group.names.splice(ni, 1);
          saveNamePickerData(data);
          renderNamePickerGroups();
          renderNamePickerSelect();
        });
        namesList.appendChild(row);
      });
      card.appendChild(namesList);

      // Add name input
      const addRow = document.createElement('div');
      addRow.className = 'namepicker-add-name';
      addRow.innerHTML = `
        <input type="text" placeholder="Add a name…" />
        <button>Add</button>
      `;
      const addInput = addRow.querySelector('input');
      const addBtn = addRow.querySelector('button');
      const doAdd = () => {
        const val = addInput.value.trim();
        if (!val) return;
        group.names.push(val);
        saveNamePickerData(data);
        addInput.value = '';
        renderNamePickerGroups();
        renderNamePickerSelect();
      };
      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doAdd();
      });
      card.appendChild(addRow);

      npGroupsList.appendChild(card);
    });
  }

  // Stop propagation on the widget interactive elements to prevent drag
  document.querySelector('.widget-namepicker').addEventListener('mousedown', (e) => {
    if (e.target.closest('select, button, input')) {
      e.stopPropagation();
    }
  });

  // Init name picker
  renderNamePickerSelect();

  // ── Ambience widget ──
  const AMBIENCE_KEY = 'cozydesk-ambience';

  const AMBIENCE_SCENES = {
    workshop: [
      { name: 'Shop Bell',          url: 'https://cdn.freesound.org/previews/72/72197_804056-hq.mp3', pauseAfter: 9 },
      { name: 'Hammering',         url: 'https://cdn.freesound.org/previews/164/164208_2915582-hq.mp3', pauseAfter: 5 },
      { name: 'Sawing Timber',     url: 'https://cdn.freesound.org/previews/164/164275_2915582-hq.mp3', pauseAfter: 7 },
      { name: 'Grandfather Clock', url: 'https://cdn.freesound.org/previews/32/32937_29541-hq.mp3' },
      { name: 'Running Gears',     url: 'https://cdn.freesound.org/previews/315/315753_3200265-hq.mp3' },
    ],
    cafe: [
      { name: 'Cafe Chatter',     url: 'https://cdn.freesound.org/previews/387/387030_4507058-hq.mp3' },
      { name: 'Espresso Machine', url: 'https://cdn.freesound.org/previews/67/67433_649468-hq.mp3' },
      { name: 'Lounge Piano',     url: 'https://cdn.freesound.org/previews/761/761167_6393958-hq.mp3' },
      { name: 'Dishes Clinking',  url: 'https://cdn.freesound.org/previews/426/426875_8244073-hq.mp3' },
      { name: 'Rain Outside',     url: 'https://cdn.freesound.org/previews/398/398741_5923045-hq.mp3' },
    ],
    nature: [
      { name: 'Forest Birds',     url: 'https://cdn.freesound.org/previews/427/427517_3662372-hq.mp3' },
      { name: 'Flowing Stream',   url: 'https://cdn.freesound.org/previews/165/165877_3026251-hq.mp3' },
      { name: 'Wind in Trees',    url: 'https://cdn.freesound.org/previews/81/81188_649468-hq.mp3' },
      { name: 'Crickets',         url: 'https://cdn.freesound.org/previews/53/53380_407362-hq.mp3' },
      { name: 'Forest Rain',      url: 'https://cdn.freesound.org/previews/34/34073_28216-hq.mp3' },
    ],
  };

  const ambChannelsEl    = document.getElementById('ambienceChannels');
  const ambScenesEl      = document.getElementById('ambienceScenes');
  const ambMasterToggle  = document.getElementById('ambienceMasterToggle');
  const ambMasterVol     = document.getElementById('ambienceMasterVol');

  // State: { scene, masterVol, volumes: { library: [50,50,...], cafe: [...], nature: [...] }, playing: { library: [false,...], ... } }
  let ambState = loadAmbienceState();
  let ambAudios = [];          // current scene's Audio elements
  let ambMasterPlaying = false;

  function loadAmbienceState() {
    const sceneKeys = Object.keys(AMBIENCE_SCENES);
    // Build fresh defaults
    const defVolumes = {};
    const defPlaying = {};
    for (const s of sceneKeys) {
      defVolumes[s] = AMBIENCE_SCENES[s].map(() => 50);
      defPlaying[s] = AMBIENCE_SCENES[s].map(() => false);
    }
    const defaults = { scene: 'workshop', masterVol: 70, volumes: defVolumes, playing: defPlaying };

    try {
      const saved = JSON.parse(localStorage.getItem(AMBIENCE_KEY));
      if (!saved || !saved.scene || !saved.volumes) return defaults;
      // Validate saved scene still exists
      if (!AMBIENCE_SCENES[saved.scene]) saved.scene = sceneKeys[0];
      // Rebuild volumes/playing for current scenes, keeping saved values where possible
      for (const s of sceneKeys) {
        const count = AMBIENCE_SCENES[s].length;
        if (!Array.isArray(saved.volumes[s]) || saved.volumes[s].length !== count) {
          saved.volumes[s] = defVolumes[s];
        }
        if (!saved.playing) saved.playing = {};
        if (!Array.isArray(saved.playing[s]) || saved.playing[s].length !== count) {
          saved.playing[s] = defPlaying[s];
        }
      }
      // Remove any old scene keys that no longer exist
      for (const k of Object.keys(saved.volumes)) {
        if (!AMBIENCE_SCENES[k]) delete saved.volumes[k];
      }
      if (saved.playing) {
        for (const k of Object.keys(saved.playing)) {
          if (!AMBIENCE_SCENES[k]) delete saved.playing[k];
        }
      }
      return saved;
    } catch {}
    return defaults;
  }

  function saveAmbienceState() {
    localStorage.setItem(AMBIENCE_KEY, JSON.stringify(ambState));
  }

  function renderAmbienceScene() {
    // Stop all current audio and clear delayed replay timers
    ambAudios.forEach(a => { clearTimeout(a._replayTimer); a._waitingToReplay = false; a.pause(); a.src = ''; });
    ambAudios = [];

    const scene = ambState.scene;
    const sounds = AMBIENCE_SCENES[scene];
    ambChannelsEl.innerHTML = '';

    sounds.forEach((sound, i) => {
      const vol = ambState.volumes[scene][i];
      const isPlaying = ambState.playing[scene][i];

      // Create audio element
      const audio = new Audio(sound.url);
      audio.volume = (vol / 100) * (ambState.masterVol / 100);
      audio.preload = 'none';
      audio._pauseAfter = sound.pauseAfter || 0;
      audio._replayTimer = null;

      if (audio._pauseAfter > 0) {
        // Delayed loop: wait N seconds after ending before replaying
        audio.loop = false;
        audio._waitingToReplay = false;

        const scheduleReplay = () => {
          if (audio._waitingToReplay) return;
          audio._waitingToReplay = true;
          audio._replayTimer = setTimeout(() => {
            audio._waitingToReplay = false;
            audio.currentTime = 0;
            audio.play().catch(() => {});
          }, audio._pauseAfter * 1000);
        };

        audio.addEventListener('ended', scheduleReplay);
        // Fallback: also detect near-end via timeupdate in case 'ended' doesn't fire
        audio.addEventListener('timeupdate', () => {
          if (audio.duration && audio.currentTime >= audio.duration - 0.1 && !audio._waitingToReplay) {
            audio.pause();
            scheduleReplay();
          }
        });
      } else {
        audio.loop = true;
      }
      ambAudios.push(audio);

      // Build channel row
      const row = document.createElement('div');
      row.className = 'ambience-channel';

      const label = document.createElement('span');
      label.className = 'ambience-label';
      label.textContent = sound.name;
      label.title = sound.name;

      const toggle = document.createElement('button');
      toggle.className = 'ambience-ch-toggle' + (isPlaying ? ' playing' : '');
      toggle.title = isPlaying ? 'Pause' : 'Play';
      toggle.innerHTML = `
        <svg class="icon-play" width="10" height="10" viewBox="0 0 18 18"><polygon points="6,3 15,9 6,15" fill="currentColor"/></svg>
        <svg class="icon-pause" width="10" height="10" viewBox="0 0 18 18"><rect x="4" y="3" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="10.5" y="3" width="3.5" height="12" rx="1" fill="currentColor"/></svg>
      `;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'ambience-slider';
      slider.min = 0;
      slider.max = 100;
      slider.value = vol;

      // Events
      toggle.addEventListener('click', () => {
        const nowPlaying = !ambState.playing[scene][i];
        ambState.playing[scene][i] = nowPlaying;
        toggle.classList.toggle('playing', nowPlaying);
        toggle.title = nowPlaying ? 'Pause' : 'Play';
        if (nowPlaying) {
          audio._waitingToReplay = false;
          audio.currentTime = 0;
          audio.play().catch(() => {});
        } else {
          clearTimeout(audio._replayTimer);
          audio._waitingToReplay = false;
          audio.pause();
        }
        updateMasterToggleState();
        saveAmbienceState();
      });

      slider.addEventListener('input', () => {
        ambState.volumes[scene][i] = Number(slider.value);
        audio.volume = (slider.value / 100) * (ambState.masterVol / 100);
        saveAmbienceState();
      });

      row.appendChild(label);
      row.appendChild(toggle);
      row.appendChild(slider);
      ambChannelsEl.appendChild(row);

      // Resume playing if it was active (not when widget is hidden)
      const ambWidgetEl = document.querySelector('.widget-ambience');
      const ambienceHidden = ambWidgetEl && ambWidgetEl.classList.contains('widget-hidden');
      if (isPlaying && !ambienceHidden) {
        audio.play().catch(() => {});
      }
    });

    // Update scene tabs
    ambScenesEl.querySelectorAll('.ambience-scene').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scene === scene);
    });

    // Update master volume slider
    ambMasterVol.value = ambState.masterVol;
    updateMasterToggleState();
  }

  function updateMasterToggleState() {
    const scene = ambState.scene;
    ambMasterPlaying = ambState.playing[scene].some(p => p);
    ambMasterToggle.classList.toggle('playing', ambMasterPlaying);
    ambMasterToggle.title = ambMasterPlaying ? 'Pause all' : 'Play all';
  }

  function updateAllVolumes() {
    const scene = ambState.scene;
    ambAudios.forEach((audio, i) => {
      audio.volume = (ambState.volumes[scene][i] / 100) * (ambState.masterVol / 100);
    });
  }

  function applyWidgetVisibility(vis) {
    WIDGET_CATALOG.forEach(({ id }) => {
      const el = document.querySelector(`[data-widget-id="${id}"]`);
      if (!el) return;
      const on = vis[id] !== false;
      el.classList.toggle('widget-hidden', !on);
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
    });

    if (vis.ambience === false) {
      Object.keys(ambState.playing).forEach(scene => {
        ambState.playing[scene] = ambState.playing[scene].map(() => false);
      });
      saveAmbienceState();
      ambAudios.forEach(a => { clearTimeout(a._replayTimer); a._waitingToReplay = false; a.pause(); });
      ambChannelsEl.querySelectorAll('.ambience-ch-toggle').forEach(btn => {
        btn.classList.remove('playing');
        btn.title = 'Play';
      });
      updateMasterToggleState();
    }
    if (vis.noise === false) {
      if (typeof noiseListening !== 'undefined' && noiseListening) stopNoise();
      noiseFsOverlay.classList.remove('open');
    }
  }

  // Scene tab clicks
  ambScenesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.ambience-scene');
    if (!btn || btn.classList.contains('active')) return;
    ambState.scene = btn.dataset.scene;
    saveAmbienceState();
    renderAmbienceScene();
  });

  // Master play/pause
  ambMasterToggle.addEventListener('click', () => {
    const scene = ambState.scene;
    if (ambMasterPlaying) {
      // Pause all
      ambState.playing[scene] = ambState.playing[scene].map(() => false);
      ambAudios.forEach(a => { clearTimeout(a._replayTimer); a._waitingToReplay = false; a.pause(); });
    } else {
      // Play all
      ambState.playing[scene] = ambState.playing[scene].map(() => true);
      ambAudios.forEach(a => { a._waitingToReplay = false; a.currentTime = 0; a.play().catch(() => {}); });
    }
    saveAmbienceState();
    // Update individual toggle buttons
    ambChannelsEl.querySelectorAll('.ambience-ch-toggle').forEach((btn, i) => {
      btn.classList.toggle('playing', ambState.playing[scene][i]);
      btn.title = ambState.playing[scene][i] ? 'Pause' : 'Play';
    });
    updateMasterToggleState();
  });

  // Master volume slider
  ambMasterVol.addEventListener('input', () => {
    ambState.masterVol = Number(ambMasterVol.value);
    updateAllVolumes();
    saveAmbienceState();
  });

  // Stop propagation on interactive elements to prevent widget drag
  document.querySelector('.widget-ambience').addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input')) {
      e.stopPropagation();
    }
  });

  // Init ambience (apply saved widget visibility first so ambience doesn’t autoplay when hidden)
  applyWidgetVisibility(getWidgetVisibility());
  renderAmbienceScene();

  // ── Responsive compact mode via ResizeObserver ──
  const COMPACT_W = 200;
  const COMPACT_H = 160;
  const widgetResizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const el = entry.target;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      el.classList.toggle('compact', w < COMPACT_W || h < COMPACT_H);
      el.classList.toggle('compact-w', w < COMPACT_W);
      el.classList.toggle('compact-h', h < COMPACT_H);
    }
  });
  document.querySelectorAll('.widget').forEach(w => widgetResizeObserver.observe(w));

  // ── Header Date & Time ──
  const headerDatetime = document.getElementById('headerDatetime');
  function updateHeaderDatetime() {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    headerDatetime.innerHTML =
      `<div class="header-time">${time}</div>` +
      `<div class="header-date">${date}</div>`;
  }
  updateHeaderDatetime();
  setInterval(updateHeaderDatetime, 1000);

  // ── Google Search ──
  document.getElementById('googleSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      if (query) {
        window.open('https://www.google.com/search?q=' + encodeURIComponent(query), '_blank');
        e.target.value = '';
      }
    }
  });

  // ── Edit Widgets modal ──
  const editWidgetsBtn = document.getElementById('editWidgetsBtn');
  const editWidgetsModal = document.getElementById('editWidgetsModal');
  const editWidgetsModalClose = document.getElementById('editWidgetsModalClose');
  const widgetVisibilityList = document.getElementById('widgetVisibilityList');

  function renderEditWidgetsModal() {
    widgetVisibilityList.innerHTML = '';
    const vis = getWidgetVisibility();
    WIDGET_CATALOG.forEach(({ id, label }) => {
      const row = document.createElement('label');
      row.className = 'ts-row';
      const span = document.createElement('span');
      span.className = 'ts-label';
      span.textContent = label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ts-toggle';
      const on = vis[id] !== false;
      btn.dataset.on = on ? 'true' : 'false';
      btn.setAttribute('role', 'switch');
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.dataset.widgetId = id;
      btn.innerHTML = '<span class="ts-toggle-knob"></span>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const next = toggleSwitch(btn);
        const v = getWidgetVisibility();
        v[id] = next;
        saveWidgetVisibility(v);
        applyWidgetVisibility(v);
      });
      row.appendChild(span);
      row.appendChild(btn);
      widgetVisibilityList.appendChild(row);
    });
  }

  function openEditWidgetsModal() {
    renderEditWidgetsModal();
    editWidgetsModal.classList.add('open');
  }

  function closeEditWidgetsModal() {
    editWidgetsModal.classList.remove('open');
  }

  editWidgetsBtn.addEventListener('click', openEditWidgetsModal);
  editWidgetsModalClose.addEventListener('click', closeEditWidgetsModal);
  editWidgetsModal.addEventListener('click', (e) => {
    if (e.target === editWidgetsModal) closeEditWidgetsModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editWidgetsModal.classList.contains('open')) {
      closeEditWidgetsModal();
    }
  });

  // ── Init ──
  injectResizeHandles();
  renderLinks();
  initNotes();
  loadPositions();
  renderWidgetPreview();

})();
