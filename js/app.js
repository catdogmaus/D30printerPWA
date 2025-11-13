// app.js — Phomemo D30C Web Bluetooth

let device, server, service, char;
let logArea;

document.addEventListener("DOMContentLoaded", () => {
  logArea = document.getElementById("log");
  document.getElementById("connect").addEventListener("click", connectPrinter);
  document.getElementById("print").addEventListener("click", handlePrint);
  log("App ready. Click Connect to begin.");
});

function log(msg) {
  const t = new Date().toLocaleTimeString();
  console.log(`[${t}] ${msg}`);
  if (logArea) {
    logArea.value += `[${t}] ${msg}\n`;
    logArea.scrollTop = logArea.scrollHeight;
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

    const uuids = [0xff00, 65280, 65282, 65298];
    for (const u of uuids) {
      try {
        service = await server.getPrimaryService(u);
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            char = c;
            log(`✅ Connected to ${device.name} (${char.uuid})`);
            return;
          }
        }
      } catch (e) {
        log(`No service ${u}`);
      }
    }
    log("❌ No suitable write characteristic found.");
  } catch (e) {
    log("Connection failed: " + e);
  }
}

async function handlePrint() {
  if (!char) {
    log("Please connect to the printer first");
    return;
  }

  const text = document.getElementById("text").value || "Hello D30C";
  const copies = parseInt(document.getElementById("copies").value) || 1;

  log(`🖨️ Printing "${text}" (${copies}x)`);

  const canvas = renderTextCanvas(text);
  const bitmap = canvasToD30(canvas);

  for (let i = 0; i < copies; i++) {
    log(`➡️ Sending job ${i + 1}/${copies}`);
    await sendToPrinter(bitmap);
  }

  log("✅ Printing done");
}

function renderTextCanvas(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 384;
  canvas.height = 96;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

function canvasToD30(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const w = canvas.width;
  const h = canvas.height;
  const bytesPerRow = Math.ceil(w / 8);
  const data = new Uint8Array(bytesPerRow * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const brightness = img.data[i];
      if (brightness < 128) {
        data[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  const wL = w & 0xff;
  const wH = (w >> 8) & 0xff;
  const hL = h & 0xff;
  const hH = (h >> 8) & 0xff;

  const handshake = new Uint8Array([0x1F, 0x10, 0x04, 0x04, 0x00, 0x00, 0x00, 0x00]);
  const header = new Uint8Array([
    0x1F, 0x11, 0x00,
    wL, wH, hL, hH,
    0x00, 0x00, 0x00, 0x00
  ]);
  const trailer = new Uint8Array([0x1F, 0x12, 0x00]);

  const totalLen = handshake.length + header.length + data.length + trailer.length;
  const packet = new Uint8Array(totalLen);
  packet.set(handshake, 0);
  packet.set(header, handshake.length);
  packet.set(data, handshake.length + header.length);
  packet.set(trailer, handshake.length + header.length + data.length);
  return packet;
}

async function sendToPrinter(data) {
  if (!char) throw new Error("No printer characteristic");

  const CHUNK = 128;
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, i + CHUNK);
    if (char.properties.write) {
      await char.writeValue(slice);
    } else {
      await char.writeValueWithoutResponse(slice);
    }
    await new Promise(r => setTimeout(r, 20));
  }
}
