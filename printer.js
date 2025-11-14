// printer.js
// Core printing + canvas rendering logic for D30 (90° CCW rotated text inside canvas)

export const printer = {
  device: null,
  server: null,
  characteristic: null,
  connected: false,
  settings: {
    labelWidthMM: 12,
    labelLengthMM: 40,
    dpiPerMM: 8,
    protocol: "phomemo_raw",
    fontFamily: "sans-serif"
  },
  logs: []
};

function pushLog(msg) {
  printer.logs.push(msg);
  console.log(msg);
  const logArea = document.getElementById("logArea");
  if (logArea) {
    logArea.value += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    logArea.scrollTop = logArea.scrollHeight;
  }
}

// ---------- Bluetooth connect / disconnect ----------
export async function connect() {
  try {
    pushLog("Requesting Bluetooth device...");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "D30" }],
      optionalServices: [
        '0000ff00-0000-1000-8000-00805f9b34fb',
        '0000ff01-0000-1000-8000-00805f9b34fb',
        '0000ff02-0000-1000-8000-00805f9b34fb'
      ]
    });
    printer.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      pushLog("Device disconnected");
      printer.connected = false;
      printer.characteristic = null;
      updateConnUI(false);
    });

    printer.server = await device.gatt.connect();
    pushLog("GATT connected");

    const svcs = await printer.server.getPrimaryServices();
    for (const s of svcs) {
      try {
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            printer.characteristic = c;
            printer.connected = true;
            pushLog(`Using characteristic ${c.uuid} (write:${c.properties.write})`);
            updateConnUI(true);
            return;
          }
        }
      } catch (e) {}
    }

    pushLog("No writable characteristic found");
  } catch (e) {
    pushLog("Connect failed: " + e);
    updateConnUI(false);
  }
}

export async function disconnect() {
  if (printer.device && printer.device.gatt && printer.device.gatt.connected) {
    printer.device.gatt.disconnect();
    printer.connected = false;
    printer.characteristic = null;
    pushLog("Disconnected");
    updateConnUI(false);
  } else {
    pushLog("Not connected");
  }
}

function updateConnUI(connected) {
  const el = document.getElementById("connectionStatus");
  if (el) el.textContent = connected ? "Connected" : "Not connected";
  const btn = document.getElementById("connectBtn");
  if (btn) btn.textContent = connected ? "Connected" : "Connect";
}

// ---------- Canvas rendering utilities ----------

// Create an empty canvas sized to printer native raster orientation:
// width = labelWidthMM * dpi (rounded up to multiple of 8), height = labelLengthMM * dpi
function makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert) {
  const widthPx = Math.round(labelWidthMM * dpi);
  const heightPx = Math.round(labelLengthMM * dpi);
  const bytesPerRow = Math.ceil(widthPx / 8);
  const alignedWidth = bytesPerRow * 8;

  const canvas = document.createElement('canvas');
  canvas.width = alignedWidth; // printer expects width aligned to 8 bits
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = invert ? "#000000" : "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return { canvas, ctx, bytesPerRow, widthPx: alignedWidth, heightPx };
}

// Render text into a canvas: text is rotated CCW inside the canvas so raster orientation remains native.
// This returns an object { canvas, bytesPerRow, widthPx, heightPx } identical to other renderers.
export function renderTextCanvas(text, fontSize = 40, alignment = 'center', invert = false, labelWidthMM = 12, labelLengthMM = 40, dpi = 8, fontFamily = 'sans-serif') {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);

  // Rotate drawing context 90° CCW (so text reads along the label feed direction)
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);

  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textAlign = alignment;
  ctx.textBaseline = "middle";

  // choose X coordinate in rotated coordinates
  let x;
  if (alignment === 'center') x = heightPx / 2;
  else if (alignment === 'left') x = 10;
  else x = heightPx - 10;

  // draw text at (x, centered horizontally in rotated space)
  ctx.fillText(text, x, widthPx / 2);

  ctx.restore();

  return { canvas, bytesPerRow, widthPx, heightPx };
}

// Render an uploaded image onto the printer-native canvas (fit in and center)
export function renderImageCanvas(image, threshold = 128, invert = false, labelWidthMM = 12, labelLengthMM = 40, dpi = 8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);

  // Fit image inside canvas while preserving aspect ratio
  const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
  const dw = image.width * ratio;
  const dh = image.height * ratio;
  ctx.drawImage(image, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);

  // threshold/inversion will be applied during packing (canvasToBitmap)
  return { canvas, bytesPerRow, widthPx, heightPx };
}

