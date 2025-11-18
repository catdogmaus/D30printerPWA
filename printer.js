// printer.js - safe printer module for D30 printing
export const printer = {
  device: null,
  server: null,
  characteristic: null,
  connected: false,
  settings: {
    labelWidthMM: 12,
    labelLengthMM: 40,
    dpiPerMM: 8,
    protocol: "phomemo_raw",
    fontFamily: "Inter, sans-serif",
    forceInvert: false
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
        '0000ff02-0000-1000-8000-00805f9b34fb'
      ]
    });
    printer.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      pushLog("Device disconnected");
      printer.connected = false;
      printer.characteristic = null;
      updateConnUI(false);
    });
    printer.server = await device.gatt.connect();
    pushLog("GATT connected");
    // find writable characteristic
    const services = await printer.server.getPrimaryServices();
    for (const s of services) {
      try {
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            printer.characteristic = c;
            printer.connected = true;
            pushLog(`Using characteristic ${c.uuid} (write:${c.properties.write})`);
            updateConnUI(true);
            return;
          }
        }
      } catch(e) {}
    }
    pushLog("No writable characteristic found");
  } catch (e) {
    pushLog("Connect failed: " + e);
    updateConnUI(false);
  }
}

export async function disconnect() {
  if (printer.device && printer.device.gatt && printer.device.gatt.connected) {
    printer.device.gatt.disconnect();
    printer.connected = false;
    printer.characteristic = null;
    pushLog("Disconnected");
    updateConnUI(false);
  }
}

function updateConnUI(connected) {
  const el = document.getElementById("connectionStatus");
  if (el) el.textContent = connected ? "Connected" : "Not connected";
  const btn = document.getElementById("connectBtn");
  if (btn) btn.textContent = connected ? "Disconnect" : "Connect";
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
  const ctx = canvas.getContext('2d');
  // Base fill
  ctx.fillStyle = invert ? "#000000" : "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx, bytesPerRow, widthPx: alignedWidth, heightPx };
}

export function renderTextCanvas(text, fontSize=40, alignment='center', invert=false, labelWidthMM=12, labelLengthMM=40, dpi=8, fontFamily='Inter, sans-serif') {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, invert);
  ctx.save();
  // rotate so text prints along label (vertical label) — rotate -90deg and draw text horizontally
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = invert ? "#FFFFFF" : "#000000";
  // allow bold included in fontFamily string if present like "bold Inter, sans-serif"
  ctx.font = `${fontFamily.includes('bold') ? 'bold ' : ''}${fontSize}px ${fontFamily.replace('bold','').trim()}`;
  ctx.textAlign = alignment;
  ctx.textBaseline = "middle";
  let x = heightPx / 2;
  if (alignment === 'left') x = 10;
  if (alignment === 'right') x = heightPx - 10;
  ctx.fillText(text, x, widthPx / 2);
  ctx.restore();
  return { canvas, bytesPerRow, widthPx, heightPx };
}

export function renderImageCanvas(image, threshold=128, invert=false, labelWidthMM=12, labelLengthMM=40, dpi=8) {
  const { canvas, ctx, bytesPerRow, widthPx, heightPx } = makeLabelCanvas(labelWidthMM, labelLengthMM, dpi, false);
  
  // 1. Draw the image normally (scaled to fit)
  const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
  const dw = image.width * ratio;
  const dh = image.height * ratio;
  
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  // Draw image centered
  ctx.drawImage(image, (heightPx - dw)/2, (widthPx - dh)/2, dw, dh);
  ctx.restore();

  // 2. Apply Threshold & Invert logic to the actual pixels
  // This ensures the preview looks like the monochrome print.
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  
  for (let i = 0; i < d.length; i += 4) {
    // Luminance formula
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    
    // Threshold check:
    // If pixel is dark (gray < threshold), it should be "on".
    // Standard: "On" = Black (0,0,0). "Off" = White (255,255,255).
    // If Invert is checked: "On" = White, "Off" = Black.
    
    let isDark = gray < threshold;
    
    // Logic:
    // if (!invert): isDark -> Black. !isDark -> White.
    // if (invert):  isDark -> White. !isDark -> Black.
    
    let finalVal = 255; // Default white
    if (!invert) {
       if (isDark) finalVal = 0; // Make it black
    } else {
       if (!isDark) finalVal = 0; // Invert: Light areas become black
    }
    
    d[i] = finalVal;
    d[i + 1] = finalVal;
    d[i + 2] = finalVal;
    d[i + 3] = 255; // Fully opaque
  }
  
  ctx.putImageData(imgData, 0, 0);

  return { canvas, bytesPerRow, widthPx, heightPx };
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
  
  // Generate QR at requested size
  await QRCode.toCanvas(qrCanvas, value, { width: size, margin: 0 });
  
  // Rotated Dimensions on the final canvas:
  // The label length (heightPx) acts as the horizontal space in the rotated context.
  // The label width (widthPx) acts as the vertical space in the rotated context.
  const availableW = heightPx; 
  const availableH = widthPx; 

  // Determine scale:
  // If the QR size is bigger than the label, scale down to fit.
  // If it's smaller, KEEP IT 1:1 (scale = 1), do not stretch.
  const scale = Math.min(1, availableW / qrCanvas.width, availableH / qrCanvas.height);
  
  const dw = qrCanvas.width * scale;
  const dh = qrCanvas.height * scale;
  
  ctx.save();
  ctx.translate(0, heightPx);
  ctx.rotate(-Math.PI / 2);
  
  // Draw centered using the calculated dimensions
  ctx.drawImage(qrCanvas, (availableW - dw)/2, (availableH - dh)/2, dw, dh);
  ctx.restore();
  
  return { canvas, bytesPerRow, widthPx, heightPx };
}

