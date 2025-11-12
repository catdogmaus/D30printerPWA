class D30 {
    async print(width, height, data) {
        const header = this.getHeader(width, height);
        const start = [0x1b, 0x40];
        const end = [0x1d, 0x0c];
        const result = [...start, ...header, ...data, ...end];
        return new Uint8Array(result);
    }

    getHeader(width, height) {
        const w = this.numToBytes(width * 8, 2);
        const h = this.numToBytes(height * 8, 2);
        return [0x1d, 0x77, w[1], w[0], 0x1d, 0x68, h[1], h[0]];
    }

    numToBytes(num, len) {
        const arr = new Array(len).fill(0);
        for (let i = 0; i < len; i++) {
            arr[i] = num % 256;
            num = Math.floor(num / 256);
        }
        return arr;
    }
}

let bleCharacteristic;

const connectButton = document.getElementById('connect');
const disconnectButton = document.getElementById('disconnect');
const mainContent = document.getElementById('main');
const imageFileInput = document.getElementById('imageFile');
const printImageButton = document.getElementById('printImage');
const previewCanvas = document.getElementById('preview');

const connect = async () => {
    try {
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [0xfee7] }],
        });
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(0xfee7);
        bleCharacteristic = await service.getCharacteristic(0xfec8);
        device.addEventListener('gattserverdisconnected', onDisconnected);
        
        connectButton.classList.add('hidden');
        disconnectButton.classList.remove('hidden');
        mainContent.classList.remove('hidden');

    } catch (error) {
        console.error("Connection failed:", error);
    }
};

const disconnect = () => {
    if (bleCharacteristic && bleCharacteristic.service.device.gatt.connected) {
        bleCharacteristic.service.device.gatt.disconnect();
    }
};

const onDisconnected = () => {
    console.log("Device disconnected");
    connectButton.classList.remove('hidden');
    disconnectButton.classList.add('hidden');
    mainContent.classList.add('hidden');
};

const send = (data) => {
    if (!bleCharacteristic) {
        alert("Not connected to a printer!");
        return;
    }
    return bleCharacteristic.writeValue(data);
};

const printText = async () => {
    const labelWidth = parseInt(document.getElementById('labelWidth').value, 10);
    const labelHeight = parseInt(document.getElementById('labelHeight').value, 10);
    const text = document.getElementById('text').value;
    const fontSize = parseInt(document.getElementById('fontSize').value, 10);
    const offsetX = parseInt(document.getElementById('offsetX').value, 10);
    const offsetY = parseInt(document.getElementById('offsetY').value, 10);

    const encoder = new EscPosEncoder();
    const result = encoder
        .initialize()
        .text(text, {
            font: 'arial',
            width: labelWidth * 8,
            height: labelHeight * 8,
            align: 'left',
            style: 'normal',
            size: fontSize,
            x: offsetX,
            y: offsetY,
        })
        .encode();

    const d30 = new D30();
    const printData = await d30.print(labelWidth, labelHeight, result);
    send(printData);
};

const printImage = async () => {
    const labelWidth = parseInt(document.getElementById('labelWidth').value, 10);
    const labelHeight = parseInt(document.getElementById('labelHeight').value, 10);
    const imageWidth = parseInt(document.getElementById('imageWidth').value, 10);
    const useDithering = document.getElementById('dithering').checked;

    const ctx = previewCanvas.getContext('2d');
    const image = new Image();
    image.onload = async () => {
        const ratio = image.height / image.width;
        previewCanvas.width = imageWidth;
        previewCanvas.height = imageWidth * ratio;
        ctx.drawImage(image, 0, 0, previewCanvas.width, previewCanvas.height);
        const imageData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

        const encoder = new EscPosEncoder();
        const result = encoder
            .initialize()
            .image(imageData, useDithering)
            .encode();

        const d30 = new D30();
        const printData = await d30.print(labelWidth, labelHeight, result);
        send(printData);
    };
    image.src = URL.createObjectURL(imageFileInput.files[0]);
};

connectButton.onclick = connect;
disconnectButton.onclick = disconnect;
document.getElementById('printText').onclick = printText;
printImageButton.onclick = printImage;

imageFileInput.onchange = () => {
    printImageButton.disabled = !imageFileInput.files.length;
};