// Render barcode as a canvas sized to label (uses JsBarcode)
export function renderBarcodeCanvas(value, type = 'CODE128', scale = 2, labelWidthMM = 12, labelLengthMM = 40, dpi = 8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);

  const bcCanvas = document.createElement('canvas');
  try {
    // JsBarcode will draw on its own canvas; we then scale/center it into printer canvas
    JsBarcode(bcCanvas, value, { format: type, displayValue: false, width: scale, margin: 0 });
    const ratio = Math.min((canvas.width * 0.9) / bcCanvas.width, (canvas.height * 0.6) / bcCanvas.height);
    const dw = bcCanvas.width * ratio;
    const dh = bcCanvas.height * ratio;
    ctx.drawImage(bcCanvas, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  } catch (e) {
    pushLog("Barcode render error: " + e);
  }

  return { canvas, bytesPerRow, widthPx, heightPx };
}

// Render QR (uses QRCode.toCanvas)
export async function renderQRCanvas(value, size = 256, labelWidthMM = 12, labelLengthMM = 40, dpi = 8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, value, { width: Math.min(size, 512) });
  const ratio = Math.min((canvas.width * 0.8) / qrCanvas.width, (canvas.height * 0.8) / qrCanvas.height);
  const dw = qrCanvas.width * ratio;
  const dh = qrCanvas.height * ratio;
  ctx.drawImage(qrCanvas, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);

  return { canvas, bytesPerRow, widthPx, heightPx };
}

// Convert canvas to 1-bit bitmap (MSB-first) - used for both preview packing and printing
export function canvasToBitmap(canvas, bytesPerRow, invert = false) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = img[idx];
      let isBlack = r < 128;
      if (invert) isBlack = !isBlack;
      if (isBlack) out[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }
  return out;
}

// Build ESC/POS style packet (GS v 0 raster) that works with the D30C
export function buildPacketFromBitmap(bitmap, bytesPerRow, heightPx) {
  const reset = new Uint8Array([0x1B, 0x40]);
  const header = new Uint8Array([
    0x1D, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    heightPx & 0xff,
    (heightPx >> 8) & 0xff
  ]);
  const footer = new Uint8Array([0x1B, 0x64, 0x00]);
  const out = new Uint8Array(reset.length + header.length + bitmap.length + footer.length);
  let p = 0;
  out.set(reset, p); p += reset.length;
  out.set(header, p); p += header.length;
  out.set(bitmap, p); p += bitmap.length;
  out.set(footer, p);
  return out;
}

// Write in chunks to characteristic
async function writeChunks(u8) {
  if (!printer.characteristic) throw new Error("Not connected");
  const CHUNK = 128;
  for (let i = 0; i < u8.length; i += CHUNK) {
    const slice = u8.slice(i, i + CHUNK);
    if (printer.characteristic.properties.write) {
      await printer.characteristic.writeValue(slice);
    } else {
      await printer.characteristic.writeValueWithoutResponse(slice);
    }
    pushLog(`Sent ${Math.min(i + CHUNK, u8.length)}/${u8.length}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

// Print a canvasObj {canvas, bytesPerRow, widthPx, heightPx}
export async function printCanvasObject(canvasObj, copies = 1, invert = false) {
  if (!printer.characteristic) throw new Error("Not connected");
  const { canvas, bytesPerRow, heightPx } = canvasObj;
  const bitmap = canvasToBitmap(canvas, bytesPerRow, invert);
  const packet = buildPacketFromBitmap(bitmap, bytesPerRow, heightPx);
  for (let i = 0; i < copies; i++) {
    await writeChunks(packet);
    await new Promise(r => setTimeout(r, 300));
  }
  pushLog("Printing done");
}

// Best-effort label detection (reads characteristics and heuristically finds mm value)
export async function detectLabel() {
  if (!printer.server) throw new Error("Not connected");
  try {
    const svcs = await printer.server.getPrimaryServices();
    for (const s of svcs) {
      try {
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          try {
            const v = await c.readValue();
            if (v && v.byteLength >= 1) {
              const b0 = v.getUint8(0);
              if (b0 >= 8 && b0 <= 60) {
                printer.settings.labelWidthMM = b0;
                pushLog("Detected label width mm: " + b0);
                return b0;
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}