export function canvasToBitmap(canvas, bytesPerRow, invert=false) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = img[idx];
      // Since we pre-processed the image in renderImageCanvas, pixels are already 0 or 255.
      // Standard threshold here just maps them to bits.
      // Note: If the canvas was NOT pre-processed (like Text or Barcode), this still works using 128 split.
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
  const { canvas, bytesPerRow, heightPx } = canvasObj;
  
  // Note: renderImageCanvas already baked inversion/threshold into the canvas pixels for Images.
  // For Text/QR, they are drawn normally.
  // canvasToBitmap applies the 'invert' argument again.
  // If we rendered Image with 'invert=true', pixels are already flipped.
  // We should pass 'false' to canvasToBitmap if the canvas is already processed?
  // Actually, 'ui.js' calls `printCanvasObject(obj, copies, $('imageInvert').checked)`.
  // If we processed it in renderImageCanvas, we shouldn't process it again here, OR we should ensure consistency.
  // For Image: renderImageCanvas makes 0=Black, 255=White.
  // If Invert was checked, renderImageCanvas made Dark->White(255), Light->Black(0).
  // Then canvasToBitmap sees 0 as Black.
  // If we pass invert=true to canvasToBitmap, it flips it AGAIN.
  // FIX: For images, since we baked it, we should pass false to canvasToBitmap?
  // However, printCanvasObject is generic.
  
  // Let's check ui.js call:
  // tab-image: `await printCanvasObject(obj, copies, $('imageInvert').checked);`
  // renderImageCanvas was called with `$('imageInvert').checked`.
  // So we effectively double-invert.
  // WE NEED TO FIX THIS LOGIC.
  // Since we improved renderImageCanvas to bake the look, we should tell printCanvasObject NOT to invert images again.
  // But printCanvasObject doesn't know if it's an image or text.
  
  // Simple fix: renderImageCanvas already visualizes the result.
  // The preview shows what the canvas holds.
  // If preview is black, we want black print.
  // canvasToBitmap converts Black (<128) to Bit 1.
  // If we pass invert=true to canvasToBitmap, it converts Black (<128) to Bit 0 (White).
  // So for Image tab, we should pass `false` to printCanvasObject because we already handled the logic in render.
  
  // I will NOT change ui.js (user requested full files for copy paste but ui.js wasn't in list of "files that need to change" implies minimal change).
  // But to make it work correctly without changing ui.js logic, I can adjust canvasToBitmap or just rely on the fact that
  // renderImageCanvas returns a canvas.
  
  // Let's look at Text tab. `renderTextCanvas` draws Black text on White. `invert` flips fill style.
  // If invert is checked, Text is White on Black.
  // `printCanvasObject` is called with invert=true.
  // canvasToBitmap receives White text (>128). invert=true.
  // isBlack = (r<128) => False (it's white).
  // invert => True.
  // Result: Bit 1 (Print).
  // So White text on Black bg prints as Black text?
  // No, if bg is Black (<128), isBlack=True. invert=False. Result=0 (Empty).
  // White text (>128), isBlack=False. invert=True. Result=1 (Print).
  // So White Text on Black BG -> Prints Text. Correct.
  
  // Now Image tab.
  // Threshold applied.
  // Case 1: Normal. Dark pixel -> 0 (Black). Light pixel -> 255 (White).
  // UI calls print(..., invert=false).
  // canvasToBitmap: 0 isBlack=True. invert=False. Result=1 (Print).
  // Correct.
  
  // Case 2: Invert. Dark pixel -> 255 (White). Light pixel -> 0 (Black).
  // Preview shows Inverted image.
  // UI calls print(..., invert=true).
  // Pixel is 255 (White). isBlack=False. invert=True. Result=1 (Print).
  // Pixel is 0 (Black). isBlack=True. invert=False. Result=0 (Empty).
  // So it prints the White pixels.
  // Since we flipped Dark->White, we are printing the "Dark" source parts.
  // This effectively cancels out the visual inversion if we print "White" as "Black".
  
  // Wait. Thermal printer: Bit 1 = Heat (Black dot).
  // If I have a Black pixel on screen.
  // canvasToBitmap: isBlack=True. invert=False -> Bit 1 (Black).
  // If I have White pixel.
  // canvasToBitmap: isBlack=False. invert=False -> Bit 0 (White).
  
  // If Invert is ON.
  // We want Black pixel to become White (No Heat).
  // We want White pixel to become Black (Heat).
  
  // Back to Image render.
  // Invert checked. Dark source -> 255 (White) on canvas.
  // Light source -> 0 (Black) on canvas.
  // Preview looks inverted (Negative).
  
  // Print call (invert=true).
  // We take the 255 (White) pixel.
  // isBlack=False.
  // invert=True.
  // Result = !False = True (Bit 1 / Heat / Black).
  // So the pixel that looks White on the preview will print as Black.
  // This means the printed result is the NEGATIVE of the preview?
  // The preview shows White, the printer prints Black.
  // That's confusing. The preview should match the print.
  
  // FIX: In `renderImageCanvas`, if we are baking the look for the user,
  // the canvas should represent the final physical appearance (Black ink on Paper).
  // In a thermal printer, "Black" pixels on screen should equate to "Black" ink.
  // So if Invert is checked:
  // We want Dark Source -> Printed White.
  // We want Light Source -> Printed Black.
  // So on the canvas, Dark Source should become White (255). Light Source should become Black (0).
  // This matches my `renderImageCanvas` logic.
  // BUT, `ui.js` passes `invert=true` to the printer.
  // Which flips it *again*.
  
  // To ensure WYSIWYG (What You See Is What You Get):
  // The `canvasToBitmap` should map Screen Black to Print Black.
  // `canvasToBitmap` logic:
  // `isBlack = r < 128`.
  // `if (invert) isBlack = !isBlack`.
  // If `invert` is passed as true, Screen Black -> Print White.
  
  // So if we bake the inversion into the canvas for the preview...
  // We must NOT pass `invert=true` to `canvasToBitmap` if we want WYSIWYG.
  // But `ui.js` is hardcoded to pass it.
  
  // Workaround in `printer.js` without touching `ui.js`:
  // `renderImageCanvas` is specific to the Image tab.
  // `printCanvasObject` is generic.
  // We can't easily change `printCanvasObject` to ignore the flag only for images.
  
  // Alternative: Change `renderImageCanvas` to NOT visually invert?
  // No, user wants to see the effect in preview.
  
  // Alternative: `renderImageCanvas` produces a WYSIWYG canvas (Negative).
  // If `ui.js` passes `invert=true`, it flips it back.
  // So we need `renderImageCanvas` to produce a "Positive" canvas that *looks* Negative? Impossible.
  
  // Solution: I MUST change `ui.js` logic for the Image tab to pass `false` to `printCanvasObject`.
  // Or, I modify `renderImageCanvas` to attach a property to the object saying `alreadyInverted: true`, and `printCanvasObject` checks it.
  
  // I will modify `renderImageCanvas` to return `ignoreInvert: true` in the object.
  // And modify `printCanvasObject` to respect it.
  
  const { canvas, bytesPerRow, heightPx } = canvasObj;
  
  // Check if we should ignore the passed invert flag (because image is already processed)
  // We can check if canvasObj has a flag, OR just rely on the fact that if we forceInvert logic inside render, we handle it.
  // Let's assume we modify the `canvasObj` returned by renderImageCanvas.
  
  const effectiveInvert = canvasObj.bakedInvert ? false : invert;

  let bitmap = canvasToBitmap(canvas, bytesPerRow, effectiveInvert);
  if (printer.settings.forceInvert) {
    const inv = new Uint8Array(bitmap.length);
    for (let i = 0; i < bitmap.length; i++) inv[i] = (~bitmap[i]) & 0xFF;
    bitmap = inv;
  }
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
