// js/app.js — D30 PWA (full-featured, Connect + Print copies + Text/Barcode/QR/Image)
// Replace your current js/app.js with this file.
// Requires: /dist/esc-pos-encoder.js loaded before this script (your index.html already does).

document.addEventListener("DOMContentLoaded", () => {
  // UI elements (index.html must contain elements with these IDs)
  const connectBtn = document.getElementById("connect");
  const disconnectBtn = document.getElementById("disconnect");
  const printBtn = document.getElementById("print");
  const statusEl = document.getElementById("status");

  // Additional UI for custom text + options
  // If not present in index.html, create them dynamically below.
  let inputContainer = document.getElementById("print-controls");
  if (!inputContainer) {
    inputContainer = document.createElement("div");
    inputContainer.id = "print-controls";
    inputContainer.style.marginTop = "1rem";
    inputContainer.innerHTML = `
      <div style="margin-bottom:.5rem">
        <label>Text: <input id="print-text" type="text" value="Hello from D30!" style="width:70%"></label>
      </div>
      <div style="margin-bottom:.5rem">
        <label>Type:
          <select id="print-type">
            <option value="text">Text</option>
            <option value="barcode">Barcode</option>
            <option value="qrcode">QR Code</option>
            <option value="image">Image</option>
          </select>
        </label>
      </div>
      <div id="image-input-row" style="margin-bottom:.5rem; display:none;">
        <label>Image: <input id="print-image" type="file" accept="image/*"></label>
      </div>
      <div style="margin-bottom:.5rem">
        <label>Copies: <input id="print-copies" type="number" min="1" value="1" style="width:4rem"></label>
      </div>
    `;
    // insert below the main controls area if exists:
    const main = document.querySelector("main") || document.body;
    main.appendChild(inputContainer);
  }

  const textInput = document.getElementById("print-text");
  const typeSelect = document.getElementById("print-type");
  const imageInputRow = document.getElementById("image-input-row");
  const imageInput = document.getElementById("print-image");
  const copiesInput = document.getElementById("print-copies");

  // Bluetooth state
  let device = null;
  let server = null;
  let printerCharacteristic = null;
  let isReady = false;

  // Candidate service/characteristic UUIDs (covers common D30/Phomemo variants)
  const CANDIDATE_SERVICES = [
    "0000ff00-0000-1000-8000-00805f9b34fb", // vendor style
    0xff00,
    "000018f0-0000-1000-8000-00805f9b34fb", // earlier D30 style seen in some forks
  ];
  const CANDIDATE_CHARACTERISTICS = [
    "0000ff01-0000-1000-8000-00805f9b34fb", // vendor / typical
    0xff01,
    "00002af1-0000-1000-8000-00805f9b34fb", // other reported
    0x2af1,
  ];

  // Utilities
  function logStatus(msg) {
    console.log(msg);
    if (statusEl) statusEl.textContent = msg;
  }

  function safeUint8(arr) {
    return arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  }

  // Convert an array of bytes or Uint8Array to a BLE-friendly buffer
  function toBuffer(data) {
    if (data instanceof ArrayBuffer) return data;
    if (data instanceof Uint8Array) return data.buffer;
    return (new Uint8Array(data)).buffer;
  }

  // Try to discover the correct service and characteristic automatically
  async function findPrinterCharacteristic(gattServer) {
    for (const svc of CANDIDATE_SERVICES) {
      try {
        const service = await gattServer.getPrimaryService(svc);
        for (const c of CANDIDATE_CHARACTERISTICS) {
          try {
            const char = await service.getCharacteristic(c);
            if (char) {
              console.log("Found characteristic", c, "on service", svc);
              return char;
            }
          } catch (e) {
            // ignore and try next characteristic
          }
        }
        // if none of the candidate characteristics matched on this service, continue
      } catch (e) {
        // service not present - try next
      }
    }

    // fallback: try to inspect first available service/characteristic (best-effort)
    try {
      const services = await gattServer.getPrimaryServices();
      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          if (chars && chars.length > 0) {
            console.log("Fallback: using first found characteristic", chars[0].uuid, "on service", service.uuid);
            return chars[0];
          }
        } catch (e) {}
      }
    } catch (e) {}

    return null;
  }

  // ESC/POS raster image helper (basic)
  // Scales image to width px (maxPrinterWidth) and converts to 1-bit per pixel (monochrome)
  async function imageToRaster(imageFile, maxPrinterWidth = 384) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // scale to max width while keeping aspect ratio
          const scale = Math.min(1, maxPrinterWidth / img.width);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          const pixels = imgData.data;
          // convert to 1-bit per pixel, left-to-right, top-to-bottom
          const bytesPerLine = Math.ceil(w / 8);
          const out = new Uint8Array(bytesPerLine * h);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2];
              // luminance
              const lum = 0.299*r + 0.587*g + 0.114*b;
              const bit = lum < 128 ? 1 : 0; // threshold
              if (bit) {
                const byteIndex = y * bytesPerLine + (x >> 3);
                out[byteIndex] |= (0x80 >> (x & 7));
              }
            }
          }
          // Build ESC/POS raster bit image command (GS v 0)
          // GS v 0 m xL xH yL yH d...   (m = 0 normal)
          const xL = bytesPerLine & 0xff;
          const xH = (bytesPerLine >> 8) & 0xff;
          const yL = h & 0xff;
          const yH = (h >> 8) & 0xff;
          const header = new Uint8Array([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
          const payload = new Uint8Array(header.length + out.length);
          payload.set(header, 0);
          payload.set(out, header.length);
          resolve(payload);
        };
        img.onerror = (e) => reject(new Error("Image load error"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("File read error"));
      reader.readAsDataURL(imageFile);
    });
  }

  // Write data to characteristic in suitable chunk sizes (Bluetooth LE has MTU limits)
  async function writeInChunks(characteristic, data) {
    // data must be Uint8Array
    const BYTES_PER_CHUNK = 180; // conservative
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let offset = 0; offset < bytes.length; offset += BYTES_PER_CHUNK) {
      const chunk = bytes.slice(offset, offset + BYTES_PER_CHUNK);
      await characteristic.writeValue(chunk);
    }
  }

  // Connect handler
  async function connect() {
    try {
      if (!("bluetooth" in navigator)) {
        alert("Web Bluetooth not available. Use Chrome/Edge or enable features in Brave.");
        return;
      }

      logStatus("Requesting device…");

      // Request using namePrefix; request optional services for later
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "D30" }],
        optionalServices: CANDIDATE_SERVICES.concat([]) // pass the list
      });

      if (!device) {
        logStatus("No device selected.");
        return;
      }

      device.addEventListener("gattserverdisconnected", onDisconnected);

      logStatus("Connecting to GATT server…");
      server = await device.gatt.connect();

      logStatus("Locating printer characteristic…");
      printerCharacteristic = await findPrinterCharacteristic(server);

      if (!printerCharacteristic) {
        logStatus("Printer characteristic not found. Connection incomplete.");
        isReady = false;
        return;
      }

      isReady = true;
      logStatus(`Connected: ${device.name || device.id}`);
      connectBtn.classList.add("hidden");
      disconnectBtn.classList.remove("hidden");
    } catch (error) {
      console.error("Connect error:", error);
      logStatus("Connect failed: " + (error && error.message ? error.message : error));
      isReady = false;
    }
  }

  async function disconnect() {
    try {
      if (device && device.gatt && device.gatt.connected) {
        device.gatt.disconnect();
      }
    } catch (e) {
      console.error("Disconnect error", e);
    } finally {
      isReady = false;
      printerCharacteristic = null;
      connectBtn.classList.remove("hidden");
      disconnectBtn.classList.add("hidden");
      logStatus("Disconnected");
    }
  }

  function onDisconnected() {
    console.log("Device disconnected event");
    isReady = false;
    printerCharacteristic = null;
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
    logStatus("Device disconnected");
  }

  // Build ESC/POS bytes for text (uses EscPosEncoder when available)
  function buildTextBytes(text) {
    if (window.EscPosEncoder) {
      const enc = new EscPosEncoder();
      // using methods commonly present in EscPosEncoder from the repo
      const data = enc
        .initialize()
        .align("center")
        .line(text)
        .newline()
        .cut()
        .encode();
      return data;
    } else {
      // fallback: simple text + linefeed + cut
      const enc = new TextEncoder();
      const textBytes = enc.encode(text + "\n\n");
      const cut = new Uint8Array([0x1D, 0x56, 0x41, 0x10]); // GS V A n - partial cut
      const out = new Uint8Array(textBytes.length + cut.length);
      out.set(textBytes, 0);
      out.set(cut, textBytes.length);
      return out;
    }
  }

  // Barcode: attempt to use ESC/POS barcode command (EAN13 example). We will encode
  // the user text as CODE128 if length variable, but many printers support CODE128 via GS k.
  function buildBarcodeBytes(value) {
    // Many ESC/POS printers support CODE128 via GS k with m=73 or m=0? Implementation varies.
    // We'll attempt to use GS k (CODE128) with a basic wrapper. If printer doesn't accept, user will see error.
    const enc = new TextEncoder();
    // Center + barcode + newline
    const cmds = [];
    // center
    cmds.push(0x1B, 0x61, 0x01);
    // Barcode: GS k (Function) - use CODE128 (m=73 or 0x49) — but many implementations prefer specific framing.
    // For reliability fallback to printing barcode human-readable text if unsupported.
    try {
      // Try native ESC/POS print as CODE128: GS k 73 n d1..dn  (not universally supported)
      const dataBytes = enc.encode(value);
      const header = new Uint8Array([0x1D, 0x6B, 0x49, dataBytes.length]); // GS k 73 len
      const out = new Uint8Array(header.length + dataBytes.length + 3);
      out.set(header, 0);
      out.set(dataBytes, header.length);
      // newline + cut
      out.set([0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10], header.length + dataBytes.length);
      return out;
    } catch (e) {
      // fallback: text
      return buildTextBytes(value);
    }
  }

  // QR code: many printers support GS ( k or other sequences. We'll attempt a generic approach:
  function buildQrBytes(value) {
    // ESC/POS QR sequence (many printers):
    // [1] Store the data in the symbol storage area:
    // 1D 28 6B pL pH 49 50 30 [data]
    // [2] Set error correction and module size (may be optional)
    // [3] Print the symbol: 1D 28 6B 03 00 49 51 30
    const enc = new TextEncoder();
    const data = enc.encode(value);
    const storeHeader = [0x1D, 0x28, 0x6B];
    const pL = (data.length + 3) & 0xff;
    const pH = ((data.length + 3) >> 8) & 0xff;
    const store = new Uint8Array(3 + 2 + 3 + data.length); // header + pL pH + cmd + data
    store[0] = 0x1D; store[1] = 0x28; store[2] = 0x6B;
    store[3] = pL; store[4] = pH;
    store[5] = 0x31; store[6] = 0x50; store[7] = 0x30;
    store.set(data, 8);
    // Print command
    const printCmd = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
    // Compose: store + print + cut
    const out = new Uint8Array(store.length + printCmd.length + 4);
    out.set(store, 0);
    out.set(printCmd, store.length);
    out.set([0x0A, 0x0A, 0x1D, 0x56], store.length + printCmd.length); // NL NL GS V (cut may be partial)
    return out;
  }

  // Main print routine implementing copies and type
  async function handlePrint() {
    try {
      if (!isReady || !printerCharacteristic) {
        logStatus("Please connect to the printer first.");
        return;
      }

      let count = parseInt(copiesInput.value || "1", 10);
      if (!isFinite(count) || count < 1) count = 1;

      const type = (typeSelect.value || "text").toLowerCase();

      let payloads = []; // array of Uint8Array to send in order for one copy

      if (type === "image") {
        const files = imageInput.files;
        if (!files || files.length === 0) {
          alert("Please select an image file to print.");
          return;
        }
        // convert first file to raster payload
        const raster = await imageToRaster(files[0]);
        // add raster + feed + cut for a single copy
        payloads.push(raster);
        payloads.push(new Uint8Array([0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10])); // feed + cut
      } else if (type === "barcode") {
        payloads.push(buildBarcodeBytes(textInput.value || ""));
      } else if (type === "qrcode") {
        payloads.push(buildQrBytes(textInput.value || ""));
      } else { // text
        payloads.push(buildTextBytes(textInput.value || ""));
      }

      logStatus(`Printing ${count} copy(ies)...`);
      // send copies
      for (let i = 0; i < count; i++) {
        for (const payload of payloads) {
          const u8 = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
          await writeInChunks(printerCharacteristic, u8);
        }
        // small pause between copies
        await new Promise((res) => setTimeout(res, 200));
      }

      logStatus("Print sent");
    } catch (err) {
      console.error("Print error:", err);
      logStatus("Print failed: " + (err && err.message ? err.message : err));
    }
  }

  // Wire up type selection to show/hide image input
  typeSelect.addEventListener("change", () => {
    if (typeSelect.value === "image") {
      imageInputRow.style.display = "";
    } else {
      imageInputRow.style.display = "none";
    }
  });

  // Wire up buttons
  if (connectBtn) connectBtn.addEventListener("click", connect);
  if (disconnectBtn) disconnectBtn.addEventListener("click", disconnect);
  if (printBtn) printBtn.addEventListener("click", handlePrint);

  // initial UI state
  if (disconnectBtn) disconnectBtn.classList.add("hidden");
  logStatus("Ready");

  // Service worker registration (retain existing behavior)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/D30printerPWA/sw.js")
      .then(() => console.log("Service Worker registered"))
      .catch((e) => console.warn("SW registration failed:", e));
  }
});
