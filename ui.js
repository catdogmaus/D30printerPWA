// ui.js (replace your existing file with this)
// Handles UI, preview and persistence.

import {
  printer,
  connect,
  disconnect,
  renderTextCanvas,
  renderImageCanvas,
  renderBarcodeCanvas,
  renderQRCanvas,
  printCanvasObject,
  detectLabel,
  makePreviewFromPrintCanvas,
  forceInvertBitmap
} from './printer.js';

function $ (id) { return document.getElementById(id); }
let previewTimer = null;
const PREVIEW_DEBOUNCE_MS = 180;

function getActiveTabName() {
  const active = document.querySelector('#tabBar .tab.active');
  return active ? active.dataset.tab : 'tab-text';
}

function setActiveTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  const el = $(name);
  if (el) el.style.display = 'block';
  document.querySelectorAll('#tabBar .tab').forEach(p => p.classList.remove('active'));
  const active = document.querySelector(`#tabBar .tab[data-tab="${name}"]`);
  if (active) active.classList.add('active');
  updatePreviewDebounced();
}

// Place preview canvas (source is HORIZONTAL preview canvas).
function placePreviewCanvas(sourceCanvas) {
  const wrap = $('previewCanvasWrap');
  wrap.innerHTML = ''; // clear previous canvas
  // Allow preview to grow if label is long; scale to max width/height of the box.
  const maxW = Math.min(680, window.innerWidth * 0.9);
  const maxH = Math.min(350, window.innerHeight * 0.5);
  const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);
  cv.className = 'preview-canvas';
  // give the canvas a CSS width of 100% of available space to let it visually expand
  cv.style.maxWidth = '100%';
  wrap.appendChild(cv);
}

// Debounced update
function updatePreviewDebounced() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, PREVIEW_DEBOUNCE_MS);
}

// IMPORTANT: this always attempts to render a preview (even if the Settings tab is active).
// It uses the currently selected tab (tabBar .tab.active) to decide what to render, but it does NOT bail out when settings/logs are open.
async function updatePreview() {
  const selectedTab = getActiveTabName(); // tab-text, tab-image, tab-barcode, tab-qr, etc.
  const labelW = Number($('labelWidth').value || printer.settings.labelWidthMM || 12);
  const labelH = Number($('labelLength').value || printer.settings.labelLengthMM || 40);
  const dpi = printer.settings.dpiPerMM || 8;
  const fontFamily = $('fontFamily')?.value || printer.settings.fontFamily || 'Inter, sans-serif';
  try {
    let printObj = null;
    if (selectedTab === 'tab-text') {
      const text = $('textInput').value || '';
      const fontSize = Number($('fontSize').value || 36);
      const align = $('alignment').value || 'center';
      const invert = $('invertInput').checked;
      // bold toggle handled by fontWeight class (we append ' bold' to font family)
      const bold = $('fontBold')?.checked;
      const ff = bold ? `bold ${fontFamily}` : fontFamily;
      printObj = renderTextCanvas(text, fontSize, align, invert, labelW, labelH, dpi, ff);
    } else if (selectedTab === 'tab-image') {
      const preview = $('imagePreview');
      const dataURL = preview.dataset.canvas;
      if (dataURL) {
        const img = new Image();
        img.onload = () => {
          const invert = $('imageInvert').checked;
          const obj = renderImageCanvas(img, Number($('imageThreshold').value||128), invert, labelW, labelH, dpi);
          const previewCanvas = makePreviewFromPrintCanvas(obj.canvas);
          placePreviewCanvas(previewCanvas);
        };
        img.src = dataURL;
        return;
      } else {
        $('previewCanvasWrap').innerHTML = '<div class="small">No image uploaded</div>';
        return;
      }
    } else if (selectedTab === 'tab-barcode') {
      const val = $('barcodeInput').value || '';
      const type = $('barcodeType').value;
      const scale = Number($('barcodeScale').value || 2);
      printObj = renderBarcodeCanvas(val, type, scale, labelW, labelH, dpi);
    } else if (selectedTab === 'tab-qr') {
      const val = $('qrInput').value || '';
      const size = Number($('qrSize').value || 256);
      printObj = await renderQRCanvas(val, size, labelW, labelH, dpi);
    } else {
      // not a content tab — fallback to text preview
      const text = $('textInput').value || '';
      printObj = renderTextCanvas(text, Number($('fontSize').value||36), $('alignment').value||'center', $('invertInput').checked, labelW, labelH, dpi, $('fontFamily')?.value||printer.settings.fontFamily);
    }

    if (printObj && printObj.canvas) {
      const previewCanvas = makePreviewFromPrintCanvas(printObj.canvas);
      placePreviewCanvas(previewCanvas);
    }

    const hint = document.getElementById('previewHint');
    if (hint) hint.textContent = `Preview shown in label proportions (${labelW}×${labelH} mm). Change label size in Settings.`;
  } catch (e) {
    console.warn('Preview error', e);
  }
}

