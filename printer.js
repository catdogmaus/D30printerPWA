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
    // We request battery_service as optional. If device doesn't have it, it won't break connection.
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
    
    // 1. Setup Printing Characteristic
    const services = await printer.server.getPrimaryServices();
    for (const s of services) {
      try {
        if (s.uuid.includes('180f')) continue; // Skip Battery for print search
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

    // 2. Setup Battery Status (Silent Fail)
    try {
       const battService = await printer.server.getPrimaryService('battery_service');
       const battChar = await battService.getCharacteristic('battery_level');
       printer.batteryChar = battChar;
       await readBattery();
       if (battChar.properties.notify) {
         await battChar.startNotifications();
         battChar.addEventListener('characteristicvaluechanged', readBattery);
       }
    } catch(e) {
       // D30 often does not support standard battery service. 
       // We ignore this error so the app keeps working.
       console.log("Battery info not available (expected for D30)");
    }

  } catch (e) {
    pushLog("Connect failed: " + e);
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

export function renderTextCanvas(text, fontSize=40, alignment='center', invert=false, labelWidthMM=12, labelLengthMM=40, dpi=8, fontFamily='Inter, sans-serif') {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);
  ctx.save();
  
  // Rotation: Standard D30 prints along the tape.
  // We rotate -90deg. The new X axis points UP the canvas. The new Y axis points RIGHT.
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  
  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.font = `${fontFamily.includes('bold') ? 'bold ' : ''}${fontSize}px ${fontFamily.replace('bold','').trim()}`;
  
  // We center the text across the WIDTH (12mm) of the label.
  // Since Y axis is now width, we use textBaseline="middle" at y = width/2.
  ctx.textBaseline = "middle";
  const y = widthPx / 2;

  // We align the text lines along the LENGTH (40mm) of the label (X axis).
  // To prevent overlap, we must calculate the start position of the Block,
  // and then draw each line sequentially.
  // We use textAlign="left" (Start) so that the text draws starting exactly at our calculated X.
  // If we used "center", the line would center itself on X, causing misalignment if lines have different lengths.
  ctx.textAlign = "left"; 

  const lines = text.split('\n');
  const lineHeight = fontSize * 1.2;
  const totalTextHeight = lines.length * lineHeight;
  
  // Calculate where the first line begins along the X axis
  let startX = 0;
  
  // Calculate width of the longest line to support 'center' alignment of the BLOCK relative to the page
  // Note: 'alignment' param is user preference (Top/Center/Bottom of label)
  
  if (alignment === 'left') {
     // Top of label
     startX = 10; 
  } else if (alignment === 'right') {
     // Bottom of label
     startX = heightPx - 10 - totalTextHeight;
  } else {
     // Center of label (default)
     startX = (heightPx - totalTextHeight) / 2;
  }

  // Draw each line
  lines.forEach((line, i) => {
    // Check for centering INDIVIDUAL lines within the block?
    // No, usually labels are center-aligned.
    // Since we set textAlign="left", we are drawing from startX.
    // But if the user selected "Center" alignment, they usually expect the text to be centered.
    // Since we are rotating, "Center" alignment usually refers to the vertical placement on the tape (Top/Mid/Bot).
    // But horizontal centering (across the text width) is handled by the fact that X axis IS the text direction.
    
    // Actually, for a truly "Centered" look:
    // We want the text block centered on the label length.
    // AND we want the text lines centered relative to each other.
    
    // Improved Logic: Use textAlign = "center".
    // But then `x` must be the CENTER of the line.
    // So x = startX + (totalTextHeight/2)? No.
    // x = The center point of the label length?
    
    // Let's revert to "center" logic but calculate the anchor correctly.
    
    if (alignment === 'center') {
      ctx.textAlign = "center";
      const centerX = heightPx / 2; // Center of label length
      // Offset to top of the text block
      const blockTop = centerX - (totalTextHeight / 2);
      // Draw
      const lineX = blockTop + (i * lineHeight) + (lineHeight/2); 
      ctx.fillText(line, lineX, y);
    } else {
      // For Left/Right alignment, "left" textAlign makes sense (drawing from start point)
      // But we actually want the text to "flow" correctly.
      // Let's stick to "center" for the text anchor, but shift the anchor position.
      
      ctx.textAlign = "center";
      let blockCenter = 0;
      
      if (alignment === 'left') { // Top of label
         blockCenter = 10 + (totalTextHeight / 2);
      } else if (alignment === 'right') { // Bottom of label
         blockCenter = (heightPx - 10) - (totalTextHeight / 2);
      }
      
      const lineX = (blockCenter - (totalTextHeight / 2)) + (i * lineHeight) + (lineHeight/2);
      ctx.fillText(line, lineX, y);
    }
  });

  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx, bakedInvert: true };
}

export function renderImageCanvas(image, threshold=128, invert=false, labelWidthMM=12, labelLengthMM=40, dpi=8, dither=false) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
  const dw = image.width * ratio;
  const dh = image.height * ratio;
  
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(image, (heightPx - dw)/2, (widthPx - dh)/2, dw, dh);
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
