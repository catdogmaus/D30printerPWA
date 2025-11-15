// printer.js
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
    fontFamily: "Inter, sans-serif"
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

export async function connect() {
  try {
    pushLog("Requesting Bluetooth device...");
    const device = await navigator.bluetooth.requestDevice({
  // accept all devices (let user choose); still request Phomemo services as optional.
  acceptAllDevices: true,
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
  if (btn) btn.textContent = connected ? "Disconnect" : "Connect";
}

// makeLabelCanvas
function makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert) {
  const widthPx = Math.round(labelWidthMM * dpi);
  const heightPx = Math.round(labelLengthMM * dpi);
  const bytesPerRow = Math.ceil(widthPx / 8);
  const alignedWidth = bytesPerRow * 8;

  const canvas = document.createElement('canvas');
  canvas.width = alignedWidth;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = invert ? "#000000" : "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx, bytesPerRow, widthPx: alignedWidth, heightPx };
}

// renderTextCanvas
export function renderTextCanvas(text, fontSize = 40, alignment = 'center', invert = false, labelWidthMM = 12, labelLengthMM = 40, dpi = 8, fontFamily = 'Inter, sans-serif') {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textAlign = alignment;
  ctx.textBaseline = "middle";
  let x;
  if (alignment === 'center') x = heightPx / 2;
  else if (alignment === 'left') x = 10;
  else x = heightPx - 10;
  ctx.fillText(text, x, widthPx / 2);
  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx };
}

// renderImageCanvas
export function renderImageCanvas(image, threshold = 128, invert = false, labelWidthMM = 12, labelLengthMM = 40, dpi = 8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);
  const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
  const dw = image.width * ratio;
  const dh = image.height * ratio;
  // draw rotated for print (rotate CCW)
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(image, (heightPx - dw)/2, (widthPx - dh)/2, dw, dh);
  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx };
}

// renderBarcodeCanvas (rotated for print)
export function renderBarcodeCanvas(value, type = 'CODE128', scale = 2, labelWidthMM = 12, labelLengthMM = 40, dpi = 8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  const bcCanvas = document.createElement('canvas');
  try {
    JsBarcode(bcCanvas, value, { format: type, displayValue: false, width: scale, margin: 0 });
    const ratio = Math.min(heightPx / bcCanvas.width, widthPx / bcCanvas.height);
    const dw = bcCanvas.width * ratio;
    const dh = bcCanvas.height * ratio;
    ctx.save();
    ctx.translate(0, heightPx);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(bcCanvas, (heightPx - dw)/2, (widthPx - dh)/2, dw, dh);
    ctx.restore();
  } catch (e) {
    pushLog("Barcode render error: " + e);
  }
  return { canvas, bytesPerRow, widthPx, heightPx };
}

// renderQRCanvas (rotated for print)
export async function renderQRCanvas(value, size = 256, labelWidthMM = 12, labelLengthMM = 40, dpi = 8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, value, { width: Math.min(size, 512) });
  const ratio = Math.min(heightPx / qrCanvas.width, widthPx / qrCanvas.height);
  const dw = qrCanvas.width * ratio;
  const dh = qrCanvas.height * ratio;
  ctx.save();
  ctx.translate(0, heightPx);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(qrCanvas, (heightPx - dw)/2, (widthPx - dh)/2, dw, dh);
  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx };
}

// canvasToBitmap
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

// Optional: force invert the already-created bitmap bytes (flip bits).
// Use this only if you know the printer ignores inverted pixels and you need to invert in software.
export function forceInvertBitmap(u8) {
  const out = new Uint8Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = ~u8[i] & 0xFF;
  return out;
}

export function buildPacketFromBitmap(bitmap, bytesPerRow, heightPx) {
  const reset = new Uint8Array([0x1B, 0x40]);
  const header = new Uint8Array([0x1D, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, heightPx & 0xff, (heightPx >> 8) & 0xff]);
  const footer = new Uint8Array([0x1B, 0x64, 0x00]);
  const out = new Uint8Array(reset.length + header.length + bitmap.length + footer.length);
  let p = 0;
  out.set(reset, p); p += reset.length;
  out.set(header, p); p += header.length;
  out.set(bitmap, p); p += bitmap.length;
  out.set(footer, p);
  return out;
}

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

export function makePreviewFromPrintCanvas(printCanvas) {
  const src = printCanvas;
  const preview = document.createElement('canvas');
  preview.width = src.height;
  preview.height = src.width;
  const ctx = preview.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, preview.width, preview.height);
  ctx.save();
  ctx.translate(preview.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return preview;
}

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
