// app.js — D30C Bluetooth Printer PWA
// Works with Phomemo D30C (ESC/POS-like firmware)

let device, server, service, char;
let logArea, textInput, copiesInput;

// Log helper
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
  if (logArea) {
    logArea.value += `[${ts}] ${msg}\n`;
    logArea.scrollTop = logArea.scrollHeight;
  }
}

// UI initialization
window.addEventListener("DOMContentLoaded", () => {
  logArea = document.getElementById("log");
  textInput = document.getElementById("textInput");
  copiesInput = document.getElementById("copiesInput");

  document.getElementById("connectBtn")?.addEventListener("click", connectPrinter);
  document.getElementById("printBtn")?.addEventListener("click", handlePrint);

  document.querySelectorAll("[data-tab]").forEach(btn =>
    btn.addEventListener("click", e => switchTab(e.target.dataset.tab))
  );

  log("App ready. Click Connect to begin.");
});

// Switch tab view
function switchTab(tabName) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.getElementById(tabName)?.classList.remove("hidden");
}

// Bluetooth connect
async function connectPrinter() {
  log("Requesting Bluetooth device...");
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "D" }],
      optionalServices: [0xff00, 0xff02, 0xff12]
    });

    log(`Connecting to ${device.name || "device"}...`);
    device.addEventListener("gattserverdisconnected", () => log("⚠️ Disconnected"));

    server = await device.gatt.connect();
    const serviceCandidates = [0xff02, 0xff12, 0xff00];
    for (const svc of serviceCandidates) {
      try {
        service = await server.getPrimaryService(svc);
        log(`✅ Found service ${svc}`);
        break;
      } catch (err) {
        log(`No service ${svc}`);
      }
    }
    if (!service) throw new Error("No supported service found");

    // Find characteristic
    const chars = await service.getCharacteristics();
    char = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
    if (!char) throw new Error("No writable characteristic found");

    log(`✅ Connected to ${device.name} (${char.uuid})`);
  } catch (err) {
    log("❌ Connection failed: " + err.message);
  }
}

// Printing handler
async function handlePrint() {
  if (!char) {
    log("⚠️ Please connect to the printer first");
    return;
  }

  const text = textInput?.value?.trim() || "Hello D30C";
  const copies = Math.max(1, parseInt(copiesInput?.value) || 1);
  log(`🖨️ Printing "${text}" (${copies}x)`);

  try {
    const canvas = textToCanvas(text);
    const bitmap = canvasToEscPos(canvas);

    for (let i = 0; i < copies; i++) {
      log(`➡️ Sending job ${i + 1}/${copies}`);
      await sendToPrinter(bitmap);
      await sendToPrinter(new Uint8Array([0x0A])); // line feed
      await new Promise(r => setTimeout(r, 500));
    }

    log("✅ Printing done");
  } catch (err) {
    log("❌ Print failed: " + err.message);
  }
}

// Convert text to canvas (for bitmap conversion)
function textToCanvas(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 384; // typical D30C width in pixels (48mm)
  canvas.height = 80;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = "36px sans-serif";
  const textWidth = ctx.measureText(text).width;
  ctx.fillText(text, (canvas.width - textWidth) / 2, 50);
  return canvas;
}

// Convert canvas to ESC/POS raster bit image command
function canvasToEscPos(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bytesPerRow = Math.ceil(canvas.width / 8);
  const data = new Uint8Array(bytesPerRow * canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const brightness = img.data[i];
      // D30C expects black=1
      if (brightness >= 128)
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  // ESC/POS "GS v 0" raster bit image command
  const wL = bytesPerRow & 0xff;
  const wH = (bytesPerRow >> 8) & 0xff;
  const hL = canvas.height & 0xff;
  const hH = (canvas.height >> 8) & 0xff;
  const header = new Uint8Array([0x1B, 0x40, 0x1D, 0x76, 0x30, 0x00, wL, wH, hL, hH]);
  const full = new Uint8Array(header.length + data.length);
  full.set(header);
  full.set(data, header.length);
  return full;
}

// Send data to printer in 128-byte chunks
async function sendToPrinter(data) {
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
