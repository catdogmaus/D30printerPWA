// printer.js
export let printer = {
  device: null,
  server: null,
  characteristic: null,
  connected: false,
  settings: {
    labelWidthMM: 12,
    labelLengthMM: 40,
    dpiPerMM: 8,
    protocol: "phomemo_raw"
  },
  logs: []
};

function log(msg) {
  printer.logs.push(msg);
  console.log(msg);
  const e = document.getElementById("logArea") || document.getElementById("log");
  if (e) {
    e.value += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    e.scrollTop = e.scrollHeight;
  }
}

// connect to a D30-like device
export async function connect() {
  try {
    log("Requesting Bluetooth device...");
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
      log("Device disconnected");
      printer.connected = false;
      printer.characteristic = null;
      updateConnectionStatus(false);
    });

    printer.server = await device.gatt.connect();
    log("GATT connected");

    // find writable characteristic
    const svcs = await printer.server.getPrimaryServices();
    for (const s of svcs) {
      try {
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            printer.characteristic = c;
            printer.connected = true;
            log(`Using characteristic ${c.uuid} (write:${c.properties.write})`);
            updateConnectionStatus(true);
            return;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    log("No writable characteristic found");
  } catch (e) {
    log("Connect failed: " + e);
    updateConnectionStatus(false);
  }
}

export async function disconnect() {
  if (printer.device && printer.device.gatt && printer.device.gatt.connected) {
    printer.device.gatt.disconnect();
    printer.connected = false;
    printer.characteristic = null;
    log("Disconnected");
    updateConnectionStatus(false);
  } else {
    log("Not connected");
  }
}

function updateConnectionStatus(connected) {
  const el = document.getElementById("connectionStatus");
  if (el) el.textContent = connected ? "Connected" : "Not connected";
  const btn = document.getElementById("connectBtn");
  if (btn) btn.textContent = connected ? "Connected" : "Connect";
}

// Render text into a canvas (text rotated inside canvas so raster keeps printer-native orientation)
function renderTextCanvas(text, fontSize, alignment, invert, labelWidthMM, labelHeightMM, dpi) {
  const widthPx = Math.round(labelWidthMM * dpi);
  const heightPx = Math.round(labelHeightMM * dpi);
  const bytesPerRow = Math.ceil(widthPx / 8);
  const alignedWidth = bytesPerRow * 8;

  const canvas = document.createElement("canvas");
  canvas.width = alignedWidth;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");

  // white or black background depending on invert
  if (invert) {
    ctx.fillStyle = "#000000";
  } else {
    ctx.fillStyle = "#FFFFFF";
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // draw rotated text (CCW)
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);

  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = alignment;
  ctx.textBaseline = "middle";

  // draw in rotated-space coordinates; vertical center is (heightPx/2)
  // we will use alignment center/left/right mapping to numeric x
  let x;
  if (alignment === 'center') x = heightPx / 2;
  else if (alignment === 'left') x = 10;
  else x = heightPx - 10;

  ctx.fillText(text, x, alignedWidth / 2);
  ctx.restore();

  return { canvas, bytesPerRow, widthPx: alignedWidth, heightPx };
}

// convert canvas -> 1-bit bitmap MSB-first
function canvasToBitmap(canvas, bytesPerRow, invert) {
  const ctx = canvas.getContext("2d");
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

function buildPacket(bitmap, bytesPerRow, heightPx) {
  const reset = new Uint8Array([0x1B, 0x40]);
  const wL = bytesPerRow & 0xff;
  const wH = (bytesPerRow >> 8) & 0xff;
  const hL = heightPx & 0xff;
  const hH = (heightPx >> 8) & 0xff;
  const header = new Uint8Array([0x1D, 0x76, 0x30, 0x00, wL, wH, hL, hH]);
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
  const CHUNK_SIZE = 128;
  for (let i = 0; i < u8.length; i += CHUNK_SIZE) {
    const slice = u8.slice(i, i + CHUNK_SIZE);
    if (printer.characteristic.properties.write) {
      await printer.characteristic.writeValue(slice);
    } else {
      await printer.characteristic.writeValueWithoutResponse(slice);
    }
    log(`Sent ${Math.min(i + CHUNK_SIZE, u8.length)}/${u8.length}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

export async function printText(options = {}) {
  if (!printer.characteristic) throw new Error("Not connected");
  const labelWidthMM = Number(options.labelWidthMM || printer.settings.labelWidthMM);
  const labelLengthMM = Number(options.labelLengthMM || printer.settings.labelLengthMM);
  const dpi = Number(options.dpi || printer.settings.dpiPerMM);
  const fontSize = Number(options.fontSize || 40);
  const alignment = options.alignment || 'center';
  const invert = !!options.invert;
  const copies = Math.max(1, Number(options.copies || 1));
  const text = String(options.text || "Hello");

  const { canvas, bytesPerRow, heightPx } = renderTextCanvas(text, fontSize, alignment, invert, labelWidthMM, labelLengthMM, dpi);

  // preview if available
  const previewEl = document.getElementById("preview");
  if (previewEl) {
    previewEl.innerHTML = "";
    previewEl.appendChild(canvas);
  }

  const bitmap = canvasToBitmap(canvas, bytesPerRow, invert);
  const packet = buildPacket(bitmap, bytesPerRow, heightPx);

  for (let i = 0; i < copies; i++) {
    await writeChunks(packet);
    await new Promise(r => setTimeout(r, 300));
  }

  log("Printing done");
}

// attempt to auto-detect label by reading a known config characteristic (best-effort)
export async function detectLabel() {
  if (!printer.server) throw new Error("Not connected");
  try {
    // try read from ff00/ff01/ff02 service characteristics (best-effort)
    const candidateSvcs = ['0000ff00-0000-1000-8000-00805f9b34fb','0000ff01-0000-1000-8000-00805f9b34fb','0000ff02-0000-1000-8000-00805f9b34fb'];
    for (const s of candidateSvcs) {
      try {
        const svc = await printer.server.getPrimaryService(s);
        const chars = await svc.getCharacteristics();
        for (const c of chars) {
          try {
            const val = await c.readValue();
            if (val && val.byteLength >= 4) {
              // heuristic: if a byte looks like 12 (mm), use it
              const b0 = val.getUint8(0);
              if (b0 >= 8 && b0 <= 60) {
                printer.settings.labelWidthMM = b0;
                log("Detected label width mm: " + b0);
                return b0;
              }
            }
          } catch (e){}
        }
      } catch (e){}
    }
  } catch (e) {
    log("Detect label failed: " + e);
  }
  return null;
}
