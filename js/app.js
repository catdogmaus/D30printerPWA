// app.js — Phomemo D30C compatible

let device = null;
let server = null;
let char = null;

const logBox = document.getElementById("logBox");
const connectBtn = document.getElementById("connectBtn");
const printBtn = document.getElementById("printBtn");
const textInput = document.getElementById("textInput");
const copiesInput = document.getElementById("copiesInput");

function log(msg) {
  console.log(msg);
  if (logBox) logBox.value += msg + "\n";
}

// ---------------- CONNECTION ----------------
async function connect() {
  log("Requesting Bluetooth device...");
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "D30" },
        { services: ["0000ff02-0000-1000-8000-00805f9b34fb"] }
      ],
      optionalServices: [0xff00, 0xff01, 0xff02, "0000ff02-0000-1000-8000-00805f9b34fb"]
    });

    log(`Connecting to ${device.name || "Unnamed device"}...`);
    server = await device.gatt.connect();

    await new Promise(r => setTimeout(r, 500)); // stability delay

    let service;
    try {
      service = await server.getPrimaryService("0000ff02-0000-1000-8000-00805f9b34fb");
    } catch (e) {
      log("No service 0000ff02, trying 65282");
      try {
        service = await server.getPrimaryService(0xff02);
      } catch (e2) {
        log("No service 65282, trying 65280");
        service = await server.getPrimaryService(0xff00);
      }
    }

    if (!service) throw new Error("No supported service found");

    const chars = await service.getCharacteristics();
    const writable = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);

    if (!writable) throw new Error("No writable characteristic");
    char = writable;

    log(`✅ Connected to ${device.name} (${char.uuid})`);
  } catch (e) {
    log("❌ Connection failed: " + e.message);
  }
}

// ---------------- PRINTING ----------------
async function handlePrint() {
  if (!char) {
    log("⚠️ Please connect to the printer first");
    return;
  }

  const text = textInput.value || "Hello D30C";
  const copies = Math.max(1, parseInt(copiesInput.value) || 1);
  log(`🖨️ Printing "${text}" (${copies}x)`);

  try {
    const canvas = textToCanvas(text);
    const bitmap = canvasToBitmap(canvas);

    const w = canvas.width;
    const h = canvas.height;

    // Original odensc header format
    const header = new Uint8Array([
      0x1F, 0x11, 0x00,
      w & 0xff, (w >> 8) & 0xff,
      h & 0xff, (h >> 8) & 0xff,
      0x00, 0x00, 0x00, 0x00
    ]);

    const end = new Uint8Array([0x1F, 0x11, 0x02]);

    for (let i = 0; i < copies; i++) {
      log(`➡️ Sending job ${i + 1}/${copies}`);
      await sendToPrinter(header);
      await sendToPrinter(bitmap);
      await sendToPrinter(end);
      await new Promise(r => setTimeout(r, 800));
    }

    log("✅ Printing done");
  } catch (err) {
    log("❌ Print failed: " + err.message);
  }
}

// ---------------- CANVAS UTILITIES ----------------
function textToCanvas(text) {
  const fontSize = 40;
  const padding = 10;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px sans-serif`;

  const textWidth = ctx.measureText(text).width;
  canvas.width = textWidth + padding * 2;
  canvas.height = fontSize + padding * 2;

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.textBaseline = "top";
  ctx.fillText(text, padding, padding);

  return canvas;
}

// Bottom-up row order (needed for D30C)
function canvasToBitmap(canvas) {
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bytesPerRow = Math.ceil(canvas.width / 8);
  const data = new Uint8Array(bytesPerRow * canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    const destY = canvas.height - 1 - y;
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const brightness = imgData.data[i];
      const bitIndex = 7 - (x & 7);
      if (brightness < 128)
        data[destY * bytesPerRow + (x >> 3)] |= 1 << bitIndex;
    }
  }
  return data;
}

// ---------------- BLUETOOTH SENDER ----------------
async function sendToPrinter(data) {
  const CHUNK = 128; // from odensc
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, i + CHUNK);
    if (char.properties.write) {
      await char.writeValue(slice); // with response
    } else {
      await char.writeValueWithoutResponse(slice);
    }
    await new Promise(r => setTimeout(r, 20));
  }
}

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", () => {
  log("App ready. Click Connect to begin.");
  connectBtn?.addEventListener("click", connect);
  printBtn?.addEventListener("click", handlePrint);
});
