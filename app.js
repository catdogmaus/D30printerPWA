// app.js — Phomemo D30C Web Bluetooth (stable build)
// Orientation: text is rotated INSIDE canvas (bitmap orientation remains native)
// Features: invert colors, preview, copies, stable chunking

let device = null;
let server = null;
let characteristic = null;

// ---- Label defaults ----
const DEFAULT_LABEL_WIDTH_MM = 12;   // 12 mm label width
const DEFAULT_LABEL_HEIGHT_MM = 40;  // 40 mm label length
const DPI_MM = 8; // ~203 DPI → 8 px/mm

const CHUNK_SIZE = 128;
const CHUNK_DELAY_MS = 20;

// ---------------- LOG ----------------
function log(msg) {
  const el = document.getElementById("log");
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}\n`;
  if (el) {
    el.value += line;
    el.scrollTop = el.scrollHeight;
  }
  console.log(line.trim());
}

// ---------------- CONNECT ----------------
async function connectPrinter() {
  log("Requesting Bluetooth device...");

  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "D30" }],
      optionalServices: [
        "0000ff00-0000-1000-8000-00805f9b34fb",
        "0000ff01-0000-1000-8000-00805f9b34fb",
        "0000ff02-0000-1000-8000-00805f9b34fb"
      ]
    });

    log(`Connecting to ${device.name}...`);

    device.addEventListener("gattserverdisconnected", () => {
      log("⚠️ Disconnected");
      characteristic = null;
    });

    server = await device.gatt.connect();

    const services = await server.getPrimaryServices();
    for (const svc of services) {
      try {
        const chars = await svc.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            characteristic = c;
            log(
              `✅ Connected (write:${c.properties.write}, wowr:${c.properties.writeWithoutResponse})`
            );
            return;
          }
        }
      } catch (_) {}
    }

    log("❌ No writable characteristic found.");
  } catch (err) {
    log("Connection failed: " + err);
  }
}

// ---------------- CANVAS RENDERING ----------------

// Text is rotated 90° CCW INSIDE the raster.
// The raster bitmap remains UNROTATED (printer requirement).
function renderTextCanvas(text, invert = false) {
  const widthPx = Math.round(DEFAULT_LABEL_WIDTH_MM * DPI_MM);   // ≈96px
  const heightPx = Math.round(DEFAULT_LABEL_HEIGHT_MM * DPI_MM); // ≈320px

  const bytesPerRow = Math.ceil(widthPx / 8);
  const alignedWidth = bytesPerRow * 8;

  const canvas = document.createElement("canvas");
  canvas.width = alignedWidth;
  canvas.height = heightPx;

  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Rotate drawing context (CCW)
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);

  // Black text
  const fontSize = Math.floor(alignedWidth * 0.8);
  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Draw rotated text
  ctx.fillText(text, heightPx / 2, alignedWidth / 2);

  ctx.restore();

  return { canvas, bytesPerRow, widthPx: alignedWidth, heightPx };
}

// Convert canvas to 1-bit raster MSB-first (printer format)
function canvasToBitmap(canvas, bytesPerRow, invert = false) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const img = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(bytesPerRow * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = img[idx]; // grayscale ok

      let isBlack = r < 128;
      if (invert) isBlack = !isBlack;

      if (isBlack) {
        out[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  return out;
}

// ---------------- BUILD PACKET ----------------
function buildPacket(bitmap, bytesPerRow, heightPx) {
  const reset = new Uint8Array([0x1B, 0x40]); // ESC @

  const header = new Uint8Array([
    0x1D, 0x76, 0x30, 0x00,
    bytesPerRow & 0xFF,
    (bytesPerRow >> 8) & 0xFF,
    heightPx & 0xFF,
    (heightPx >> 8) & 0xFF
  ]);

  const footer = new Uint8Array([0x1B, 0x64, 0x00]); // ESC d 0

  const out = new Uint8Array(reset.length + header.length + bitmap.length + footer.length);
  let p = 0;
  out.set(reset, p); p += reset.length;
  out.set(header, p); p += header.length;
  out.set(bitmap, p); p += bitmap.length;
  out.set(footer, p);

  return out;
}

// ---------------- CHUNKED WRITE ----------------
async function writeChunks(u8) {
  for (let i = 0; i < u8.length; i += CHUNK_SIZE) {
    const slice = u8.slice(i, i + CHUNK_SIZE);

    if (characteristic.properties.write) {
      await characteristic.writeValue(slice);
    } else {
      await characteristic.writeValueWithoutResponse(slice);
    }

    log(`Sent ${Math.min(i + CHUNK_SIZE, u8.length)}/${u8.length}`);
    await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
  }
}

// ---------------- PRINTING ----------------
async function handlePrint() {
  if (!characteristic) {
    log("Please connect first.");
    return;
  }

  const text = document.getElementById("text").value.trim() || "Hello";
  const copies = Math.max(1, parseInt(document.getElementById("copies").value) || 1);
  const invert = document.getElementById("invert")?.checked || false;

  log(`🖨️ Printing "${text}" (${copies}×), invert=${invert}`);

  const { canvas, bytesPerRow, heightPx } = renderTextCanvas(text, invert);

  // preview
  const preview = document.getElementById("preview");
  if (preview) {
    preview.innerHTML = "";
    preview.appendChild(canvas);
  }

  const bitmap = canvasToBitmap(canvas, bytesPerRow, invert);

  const packet = buildPacket(bitmap, bytesPerRow, heightPx);

  for (let i = 0; i < copies; i++) {
    log(`➡️ Sending job ${i + 1}/${copies}`);
    await writeChunks(packet);
    await new Promise(r => setTimeout(r, 400));
  }

  log("✅ Printing done");
}

// ---------------- INIT ----------------
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("connect").addEventListener("click", connectPrinter);
  document.getElementById("print").addEventListener("click", handlePrint);

  log("App ready. Click Connect to begin.");
});
