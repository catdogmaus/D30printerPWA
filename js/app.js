// js/app.js — final adaptive D30 PWA print logic with UI bindings and preview
document.addEventListener("DOMContentLoaded", () => {
  // UI refs
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
  const defaultWidthInput = document.getElementById("default-width");
  const defaultHeightInput = document.getElementById("default-height");
  const defaultProtocolSelect = document.getElementById("default-protocol");
  const previewCanvas = document.getElementById("preview-canvas");
  const imagePicker = document.getElementById("image-picker");
  const imageInput = document.getElementById("print-image");
  const logbox = document.getElementById("logbox");
  const tabs = document.getElementById("tabs");
  const tabPrint = document.getElementById("tab-print");
  const tabSettings = document.getElementById("tab-settings");
  const tabLog = document.getElementById("tab-log");
  const exportLogBtn = document.getElementById("export-log");
  const clearLogBtn = document.getElementById("clear-log");
  const showCharBtn = document.getElementById("show-char");
  const resetDefaultsBtn = document.getElementById("reset-settings");
  const downloadPreviewBtn = document.getElementById("download-preview");

  // logging helper
  function appendLogLine(line) {
    const ts = new Date().toLocaleTimeString();
    const entry = `[${ts}] ${line}`;
    if (logbox.textContent === "No logs yet.") logbox.textContent = "";
    logbox.textContent += entry + "\n";
    logbox.scrollTop = logbox.scrollHeight;
    console.log(entry);
  }
  function setStatus(s) { statusEl.textContent = s; appendLogLine('[STATUS] ' + s); }

  // tabs
  tabs.addEventListener("click", (e) => {
    const tgt = e.target.closest(".tab");
    if (!tgt) return;
    const t = tgt.getAttribute("data-tab");
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    tgt.classList.add("active");
    tabPrint.style.display = t === "print" ? "" : "none";
    tabSettings.style.display = t === "settings" ? "" : "none";
    tabLog.style.display = t === "log" ? "" : "none";
  });

  // show/hide image picker
  typeSelect.addEventListener("change", () => {
    imagePicker.style.display = typeSelect.value === "image" ? "" : "none";
  });

  // persistence
  const STORAGE_KEY = "d30_pwa_settings_v1";
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch { return {}; }
  }
  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
  const settings = loadSettings();
  if (settings.defaultWidth) { labelWidthInput.value = settings.defaultWidth; defaultWidthInput.value = settings.defaultWidth; }
  if (settings.defaultHeight) { labelHeightInput.value = settings.defaultHeight; defaultHeightInput.value = settings.defaultHeight; }
  if (settings.defaultProtocol) { protocolSelect.value = settings.defaultProtocol; defaultProtocolSelect.value = settings.defaultProtocol; }

  resetDefaultsBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    labelWidthInput.value = 40; labelHeightInput.value = 12; protocolSelect.value = 'auto';
    defaultWidthInput.value = 40; defaultHeightInput.value = 12; defaultProtocolSelect.value = 'auto';
    appendLogLine('Defaults reset');
  });

  defaultWidthInput.addEventListener("change", () => {
    const v = parseInt(defaultWidthInput.value, 10) || 40;
    settings.defaultWidth = v; saveSettings(settings); appendLogLine('Saved default width ' + v);
  });
  defaultHeightInput.addEventListener("change", () => {
    const v = parseInt(defaultHeightInput.value, 10) || 12;
    settings.defaultHeight = v; saveSettings(settings); appendLogLine('Saved default height ' + v);
  });
  defaultProtocolSelect.addEventListener("change", () => {
    const v = defaultProtocolSelect.value || 'auto';
    settings.defaultProtocol = v; saveSettings(settings); appendLogLine('Saved default protocol ' + v);
  });

  // preview utilities
  const DPI = 203; // typical thermal DPI
  function mmToPx(mm) { return Math.round((DPI / 25.4) * mm); }

  function renderTextToCanvas(text, widthMm, heightMm) {
    const w = Math.max(8, Math.ceil(mmToPx(widthMm) / 8) * 8);
    const h = Math.max(8, Math.floor(mmToPx(heightMm)));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "black";
    ctx.font = Math.max(10, Math.floor(h / 6)) + "px sans-serif";
    ctx.textBaseline = "top";
    const padding = 4;
    const words = (text || "").split(" ");
    let line = "", y = padding;
    for (let i = 0; i < words.length; i++) {
      const test = line ? (line + " " + words[i]) : words[i];
      if (ctx.measureText(test).width > w - padding * 2 && line) {
        ctx.fillText(line, padding, y);
        line = words[i];
        y += Math.floor(h / 6) + 2;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, padding, y);
    return c;
  }

  async function renderImageFileToCanvas(file, widthMm, heightMm) {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const img = new Image(); img.src = dataUrl;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const wPx = Math.max(8, Math.ceil(mmToPx(widthMm) / 8) * 8);
    const hPx = Math.max(8, Math.floor(mmToPx(heightMm)));
    const canvas = document.createElement("canvas"); canvas.width = wPx; canvas.height = hPx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, wPx, hPx);
    const s = Math.min(wPx / img.width, hPx / img.height) * 0.95;
    const iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, (wPx - iw) / 2, (hPx - ih) / 2, iw, ih);
    return canvas;
  }

  async function renderQrToCanvas(value, widthMm, heightMm) {
    const sizePx = 256;
    const url = 'https://chart.googleapis.com/chart?cht=qr&chs=' + sizePx + 'x' + sizePx + '&chl=' + encodeURIComponent(value);
    const img = new Image(); img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const wPx = Math.max(8, Math.ceil(mmToPx(widthMm) / 8) * 8);
    const hPx = Math.max(8, Math.floor(mmToPx(heightMm)));
    const canvas = document.createElement("canvas"); canvas.width = wPx; canvas.height = hPx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, wPx, hPx);
    const scale = Math.min(wPx / img.width, hPx / img.height) * 0.9;
    const iw = img.width * scale, ih = img.height * scale;
    ctx.drawImage(img, (wPx - iw) / 2, (hPx - ih) / 2, iw, ih);
    return canvas;
  }

  function canvasToBits(canvas) {
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bytesPerRow = canvas.width / 8;
    const out = new Uint8Array(bytesPerRow * canvas.height);
    let idx = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let b = 0; b < bytesPerRow; b++) {
        let v = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = b * 8 + bit;
          const i = (y * canvas.width + x) * 4;
          const r = d[i], g = d[i + 1], bl = d[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
          const pixel = lum < 128 ? 1 : 0;
          if (pixel) v |= (0x80 >> bit);
        }
        out[idx++] = v;
      }
    }
    return { bytesPerRow: bytesPerRow, height: canvas.height, data: out };
  }

  // Bluetooth variables
  const SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
  const CHAR_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
  let device = null, server = null, char = null, ready = false;
  window.char = null; // expose

  function showCharProperties() {
    if (!char) { appendLogLine('No characteristic available'); return; }
    console.log('char.properties:', char.properties);
    appendLogLine('char.properties logged to console');
  }

  showCharBtn.addEventListener("click", showCharProperties);

  function appendLogLine(txt) {
    appendLogLine; // placeholder to silence linter (we use appendLogLine defined earlier)
  }

  // write helper (chunks + writeWithoutResponse fallback)
  async function writeChunks(characteristic, bytes, chunkSize = 120, delayMs = 18) {
    const props = characteristic.properties || {};
    const canNoResp = !!props.writeWithoutResponse;
    const canWithResp = !!props.write;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
      try {
        if (canNoResp && typeof characteristic.writeValueWithoutResponse === 'function') {
          await characteristic.writeValueWithoutResponse(chunk);
        } else if (typeof characteristic.writeValueWithResponse === 'function') {
          await characteristic.writeValueWithResponse(chunk);
        } else if (typeof characteristic.writeValue === 'function') {
          await characteristic.writeValue(chunk);
        } else {
          await characteristic.writeValue(chunk);
        }
      } catch (e) {
        appendLogLine('Chunk write error: ' + (e && e.message ? e.message : e));
        throw e;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Build candidate frames / strategies
  function buildD30VariantA(mmW, bytesPerRow, pixelBytes) {
    // Variant A: global header 1F 1B 33 00 [width_mm] [height_mm] [bytesPerRow_low][bytesPerRow_high] [height_low][height_high]
    const globalHeader = new Uint8Array([0x1F, 0x1B, 0x33, 0x00]);
    // We'll append width_mm and height_mm (1 byte each if < 256) and then bytesPerRow low/high and height low/high
    // (some firmwares expect different fields; we try to include common ones)
    const widthByte = mmW & 0xff;
    const heightByte = parseInt(labelHeightInput.value || 12, 10) & 0xff;
    const bprL = bytesPerRow & 0xff, bprH = (bytesPerRow >> 8) & 0xff;
    const hL = (pixelBytes.length / bytesPerRow) & 0xff, hH = ((pixelBytes.length / bytesPerRow) >> 8) & 0xff;
    const header = new Uint8Array(globalHeader.length + 6);
    header.set(globalHeader, 0);
    header.set([widthByte, heightByte, bprL, bprH, hL, hH], globalHeader.length);
    // data is header + pixel bytes then tail
    const tail = new Uint8Array([0x0A, 0x0A, 0x04]); // feed + end marker
    // return array of frames: [header, chunk..., tail]
    const frames = [header, pixelBytes, tail];
    return frames;
  }

  function buildD30VariantB(mmW, bytesPerRow, pixelBytes) {
    // Variant B: prefix each chunk with 1F 1B 33 00 <chunkLenLow> <chunkLenHigh>
    const header = new Uint8Array([0x1F, 0x1B, 0x33, 0x00]);
    const PACK = 120;
    const frames = [];
    for (let i = 0; i < pixelBytes.length; i += PACK) {
      const slice = pixelBytes.slice(i, i + PACK);
      const L = slice.length & 0xff, H = (slice.length >> 8) & 0xff;
      const pHeader = new Uint8Array(header.length + 2);
      pHeader.set(header, 0);
      pHeader.set([L, H], header.length);
      frames.push(pHeader);
      frames.push(slice);
    }
    frames.push(new Uint8Array([0x0A, 0x0A, 0x04]));
    return frames;
  }

  function buildEscPosRaster(mmW, bytesPerRow, pixelBytes) {
    const xL = bytesPerRow & 0xff, xH = (bytesPerRow >> 8) & 0xff;
    const y = pixelBytes.length / bytesPerRow;
    const yL = y & 0xff, yH = (y >> 8) & 0xff;
    const header = new Uint8Array([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    const tail = new Uint8Array([0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10]);
    return [header, pixelBytes, tail];
  }

  function buildRaw(pixelBytes) {
    return [pixelBytes, new Uint8Array([0x0A, 0x0A])];
  }

  // attempt send given strategy
  async function tryStrategy(strategy, characteristic, mmW, bytesPerRow, pixelBytes) {
    window.lastStrategy = strategy;
    appendLogLine('Trying strategy: ' + strategy);
    if (strategy === 'd30A') {
      const frames = buildD30VariantA(mmW, bytesPerRow, pixelBytes);
      for (const f of frames) await writeChunks(characteristic, f);
    } else if (strategy === 'd30B') {
      const frames = buildD30VariantB(mmW, bytesPerRow, pixelBytes);
      for (const f of frames) await writeChunks(characteristic, f);
    } else if (strategy === 'escpos') {
      const frames = buildEscPosRaster(mmW, bytesPerRow, pixelBytes);
      for (const f of frames) await writeChunks(characteristic, f);
    } else if (strategy === 'raw') {
      const frames = buildRaw(pixelBytes);
      for (const f of frames) await writeChunks(characteristic, f);
    } else {
      throw new Error('Unknown strategy ' + strategy);
    }
  }

  // connect / disconnect
  async function connect() {
    try {
      if (!('bluetooth' in navigator)) { alert('Web Bluetooth not available here. Use Chrome/Edge.'); return; }
      setStatus('Opening device chooser...');
      device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'D30' }], optionalServices: [SERVICE_UUID] });
      if (!device) { setStatus('No device selected'); return; }
      device.addEventListener('gattserverdisconnected', onDisconnected);
      setStatus('Connecting GATT...');
      server = await device.gatt.connect();
      setStatus('Getting service/characteristic...');
      const service = await server.getPrimaryService(SERVICE_UUID);
      char = await service.getCharacteristic(CHAR_UUID);
      window.char = char;
      appendLogLine('Characteristic properties: ' + JSON.stringify(char.properties || {}));
      ready = true;
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = '';
      setStatus('Connected: ' + (device.name || device.id));
    } catch (e) {
      appendLogLine('Connect error: ' + (e && e.message ? e.message : e));
      setStatus('Connect failed');
      ready = false;
    }
  }

  function onDisconnected() {
    setStatus('Device disconnected');
    ready = false; char = null; device = null;
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
  }

  async function disconnect() {
    try { if (device && device.gatt && device.gatt.connected) device.gatt.disconnect(); } catch (e) { console.warn(e); }
    onDisconnected();
  }

  // preview
  async function doPreview() {
    try {
      const wmm = parseInt(labelWidthInput.value || 40, 10);
      const hmm = parseInt(labelHeightInput.value || 12, 10);
      const type = typeSelect.value || 'text';
      let canvas;
      if (type === 'image') {
        if (!imageInput.files || imageInput.files.length === 0) { alert('Choose an image first'); return; }
        canvas = await renderImageFileToCanvas(imageInput.files[0], wmm, hmm);
      } else if (type === 'qrcode') {
        canvas = await renderQrToCanvas(textInput.value || '', wmm, hmm);
      } else if (type === 'barcode') {
        canvas = renderTextToCanvas(textInput.value || '', wmm, hmm);
      } else {
        canvas = renderTextToCanvas(textInput.value || '', wmm, hmm);
      }
      // copy to preview canvas element sized for display (we scale to fit)
      const preview = previewCanvas;
      const ctx = preview.getContext('2d');
      // fit canvas by scaling to preview size
      const scale = Math.min(preview.width / canvas.width, preview.height / canvas.height);
      ctx.fillStyle = 'white'; ctx.fillRect(0,0,preview.width,preview.height);
      ctx.drawImage(canvas, (preview.width - canvas.width * scale)/2, (preview.height - canvas.height * scale)/2, canvas.width * scale, canvas.height * scale);
      setStatus('Preview ready');
    } catch (e) {
      appendLogLine('Preview error: ' + (e && e.message ? e.message : e));
      setStatus('Preview failed');
    }
  }

  downloadPreviewBtn.addEventListener('click', () => {
    const dataUrl = previewCanvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = dataUrl; a.download = 'preview.png'; a.click();
  });

  // main print entry
  async function handlePrint() {
    if (!ready || !char) { setStatus('Please connect to the printer first'); return; }
    const copies = Math.max(1, parseInt(copiesInput.value || '1', 10));
    const wmm = parseInt(labelWidthInput.value || 40, 10);
    const hmm = parseInt(labelHeightInput.value || 12, 10);
    const type = typeSelect.value || 'text';
    setStatus('Preparing print data');

    try {
      let canvas;
      if (type === 'image') {
        if (!imageInput.files || imageInput.files.length === 0) { alert('Choose an image'); return; }
        canvas = await renderImageFileToCanvas(imageInput.files[0], wmm, hmm);
      } else if (type === 'qrcode') {
        canvas = await renderQrToCanvas(textInput.value || '', wmm, hmm);
      } else if (type === 'barcode') {
        canvas = renderTextToCanvas(textInput.value || '', wmm, hmm);
      } else {
        canvas = renderTextToCanvas(textInput.value || '', wmm, hmm);
      }

      const conv = canvasToBits(canvas);
      const pixelBytes = conv.data;
      const bytesPerRow = conv.bytesPerRow;

      // strategy selection
      const pref = protocolSelect.value || 'auto';
      const strategies = pref === 'auto' ? ['d30A','d30B','escpos','raw'] : (pref === 'd30' ? ['d30A','d30B'] : (pref === 'escpos' ? ['escpos'] : ['raw']));

      for (let c = 0; c < copies; c++) {
        let printed = false;
        for (const s of strategies) {
          try {
            appendLogLine('Using strategy ' + s + ' for copy ' + (c+1));
            await tryStrategy(s, char, wmm, bytesPerRow, pixelBytes);
            appendLogLine('Strategy ' + s + ' SUCCESS');
            printed = true;
            break;
          } catch (err) {
            appendLogLine('Strategy ' + s + ' failed: ' + (err && err.message ? err.message : err));
            // continue to next strategy
          }
        }
        if (!printed) {
          appendLogLine('All strategies failed for copy ' + (c+1));
          setStatus('Print failed (see log)');
          return;
        }
        // small pause between copies
        await new Promise(r => setTimeout(r, 300));
      }

      setStatus('Printing done');
    } catch (err) {
      appendLogLine('Print error: ' + (err && err.message ? err.message : err));
      setStatus('Print failed');
    }
  }

  // wire events
  connectBtn.addEventListener('click', connect);
  disconnectBtn.addEventListener('click', disconnect);
  printBtn.addEventListener('click', handlePrint);
  previewBtn.addEventListener('click', doPreview);

  exportLogBtn.addEventListener('click', () => {
    const blob = new Blob([logbox.textContent], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'd30_log.txt'; a.click();
  });
  clearLogBtn.addEventListener('click', () => { logbox.textContent = ''; });
  // show char.properties in console
  showCharBtn.addEventListener('click', () => {
    if (!char) { appendLogLine('No char to show'); return; }
    console.log('char.properties:', char.properties); appendLogLine('char.properties logged to console');
  });

  // image input changes update preview
  imageInput && imageInput.addEventListener('change', () => { if (imageInput.files && imageInput.files.length) previewBtn.click(); });

  // load saved defaults into settings UI (already applied earlier)
  // Save when label size changes
  labelWidthInput.addEventListener('change', () => { settings.defaultWidth = parseInt(labelWidthInput.value || 40, 10); saveSettings(settings); });
  labelHeightInput.addEventListener('change', () => { settings.defaultHeight = parseInt(labelHeightInput.value || 12, 10); saveSettings(settings); });
  protocolSelect.addEventListener('change', () => { settings.defaultProtocol = protocolSelect.value || 'auto'; saveSettings(settings); });

  // initial UI state
  disconnectBtn.style.display = 'none'; setStatus('Ready');

  // Service worker registration left intact
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/D30printerPWA/sw.js').then(()=>appendLogLine('SW registered')).catch(e=>appendLogLine('SW register failed: ' + (e && e.message ? e.message : e)));
  }
});
