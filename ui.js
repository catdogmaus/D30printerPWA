// ui.js
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
  makePreviewFromPrintCanvas
} from './printer.js';

function $ (id) { return document.getElementById(id); }
let previewTimer = null;
const PREVIEW_DEBOUNCE_MS = 250;

function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const el = $(name);
  if (el) el.classList.remove('hidden');
  document.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('bg-indigo-100','text-indigo-700'));
  const active = document.querySelector(`[data-tab="${name}"]`);
  if (active) active.classList.add('bg-indigo-100','text-indigo-700');
  updatePreviewDebounced();
}

// create scaled preview canvas (source is HORIZONTAL preview canvas)
function placePreviewCanvas(sourceCanvas) {
  const wrap = $('previewCanvasWrap');
  wrap.innerHTML = ''; // clear previous content (fix duplication)

  // dynamic max height based on aspect ratio (source is horizontal: w/h)
  const aspect = sourceCanvas.width / sourceCanvas.height;
  let maxH = 220; // base
  if (aspect > 5) maxH = 350; // very long horizontal labels -> bigger preview

  const maxW = Math.min(680, window.innerWidth * 0.9);

  const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,cv.width,cv.height);
  ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);

  cv.style.border = '1px solid #E6E9EE';
  cv.style.borderRadius = '6px';

  wrap.appendChild(cv);
}

function updatePreviewDebounced() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, PREVIEW_DEBOUNCE_MS);
}

async function updatePreview() {
  const active = document.querySelector('.tab-content:not(.hidden)');
  if (!active) return;

  const labelW = Number($('labelWidth').value || printer.settings.labelWidthMM || 12);
  const labelH = Number($('labelLength').value || printer.settings.labelLengthMM || 40);
  const dpi = printer.settings.dpiPerMM || 8;
  const fontFamily = $('fontFamily')?.value || printer.settings.fontFamily || 'sans-serif';

  try {
    let printObj = null;

    if (active.id === 'tab-text') {
      const text = $('textInput').value;
      const fontSize = Number($('fontSize').value || 36);
      const align = $('alignment').value || 'center';
      const invert = $('invertInput').checked;
      printObj = renderTextCanvas(text, fontSize, align, invert, labelW, labelH, dpi, fontFamily);
    } else if (active.id === 'tab-image') {
      const preview = $('imagePreview');
      const dataURL = preview.dataset.canvas;
      if (dataURL) {
        const img = new Image();
        img.onload = () => {
          const invert = $('imageInvert').checked;
          // use same render pipeline used for printing
          const obj = renderImageCanvas(img, Number($('imageThreshold').value||128), invert, labelW, labelH, dpi);
          const previewCanvas = makePreviewFromPrintCanvas(obj.canvas);
          placePreviewCanvas(previewCanvas);
        };
        img.src = dataURL;
        return;
      } else {
        $('previewCanvasWrap').innerHTML = '<div class="text-sm text-gray-500">No image uploaded</div>';
        return;
      }
    } else if (active.id === 'tab-barcode') {
      const val = $('barcodeInput').value;
      const type = $('barcodeType').value;
      const scale = Number($('barcodeScale').value || 2);
      printObj = renderBarcodeCanvas(val, type, scale, labelW, labelH, dpi);
    } else if (active.id === 'tab-qr') {
      const val = $('qrInput').value;
      const size = Number($('qrSize').value || 256);
      printObj = await renderQRCanvas(val, size, labelW, labelH, dpi);
    } else {
      // settings or logs -> keep previous preview
      return;
    }

    if (printObj && printObj.canvas) {
      // convert print canvas (rotated for printer) into horizontal preview
      const previewCanvas = makePreviewFromPrintCanvas(printObj.canvas);
      placePreviewCanvas(previewCanvas);
    }

    const hint = document.getElementById('previewHint');
    if (hint) {
      hint.textContent = `Preview shown in label proportions (${labelW}×${labelH} mm). Change label size in Settings.`;
    }
  } catch (e) {
    console.warn('Preview error', e);
  }
}

