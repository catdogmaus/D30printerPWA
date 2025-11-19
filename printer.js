// printer.js - safe printer module for D30 printing
export const printer = {
  device: null,
  server: null,
  characteristic: null,
  connected: false,
  batteryChar: null,
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
  const la = document.getElementById('logArea');
  if (la) { la.value += `[${new Date().toLocaleTimeString()}] ${msg}\n`; la.scrollTop = la.scrollHeight; }
}

export async function connect() {
  try {
    pushLog("Requesting Bluetooth device...");
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '0000ff00-0000-1000-8000-00805f9b34fb',
        '0000ff01-0000-1000-8000-00805f9b34fb',
        '0000ff02-0000-1000-8000-00805f9b34fb',
        'battery_service'
      ]
    });
    printer.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      pushLog("Device disconnected");
      printer.connected = false;
      printer.characteristic = null;
      printer.batteryChar = null;
      updateConnUI(false);
    });
    printer.server = await device.gatt.connect();
    pushLog("GATT connected");
    
    const services = await printer.server.getPrimaryServices();
    for (const s of services) {
      try {
        if (s.uuid.includes('180f')) continue; 
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            printer.characteristic = c;
            printer.connected = true;
            pushLog(`Using char ${c.uuid}`);
            updateConnUI(true);
          }
        }
      } catch(e) {}
    }

    if (!printer.connected) {
      pushLog("No writable characteristic found");
      return;
    }

    try {
       const battService = await printer.server.getPrimaryService('battery_service');
       const battChar = await battService.getCharacteristic('battery_level');
       printer.batteryChar = battChar;
       await readBattery();
       if (battChar.properties.notify) {
         await battChar.startNotifications();
         battChar.addEventListener('characteristicvaluechanged', readBattery);
       }
    } catch(e) {}

  } catch (e) {
    if (!e.toString().includes("User cancelled")) {
       pushLog("Connect failed: " + e);
    }
    updateConnUI(false);
  }
}

async function readBattery(e) {
  try {
    const val = e ? e.target.value : await printer.batteryChar.readValue();
    const pct = val.getUint8(0);
    const el = document.getElementById('battPercent');
    const wrap = document.getElementById('batteryLevel');
    if (el && wrap) {
      el.textContent = pct + '%';
      wrap.style.display = 'flex';
    }
  } catch(e) {}
}

export async function disconnect() {
  if (printer.device && printer.device.gatt && printer.device.gatt.connected) {
    printer.device.gatt.disconnect();
    printer.connected = false;
    printer.characteristic = null;
    printer.batteryChar = null;
    pushLog("Disconnected");
    updateConnUI(false);
  }
}

function updateConnUI(connected) {
  const el = document.getElementById("connectionStatus");
  if (el) el.textContent = connected ? "Connected" : "Not connected";
  const btn = document.getElementById("connectBtn");
  if (btn) btn.textContent = connected ? "Disconnect" : "Connect";
  const batt = document.getElementById("batteryLevel");
  if (!connected && batt) batt.style.display = 'none';
}

// canvas utilities
export function makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert=false) {
  const widthPx = Math.round(labelWidthMM * dpi);
  const heightPx = Math.round(labelLengthMM * dpi);
  const bytesPerRow = Math.ceil(widthPx / 8);
  const alignedWidth = bytesPerRow * 8;
  const canvas = document.createElement('canvas');
  canvas.width = alignedWidth;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = invert ? "#000000" : "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx, bytesPerRow, widthPx: alignedWidth, heightPx };
}

// --- Frame Drawing Logic ---
function drawFrame(ctx, width, height, style, invert) {
  if (!style || style === 'none') return;
  
  // Safety margin (e.g. 8px approx 1mm)
  const margin = 8; 
  const x = margin;
  const y = margin;
  const w = width - (margin * 2);
  const h = height - (margin * 2);
  
  ctx.save();
  ctx.strokeStyle = invert ? "#FFFFFF" : "#000000";
  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.lineWidth = 4;

  if (style === 'simple') {
    ctx.strokeRect(x, y, w, h);
  } else if (style === 'thick') {
    ctx.lineWidth = 8;
    ctx.strokeRect(x, y, w, h);
  } else if (style === 'rounded') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 20); // 20px radius
    ctx.stroke();
  } else if (style === 'double') {
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
  } else if (style === 'dashed') {
    ctx.setLineDash([15, 10]); // 15px line, 10px gap
    ctx.strokeRect(x, y, w, h);
  } else if (style === 'ticket') {
    // Box with circle cutouts
    ctx.beginPath();
    // Top line
    ctx.moveTo(x + 20, y);
    ctx.lineTo(x + w - 20, y);
    // Right cutout
    ctx.arc(x + w, y + h/2, 15, 1.5*Math.PI, 0.5*Math.PI, true);
    // Bottom line
    ctx.lineTo(x + 20, y + h);
    // Left cutout
    ctx.arc(x, y + h/2, 15, 0.5*Math.PI, 1.5*Math.PI, true);
    ctx.closePath();
    ctx.stroke();
  } else if (style === 'brackets') {
    ctx.lineWidth = 6;
    const len = Math.min(w, h) / 3; // length of bracket leg
    ctx.beginPath();
    // Top-Left
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    // Top-Right
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    // Bottom-Right
    ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
    // Bottom-Left
    ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
    ctx.stroke();
  }
  
  ctx.restore();
}
// ---------------------------