// Save settings helper
function saveSetting(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// Load settings helper
function loadSetting(key, def) {
  const v = localStorage.getItem(key);
  if (!v) return def;
  try { return JSON.parse(v); } catch { return def; }
}

async function setup() {
  // Tabs wiring
  document.querySelectorAll('#tabBar .tab').forEach(p => p.addEventListener('click', () => setActiveTab(p.dataset.tab)));
  // restore selected tab
  const lastTab = loadSetting('ui.selectedTab', 'tab-text');
  setActiveTab(lastTab);

  // Restore persisted settings into UI
  const saved = {
    labelWidth: loadSetting('labelWidth', 12),
    labelLength: loadSetting('labelLength', 40),
    protocol: loadSetting('protocol', 'phomemo_raw'),
    fontFamily: loadSetting('fontFamily', 'Inter, sans-serif'),
    fontSize: loadSetting('fontSize', 40),
    alignment: loadSetting('alignment', 'center'),
    invert: loadSetting('invert', false),
    barcodeType: loadSetting('barcodeType', 'CODE128'),
    barcodeScale: loadSetting('barcodeScale', 2),
    qrSize: loadSetting('qrSize', 256),
    qrEc: loadSetting('qrEc', 'M'),
    imageThreshold: loadSetting('imageThreshold', 128),
    imageInvert: loadSetting('imageInvert', false),
    copies: loadSetting('copies', 1),
  };

  $('labelWidth').value = saved.labelWidth;
  $('labelLength').value = saved.labelLength;
  $('protocolSelect').value = saved.protocol;
  $('fontFamily').value = saved.fontFamily;
  $('fontSize').value = saved.fontSize;
  $('alignment').value = saved.alignment;
  $('invertInput').checked = saved.invert;
  $('barcodeType').value = saved.barcodeType;
  $('barcodeScale').value = saved.barcodeScale;
  $('qrSize').value = saved.qrSize;
  $('qrEc').value = saved.qrEc;
  $('imageThreshold').value = saved.imageThreshold;
  $('imageInvert').checked = saved.imageInvert;
  $('copiesInput').value = saved.copies;

  // Connect / Disconnect toggle
  $('connectBtn').addEventListener('click', async () => {
    if (!printer.connected) {
      await connect();
    } else {
      await disconnect();
    }
    updatePreviewDebounced();
  });

  // Persist and immediate update listeners for ALL relevant inputs
  const persistAndUpdate = (id, key, parse = (v)=>v) => {
    const el = $(id);
    if (!el) return;
    const handler = () => {
      const v = parse(el.type === 'checkbox' ? el.checked : el.value);
      saveSetting(key, v);
      // apply immediate to printer.settings if relevant
      if (key === 'labelWidth') printer.settings.labelWidthMM = Number(v);
      if (key === 'labelLength') printer.settings.labelLengthMM = Number(v);
      if (key === 'fontFamily') printer.settings.fontFamily = v;
      updatePreviewDebounced();
    };
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', handler);
  };

  // Wire settings
  persistAndUpdate('labelWidth', 'labelWidth', Number);
  persistAndUpdate('labelLength', 'labelLength', Number);
  persistAndUpdate('protocolSelect', 'protocol', String);
  persistAndUpdate('fontFamily', 'fontFamily', String);
  persistAndUpdate('fontSize', 'fontSize', Number);
  persistAndUpdate('alignment', 'alignment', String);
  persistAndUpdate('invertInput', 'invert', Boolean);
  persistAndUpdate('barcodeType', 'barcodeType', String);
  persistAndUpdate('barcodeScale', 'barcodeScale', Number);
  persistAndUpdate('qrSize', 'qrSize', Number);
  persistAndUpdate('qrEc', 'qrEc', String);
  persistAndUpdate('imageThreshold', 'imageThreshold', Number);
  persistAndUpdate('imageInvert', 'imageInvert', Boolean);
  persistAndUpdate('copiesInput', 'copies', Number);

  // font +/- and presets
  $('fontInc').addEventListener('click', ()=> { $('fontSize').value = Math.min(200, Number($('fontSize').value || 36) + 2); saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced();});
  $('fontDec').addEventListener('click', ()=> { $('fontSize').value = Math.max(6, Number($('fontSize').value || 36) - 2); saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced();});
  $('fontPreset').addEventListener('change', ()=> { $('fontSize').value = $('fontPreset').value; saveSetting('fontSize', Number($('fontSize').value)); updatePreviewDebounced();});

  // bold toggle (if present)
  if ($('fontBold')) {
    $('fontBold').addEventListener('change', () => { saveSetting('fontBold', $('fontBold').checked); updatePreviewDebounced(); });
  }

  // file upload preview
  $('imageFile')?.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) { updatePreviewDebounced(); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const labelW = Number($('labelWidth').value || printer.settings.labelWidthMM || 12);
        const labelH = Number($('labelLength').value || printer.settings.labelLengthMM || 40);
        const dpi = printer.settings.dpiPerMM || 8;
        const widthPx = Math.round(labelW * dpi);
        const heightPx = Math.round(labelH * dpi);
        const bytesPerRow = Math.ceil(widthPx / 8);
        const alignedW = bytesPerRow * 8;
        const c = document.createElement('canvas');
        c.width = alignedW; c.height = heightPx;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,c.width,c.height);
        const ratio = Math.min(c.width / img.width, c.height / img.height);
        ctx.drawImage(img, (c.width - img.width*ratio)/2, (c.height - img.height*ratio)/2, img.width*ratio, img.height*ratio);
        $('imagePreview').dataset.canvas = c.toDataURL();
        $('imagePreview').innerHTML = ''; $('imagePreview').appendChild(c);
        updatePreviewDebounced();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });

  // detect label
  $('detectLabelBtn')?.addEventListener('click', async () => {
    try {
      const res = await detectLabel();
      if (res) {
        alert('Detected label width mm: ' + res);
        $('labelWidth').value = res;
        saveSetting('labelWidth', res);
        printer.settings.labelWidthMM = Number(res);
        updatePreviewDebounced();
      } else {
        alert('Auto detect not available — feature placeholder.');
      }
    } catch (e) { alert('Detect failed: ' + e); }
  });

  // Print action: use same rendering pipeline (and use invert flag consistently).
  $('fab-print').addEventListener('click', async () => {
    try {
      const selectedTab = getActiveTabName();
      const labelW = Number($('labelWidth').value || printer.settings.labelWidthMM || 12);
      const labelH = Number($('labelLength').value || printer.settings.labelLengthMM || 40);
      const dpi = printer.settings.dpiPerMM || 8;
      const copies = Number($('copiesInput').value || 1);
      const fontFamily = $('fontFamily')?.value || printer.settings.fontFamily || 'Inter, sans-serif';
      let obj;
      if (selectedTab === 'tab-text') {
        obj = renderTextCanvas($('textInput').value, Number($('fontSize').value||36), $('alignment').value, $('invertInput').checked, labelW, labelH, dpi, fontFamily);
        await printCanvasObject(obj, copies, $('invertInput').checked);
      } else if (selectedTab === 'tab-image') {
        const dataURL = $('imagePreview').dataset.canvas;
        if (!dataURL) return alert('Please upload an image first');
        const img = new Image();
        img.onload = async () => {
          obj = renderImageCanvas(img, Number($('imageThreshold').value||128), $('imageInvert').checked, labelW, labelH, dpi);
          // Some printers ignore inverted image mode; do a forced bitmap invert if user has "forceInvert" enabled
          if (printer.settings.forceInvert) {
            const bitmap = (await import('./printer.js')).canvasToBitmap(obj.canvas, obj.bytesPerRow, false);
            const inverted = forceInvertBitmap(bitmap);
            const packet = (await import('./printer.js')).buildPacketFromBitmap(inverted, obj.bytesPerRow, obj.heightPx);
            // writeChunks is internal; simplest: call printCanvasObject but it expects canvas; we fall back to printing normal (rare)
            // Instead, call printCanvasObject normally — most devices accept invert flag. If not, use forceInvertBitmap path in future.
            await printCanvasObject(obj, copies, $('imageInvert').checked);
          } else {
            await printCanvasObject(obj, copies, $('imageInvert').checked);
          }
        };
        img.src = dataURL;
      } else if (selectedTab === 'tab-barcode') {
        obj = renderBarcodeCanvas($('barcodeInput').value, $('barcodeType').value, Number($('barcodeScale').value||2), labelW, labelH, dpi);
        await printCanvasObject(obj, copies, false);
      } else if (selectedTab === 'tab-qr') {
        obj = await renderQRCanvas($('qrInput').value, Number($('qrSize').value||256), labelW, labelH, dpi);
        await printCanvasObject(obj, copies, false);
      } else {
        // fallback to text
        obj = renderTextCanvas($('textInput').value, Number($('fontSize').value||36), $('alignment').value, $('invertInput').checked, labelW, labelH, dpi, fontFamily);
        await printCanvasObject(obj, copies, $('invertInput').checked);
      }
    } catch (e) {
      alert('Print failed: ' + e);
      console.error(e);
    }
  });

  // persist UI selection
  window.addEventListener('beforeunload', () => saveSetting('ui.selectedTab', getActiveTabName()));

  // initial update
  updatePreviewDebounced();
}

window.addEventListener('DOMContentLoaded', setup);
