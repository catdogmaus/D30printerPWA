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

function drawFrame(ctx, width, height, style, invert) {
  if (!style || style === 'none') return;
  const marginX = 16; const marginY = 8;  
  const x = marginX; const y = marginY;
  const w = width - (marginX * 2); const h = height - (marginY * 2);
  
  ctx.save();
  ctx.strokeStyle = invert ? "#FFFFFF" : "#000000";
  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.lineWidth = 4;

  if (style === 'simple') ctx.strokeRect(x, y, w, h);
  else if (style === 'thick') { ctx.lineWidth = 8; ctx.strokeRect(x, y, w, h); }
  else if (style === 'rounded') { ctx.beginPath(); ctx.roundRect(x, y, w, h, 20); ctx.stroke(); }
  else if (style === 'double') { ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); ctx.strokeRect(x + 6, y + 6, w - 12, h - 12); }
  else if (style === 'dashed') { ctx.setLineDash([15, 10]); ctx.strokeRect(x, y, w, h); }
  else if (style === 'ticket') {
    const r = 15; ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h/2 - r);
    ctx.arc(x + w, y + h/2, r, 1.5 * Math.PI, 0.5 * Math.PI, true);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h/2 + r);
    ctx.arc(x, y + h/2, r, 0.5 * Math.PI, 1.5 * Math.PI, true);
    ctx.closePath(); ctx.stroke();
  } else if (style === 'cut_corners' || style === 'cut_corners_double') {
      const r = 15; 
      const drawPath = (inset) => {
         const ix = x + inset; const iy = y + inset; const iw = w - 2*inset; const ih = h - 2*inset;
         ctx.beginPath(); ctx.moveTo(ix + r, iy); ctx.lineTo(ix + iw - r, iy);
         ctx.arc(ix + iw, iy, r, Math.PI, 0.5*Math.PI, true); 
         ctx.lineTo(ix + iw, iy + ih - r); ctx.arc(ix + iw, iy + ih, r, 1.5*Math.PI, Math.PI, true); 
         ctx.lineTo(ix + r, iy + ih); ctx.arc(ix, iy + ih, r, 0, 1.5*Math.PI, true); 
         ctx.lineTo(ix, iy + r); ctx.arc(ix, iy, r, 0.5*Math.PI, 0, true); 
         ctx.closePath(); ctx.stroke();
      };
      if (style === 'cut_corners') { ctx.lineWidth = 4; drawPath(0); } 
      else { ctx.lineWidth = 6; drawPath(0); ctx.lineWidth = 2; drawPath(6); }
  } else if (style === 'brackets') {
    ctx.lineWidth = 6; const len = Math.min(w, h) / 3; 
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
    ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderTextCanvas(text, fontSize=40, alignment='center', invert=false, labelWidthMM=12, labelLengthMM=40, dpi=8, fontFamily='Inter, sans-serif', frameStyle='none') {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  drawFrame(ctx, heightPx, widthPx, frameStyle, invert);
  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  ctx.font = `${fontFamily.includes('bold') ? 'bold ' : ''}${fontSize}px ${fontFamily.replace('bold','').trim()}`;
  ctx.textBaseline = "middle"; 
  const lines = text.split('\n');
  const lineHeight = fontSize * 1.0; 
  const totalBlockHeight = lines.length * lineHeight;
  let x = 0;
  if (alignment === 'left') { ctx.textAlign = "left"; x = 10; } 
  else if (alignment === 'right') { ctx.textAlign = "right"; x = heightPx - 10; } 
  else { ctx.textAlign = "center"; x = heightPx / 2; }
  const startY = (widthPx - totalBlockHeight) / 2 + 2;
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
     if (rotation % 180 !== 0) { rotCanvas.width = image.height; rotCanvas.height = image.width; } 
     else { rotCanvas.width = image.width; rotCanvas.height = image.height; }
     const rctx = rotCanvas.getContext('2d');
     rctx.translate(rotCanvas.width/2, rotCanvas.height/2);
     rctx.rotate(rotation * Math.PI / 180);
     rctx.drawImage(image, -image.width/2, -image.height/2);
     srcImage = rotCanvas;
  }
  let ratio = Math.min(canvas.width / srcImage.width, canvas.height / srcImage.height);
  ratio *= (scalePct / 100);
  const dw = srcImage.width * ratio; const dh = srcImage.height * ratio;
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(srcImage, (heightPx - dw)/2, (widthPx - dh)/2, dw, dh);
  ctx.restore();
  const w = canvas.width; const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  if (dither) {
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i+1] = d[i+2] = gray;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4; const oldPixel = d[i];
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
       for (let i = 0; i < d.length; i += 4) { const v = d[i] === 0 ? 255 : 0; d[i] = d[i+1] = d[i+2] = v; }
    }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let isDark = gray < threshold; let finalVal = 255;
      if (!invert) { if (isDark) finalVal = 0; } else { if (!isDark) finalVal = 0; }
      d[i] = d[i + 1] = d[i + 2] = finalVal; d[i + 3] = 255; 
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