export function renderTextCanvas(text, fontSize=40, alignment='center', invert=false, labelWidthMM=12, labelLengthMM=40, dpi=8, fontFamily='Inter, sans-serif', frameStyle='none') {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);
  
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  
  // DRAW FRAME FIRST (Background layer)
  // Note: Inside this context, Width = HeightPx (label length), Height = WidthPx (label width)
  drawFrame(ctx, heightPx, widthPx, frameStyle, invert);

  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.font = `${fontFamily.includes('bold') ? 'bold ' : ''}${fontSize}px ${fontFamily.replace('bold','').trim()}`;
  ctx.textBaseline = "middle"; 

  const lines = text.split('\n');
  const lineHeight = fontSize * 1.0; 
  const totalBlockHeight = lines.length * lineHeight;

  let x = 0;
  if (alignment === 'left') {
    ctx.textAlign = "left";
    x = 10; 
  } else if (alignment === 'right') {
    ctx.textAlign = "right";
    x = heightPx - 10; 
  } else {
    ctx.textAlign = "center";
    x = heightPx / 2; 
  }

  const startY = (widthPx - totalBlockHeight) / 2;

  lines.forEach((line, i) => {
    const y = startY + (i * lineHeight) + (lineHeight / 2);
    ctx.fillText(line, x, y);
  });

  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx, bakedInvert: true };
}

export function renderImageCanvas(image, threshold=128, invert=false, labelWidthMM=12, labelLengthMM=40, dpi=8, dither=false, rotation=0, scalePct=100) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  
  let srcImage = image;
  if (rotation !== 0) {
     const rotCanvas = document.createElement('canvas');
     if (rotation % 180 !== 0) {
       rotCanvas.width = image.height;
       rotCanvas.height = image.width;
     } else {
       rotCanvas.width = image.width;
       rotCanvas.height = image.height;
     }
     const rctx = rotCanvas.getContext('2d');
     rctx.translate(rotCanvas.width/2, rotCanvas.height/2);
     rctx.rotate(rotation * Math.PI / 180);
     rctx.drawImage(image, -image.width/2, -image.height/2);
     srcImage = rotCanvas;
  }

  let ratio = Math.min(canvas.width / srcImage.width, canvas.height / srcImage.height);
  ratio *= (scalePct / 100);

  const dw = srcImage.width * ratio;
  const dh = srcImage.height * ratio;
  
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(srcImage, (heightPx - dw)/2, (widthPx - dh)/2, dw, dh);
  ctx.restore();

  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  
  if (dither) {
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i+1] = d[i+2] = gray;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const oldPixel = d[i];
        const newPixel = oldPixel < 128 ? 0 : 255;
        d[i] = d[i+1] = d[i+2] = newPixel;
        const quantError = oldPixel - newPixel;
        if (x + 1 < w) d[((y * w + x + 1) * 4)] += quantError * 7 / 16;
        if (x - 1 >= 0 && y + 1 < h) d[(( (y + 1) * w + x - 1) * 4)] += quantError * 3 / 16;
        if (y + 1 < h) d[(( (y + 1) * w + x) * 4)] += quantError * 5 / 16;
        if (x + 1 < w && y + 1 < h) d[(( (y + 1) * w + x + 1) * 4)] += quantError * 1 / 16;
      }
    }
    if (invert) {
       for (let i = 0; i < d.length; i += 4) {
         const v = d[i] === 0 ? 255 : 0;
         d[i] = d[i+1] = d[i+2] = v;
       }
    }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let isDark = gray < threshold;
      let finalVal = 255;
      if (!invert) { if (isDark) finalVal = 0; } 
      else { if (!isDark) finalVal = 0; }
      d[i] = d[i + 1] = d[i + 2] = finalVal;
      d[i + 3] = 255; 
    }
  }
  
  ctx.putImageData(imgData, 0, 0);
  return { canvas, bytesPerRow, widthPx, heightPx, bakedInvert: true };
}

export function renderBarcodeCanvas(value, type='CODE128', scale=2, labelWidthMM=12, labelLengthMM=40, dpi=8) {
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

export async function renderQRCanvas(value, size=256, labelWidthMM=12, labelLengthMM=40, dpi=8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, value, { width: size, margin: 0 });
  const availableW = heightPx; 
  const availableH = widthPx; 
  const scale = Math.min(1, availableW / qrCanvas.width, availableH / qrCanvas.height);
  const dw = qrCanvas.width * scale;
  const dh = qrCanvas.height * scale;
  ctx.save();
  ctx.translate(0, heightPx);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(qrCanvas, (availableW - dw)/2, (availableH - dh)/2, dw, dh);
  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx };
}

export function canvasToBitmap(canvas, bytesPerRow, invert=false) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
    await new Promise(r => setTimeout(r, 20));
  }
}

export async function printCanvasObject(canvasObj, copies = 1, invert = false) {
  if (!printer.characteristic) throw new Error("Not connected");
  const { canvas, bytesPerRow, heightPx, bakedInvert } = canvasObj;
  const effectiveInvert = bakedInvert ? false : invert;
  let bitmap = canvasToBitmap(canvas, bytesPerRow, effectiveInvert);
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
