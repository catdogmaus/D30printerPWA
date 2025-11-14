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
  detectLabel
} from './printer.js';

function $ (id) { return document.getElementById(id); }
let previewTimer = null;
const PREVIEW_DEBOUNCE_MS = 250;

// switch tabs and update preview
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const el = $(name);
  if (el) el.classList.remove('hidden');
  document.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('bg-indigo-100','text-indigo-700'));
  const active = document.querySelector(`[data-tab="${name}"]`);
  if (active) active.classList.add('bg-indigo-100','text-indigo-700');
  updatePreviewDebounced();
}

// place preview canvas scaled but preserving aspect ratio
function placePreviewCanvas(sourceCanvas) {
  const wrap = $('previewCanvasWrap');
  wrap.innerHTML = '';

  // compute dynamic max height based on aspect ratio
  const aspect = sourceCanvas.width / sourceCanvas.height; // width/height
  let maxH = 250; // base
  if (aspect < 0.2) maxH = 350; // very long labels -> bigger preview

  // compute max available width (bounded)
  const maxW = Math.min(680, window.innerWidth * 0.9);

  const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,cv.width,cv.height);
  ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);

  // center and append
  wrap.appendChild(cv);
}

// debounced preview update
function updatePreviewDebounced() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, PREVIEW_DEBOUNCE_MS);
}

async function updatePreview() {
  const active = document.querySelector('.tab-content:not(.hidden)');
  if (!active) return;

  const labelW = Number($('labelWidth').value || 12);
  const labelH = Number($('labelLength').value || 40);
  const dpi = printer.settings.dpiPerMM || 8;
  const fontFamily = $('fontFamily')?.value || printer.settings.fontFamily || 'sans-serif';

  try {
    if (active.id === 'tab-text') {
      const text = $('textInput').value;
      const fontSize = Number($('fontSize').value || 36);
      const align = $('alignment').value || 'center';
      const invert = $('invertInput').checked;
      const obj = renderTextCanvas(text, fontSize, align, invert, labelW, labelH, dpi, fontFamily);
      placePreviewCanvas(obj.canvas);
    } else if (active.id === 'tab-image') {
      const preview = $('imagePreview');
      const dataURL = preview.dataset.canvas;
      if (dataURL) {
        const img = new Image();
        img.onload = () => {
          const threshold = Number($('imageThreshold').value || 128);
          const invert = $('imageInvert').checked;
          const obj = renderImageCanvas(img, threshold, invert, labelW, labelH, dpi);
          placePreviewCanvas(obj.canvas);
        };
        img.src = dataURL;
      } else {
        $('previewCanvasWrap').innerHTML = '<div class="text-sm text-gray-500">No image uploaded</div>';
      }
    } else if (active.id === 'tab-barcode') {
      const val = $('barcodeInput').value;
      const type = $('barcodeType').value;
      const scale = Number($('barcodeScale').value || 2);
      const obj = renderBarcodeCanvas(val, type, scale, labelW, labelH, dpi);
      placePreviewCanvas(obj.canvas);
    } else if (active.id === 'tab-qr') {
      const val = $('qrInput').value;
      const size = Number($('qrSize').value || 256);
      const obj = await renderQRCanvas(val, size, labelW, labelH, dpi);
      placePreviewCanvas(obj.canvas);
    } else {
      // settings/logs: leave preview as is
    }
  } catch (e) {
    console.warn('Preview error', e);
  }
}

// UI wiring
async function setup() {
  // tabs
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

  // barcode/qr inputs
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
        const labelW = Number($('labelWidth').value || 12);
        const labelH = Number($('labelLength').value || 40);
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

  // image controls
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

  // font family setting
  const savedFont = localStorage.getItem('fontFamily') || 'sans-serif';
  $('fontFamily').value = savedFont;
  $('fontFamily').addEventListener('change', ()=> { localStorage.setItem('fontFamily', $('fontFamily').value); updatePreviewDebounced(); });

  // preview for barcode & qr at start
  $('barcodeInput').dispatchEvent(new Event('input'));
  $('qrInput').dispatchEvent(new Event('input'));

  // print action (FAB)
  $('fab-print').addEventListener('click', async () => {
    try {
      const active = document.querySelector('.tab-content:not(.hidden)');
      const labelW = Number($('labelWidth').value || 12);
      const labelH = Number($('labelLength').value || 40);
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

  // simple prefs
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
