// ui.js
import { printer, connect, disconnect, printText, detectLabel } from './printer.js';

// small helper
function $(id) { return document.getElementById(id); }

function saveSettings() {
  const w = Number($('labelWidth').value || 12);
  const h = Number($('labelLength').value || 40);
  const proto = $('protocolSelect').value;
  localStorage.setItem('labelWidth', w);
  localStorage.setItem('labelLength', h);
  localStorage.setItem('protocol', proto);
  printer.settings.labelWidthMM = w;
  printer.settings.labelLengthMM = h;
  printer.settings.protocol = proto;
}

function loadSettings() {
  const w = Number(localStorage.getItem('labelWidth') || 12);
  const h = Number(localStorage.getItem('labelLength') || 40);
  const proto = localStorage.getItem('protocol') || 'phomemo_raw';
  $('labelWidth').value = w;
  $('labelLength').value = h;
  $('protocolSelect').value = proto;
  printer.settings.labelWidthMM = w;
  printer.settings.labelLengthMM = h;
  printer.settings.protocol = proto;
}

function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const el = $(name);
  if (el) el.classList.remove('hidden');
  // pill active style
  document.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('bg-indigo-100','text-indigo-700'));
  const active = document.querySelector(`[data-tab="${name}"]`);
  if (active) active.classList.add('bg-indigo-100','text-indigo-700');
}

async function setup() {
  loadSettings();
  // wire tabs
  document.querySelectorAll('.tab-pill').forEach(p => {
    p.addEventListener('click', () => switchTab(p.dataset.tab));
  });
  switchTab('tab-text');

  // connect/disconnect
  $('connectBtn').addEventListener('click', async () => {
    if (!printer.connected) {
      await connect();
    } else {
      await disconnect();
    }
  });
  $('disconnectBtn').addEventListener('click', async () => {
    await disconnect();
  });

  // detect label
  $('detectLabelBtn').addEventListener('click', async () => {
    try {
      const res = await detectLabel();
      if (res) {
        alert('Detected label width mm: ' + res);
        $('labelWidth').value = res;
        saveSettings();
      } else {
        alert('Auto detect not available on this device.');
      }
    } catch (e) {
      alert('Detect failed: ' + e);
    }
  });

  // Text UI: font controls
  $('fontInc').addEventListener('click', ()=> { $('fontSize').value = Math.min(200, Number($('fontSize').value || 36) + 2); });
  $('fontDec').addEventListener('click', ()=> { $('fontSize').value = Math.max(8, Number($('fontSize').value || 36) - 2); });
  $('fontPreset').addEventListener('change', ()=> { $('fontSize').value = $('fontPreset').value; });

  // Text & FAB print
  async function doPrintText() {
    try {
      saveSettings();
      await printText({
        text: $('textInput').value,
        fontSize: Number($('fontSize').value),
        alignment: $('alignment').value,
        invert: $('invertInput').checked,
        copies: Number($('copiesInput').value),
        labelWidthMM: Number($('labelWidth').value),
        labelLengthMM: Number($('labelLength').value),
        dpi: printer.settings.dpiPerMM
      });
    } catch (e) {
      alert('Print failed: ' + e);
    }
  }

  $('fab-print').addEventListener('click', doPrintText);
  $('printBtn')?.addEventListener('click', doPrintText);

  // Image upload
  $('imageFile')?.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // draw onto canvas sized to label (fit)
        const labelW = Number($('labelWidth').value);
        const labelH = Number($('labelLength').value);
        const dpi = printer.settings.dpiPerMM;
        const w = Math.round(labelW * dpi);
        const h = Math.round(labelH * dpi);
        const bytesPerRow = Math.ceil(w / 8);
        const alignedW = bytesPerRow * 8;
        const canvas = document.createElement('canvas');
        canvas.width = alignedW;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // fit image inside
        const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
        const dw = img.width * ratio;
        const dh = img.height * ratio;
        ctx.drawImage(img, (canvas.width - dw)/2, (canvas.height - dh)/2, dw, dh);
        const preview = $('imagePreview');
        preview.innerHTML = '';
        preview.appendChild(canvas);
        // store the canvas on element for later printing
        preview.dataset.canvas = canvas.toDataURL();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });

  // Barcode preview
  $('barcodeInput').addEventListener('input', () => {
    const val = $('barcodeInput').value;
    const scale = Number($('barcodeScale').value || 2);
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, val, { format: $('barcodeType').value, displayValue: false, width: scale });
      $('barcodePreview').innerHTML = '';
      $('barcodePreview').appendChild(canvas);
    } catch (e) {
      $('barcodePreview').textContent = 'Invalid barcode';
    }
  });
  // fire initial
  $('barcodeInput').dispatchEvent(new Event('input'));

  // QR preview
  $('qrInput').addEventListener('input', () => {
    const val = $('qrInput').value;
    const size = Number($('qrSize').value || 256);
    const el = document.createElement('div');
    el.innerHTML = '';
    QRCode.toCanvas(document.createElement('canvas'), val, { width: size }).then(canvas => {
      $('qrPreview').innerHTML = '';
      $('qrPreview').appendChild(canvas);
    }).catch(e => $('qrPreview').textContent = 'QR error: ' + e);
  });
  $('qrInput').dispatchEvent(new Event('input'));

  // load saved UI settings
  $('fontSize').value = localStorage.getItem('fontSize') || 36;
  $('alignment').value = localStorage.getItem('alignment') || 'center';
  $('invertInput').checked = localStorage.getItem('invert') === 'true' || false;

  $('fontSize').addEventListener('change', ()=> localStorage.setItem('fontSize', $('fontSize').value));
  $('alignment').addEventListener('change', ()=> localStorage.setItem('alignment', $('alignment').value));
  $('invertInput').addEventListener('change', ()=> localStorage.setItem('invert', $('invertInput').checked));

  // keep connect button visible state
  setInterval(()=> {
    const btn = $('connectBtn');
    if (printer.connected) btn.textContent = 'Connected'; else btn.textContent = 'Connect';
  }, 800);

  // logs area
  const logArea = $('logArea');
  if (logArea) logArea.value = '';

  // initial setup done
  console.log("UI setup complete");
}

window.addEventListener('DOMContentLoaded', setup);
