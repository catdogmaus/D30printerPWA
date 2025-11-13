let device, server, service, char;
const SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
const CHAR_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
const log = msg => {
  console.log(msg);
  const el = document.getElementById("log-output");
  if (el) el.textContent += msg + "\n";
};

async function connect() {
  try {
    log("Requesting Bluetooth device...");
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });
    log("Connecting...");
    server = await device.gatt.connect();
    service = await server.getPrimaryService(SERVICE_UUID);
    char = await service.getCharacteristic(CHAR_UUID);
    window.char = char;
    log("Connected to " + device.name);
  } catch (e) {
    log("Connect error: " + e);
  }
}

async function disconnect() {
  if (device && device.gatt.connected) {
    device.gatt.disconnect();
    log("Disconnected");
  }
}

function textToBitmapBytes(text, width = 384) {
  // Placeholder: build 1-bit dummy bitmap (later can use real canvas rendering)
  const bytes = new Uint8Array(width * 8).fill(0xff);
  return bytes;
}

async function writeChunks(characteristic, data) {
  const chunkSize = 180;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    try {
      if (characteristic.writeValueWithoutResponse)
        await characteristic.writeValueWithoutResponse(chunk);
      else await characteristic.writeValue(chunk);
      await new Promise(r => setTimeout(r, 20));
    } catch (e) {
      log("Chunk write failed: " + e);
      throw e;
    }
  }
}

async function handlePrint() {
  if (!char) return log("Please connect first");
  const text = document.getElementById("textInput").value || " ";
  const width = parseInt(document.getElementById("labelWidth").value) || 40;
  const height = parseInt(document.getElementById("labelHeight").value) || 12;
  const copies = parseInt(document.getElementById("copies").value) || 1;
  const protocol = document.getElementById("protocol").value;

  log(`Printing: "${text}" (${copies}x) via ${protocol}`);

  const pixelBytes = textToBitmapBytes(text, width);
  try {
    if (protocol === "d30_header") {
      const init = new Uint8Array([0x1b, 0x40]);
      const start = new Uint8Array([0x1f, 0x11, 0x00]);
      const tail = new Uint8Array([0x0a, 0x0a, 0x04]);
      const frames = [init, start, pixelBytes, tail];
      for (let i = 0; i < copies; i++) {
        for (const f of frames) await writeChunks(char, f);
      }
    } else if (protocol === "escpos") {
      const esc = new TextEncoder().encode(text + "\n\n");
      for (let i = 0; i < copies; i++) await writeChunks(char, esc);
    }
    log("Printing done");
  } catch (e) {
    log("Print error: " + e);
  }
}

document.getElementById("connectBtn").addEventListener("click", connect);
document.getElementById("disconnectBtn").addEventListener("click", disconnect);
document.getElementById("printBtn").addEventListener("click", handlePrint);

const textInput = document.getElementById("textInput");
const preview = document.getElementById("preview");
textInput.addEventListener("input", () => (preview.textContent = textInput.value));
preview.textContent = textInput.value;