export async function renderQRCanvas(value, typeOrSize='M', size=70, labelWidthMM=12, labelLengthMM=40, dpi=8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  const qrCanvas = document.createElement('canvas');
  
  if (typeOrSize === 'AZTEC') {
    try {
      bwipjs.toCanvas(qrCanvas, { bcid: 'azteccode', text: value, scale: 4, includetext: false });
    } catch (e) { console.warn('Aztec error', e); }
  } else {
    await QRCode.toCanvas(qrCanvas, value, { errorCorrectionLevel: typeOrSize, margin: 0 });
  }

  const availableW = heightPx; 
  const availableH = widthPx; 
  
  const targetSize = size;
  const fitScale = Math.min(availableW / qrCanvas.width, availableH / qrCanvas.height);
  const requestedScale = targetSize / qrCanvas.width;
  const scale = Math.min(fitScale, requestedScale);
  
  const dw = qrCanvas.width * scale;
  const dh = qrCanvas.height * scale;
  
  ctx.save();
  ctx.translate(0, heightPx);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(qrCanvas, (availableW - dw)/2, (availableH - dh)/2, dw, dh);
  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx };
}

export async function renderCombinedCanvas(data, labelWidthMM, labelLengthMM, dpi) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  
  const mx = 16; 
  const visW = heightPx - (2*mx); 
  const visH = widthPx; 
  
  const slots = { left: false, right: false };
  ['text','image','barcode','qr'].forEach(k => {
      if (data[k].enabled) {
          if (data[k].pos === 'left') slots.left = true;
          if (data[k].pos === 'right') slots.right = true;
      }
  });

  const lx = mx; 
  const lw = slots.left ? visW * 0.25 : 0;
  const rw = slots.right ? visW * 0.25 : 0;
  const rx = mx + visW - rw;
  
  const sx = lx + lw;
  const sw = visW - lw - rw;
  
  const getRect = (pos) => {
    if (pos === 'left') return { x: lx, y: 0, w: lw, h: visH };
    if (pos === 'right') return { x: rx, y: 0, w: rw, h: visH };
    if (pos === 'top')    return { x: sx, y: 0, w: sw, h: visH * 0.25 };
    if (pos === 'bottom') return { x: sx, y: visH * 0.75, w: sw, h: visH * 0.25 };
    
    let topUsed = false; let botUsed = false;
    ['text','image','barcode','qr'].forEach(k => {
        if (data[k].enabled) {
            if (data[k].pos === 'top') topUsed = true;
            if (data[k].pos === 'bottom') botUsed = true;
        }
    });
    const cy = topUsed ? visH * 0.25 : 0;
    const ch = visH - (topUsed ? visH*0.25 : 0) - (botUsed ? visH*0.25 : 0);
    if (pos === 'center') return { x: sx, y: cy, w: sw, h: ch };
    return { x: 0, y: 0, w: 0, h: 0 };
  };

  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  
  const drawOrder = ['center', 'left', 'right', 'top', 'bottom'];
  
  for (const pos of drawOrder) {
    const rect = getRect(pos);
    if (rect.w <= 0 || rect.h <= 0) continue;

    // 1. DRAW IMAGE FIRST (Background layer)
    if (data.image.enabled && data.image.pos === pos && data.image.img) {
        let img = data.image.img;
        if (data.image.rotation !== 0) {
             const rotCanvas = document.createElement('canvas');
             if (data.image.rotation % 180 !== 0) { rotCanvas.width = img.height; rotCanvas.height = img.width; } 
             else { rotCanvas.width = img.width; rotCanvas.height = img.height; }
             const rctx = rotCanvas.getContext('2d');
             rctx.translate(rotCanvas.width/2, rotCanvas.height/2);
             rctx.rotate(data.image.rotation * Math.PI / 180);
             rctx.drawImage(img, -img.width/2, -img.height/2);
             img = rotCanvas;
        }

        let ratio = Math.min(rect.w / img.width, rect.h / img.height);
        ratio *= (data.image.scalePct / 100);
        const dw = img.width * ratio;
        const dh = img.height * ratio;
        const dx = rect.x + (rect.w - dw)/2;
        const dy = rect.y + (rect.h - dh)/2;
        ctx.drawImage(img, dx, dy, dw, dh);
        
        const iData = ctx.getImageData(dx, dy, dw, dh);
        const dd = iData.data;
        
        if (data.image.dither) {
            for (let i=0; i<dd.length; i+=4) {
                const g = 0.299*dd[i] + 0.587*dd[i+1] + 0.114*dd[i+2];
                dd[i]=dd[i+1]=dd[i+2]=g;
            }
            const iw = iData.width; const ih = iData.height;
            for(let y=0; y<ih; y++){
                for(let x=0; x<iw; x++){
                    const i = (y*iw + x)*4;
                    const oldP = dd[i];
                    const newP = oldP < 128 ? 0 : 255;
                    dd[i]=dd[i+1]=dd[i+2]=newP;
                    const err = oldP - newP;
                    if(x+1<iw) dd[((y*iw+x+1)*4)] += err*7/16;
                    if(x-1>=0 && y+1<ih) dd[(((y+1)*iw+x-1)*4)] += err*3/16;
                    if(y+1<ih) dd[(((y+1)*iw+x)*4)] += err*5/16;
                    if(x+1<iw && y+1<ih) dd[(((y+1)*iw+x+1)*4)] += err*1/16;
                }
            }
        } else {
            for(let i=0; i<dd.length; i+=4) {
                const g = 0.299*dd[i] + 0.587*dd[i+1] + 0.114*dd[i+2];
                const v = g < data.image.threshold ? 0 : 255;
                dd[i]=dd[i+1]=dd[i+2]=v;
            }
        }
        
        if (data.image.invert) {
            for(let i=0; i<dd.length; i+=4) {
                const v = dd[i] === 0 ? 255 : 0;
                dd[i]=dd[i+1]=dd[i+2]=v;
            }
        }
        ctx.putImageData(iData, dx, dy);
    }
    
    // 2. DRAW BARCODES
    if (data.barcode.enabled && data.barcode.pos === pos) {
        const bcCanvas = document.createElement('canvas');
        try {
            JsBarcode(bcCanvas, data.barcode.val, { format: 'CODE128', displayValue: false, width: data.barcode.scale, margin:0 });
            const ratio = Math.min(rect.w / bcCanvas.width, rect.h / bcCanvas.height);
            const dw = bcCanvas.width * ratio;
            const dh = bcCanvas.height * ratio;
            ctx.drawImage(bcCanvas, rect.x + (rect.w - dw)/2, rect.y + (rect.h - dh)/2, dw, dh);
        } catch(e) {}
    }
    
    // 3. DRAW QR/AZTEC
    if (data.qr.enabled && data.qr.pos === pos) {
        const qCanvas = document.createElement('canvas');
        if (data.qr.type === 'AZTEC') {
             try { bwipjs.toCanvas(qCanvas, { bcid: 'azteccode', text: data.qr.val, scale: 4, includetext: false }); } catch(e){}
        } else {
             await QRCode.toCanvas(qCanvas, data.qr.val, { errorCorrectionLevel: data.qr.type, margin: 0 });
        }
        
        const targetSize = data.qr.size;
        const fitScale = Math.min(rect.w / qCanvas.width, rect.h / qCanvas.height);
        const reqScale = targetSize / qCanvas.width;
        const scale = Math.min(fitScale, reqScale);
        
        const dw = qCanvas.width * scale;
        const dh = qCanvas.height * scale;
        ctx.drawImage(qCanvas, rect.x + (rect.w - dw)/2, rect.y + (rect.h - dh)/2, dw, dh);
    }

    // 4. DRAW TEXT LAST (Foreground layer)
    if (data.text.enabled && data.text.pos === pos) {
       ctx.save();
       ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
       ctx.fillStyle = "#000000";
       ctx.font = `${data.text.bold?'bold ':''}${data.text.fontSize}px ${data.text.fontFamily}`;
       ctx.textBaseline = "middle"; ctx.textAlign = "center";
       ctx.fillText(data.text.val, rect.x + rect.w/2, rect.y + rect.h/2);
       ctx.restore();
    }
  }

  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx, bakedInvert: true };
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
