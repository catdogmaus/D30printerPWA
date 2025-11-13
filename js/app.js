let device, server, service, char;

function log(msg) {
  const box = document.getElementById("logs");
  box.textContent += msg + "\n";
  box.scrollTop = box.scrollHeight;
  console.log(msg);
}

document.getElementById("connectBtn").addEventListener("click", connect);
document.getElementById("printBtn").addEventListener("click", handlePrint);

async function connect() {
  log("Requesting Bluetooth device...");
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [0xff00] }]
    });
    log(`Connecting to ${device.name}...`);
    server = await device.gatt.connect();
    service = await server.getPrimaryService(0xff00);
    char = await service.getCharacteristic(0xff02);
    log(`Connected to ${device.name}`);
  } catch (e) {
    log("Connection failed: " + e);
  }
}

async function writeChunks(characteristic, data) {
  const CHUNK = 180;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    await characteristic.writeValueWithoutResponse(chunk);
    await new Promise(r => setTimeout(r, 10));
  }
}

function textToCanvas(text, widthMm, heightMm, fontPercent) {
  const dpi = 8; // ~203 dpi
  const w = widthMm * dpi;
  const h = heightMm * dpi;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFF";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = (h * fontPercent) / 100;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillText(text, w / 2, h / 2);
  return canvas;
}

function canvasToBitmap(canvas) {
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bytesPerRow = Math.ceil(canvas.width / 8);
  const data = new Uint8Array(bytesPerRow * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const brightness = imgData.data[i];
      if (brightness < 128) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return data;
}

async function handlePrint() {
  if (!char) return log("Please connect first");
  const text = document.getElementById("textInput").value || " ";
  const widthMm = parseInt(document.getElementById("labelWidth").value);
  const heightMm = parseInt(document.getElementById("labelHeight").value);
  const fontPercent = parseInt(document.getElementById("fontSize").value);
  const copies = parseInt(document.getElementById("copies").value);

  const canvas = textToCanvas(text, widthMm, heightMm, fontPercent);
  const preview = document.getElementById("preview");
  preview.innerHTML = "";
  preview.appendChild(canvas);

  const bmp = canvasToBitmap(canvas);
  const w = canvas.width;
  const h = canvas.height;

  const header = new Uint8Array([
    0x1B, 0x40, 0x1F, 0x11, 0x00,
    w & 0xff, (w >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff
  ]);
  const tail = new Uint8Array([0x1A, 0x0A, 0x0A, 0x04]);

  try {
    for (let i = 0; i < copies; i++) {
      log(`Printing "${text}" (${i + 1}/${copies})`);
      await writeChunks(char, header);
      await writeChunks(char, bmp);
      await writeChunks(char, tail);
    }
    log("Printing done");
  } catch (e) {
    log("Print error: " + e);
  }
}
