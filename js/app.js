let device, server, service, char;

// simple logging helper
function log(msg) {
  const box = document.getElementById("logs");
  if (box) {
    box.textContent += msg + "\n";
    box.scrollTop = box.scrollHeight;
  }
  console.log(msg);
}

// connect to D30 printer
async function connect() {
  log("Requesting Bluetooth device...");
  try {
    if (!navigator.bluetooth) {
      log("❌ Web Bluetooth not supported in this browser.");
      return;
    }

    device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "D30" },
        { services: ["0000ff02-0000-1000-8000-00805f9b34fb"] }
      ],
      optionalServices: [
        0xff00,
        0xff01,
        0xff02,
        "0000ff02-0000-1000-8000-00805f9b34fb"
      ]
    });

    log(`Connecting to ${device.name || "Unnamed device"}...`);
    server = await device.gatt.connect();
    await new Promise(r => setTimeout(r, 500)); // Brave delay buffer

    // try to get primary service
    const possible = [
      "0000ff02-0000-1000-8000-00805f9b34fb",
      0xff02,
      0xff00
    ];
    for (const sid of possible) {
      try {
        service = await server.getPrimaryService(sid);
        log(`✅ Found service ${sid}`);
        break;
      } catch (e) {
        log(`No service ${sid}`);
      }
    }

    if (!service) throw new Error("No supported service found");

    const chars = await service.getCharacteristics();
    char = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
    if (!char) throw new Error("No writable characteristic found");

    log(`✅ Connected to ${device.name} (${char.uuid})`);
  } catch (e) {
    log("❌ Connection failed: " + e.message);
  }
}

// write helper
async function writeChunks(characteristic, data) {
  const CHUNK = 180;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    await characteristic.writeValueWithoutResponse(chunk);
    await new Promise(r => setTimeout(r, 10));
  }
}

// convert text → canvas
function textToCanvas(text, widthMm, heightMm, fontPercent) {
  const dpi = 8; // ~203dpi
  const w = widthMm * dpi;
  const h = heightMm * dpi;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = (h * fontPercent) / 100;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillText(text, w / 2, h / 2);

  return canvas;
}

// convert canvas → monochrome bitmap
function canvasToBitmap(canvas) {
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bytesPerRow = Math.ceil(canvas.width / 8);
  const data = new Uint8Array(bytesPerRow * canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const brightness = imgData.data[i]; // red channel
      if (brightness < 128)
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return data;
}

// print handler
async function handlePrint() {
  if (!char) {
    log("⚠️ Please connect to the printer first");
    return;
  }

  const text = document.getElementById("textInput").value || " ";
  const widthMm = parseInt(document.getElementById("labelWidth").value) || 40;
  const heightMm = parseInt(document.getElementById("labelHeight").value) || 12;
  const fontPercent = parseInt(document.getElementById("fontSize").value) || 80;
  const copies = parseInt(document.getElementById("copies").value) || 1;

  const canvas = textToCanvas(text, widthMm, heightMm, fontPercent);
  const preview = document.getElementById("preview");
  if (preview) {
    preview.innerHTML = "";
    preview.appendChild(canvas);
  }

  const bmp = canvasToBitmap(canvas);
  const w = canvas.width;
  const h = canvas.height;

  // proper D30C frame
  const header = new Uint8Array([
    0x1F, 0x11, 0x00,
    w & 0xff, (w >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
    0x00, 0x00, 0x00, 0x00
  ]);
  const tail = new Uint8Array([0x0A, 0x0A, 0x1A, 0x00]);

  try {
    for (let i = 0; i < copies; i++) {
      log(`🖨️ Printing "${text}" (${i + 1}/${copies})`);
      await writeChunks(char, header);
      await writeChunks(char, bmp);
      await writeChunks(char, tail);
    }
    log("✅ Printing done");
  } catch (e) {
    log("❌ Print error: " + e.message);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const connectBtn = document.getElementById("connectBtn");
  const printBtn = document.getElementById("printBtn");
  if (connectBtn) connectBtn.addEventListener("click", connect);
  if (printBtn) printBtn.addEventListener("click", handlePrint);
  log("App ready. Click Connect to begin.");
});
