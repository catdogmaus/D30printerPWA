
import type { LabelElement, LabelConfig } from '../types';
import { ElementType } from '../types';

// These are globals from the script tags in index.html
declare var JsBarcode: any;
declare var QRCode: any;

const DOTS_PER_MM = 8;

export const generatePrintCommands = async (elements: LabelElement[], config: LabelConfig): Promise<Uint8Array> => {
    const canvasWidth = config.width * DOTS_PER_MM;
    const canvasHeight = config.height * DOTS_PER_MM;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Could not create canvas context');
    }

    // Fill background with white
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    ctx.fillStyle = 'black';
    ctx.strokeStyle = 'black';

    for (const el of elements) {
        ctx.save();
        
        // Handle rotation
        if (el.rotate) {
            ctx.translate(el.x, el.y);
            ctx.rotate(el.rotate * Math.PI / 180);
            ctx.translate(-el.x, -el.y);
        }

        switch (el.type) {
            case ElementType.TEXT:
                ctx.font = `${el.fontSize}px sans-serif`;
                ctx.textBaseline = 'top';
                ctx.fillText(el.text, el.x, el.y);
                break;
            case ElementType.BARCODE: {
                const barcodeCanvas = document.createElement('canvas');
                try {
                    JsBarcode(barcodeCanvas, el.data, {
                        format: el.format,
                        width: el.width,
                        height: el.height,
                        displayValue: el.displayValue,
                        margin: 0
                    });
                    ctx.drawImage(barcodeCanvas, el.x, el.y);
                } catch (e) {
                    console.error("JsBarcode error:", e);
                    // Draw an error box
                    ctx.strokeRect(el.x, el.y, 100, el.height);
                    ctx.fillText("Barcode Error", el.x + 5, el.y + 10);
                }
                break;
            }
            case ElementType.QR_CODE: {
                const qrCanvas = document.createElement('canvas');
                qrCanvas.width = el.size;
                qrCanvas.height = el.size;
                await QRCode.toCanvas(qrCanvas, el.data, { width: el.size, margin: 0 });
                ctx.drawImage(qrCanvas, el.x, el.y);
                break;
            }
        }
        ctx.restore();
    }
    
    return createPrintPayload(ctx, canvasWidth, canvasHeight);
};


const createPrintPayload = (ctx: CanvasRenderingContext2D, width: number, height: number): Uint8Array => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const widthBytes = width / 8;
    const bitmap = new Uint8Array(widthBytes * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            
            // Grayscale and threshold
            const lightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (lightness < 128) { // Black pixel
                const byteIndex = y * widthBytes + Math.floor(x / 8);
                const bitIndex = 7 - (x % 8);
                bitmap[byteIndex] |= (1 << bitIndex);
            }
        }
    }
    
    const commands: number[] = [];

    // Initialize printer
    commands.push(0x1B, 0x40);

    // Set label size
    commands.push(0x1D, 0x6C, 0, 0); // Not sure this is correct for D30, but it's a common command

    // Command to send raster bitmap
    // GS v 0 m xL xH yL yH ...d
    commands.push(0x1D, 0x76, 0x30, 0x00);
    commands.push(widthBytes & 0xFF, (widthBytes >> 8) & 0xFF);
    commands.push(height & 0xFF, (height >> 8) & 0xFF);
    
    // Add bitmap data
    commands.push(...bitmap);

    // Print and feed paper
    commands.push(0x0C);
    
    return new Uint8Array(commands);
};