// UI wiring
async function setup() {
  document.querySelectorAll('.tab-pill').forEach(p => {
    p.addEventListener('click', ()=> switchTab(p.dataset.tab));
  });
  switchTab('tab-text');

  // connect/disconnect
  $('connectBtn').addEventListener('click', async () => {
    if (!printer.connected) {
      await connect();
    } else {
      await disconnect();
    }
    updatePreviewDebounced();
  });
  $('disconnectBtn')?.addEventListener('click', async () => { await disconnect(); updatePreviewDebounced(); });

  // font controls
  $('fontInc').addEventListener('click', ()=> { $('fontSize').value = Math.min(200, Number($('fontSize').value || 36) + 2); updatePreviewDebounced();});
  $('fontDec').addEventListener('click', ()=> { $('fontSize').value = Math.max(8, Number($('fontSize').value || 36) - 2); updatePreviewDebounced();});
  $('fontPreset').addEventListener('change', ()=> { $('fontSize').value = $('fontPreset').value; updatePreviewDebounced();});
  $('fontSize').addEventListener('input', ()=> updatePreviewDebounced());
  $('alignment').addEventListener('change', ()=> updatePreviewDebounced());
  $('invertInput').addEventListener('change', ()=> updatePreviewDebounced());
  $('textInput').addEventListener('input', ()=> updatePreviewDebounced());

  // barcode / qr inputs
  $('barcodeInput').addEventListener('input', ()=> updatePreviewDebounced());
  $('barcodeType').addEventListener('change', ()=> updatePreviewDebounced());
  $('barcodeScale').addEventListener('input', ()=> updatePreviewDebounced());
  $('qrInput').addEventListener('input', ()=> updatePreviewDebounced());
  $('qrSize').addEventListener('input', ()=> updatePreviewDebounced());

  // image upload
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

  $('imageThreshold')?.addEventListener('input', ()=> updatePreviewDebounced());
  $('imageInvert')?.addEventListener('change', ()=> updatePreviewDebounced());

  // detect label
  $('detectLabelBtn')?.addEventListener('click', async () => {
    try {
      const res = await detectLabel();
      if (res) {
        alert('Detected label width mm: ' + res);
        $('labelWidth').value = res; updatePreviewDebounced();
      } else alert('Auto detect not available');
    } catch (e) { alert('Detect failed: ' + e); }
  });

  // label settings change -> preview update
  $('labelWidth').addEventListener('input', ()=> updatePreviewDebounced());
  $('labelLength').addEventListener('input', ()=> updatePreviewDebounced());
  $('protocolSelect').addEventListener('change', ()=> localStorage.setItem('protocol', $('protocolSelect').value));

  // font family
  const savedFont = localStorage.getItem('fontFamily') || 'sans-serif';
  if ($('fontFamily')) {
    $('fontFamily').value = savedFont;
    $('fontFamily').addEventListener('change', ()=> { localStorage.setItem('fontFamily', $('fontFamily').value); updatePreviewDebounced(); });
  }

  // print action (FAB)
  $('fab-print').addEventListener('click', async () => {
    try {
      const active = document.querySelector('.tab-content:not(.hidden)');
      const labelW = Number($('labelWidth').value || printer.settings.labelWidthMM || 12);
      const labelH = Number($('labelLength').value || printer.settings.labelLengthMM || 40);
      const dpi = printer.settings.dpiPerMM || 8;
      const copies = Number($('copiesInput').value || 1);
      const fontFamily = $('fontFamily')?.value || printer.settings.fontFamily || 'sans-serif';
      let obj;
      if (active.id === 'tab-text') {
        obj = renderTextCanvas($('textInput').value, Number($('fontSize').value||36), $('alignment').value, $('invertInput').checked, labelW, labelH, dpi, fontFamily);
      } else if (active.id === 'tab-image') {
        const dataURL = $('imagePreview').dataset.canvas;
        if (!dataURL) return alert('Please upload an image first');
        const img = new Image();
        img.onload = async () => {
          obj = renderImageCanvas(img, Number($('imageThreshold').value||128), $('imageInvert').checked, labelW, labelH, dpi);
          await printCanvasObject(obj, copies, $('imageInvert').checked);
        };
        img.src = dataURL;
        return;
      } else if (active.id === 'tab-barcode') {
        obj = renderBarcodeCanvas($('barcodeInput').value, $('barcodeType').value, Number($('barcodeScale').value||2), labelW, labelH, dpi);
      } else if (active.id === 'tab-qr') {
        obj = await renderQRCanvas($('qrInput').value, Number($('qrSize').value||256), labelW, labelH, dpi);
      } else return alert('Nothing to print');
      await printCanvasObject(obj, copies, $('invertInput').checked);
    } catch (e) {
      alert('Print failed: ' + e);
    }
  });

  // local prefs
  $('fontSize').value = localStorage.getItem('fontSize') || 40;
  $('alignment').value = localStorage.getItem('alignment') || 'center';
  $('invertInput').checked = localStorage.getItem('invert') === 'true' || false;
  $('fontSize').addEventListener('change', ()=> localStorage.setItem('fontSize', $('fontSize').value));
  $('alignment').addEventListener('change', ()=> localStorage.setItem('alignment', $('alignment').value));
  $('invertInput').addEventListener('change', ()=> localStorage.setItem('invert', $('invertInput').checked));

  // initial preview
  updatePreviewDebounced();
}

window.addEventListener('DOMContentLoaded', setup);
