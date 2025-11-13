/**
 * Final adaptive D30 app.js
 * - Uses char uuid 0000ff02-...
 * - Tries multiple D30 framing variants and fallbacks
 * - Exposes window.char and window.lastStrategy
 * - Persists user protocol selection
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- UI refs ---
  const connectBtn = document.getElementById("connect");
  const disconnectBtn = document.getElementById("disconnect");
  const printBtn = document.getElementById("print");
  const previewBtn = document.getElementById("preview-btn");
  const statusEl = document.getElementById("status");
  const typeSelect = document.getElementById("print-type");
  const textInput = document.getElementById("print-text");
  const copiesInput = document.getElementById("print-copies");
  const protocolSelect = document.getElementById("protocol-select");
  const labelWidthInput = document.getElementById("label-width");
  const labelHeightInput = document.getElementById("label-height");
  const previewCanvas = document.getElementById("preview-canvas");
  const imageInput = document.getElementById("print-image");
  const logbox = document.getElementById("logbox");

  // safe log
  function logLine(...args) {
    const s = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    const ts = new Date().toISOString();
    if (logbox) {
      if (logbox.textContent === "No logs yet.") logbox.textContent = "";
      logbox.textContent += `[${ts}] ${s}\n`;
      logbox.scrollTop = logbox.scrollHeight;
    }
    console.log(...args);
  }
  function setStatus(s) {
    if (statusEl) statusEl.textContent = s;
    logLine("[STATUS]", s);
  }

  // settings persistence
  const SETTINGS_KEY = "d30_pwa_settings_v2";
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  const SETTINGS = loadSettings();
  if (SETTINGS.labelWidth) labelWidthInput.value = SETTINGS.labelWidth;
  if (SETTINGS.labelHeight) labelHeightInput.value = SETTINGS.labelHeight;
  if (SETTINGS.protocol) protocolSelect.value = SETTINGS.protocol;

  protocolSelect.addEventListener("change", () => { SETTINGS.protocol = protocolSelect.value; saveSettings(SETTINGS); });
  labelWidthInput.addEventListener("change", () => { SETTINGS.labelWidth = parseInt(labelWidthInput.value||40,10); saveSettings(SETTINGS); });
  labelHeightInput.addEventListener("change", () => { SETTINGS.labelHeight = parseInt(labelHeightInput.value||12,10); saveSettings(SETTINGS); });

  // --- DPI / rendering helpers ---
  const DPI = 203;
  const mmToPx = (mm) => Math.max(8, Math.round((DPI / 25.4) * mm));

  function renderTextCanvas(text, widthMm, heightMm) {
    const w = Math.ceil(mmToPx(widthMm)/8)*8;
    const h = Math.max(8, Math.round(mmToPx(heightMm)));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = "black"; ctx.font = `${Math.max(10, Math.floor(h/6))}px sans-serif`; ctx.textBaseline = "top";
    const pad = 4;
    const words = (text||"").split(" ");
    let line="", y=pad;
    for (let i=0;i<words.length;i++){
      const t = line ? (line+" "+words[i]) : words[i];
      if (ctx.measureText(t).width > w - pad*2 && line) {
        ctx.fillText(line, pad, y);
        line = words[i];
        y += Math.floor(h/6) + 2;
      } else line = t;
    }
    ctx.fillText(line, pad, y);
    return c;
  }

  async function renderImageCanvas(file, widthMm, heightMm) {
    const url = await new Promise((res,rej) => {
      const r = new FileReader(); r.onload = ()=>res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const img = new Image(); img.src = url;
    await new Promise((res,rej)=>{ img.onload = res; img.onerror = rej; });
    const w = Math.ceil(mmToPx(widthMm)/8)*8;
    const h = Math.max(8, Math.round(mmToPx(heightMm)));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0,0,w,h);
    const scale = Math.min((w*0.95)/img.width, (h*0.95)/img.height);
    const iw = img.width * scale, ih = img.height * scale;
    ctx.drawImage(img, (w-iw)/2, (h-ih)/2, iw, ih);
    return c;
  }

  async function renderQrCanvas(value, widthMm, heightMm) {
    const size = 300;
    const url = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(value)}`;
    const img = new Image(); img.crossOrigin = 'anonymous';
    await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
    const w = Math.ceil(mmToPx(widthMm)/8)*8;
    const h = Math.max(8, Math.round(mmToPx(heightMm)));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle='white'; ctx.fillRect(0,0,w,h);
    const scale = Math.min((w*0.9)/img.width, (h*0.9)/img.height);
    ctx.drawImage(img, (w - img.width*scale)/2, (h - img.height*scale)/2, img.width*scale, img.height*scale);
    return c;
  }

  function canvasToBitBytes(canvas) {
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const bytesPerRow = canvas.width / 8;
    const out = new Uint8Array(bytesPerRow * canvas.height);
    let o = 0;
    for (let y=0;y<canvas.height;y++){
      for (let b=0;b<bytesPerRow;b++){
        let val = 0;
        for (let bit=0; bit<8; bit++){
          const x = b*8 + bit;
          const i = (y*canvas.width + x) * 4;
          const r = img[i], g = img[i+1], bl = img[i+2];
          const lum = 0.299*r + 0.587*g + 0.114*bl;
          const pix = lum < 128 ? 1 : 0; // 1=black
          if (pix) val |= (0x80 >> bit);
        }
        out[o++] = val;
      }
    }
    return {bytesPerRow: bytesPerRow, height: canvas.height, data: out};
  }

  // --- Bluetooth ---
  const SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
  const CHAR_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
  let device = null, server = null, char = null, ready = false;
  window.char = null;
  window.lastStrategy = null;

  function exposeCharPropsToConsole() {
    if (!char) { logLine("No char available"); return; }
    console.log("char.properties:", char.properties);
    logLine("char.properties logged to console");
  }

  // robust write with detection of available methods
  async function writeChunks(characteristic, u8arr, chunkSize = 120, delay = 15) {
    const props = characteristic.properties || {};
    const canNoResp = !!props.writeWithoutResponse;
    const canWithResp = !!props.write;
    for (let i=0;i<u8arr.length;i+=chunkSize) {
      const chunk = u8arr.slice(i, Math.min(i+chunkSize, u8arr.length));
      try {
        if (canNoResp && typeof characteristic.writeValueWithoutResponse === "function") {
          await characteristic.writeValueWithoutResponse(chunk);
        } else if (typeof characteristic.writeValueWithResponse === "function") {
          await characteristic.writeValueWithResponse(chunk);
        } else if (typeof characteristic.writeValue === "function") {
          await characteristic.writeValue(chunk);
        } else {
          throw new Error("No write method available on characteristic");
        }
      } catch (e) {
        logLine("Write chunk error:", e && e.message ? e.message : e);
        throw e;
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // --- framing strategies (exhaustive set) ---
  // 1) D30 variant header: 1F 1B 33 00 [width_mm] [height_mm] [bprL] [bprH] [hL] [hH]
  function buildD30VariantHeader(mmWidth, heightPx, bytesPerRow, pixelBytes) {
    const widthByte = mmWidth & 0xff;
    const heightByte = parseInt(labelHeightInput.value||12,10) & 0xff;
    const bprL = bytesPerRow & 0xff, bprH = (bytesPerRow>>8) & 0xff;
    const hL = heightPx & 0xff, hH = (heightPx>>8) & 0xff;
    const header = new Uint8Array([0x1F,0x1B,0x33,0x00, widthByte, heightByte, bprL, bprH, hL, hH]);
    // send header then pixels then small feed tail
    const tail = new Uint8Array([0x0A,0x0A,0x04]);
    return [header, pixelBytes, tail];
  }

  // 2) D30 per-chunk prefix: [0x1F,0x1B,0x33,0x00, lenL, lenH] then chunk
  function buildD30PerChunkPrefix(pixelBytes, chunkSize = 120) {
    const headerBase = new Uint8Array([0x1F,0x1B,0x33,0x00]);
    const frames = [];
    for (let i=0;i<pixelBytes.length;i+=chunkSize) {
      const slice = pixelBytes.slice(i, Math.min(i+chunkSize, pixelBytes.length));
      const L = slice.length & 0xff, H = (slice.length>>8) & 0xff;
      const p = new Uint8Array(headerBase.length + 2);
      p.set(headerBase, 0); p.set([L, H], headerBase.length);
      frames.push(p);
      frames.push(slice);
    }
    frames.push(new Uint8Array([0x0A,0x0A,0x04]));
    return frames;
  }

  // 3) D30 length-prefixed global: [0x02, lenL, lenH] [payload]
  function buildD30LengthPrefixed(pixelBytes) {
    const totalLen = pixelBytes.length;
    const lenL = totalLen & 0xff, lenH = (totalLen>>8) & 0xff;
    const prefix = new Uint8Array([0x02, lenL, lenH]);
    const tail = new Uint8Array([0x0A,0x0A,0x04]);
    return [prefix, pixelBytes, tail];
  }

  // 4) ESC/POS raster fallback
  function buildEscPos(pixelBytes, bytesPerRow) {
    const xL = bytesPerRow & 0xff, xH = (bytesPerRow>>8)&0xff;
    const y = pixelBytes.length / bytesPerRow;
    const yL = y & 0xff, yH = (y>>8)&0xff;
    const header = new Uint8Array([0x1D,0x76,0x30,0x00, xL, xH, yL, yH]);
    const tail = new Uint8Array([0x0A,0x0A,0x1D,0x56,0x41,0x10]);
    return [header, pixelBytes, tail];
  }

  // 5) Raw
  function buildRaw(pixelBytes) { return [pixelBytes, new Uint8Array([0x0A,0x0A])]; }

  async function tryStrategy(name, characteristic, mmWidth, bytesPerRow, heightPx, pixelBytes) {
    window.lastStrategy = name;
    logLine("Trying strategy:", name);
    if (name === "d30_header") {
  // D30C-style framing
  const init = new Uint8Array([0x1B, 0x40]);              // printer init
  const start = new Uint8Array([0x1F, 0x11, 0x00]);       // image start
  const tail = new Uint8Array([0x0A, 0x0A, 0x04]);        // feed & cut
  const frames = [init, start, pixelBytes, tail];
  for (const f of frames) await writeChunks(characteristic, f);
}
  }

  // connect/disconnect
  async function connect() {
    try {
      if (!("bluetooth" in navigator)) { alert("Web Bluetooth not available here"); return; }
      setStatus("Opening device chooser...");
      device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "D30" }], optionalServices: [SERVICE_UUID] });
      if (!device) { setStatus("No device selected"); return; }
      device.addEventListener("gattserverdisconnected", onDisconnected);
      setStatus("Connecting to device...");
      server = await device.gatt.connect();
      setStatus("Retrieving service/characteristic...");
      const service = await server.getPrimaryService(SERVICE_UUID);
      char = await service.getCharacteristic(CHAR_UUID);
      window.char = char;
      logLine("Connected. char.properties:", char.properties);
      ready = true;
      connectBtn.style.display = "none";
      disconnectBtn.style.display = "";
      setStatus("Connected: " + (device.name || device.id));
    } catch (e) {
      logLine("Connect failed:", e && e.message ? e.message : e);
      setStatus("Connect failed");
      ready = false;
    }
  }

  function onDisconnected() {
    setStatus("Device disconnected");
    ready = false; char = null; device = null;
    connectBtn.style.display = ""; disconnectBtn.style.display = "none";
  }

  async function disconnect() {
    try { if (device && device.gatt && device.gatt.connected) device.gatt.disconnect(); } catch (e) { logLine("Disconnect error:", e); }
    onDisconnected();
  }

  // preview rendering (draw canvas to preview element)
  async function doPreview() {
    try {
      const wmm = parseInt(labelWidthInput.value||40,10);
      const hmm = parseInt(labelHeightInput.value||12,10);
      const type = typeSelect.value || "text";
      let canvas;
      if (type === "image") {
        if (!imageInput.files || imageInput.files.length === 0) { alert("Select image"); return; }
        canvas = await renderImageCanvas(imageInput.files[0], wmm, hmm);
      } else if (type === "qrcode") {
        canvas = await renderQrCanvas(textInput.value||"", wmm, hmm);
      } else if (type === "barcode") {
        canvas = renderTextCanvas(textInput.value||"", wmm, hmm);
      } else {
        canvas = renderTextCanvas(textInput.value||"", wmm, hmm);
      }
      // draw scaled into previewCanvas
      const preview = previewCanvas;
      const ctx = preview.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0,0,preview.width, preview.height);
      const scale = Math.min(preview.width / canvas.width, preview.height / canvas.height);
      ctx.drawImage(canvas, (preview.width - canvas.width*scale)/2, (preview.height - canvas.height*scale)/2, canvas.width*scale, canvas.height*scale);
      setStatus("Preview ready");
    } catch (e) {
      logLine("Preview error:", e && e.message ? e.message : e);
      setStatus("Preview failed");
    }
  }

  // main print
  async function handlePrint() {
    if (!ready || !char) { setStatus("Please connect first"); return; }
    const copies = Math.max(1, parseInt(copiesInput.value||"1",10));
    const wmm = parseInt(labelWidthInput.value||40,10);
    const hmm = parseInt(labelHeightInput.value||12,10);
    const type = typeSelect.value || "text";
    setStatus("Preparing print data...");
    try {
      let canvas;
      if (type === "image") {
        if (!imageInput.files || imageInput.files.length === 0) { alert("Select an image"); return; }
        canvas = await renderImageCanvas(imageInput.files[0], wmm, hmm);
      } else if (type === "qrcode") {
        canvas = await renderQrCanvas(textInput.value||"", wmm, hmm);
      } else if (type === "barcode") {
        canvas = renderTextCanvas(textInput.value||"", wmm, hmm);
      } else {
        canvas = renderTextCanvas(textInput.value||"", wmm, hmm);
      }

      const conv = canvasToBitBytes(canvas);
      const pixelBytes = conv.data;
      const bytesPerRow = conv.bytesPerRow;
      const heightPx = conv.height;

      // build strategy list
      const pref = protocolSelect.value || "auto";
      const strategyList = pref === "auto" ? ["d30_header","d30_chunked","d30_lenpref","escpos","raw"] :
                         (pref === "d30" ? ["d30_header","d30_chunked","d30_lenpref"] :
                         (pref === "escpos" ? ["escpos"] : ["raw"]));

      for (let copy=0; copy<copies; copy++) {
        let printed = false;
        for (const strat of strategyList) {
          try {
            logLine(`Copy ${copy+1}: trying ${strat}`);
            await tryStrategy(strat, char, wmm, bytesPerRow, heightPx, pixelBytes);
            logLine(`Copy ${copy+1}: strategy ${strat} succeeded`);
            window.lastStrategy = strat;
            printed = true;
            break;
          } catch (e) {
            logLine(`Copy ${copy+1}: strategy ${strat} failed:`, e && e.message ? e.message : e);
          }
        }
        if (!printed) {
          setStatus("All strategies failed for copy " + (copy+1));
          return;
        }
        // wait a bit between copies
        await new Promise(r => setTimeout(r, 300));
      }
      setStatus("Printing done");
    } catch (err) {
      logLine("Print flow error:", err && err.message ? err.message : err);
      setStatus("Print failed");
    }
  }

  // --- wire up UI ---
  connectBtn && connectBtn.addEventListener("click", connect);
  disconnectBtn && disconnectBtn.addEventListener("click", disconnect);
  previewBtn && previewBtn.addEventListener("click", doPreview);
  printBtn && printBtn.addEventListener("click", handlePrint);

  // expose debug helper
  window.showCharProps = () => {
    if (!char) { logLine("No characteristic"); return; }
    console.log("char.properties:", char.properties);
    alert("char.properties printed to console");
  };

  // initial state
  disconnectBtn && (disconnectBtn.style.display = "none");
  setStatus("Ready");
});
