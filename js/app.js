// app.js — Phomemo D30C (universal Web Bluetooth printer)

let device, server, service, characteristic;
let logBox;

document.addEventListener("DOMContentLoaded", () => {
  logBox = document.getElementById("log");
  document.getElementById("connect").addEventListener("click", connectPrinter);
  document.getElementById("print").addEventListener("click", handlePrint);
  log("App ready. Click Connect to begin.");
});

function log(msg) {
  const t = new Date().toLocaleTimeString();
  console.log(`[${t}] ${msg}`);
  if (logBox) {
    logBox.value += `[${t}] ${msg}\n`;
    logBox.scrollTop = logBox.scrollHeight;
  }
}

async function connectPrinter() {
  try {
    log("Requesting Bluetooth device...");
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "D30" }],
      optionalServices: [0xff00, 65280, 65282, 65298]
    });
    log(`Connecting to ${device.name}...`);
    server = await device.gatt.connect();

    const services = [0xff00, 65280, 65282, 65298];
    for (const s of services) {
      try {
        service = await server.getPrimaryService(s);
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            characteristic = c;
            log(`✅ Connected to ${device.name} (${characteristic.uuid})`);
            return;
          }
        }
      } catch {
        log(`No service ${s}`);
      }
    }
    log("❌ No writable characteristic found.");
  } catch (e) {
    log("Connection failed: " + e);
  }
}

async function handlePrint() {
  if (!characteristic) return log("Please connect to the printer first");

  const text = document.getElementById("text").value || "Hello D30C";
  const copies = parseInt(document.getElementById("copies").value) || 1;
  log(`🖨️ Printing "${text}" (${copies}x)`);

  const canvas = renderText(text);
  const payload = canvasToPhomemo(canvas);

  for (let i = 0; i < copies; i++) {
    log(`➡️ Sending job ${i + 1}/${copies}`);
    await sendPayload(payload);
    await new Promise(r => setTimeout(r, 300));
  }

  log("✅ Printing done");
}

function renderText(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 384;
  canvas.height = 96;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = "bold 42px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

function canvasToPhomemo(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h).data;
  const rowBytes = Math.ceil(w / 8);
  const bitmap = new Uint8Array(rowBytes * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const brightness = img[i];
      if (brightness < 128) bitmap[y * rowBytes + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }

  const wL = w & 0xff, wH = (w >> 8) & 0xff;
  const hL = h & 0xff, hH = (h >> 8) & 0xff;

  const reset = new Uint8Array([0x1B, 0x40]);
  const handshake = new Uint8Array([0x1F, 0x10, 0x04, 0x02, 0x00, 0x00, 0x00, 0x00]);
  const header = new Uint8Array([
    0x1F, 0x11, 0x00,
    wL, wH, hL, hH,
    0x00, 0x00, 0x00, 0x00
  ]);
  const footer = new Uint8Array([0x1F, 0x12, 0x00]);

  const full = new Uint8Array(
    reset.length + handshake.length + header.length + bitmap.length + footer.length
  );
  full.set(reset, 0);
  full.set(handshake, reset.length);
  full.set(header, reset.length + handshake.length);
  full.set(bitmap, reset.length + handshake.length + header.length);
  full.set(footer, reset.length + handshake.length + header.length + bitmap.length);
  return full;
}

async function sendPayload(buf) {
  const CHUNK = 128;
  for (let i = 0; i < buf.length; i += CHUNK) {
    const chunk = buf.slice(i, i + CHUNK);
    try {
      if (characteristic.properties.write)
        await characteristic.writeValue(chunk);
      else
        await characteristic.writeValueWithoutResponse(chunk);
      log(`Sent ${i + chunk.length}/${buf.length}`);
      await new Promise(r => setTimeout(r, 25));
    } catch (e) {
      log("Write error: " + e);
      break;
    }
  }
}
