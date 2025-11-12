// D30 Printer PWA — Patched app.js
// Compatible with Brave/Chrome on Android & Desktop

let device, server, printerCharacteristic;

const connectButton = document.getElementById("connect");
const disconnectButton = document.getElementById("disconnect");
const printButton = document.getElementById("print");
const statusElement = document.getElementById("status");

function updateStatus(message) {
  console.log(message);
  if (statusElement) statusElement.textContent = message;
}

// Connect to Bluetooth printer
async function connect() {
  try {
    updateStatus("Requesting Bluetooth device...");

    // ✅ Correct filter: show Phomemo D30 printers and similar
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "D30" }],
      optionalServices: [0xff00],
    });

    updateStatus(`Connecting to ${device.name || "device"}...`);
    server = await device.gatt.connect();

    // Try to get the main printer service
    const service = await server.getPrimaryService(0xff00);
    const characteristics = await service.getCharacteristics();
    printerCharacteristic = characteristics[0];

    updateStatus(`Connected to ${device.name}`);
    connectButton.classList.add("hidden");
    disconnectButton.classList.remove("hidden");

    // Auto handle disconnection
    device.addEventListener("gattserverdisconnected", onDisconnected);
  } catch (error) {
    console.error(error);
    updateStatus("Connection failed: " + error.message);
  }
}

// Disconnect the printer
async function disconnect() {
  try {
    if (device && device.gatt.connected) {
      updateStatus("Disconnecting...");
      await device.gatt.disconnect();
      updateStatus("Disconnected");
    }
  } catch (error) {
    console.error(error);
    updateStatus("Error during disconnect: " + error.message);
  } finally {
    connectButton.classList.remove("hidden");
    disconnectButton.classList.add("hidden");
  }
}

// Handle automatic disconnection
function onDisconnected() {
  updateStatus("Device disconnected");
  connectButton.classList.remove("hidden");
  disconnectButton.classList.add("hidden");
}

// Print a demo label
async function printDemo() {
  try {
    if (!printerCharacteristic) {
      updateStatus("Not connected to printer");
      return;
    }

    updateStatus("Printing demo...");

    // Use EscPosEncoder if available
    let encoder;
    if (window.EscPosEncoder) {
      encoder = new EscPosEncoder();
      const data = encoder
        .initialize()
        .align("center")
        .line("D30 Printer PWA")
        .newline()
        .line("Bluetooth OK ✅")
        .newline()
        .line("Hello from Web Bluetooth!")
        .newline()
        .cut()
        .encode();
      await printerCharacteristic.writeValue(data);
    } else {
      // Fallback raw data
      const text = "D30 Printer PWA\nHello!\n\n";
      const enc = new TextEncoder();
      await printerCharacteristic.writeValue(enc.encode(text));
    }

    updateStatus("Print sent successfully");
  } catch (error) {
    console.error(error);
    updateStatus("Print failed: " + error.message);
  }
}

// Event listeners (safe)
if (connectButton) connectButton.addEventListener("click", connect);
if (disconnectButton) disconnectButton.addEventListener("click", disconnect);
if (printButton) printButton.addEventListener("click", printDemo);

// Initial status
updateStatus("Ready to connect");

// Warn user if Bluetooth API missing
if (!("bluetooth" in navigator)) {
  alert(
    "⚠️ Web Bluetooth is not available in this browser.\n\nPlease use Chrome, Edge, or enable Experimental Web Platform features in Brave."
  );
}
