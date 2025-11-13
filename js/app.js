// js/app.js — D30 PWA using original D30 packet framing from odensc/phomemo-d30-web-bluetooth
// - uses service 0000ff00-0000-1000-8000-00805f9b34fb and characteristic 0000ff02-0000-1000-8000-00805f9b34fb
// - renders Text / Barcode / QR / Image to a canvas, converts to D30 print bytes and sends in 128-byte packets

document.addEventListener("DOMContentLoaded", () => {
  // ---------- UI ----------
  const connectBtn = document.getElementById("connect");
  const disconnectBtn = document.getElementById("disconnect");
  const printBtn = document.getElementById("print");
  const statusEl = document.getElementById("status");

  // create print controls if missing
  let controls = document.getElementById("print-controls");
  if (!controls) {
    controls = document.createElement("div");
    controls.id = "print-controls";
    controls.style.marginTop = "1rem";
    controls.innerHTML = `
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
      <div id="image-row" style="margin-bottom:.5rem; display:none;">
        <label>Image: <input id="print-image" type="file" accept="image/*"></label>
      </div>
      <div style="margin-bottom:.5rem">
        <label>Copies: <input id="print-copies" type="number" min="1" value="1" style="width:4rem"></label>
      </div>
    `;
    const main = document.querySelector("main") || document.body;
    main.appendChild(controls);
  }

  const textInput = document.getElementById("print-text");
  const typeSelect = document.getElementById("print-type");
  const imageRow = document.getElementById("image-row");
  const imageInput = document.getElementById("print-image");
  const copiesInput = document.getElementById("print-copies");

  typeSelect.addEventListener("change", () => {
    imageRow.style.display = typeSelect.value === "image" ? "" : "none";
  });

  // ---------- D30 constants & helpers (from original printer.js) ----------
  const PACKET_SIZE_BYTES = 128;

  // HEADER_DATA(mmWidthBytes, bytesPerRow)
  const HEADER_DATA = (mmWidth, bytes) =>
    new Uint8Array([
      0x1b,
      0x40,
      0x1d,
      0x76,
      0x30,
      0x00,
      mmWidth % 256,
      Math.floor(mmWidth / 256),
      bytes % 256,
      Math.floor(bytes / 256),
    ]);

  const END_DATA = new Uint8Array([0x1b, 0x64, 0x00]);

  function logStatus(msg) {
    console.log(msg);
    if (statusEl) statusEl.textContent = msg;
  }

  // pixel decision: returns 0 for black, 1 for white (matching original)
  function getWhitePixel(canvas, imageData, x, y) {
    const red = imageData[(canvas.width * y + x) * 4];
    const green = imageData[(canvas.width * y + x) * 4 + 1];
    const blue = imageData[(canvas.width * y + x) * 4 + 2];
    // original: red + green + blue > 0 ? 0 : 1  (0 -> black, 1 -> white)
    return red + green + blue > 0 ? 0 : 1;
  }

  // convert a canvas to the D30 data format: each 8 horizontal pixels -> 1 byte
  function getPrintData(canvas) {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bytesPerRow = canvas.width / 8;
    const data = new Uint8Array(bytesPerRow * canvas.height);
    let offset = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let k = 0; k < bytesPerRow; k++) {
        const k8 = k * 8;
        const b =
          getWhitePixel(canvas, imageData, k8 + 0, y) * 128 +
          getWhitePixel(canvas, imageData, k8 + 1, y) * 64 +
          getWhitePixel(canvas, imageData, k8 + 2, y) * 32 +
          getWhitePixel(canvas, imageData, k8 + 3, y) * 16 +
          getWhitePixel(canvas, imageData, k8 + 4, y) * 8 +
          getWhitePixel(canvas, imageData, k8 + 5, y) * 4 +
          getWhitePixel(canvas, imageData, k8 + 6, y) * 2 +
          getWhitePixel(canvas, imageData, k8 + 7, y);
        data[offset++] = b;
      }
    }
    return data;
  }

  // send print bytes (header + data + end) in 128-byte packets using characteristic write method
  async function sendPrintData(characteristic, mmWidth, printBytes) {
    // printBytes is Uint8Array of the per-row bytes (getPrintData output)
    const bytesPerRow = mmWidth / 8;
    const header = HEADER_DATA(mmWidth, bytesPerRow);
    // final data is header + printBytes
    const data = new Uint8Array(header.length + printBytes.length);
    data.set(header, 0);
    data.set(printBytes, header.length);

    // helper: choose write function
    const supportsWriteWithResponse = typeof characteristic.writeValueWithResponse === "function";
    const supportsWriteWithoutResponse = characteristic.properties && characteristic.properties.writeWithoutResponse;
    const supportsWrite = typeof characteristic.writeValue === "function";

    // We'll attempt writeValueWithResponse first (original used that), then fallback, chunking into PACKET_SIZE_BYTES
    const writeChunk = async (chunk) => {
      if (supportsWriteWithResponse) {
        return characteristic.writeValueWithResponse(chunk);
      } else if (supportsWrite && !supportsWriteWithoutResponse) {
        // characteristic.writeValue is likely write with response
        return characteristic.writeValue(chunk);
      } else if (supportsWriteWithoutResponse) {
        // some characteristics only allow writeWithoutResponse
        if (typeof characteristic.writeValueWithoutResponse === "function") {
          return characteristic.writeValueWithoutResponse(chunk);
        } else {
          // fallback: try writeValue
          return characteristic.writeValue(chunk);
        }
      } else {
        // as a last resort
        return characteristic.writeValue(chunk);
      }
    };

    // send in chunks
    for (let i = 0; i < data.length; i += PACKET_SIZE_BYTES) {
      const chunk = data.slice(i, Math.min(i + PACKET_SIZE_BYTES, data.length));
      await writeChunk(chunk);
      // tiny pause to give device time to handle stream
      await new Promise((r) => setTimeout(r, 20));
    }

    // send END_DATA
    await writeChunk(END_DATA);
    console.log("sendPrintData: done");
  }

  // Util to draw plain text on a canvas (wraps simple)
  function renderTextToCanvas(text, labelWidthMm = 40, labelHeightMm = 12, dpi = 203, fontSize = 20) {
    // Convert mm to pixels using dpi (203 dpi typical thermal) where 1 inch = 25.4 mm
    const pxPerMm = dpi / 25.4;
    const widthPx = Math.max(8, Math.floor(labelWidthMm * pxPerMm));
    const heightPx = Math.max(8, Math.floor(labelHeightMm * pxPerMm));
    // Ensure width is multiple of 8
    const widthAligned = Math.ceil(widthPx / 8) * 8;

    const canvas = document.createElement("canvas");
    canvas.width = widthAligned;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = "top";

    // simple wrap
    const padding = 4;
    const maxW = canvas.width - padding * 2;
    const words = (text || "").split(" ");
    let line = "";
    let y = padding;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + (line ? " " : "") + words[n];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxW && n > 0) {
        ctx.fillText(line, padding, y);
        line = words[n];
        y += fontSize + 2;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, padding, y);

    return canvas;
  }

  // Render barcode to canvas (simple visual: big text rotated)
  function renderBarcodeToCanvas(value, labelWidthMm = 40, labelHeightMm = 12, dpi = 203) {
    // For compatibility produce a human-readable barcode-like block (actual barcode support varies).
    const pxPerMm = dpi / 25.4;
    const widthPx = Math.max(8, Math.floor(labelWidthMm * pxPerMm));
    const heightPx = Math.max(8, Math.floor(labelHeightMm * pxPerMm));
    const widthAligned = Math.ceil(widthPx / 8) * 8;
    const canvas = document.createElement("canvas");
    canvas.width = widthAligned;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";

    // Draw thick vertical bars from hash of characters (simple barcode look)
    const barWidth = 2;
    let x = 4;
    for (let i = 0; i < value.length && x < canvas.width - 4; i++) {
      const code = value.charCodeAt(i);
      const bars = (code % 5) + 1;
      for (let b = 0; b < bars && x < canvas.width - 4; b++) {
        ctx.fillRect(x, 4, barWidth, canvas.height - 8);
        x += barWidth + 1;
      }
      x += 2;
    }

    // Draw human-readable at bottom
    ctx.font = "14px monospace";
    ctx.fillText(value.slice(0, 20), 4, canvas.height - 18);

    return canvas;
  }

  // Render QR code by fetching a QR image (Google Chart API) then drawing to canvas
  async function renderQrToCanvas(value, labelWidthMm = 40, labelHeightMm = 12, dpi = 203) {
    // Compose a QR PNG via Google Chart API (data sent via URL)
    const sizePx = 256;
    const url = "https://chart.googleapis.com/chart?cht=qr&chs=" + sizePx + "x" + sizePx + "&chl=" + encodeURIComponent(value);
    const img = new Image();
    img.crossOrigin = "anonymous";
    const p = new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = (e) => rej(e);
    });
    img.src = url;
    await p;

    // draw scaled to label
    const pxPerMm = dpi / 25.4;
    const widthPx = Math.max(8, Math.floor(labelWidthMm * pxPerMm));
    const heightPx = Math.max(8, Math.floor(labelHeightMm * pxPerMm));
    const widthAligned = Math.ceil(widthPx / 8) * 8;
    const canvas = document.createElement("canvas");
    canvas.width = widthAligned;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // center QR
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.9;
    const iw = img.width * scale;
    const ih = img.height * scale;
    ctx.drawImage(img, (canvas.width - iw) / 2, (canvas.height - ih) / 2, iw, ih);
    return canvas;
  }

  // convert uploaded image file to canvas scaled to the label size
  async function renderImageFileToCanvas(file, labelWidthMm = 40, labelHeightMm = 12, dpi = 203) {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = (e) => rej(e);
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.src = dataUrl;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });

    const pxPerMm = dpi / 25.4;
    const widthPx = Math.max(8, Math.floor(labelWidthMm * pxPerMm));
    const heightPx = Math.max(8, Math.floor(labelHeightMm * pxPerMm));
    const widthAligned = Math.ceil(widthPx / 8) * 8;
    const canvas = document.createElement("canvas");
    canvas.width = widthAligned;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // fit image preserving aspect ratio
    const s = Math.min(canvas.width / img.width, canvas.height / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    return canvas;
  }

  // ---------- Bluetooth / State ----------
  const SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
  const CHAR_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";

  let device = null;
  let server = null;
  let char = null;
  let ready = false;

  function onDisconnected() {
    logStatus("Device disconnected");
    ready = false;
    char = null;
    device = null;
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
  }

  async function connect() {
    try {
      if (!("bluetooth" in navigator)) {
        alert("Web Bluetooth not available. Use Chrome/Edge or enable flags in Brave.");
        return;
      }
      logStatus("Selecting device (chooser) ...");
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "D30" }],
        optionalServices: [SERVICE_UUID],
      });
      if (!device) {
        logStatus("No device selected");
        return;
      }
      device.addEventListener("gattserverdisconnected", onDisconnected);
      logStatus("Connecting to GATT server ...");
      server = await device.gatt.connect();
      logStatus("Getting service ...");
      const service = await server.getPrimaryService(SERVICE_UUID);
      logStatus("Getting characteristic ...");
      char = await service.getCharacteristic(CHAR_UUID);
      // char may support writeWithoutResponse, writeValueWithResponse etc.
      ready = true;
      connectBtn.classList.add("hidden");
      disconnectBtn.classList.remove("hidden");
      logStatus(`Connected: ${device.name || device.id}`);
    } catch (e) {
      console.error("Connect error", e);
      logStatus("Connect failed: " + (e && e.message ? e.message : e));
      ready = false;
    }
  }

  async function disconnect() {
    try {
      if (device && device.gatt && device.gatt.connected) {
        device.gatt.disconnect();
      }
    } catch (e) {
      console.error(e);
    } finally {
      onDisconnected();
    }
  }

  // ---------- print handling ----------
  async function handlePrint() {
    try {
      if (!ready || !char) {
        logStatus("Please connect to the printer first.");
        return;
      }

      let copies = parseInt(copiesInput.value || "1", 10);
      if (!isFinite(copies) || copies < 1) copies = 1;

      const type = (typeSelect.value || "text").toLowerCase();
      let canvas = null;

      if (type === "image") {
        const files = imageInput.files;
        if (!files || files.length === 0) {
          alert("Please select an image file.");
          return;
        }
        canvas = await renderImageFileToCanvas(files[0]);
      } else if (type === "barcode") {
        canvas = renderBarcodeToCanvas(textInput.value || "");
      } else if (type === "qrcode") {
        canvas = await renderQrToCanvas(textInput.value || "");
      } else {
        // text
        canvas = renderTextToCanvas(textInput.value || "");
      }

      // get D30 bytes and send (copies times)
      const dataBytes = getPrintData(canvas); // Uint8Array of pixels per original format
      for (let i = 0; i < copies; i++) {
        logStatus(`Printing copy ${i + 1} of ${copies} ...`);
        await sendPrintData(char, canvas.width, dataBytes);
        // small delay between copies
        await new Promise((r) => setTimeout(r, 300));
      }
      logStatus("Printing done");
    } catch (err) {
      console.error("Print error:", err);
      logStatus("Print failed: " + (err && err.message ? err.message : err));
    }
  }

  // ---------- wire up ----------
  if (connectBtn) connectBtn.addEventListener("click", connect);
  if (disconnectBtn) disconnectBtn.addEventListener("click", disconnect);
  if (printBtn) printBtn.addEventListener("click", handlePrint);

  if (disconnectBtn) disconnectBtn.classList.add("hidden");
  logStatus("Ready");

  // register service worker as before if present
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/D30printerPWA/sw.js")
      .then(() => console.log("Service Worker registered"))
      .catch((e) => console.warn("SW registration failed:", e));
  }
});
