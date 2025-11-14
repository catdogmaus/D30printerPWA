// app.js — Phomemo D30C Web Bluetooth (final, raster protocol)
// Assumes your page has elements with IDs:
//  #connect  #print  #text  #copies  #log

let device = null;
let server = null;
let service = null;
let characteristic = null;

const LOG_ID = 'log';
const CONNECT_ID = 'connect';
const PRINT_ID = 'print';
const TEXT_ID = 'text';
const COPIES_ID = 'copies';

// ---- Default physical settings (can be exposed in UI) ----
const DEFAULT_LABEL_WIDTH_MM = 12;   // mm (you said 12x40)
const DEFAULT_LABEL_HEIGHT_MM = 40;  // mm
const DPI_MM = 8; // approx 203 DPI -> 8 px/mm (matches 96 px width for 12mm)
const CHUNK_SIZE = 128; // replicate odensc chunking
const CHUNK_DELAY_MS = 20;

function log(msg) {
  const el = document.getElementById(LOG_ID);
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}\n`;
  if (el) {
    el.value = (el.value || '') + line;
    el.scrollTop = el.scrollHeight;
  }
  console.log(line.trim());
}

async function connectPrinter() {
  log('Requesting Bluetooth device...');
  if (!navigator.bluetooth) {
    log('Web Bluetooth not supported in this browser.');
    return;
  }

  try {
    // use the discovery that previously worked for you
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'D30' }],
      optionalServices: [
        '0000ff00-0000-1000-8000-00805f9b34fb',
        '0000ff01-0000-1000-8000-00805f9b34fb',
        '0000ff02-0000-1000-8000-00805f9b34fb'
      ]
    });

    log(`Selected device: ${device.name || device.id}`);
    device.addEventListener('gattserverdisconnected', () => {
      log('⚠️ Device disconnected');
      characteristic = null;
    });

    server = await device.gatt.connect();
    log('GATT connected — discovering service/characteristic...');

    // Try candidate services and pick a writable characteristic
    const candidates = [
      '0000ff02-0000-1000-8000-00805f9b34fb',
      '0000ff01-0000-1000-8000-00805f9b34fb',
      '0000ff00-0000-1000-8000-00805f9b34fb',
      0xff02, 0xff01, 0xff00
    ];

    for (const cand of candidates) {
      try {
        service = await server.getPrimaryService(cand);
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            characteristic = c;
            log(`✅ Using characteristic ${c.uuid} (write:${!!c.properties.write}, writeWoResp:${!!c.properties.writeWithoutResponse})`);
            return;
          }
        }
      } catch (e) {
        // ignore and try next
      }
    }

    // If still not found, enumerate and pick any writable char
    const allServices = await server.getPrimaryServices();
    for (const s of allServices) {
      try {
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            service = s;
            characteristic = c;
            log(`✅ Auto-selected char ${c.uuid} on service ${s.uuid}`);
            return;
          }
        }
      } catch (e) {}
    }

    log('❌ No writable characteristic found on device.');
  } catch (err) {
    log('Connection failed: ' + (err && err.message ? err.message : err));
  }
}

// Render text into canvas sized for label (px)
function renderTextToCanvas(text, labelWidthMm = DEFAULT_LABEL_WIDTH_MM, labelHeightMm = DEFAULT_LABEL_HEIGHT_MM, fontPercent = 80) {
  const widthPx = Math.round(labelWidthMm * DPI_MM);
  const heightPx = Math.round(labelHeightMm * DPI_MM);

  // ensure width is multiple of 8 (bytes per row)
  const bytesPerRow = Math.ceil(widthPx / 8);
  const alignedWidthPx = bytesPerRow * 8;

  const canvas = document.createElement('canvas');
  canvas.width = alignedWidthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');

  // white background, black text
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';

  // choose font size relative to height
  const fontSize = Math.floor((heightPx * fontPercent) / 100);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // draw text centered
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  // Optionally append preview to DOM (if you want)
  // const previewArea = document.getElementById('preview'); if (previewArea) { previewArea.innerHTML = ''; previewArea.appendChild(canvas); }

  return { canvas, bytesPerRow, widthPx: alignedWidthPx, heightPx };
}

// Pack canvas -> 1-bit bitmap MSB-first per byte, top-to-bottom
function canvasToBitmapData(canvas, bytesPerRow) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(bytesPerRow * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = img[idx]; // red channel (canvas is grayscale here)
      // threshold: black if < 128
      if (r < 128) {
        data[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7)); // MSB-first
      }
    }
  }
  return data;
}

// Build the full packet: ESC @, GS v 0 00, widthBytes, height, bitmap, ESC d 0
function buildPhomemoPacket(bitmapData, bytesPerRow, heightPx) {
  // header pieces
  const reset = new Uint8Array([0x1B, 0x40]); // ESC @
  // GS v 0 m xL xH yL yH  (m = 0)
  const wL = bytesPerRow & 0xff;
  const wH = (bytesPerRow >> 8) & 0xff;
  const hL = heightPx & 0xff;
  const hH = (heightPx >> 8) & 0xff;
  const gsHeader = new Uint8Array([0x1D, 0x76, 0x30, 0x00, wL, wH, hL, hH]);
  // finalize with ESC d 0 (feed n lines = 0)
  const footer = new Uint8Array([0x1B, 0x64, 0x00]);

  // concatenate
  const totalLen = reset.length + gsHeader.length + bitmapData.length + footer.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  out.set(reset, pos); pos += reset.length;
  out.set(gsHeader, pos); pos += gsHeader.length;
  out.set(bitmapData, pos); pos += bitmapData.length;
  out.set(footer, pos);
  return out;
}

// Write helper: split into CHUNK_SIZE and write (with response when supported)
async function writeChunks(u8) {
  if (!characteristic) throw new Error('Not connected to printer characteristic');
  for (let i = 0; i < u8.length; i += CHUNK_SIZE) {
    const slice = u8.slice(i, i + CHUNK_SIZE);
    try {
      if (characteristic.properties && characteristic.properties.write) {
        await characteristic.writeValue(slice); // with response
      } else {
        await characteristic.writeValueWithoutResponse(slice);
      }
    } catch (e) {
      // some errors may be transient, log and continue/throw as appropriate
      log('Write error: ' + (e && e.message ? e.message : e));
      throw e;
    }
    log(`Sent ${Math.min(i + CHUNK_SIZE, u8.length)}/${u8.length}`);
    await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
  }
}

// Main print flow
async function handlePrint() {
  if (!characteristic) {
    log('Please connect to the printer first.');
    return;
  }

  const textEl = document.getElementById(TEXT_ID);
  const copiesEl = document.getElementById(COPIES_ID);
  const text = textEl ? textEl.value.trim() : 'Hello D30C';
  const copies = Math.max(1, parseInt(copiesEl ? copiesEl.value : '1') || 1);

  log(`Preparing print: "${text}" (${copies} copies)`);

  // render at default mm size (you can expose these as UI controls)
  const { canvas, bytesPerRow, widthPx, heightPx } = renderTextToCanvas(text, DEFAULT_LABEL_WIDTH_MM, DEFAULT_LABEL_HEIGHT_MM, 80);

  // show preview if element exists
  const previewEl = document.getElementById('preview');
  if (previewEl) {
    previewEl.innerHTML = '';
    previewEl.appendChild(canvas);
  }

  const bitmapData = canvasToBitmapData(canvas, bytesPerRow);

  // Build payload
  const packet = buildPhomemoPacket(bitmapData, bytesPerRow, heightPx);

  try {
    for (let i = 0; i < copies; i++) {
      log(`➡️ Sending job ${i + 1}/${copies}`);
      await writeChunks(packet);
      // small pause between copies
      await new Promise(r => setTimeout(r, 400));
    }
    log('✅ Printing done');
  } catch (e) {
    log('❌ Print failed: ' + (e && e.message ? e.message : e));
  }
}

// DOM wiring
window.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById(CONNECT_ID);
  const printBtn = document.getElementById(PRINT_ID);
  if (connectBtn) connectBtn.addEventListener('click', connectPrinter);
  if (printBtn) printBtn.addEventListener('click', handlePrint);
  log('App ready. Click Connect to begin.');
});
