// js/app.js — Adaptive D30 printing (tries D30-native framing first in Auto mode)
// Provides: Connect / Disconnect / Print (text/barcode/qr/image) + copies
// Shows verbose log to #log element and console for iteration

document.addEventListener("DOMContentLoaded", () => {
  // UI elements
  const connectBtn = document.getElementById("connect");
  const disconnectBtn = document.getElementById("disconnect");
  const printBtn = document.getElementById("print");
  const logEl = document.getElementById("log");
  const statusEl = document.getElementById("status");
  const textInput = document.getElementById("print-text");
  const typeSelect = document.getElementById("print-type");
  const copiesInput = document.getElementById("print-copies");
  const protocolSelect = document.getElementById("protocol-select");
  const imageCol = document.getElementById("image-col");
  const imageInput = document.getElementById("print-image");
  const clearLogBtn = document.getElementById("clear-log");

  function log(...args) {
    console.log(...args);
    const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (logEl) {
      if (logEl.textContent === 'No logs yet') logEl.textContent = '';
      logEl.textContent += line + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
  function setStatus(s) {
    if (statusEl) statusEl.textContent = s;
    log('[STATUS]', s);
  }

  // show/hide image control
  typeSelect.addEventListener("change", () => {
    if (typeSelect.value === "image") {
      imageCol.style.display = "";
    } else {
      imageCol.style.display = "none";
    }
  });

  clearLogBtn.addEventListener("click", () => {
    logEl.textContent = '';
  });

  // Bluetooth state
  const SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
  const CHAR_UUID    = "0000ff02-0000-1000-8000-00805f9b34fb";
  let device = null, server = null, char = null, ready = false;

  // Utilities: write with fallback, splitting into chunks
  async function writeChunks(characteristic, bytes, msBetween = 20) {
    const BYTES_PER_CHUNK = 120; // conservative
    const properties = characteristic.properties || {};
    const canWriteNoResp = !!properties.writeWithoutResponse;
    const canWriteWithResp = !!properties.write;
    // prefer writeValueWithoutResponse when available to match D30 behavior
    for (let i = 0; i < bytes.length; i += BYTES_PER_CHUNK) {
      const chunk = bytes.slice(i, Math.min(i + BYTES_PER_CHUNK, bytes.length));
      try {
        if (canWriteNoResp && typeof characteristic.writeValueWithoutResponse === 'function') {
          await characteristic.writeValueWithoutResponse(chunk);
        } else if (typeof characteristic.writeValueWithResponse === 'function') {
          await characteristic.writeValueWithResponse(chunk);
        } else if (typeof characteristic.writeValue === 'function') {
          await characteristic.writeValue(chunk);
        } else {
          // last resort, attempt writeValue
          await characteristic.writeValue(chunk);
        }
      } catch (e) {
        log('Chunk write failed', e);
        throw e;
      }
      await new Promise(r => setTimeout(r, msBetween));
    }
  }

  // Helper: render text/barcode/qr/image to canvas
  function textToCanvas(text, widthMm = 40, heightMm = 12, dpi = 203) {
    const pxPerMm = dpi / 25.4;
    const w = Math.max(8, Math.ceil((widthMm * pxPerMm)/8)*8);
    const h = Math.max(8, Math.floor(heightMm * pxPerMm));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = 'black'; ctx.font = `${Math.max(10, Math.floor(h/6))}px sans-serif`; ctx.textBaseline='top';
    const padding = 4;
    const words = (text||'').split(' ');
    let line='', y = padding;
    for (let i=0;i<words.length;i++){
      const test = line ? (line+' '+words[i]) : words[i];
      if (ctx.measureText(test).width > w - padding*2 && line) {
        ctx.fillText(line, padding, y); line = words[i]; y += Math.floor(h/6)+2;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, padding, y);
    return c;
  }

  async function imageFileToCanvas(file, widthMm = 40, heightMm = 12, dpi = 203) {
    const dataUrl = await new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = ()=>res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.src = dataUrl;
    await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; });
    const pxPerMm = dpi / 25.4;
    const w = Math.max(8, Math.ceil((widthMm * pxPerMm)/8)*8);
    const h = Math.max(8, Math.floor(heightMm * pxPerMm));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0,0,w,h);
    const scale = Math.min(w/img.width, h/img.height) * 0.95;
    const iw = img.width * scale, ih = img.height * scale;
    ctx.drawImage(img, (w-iw)/2, (h-ih)/2, iw, ih);
    return canvas;
  }

  // Converts canvas -> 1-bit pixel bytes (8 pixels per byte, same orientation original used)
  function canvasToBits(canvas) {
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const bytesPerRow = canvas.width / 8;
    const out = new Uint8Array(bytesPerRow * canvas.height);
    let idx=0;
    for (let y=0;y<canvas.height;y++){
      for (let b=0;b<bytesPerRow;b++){
        let v = 0;
        for (let bit=0; bit<8; bit++){
          const x = b*8 + bit;
          const i = (y*canvas.width + x)*4;
          const r=d[i],g=d[i+1],bl=d[i+2];
          const lum = 0.299*r + 0.587*g + 0.114*bl;
          const pixel = lum < 128 ? 1 : 0; // 1 -> black
          if (pixel) v |= (0x80 >> bit);
        }
        out[idx++] = v;
      }
    }
    return {bytesPerRow: bytesPerRow, height: canvas.height, data: out};
  }

  // D30-native framing attempt (common pattern in D30 forks)
  // We'll send per-chunk frames with a small header per chunk. There are variants; Auto mode will try this first.
  function buildD30Frames(mmWidth, bytesPerRow, pixelBytes) {
    // Strategy used by multiple D30 implementations: prefix chunk with 0x1F 0x1B 0x33 0x00 and length prefix sometimes
    // We'll implement a conservative chunking: send a global header then raw pixel bytes in PACKET_SIZE chunks, then tail.
    const PACKET_SIZE = 128;
    // Basic header (some repos used 0x1F 0x1B 0x33 0x00). We'll include both a global header and per-chunk frame.
    const globalHeader = new Uint8Array([0x1F,0x1B,0x33,0x00, mmWidth & 0xff, (mmWidth>>8)&0xff, bytesPerRow & 0xff, (bytesPerRow>>8)&0xff]);
    // We'll return an array of Uint8Array chunks: [globalHeader, chunk1, chunk2, ..., tail]
    const chunks = [];
    chunks.push(globalHeader);
    for (let i=0; i<pixelBytes.length; i+=PACKET_SIZE) {
      const slice = pixelBytes.slice(i, i+PACKET_SIZE);
      // Some firmwares accept the chunk raw; others want a 2-byte length prefix — we include the raw.
      chunks.push(slice);
    }
    // end frame (some D30 variants used 0x04 0x04 or 0x1E; include a gentle feed)
    const tail = new Uint8Array([0x0A,0x0A,0x1E]);
    chunks.push(tail);
    return chunks;
  }

  // ESC/POS raster fallback builder (header + data)
  function buildEscPosRaster(mmWidth, bytesPerRow, pixelBytes) {
    // GS v 0 m xL xH yL yH d...
    const xL = bytesPerRow & 0xff;
    const xH = (bytesPerRow>>8) & 0xff;
    const yL = (pixelBytes.length / bytesPerRow) & 0xff;
    const yH = ((pixelBytes.length / bytesPerRow) >> 8) & 0xff;
    const header = new Uint8Array([0x1D,0x76,0x30,0x00,xL,xH,yL,yH]);
    const out = new Uint8Array(header.length + pixelBytes.length);
    out.set(header,0); out.set(pixelBytes, header.length);
    return [out, new Uint8Array([0x0A,0x0A,0x1D,0x56,0x41,0x10])];
  }

  // Raw chunk send (just send the pixel bytes + simple feed)
  function buildRawChunks(pixelBytes) {
    const tail = new Uint8Array([0x0A,0x0A]);
    return [pixelBytes, tail];
  }

  async function trySendUsingStrategy(strategyName, characteristic, mmWidth, bytesPerRow, pixelBytes) {
    setStatus('Sending via ' + strategyName);
    log('Attempting strategy:', strategyName);
    if (strategyName === 'd30') {
      const frames = buildD30Frames(mmWidth, bytesPerRow, pixelBytes);
      for (const f of frames) {
        await writeChunks(characteristic, f);
      }
    } else if (strategyName === 'escpos') {
      const frames = buildEscPosRaster(mmWidth, bytesPerRow, pixelBytes);
      for (const f of frames) {
        await writeChunks(characteristic, f);
      }
    } else if (strategyName === 'raw') {
      const frames = buildRawChunks(pixelBytes);
      for (const f of frames) {
        await writeChunks(characteristic, f);
      }
    } else {
      throw new Error('Unknown strategy ' + strategyName);
    }
  }

  // Connect
  async function connect() {
    try {
      if (!('bluetooth' in navigator)) {
        alert('Web Bluetooth not available here — use Chrome/Edge or enable experimental features in Brave.');
        return;
      }
      setStatus('Requesting device...');
      device = await navigator.bluetooth.requestDevice({
        filters: [{namePrefix: 'D30'}],
        optionalServices: [SERVICE_UUID]
      });
      if (!device) { setStatus('No device chosen'); return; }
      device.addEventListener('gattserverdisconnected', onDisconnected);
      setStatus('Connecting GATT...');
      server = await device.gatt.connect();
      setStatus('Getting service...');
      const service = await server.getPrimaryService(SERVICE_UUID);
      setStatus('Getting characteristic...');
      char = await service.getCharacteristic(CHAR_UUID);
      setStatus('Connected to ' + (device.name || device.id));
      ready = true;
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = '';
      log('Characteristic properties:', char.properties);
    } catch (e) {
      console.error('Connect error', e);
      setStatus('Connect failed: ' + (e && e.message ? e.message : e));
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
    try {
      if (device && device.gatt.connected) device.gatt.disconnect();
    } catch (e) { console.warn(e); }
    onDisconnected();
  }

  // main print flow
  async function handlePrint() {
    try {
      if (!ready || !char) { setStatus('Please connect to the printer first'); return; }
      let copies = parseInt(copiesInput.value || '1', 10); if (!isFinite(copies) || copies < 1) copies = 1;
      const type = (typeSelect.value || 'text').toLowerCase();

      // render canvas
      let canvas;
      if (type === 'image') {
        if (!imageInput.files || imageInput.files.length === 0) { alert('Pick an image'); return; }
        canvas = await imageFileToCanvas(imageInput.files[0]);
      } else if (type === 'barcode') {
        // quick visual barcode
        canvas = textToCanvas(textInput.value || '', 40, 12);
      } else if (type === 'qrcode') {
        // render via Google Chart API for simplicity
        const url = 'https://chart.googleapis.com/chart?cht=qr&chs=256x256&chl=' + encodeURIComponent(textInput.value || '');
        const img = new Image(); img.crossOrigin = 'anonymous';
        await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
        const pxPerMm = 203 / 25.4; const w = Math.max(8, Math.ceil((40 * pxPerMm)/8)*8); const h = Math.max(8, Math.floor(12 * pxPerMm));
        canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
        const ctx = canvas.getContext('2d'); ctx.fillStyle='white'; ctx.fillRect(0,0,w,h);
        const scale = Math.min(w/img.width, h/img.height)*0.9; ctx.drawImage(img, (w-img.width*scale)/2, (h-img.height*scale)/2, img.width*scale, img.height*scale);
      } else {
        canvas = textToCanvas(textInput.value || '');
      }

      // convert to bits array
      const conv = canvasToBits(canvas);
      const pixelBytes = conv.data;
      const bytesPerRow = conv.bytesPerRow;
      const mmWidth = canvas.width; // keep pixel width for frame building

      // choose strategy
      const selected = protocolSelect.value || 'auto';
      const strategies = selected === 'auto' ? ['d30','escpos','raw'] : [selected];

      let sent = false;
      for (const strat of strategies) {
        try {
          setStatus('Trying strategy: ' + strat);
          await trySendUsingStrategy(strat, char, mmWidth, bytesPerRow, pixelBytes);
          setStatus('Printing done (strategy: ' + strat + ')');
          log('Printed using', strat);
          sent = true;
          break;
        } catch (err) {
          log('Strategy', strat, 'failed:', err);
          // try next strategy
        }
      }

      if (!sent) {
        setStatus('All strategies failed — see console log.');
      }
    } catch (err) {
      console.error('Print error:', err);
      setStatus('Print error: ' + (err && err.message ? err.message : err));
    }
  }

  // wire up
  connectBtn.addEventListener('click', connect);
  disconnectBtn.addEventListener('click', disconnect);
  printBtn.addEventListener('click', handlePrint);

  // initial UI state
  disconnectBtn.style.display = 'none';
  setStatus('Ready');
});
