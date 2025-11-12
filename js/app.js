// js/app.js — D30 printer PWA (DOMContentLoaded safe version)

document.addEventListener("DOMContentLoaded", () => {
  const connectButton = document.getElementById("connect");
  const disconnectButton = document.getElementById("disconnect");
  const printButton = document.getElementById("print");
  const statusEl = document.getElementById("status");

  let bleCharacteristic = null;
  let connectedDevice = null;

  const PRINTER_NAME_PREFIX = "D30";
  const PRINTER_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
  const PRINTER_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

  function updateStatus(connected, name = "") {
    statusEl.textContent = connected ? `Connected to ${name}` : "Not connected";
  }

  function onDisconnected() {
    console.log("Device disconnected");
    bleCharacteristic = null;
    connectedDevice = null;
    connectButton.classList.remove("hidden");
    disconnectButton.classList.add("hidden");
    updateStatus(false);
  }

  async function connect() {
    try {
      if (!navigator.bluetooth) {
        alert(
          "Web Bluetooth is not available in this browser.\n" +
            "Use Chrome / Edge on Android, macOS or Windows."
        );
        return;
      }

      console.log("Requesting D30 printer…");
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: PRINTER_NAME_PREFIX }],
        optionalServices: [PRINTER_SERVICE_UUID],
      });

      if (!device) {
        console.warn("No device selected.");
        return;
      }

      connectedDevice = device;
      connectedDevice.addEventListener("gattserverdisconnected", onDisconnected);

      const server = await connectedDevice.gatt.connect();
      const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
      bleCharacteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

      connectButton.classList.add("hidden");
      disconnectButton.classList.remove("hidden");
      updateStatus(true, connectedDevice.name || "D30");
      console.log("Connected to", connectedDevice.name);
    } catch (err) {
      console.error("Bluetooth connect failed:", err);
      alert("Bluetooth connect failed: " + (err.message || err));
      disconnect();
    }
  }

  async function disconnect() {
    try {
      if (connectedDevice && connectedDevice.gatt.connected) {
        console.log("Disconnecting…");
        connectedDevice.gatt.disconnect();
      }
    } catch (err) {
      console.error("Disconnect error:", err);
    } finally {
      onDisconnected();
    }
  }

  async function printDemo() {
    if (!bleCharacteristic) {
      alert("Please connect to the printer first.");
      return;
    }

    try {
      console.log("Sending demo data to printer…");
      const encoder = new EscPosEncoder();
      const data = encoder.initialize().text("Hello from D30 PWA!").newline().encode();
      await bleCharacteristic.writeValue(data);
      console.log("Print data sent.");
    } catch (err) {
      console.error("Print failed:", err);
      alert("Print failed: " + (err.message || err));
    }
  }

  connectButton.addEventListener("click", connect);
  disconnectButton.addEventListener("click", disconnect);
  printButton.addEventListener("click", printDemo);

  updateStatus(false);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/D30printerPWA/sw.js")
      .then(() => console.log("Service Worker registered."))
      .catch((err) => console.error("Service Worker registration failed:", err));
  }
});
