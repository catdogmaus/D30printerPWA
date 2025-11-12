
import React, { useRef, useEffect, useState } from 'react';
import type { LabelElement, LabelConfig, TextElement, BarcodeElement, QrElement } from '../types';
import { ElementType } from '../types';

declare var JsBarcode: any;
declare var QRCode: any;

interface CanvasPreviewProps {
    elements: LabelElement[];
    labelConfig: LabelConfig;
    selectedElementId: string | null;
    onSelectElement: (id: string | null) => void;
    onUpdateElement: (element: LabelElement) => void;
}

const DOTS_PER_MM = 8;
const DISPLAY_SCALING = 2.5; // Scale up for better viewing on screen

export const CanvasPreview: React.FC<CanvasPreviewProps> = ({
    elements,
    labelConfig,
    selectedElementId,
    onSelectElement,
    onUpdateElement,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [draggingElement, setDraggingElement] = useState<{ id: string, offsetX: number, offsetY: number } | null>(null);

    const draw = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const el of elements) {
            ctx.save();
            if (el.rotate) {
                ctx.translate(el.x, el.y);
                ctx.rotate(el.rotate * Math.PI / 180);
                ctx.translate(-el.x, -el.y);
            }
            ctx.fillStyle = 'black';

            switch (el.type) {
                case ElementType.TEXT:
                    ctx.font = `${(el as TextElement).fontSize}px sans-serif`;
                    ctx.textBaseline = 'top';
                    ctx.fillText((el as TextElement).text, el.x, el.y);
                    break;
                case ElementType.BARCODE:
                    const barcodeEl = el as BarcodeElement;
                    const barcodeCanvas = document.createElement('canvas');
                    try {
                        JsBarcode(barcodeCanvas, barcodeEl.data, {
                            format: barcodeEl.format,
                            width: barcodeEl.width,
                            height: barcodeEl.height,
                            displayValue: barcodeEl.displayValue,
                            margin: 0
                        });
                        ctx.drawImage(barcodeCanvas, el.x, el.y);
                    } catch (e) {
                         ctx.strokeStyle = 'red';
                         ctx.strokeRect(el.x, el.y, 100, barcodeEl.height);
                         ctx.fillText("Barcode Error", el.x + 5, el.y + 10);
                    }
                    break;
                case ElementType.QR_CODE:
                    const qrEl = el as QrElement;
                    const qrCanvas = document.createElement('canvas');
                    await QRCode.toCanvas(qrCanvas, qrEl.data, { width: qrEl.size, margin: 0 });
                    ctx.drawImage(qrCanvas, el.x, el.y);
                    break;
            }
            ctx.restore();

            if (el.id === selectedElementId) {
                ctx.strokeStyle = '#0891b2'; // cyan-600
                ctx.lineWidth = 2;
                const { width, height } = getElementBounds(el);
                ctx.strokeRect(el.x - 2, el.y - 2, width + 4, height + 4);
            }
        }
    };

    useEffect(() => {
        draw();
    }, [elements, labelConfig, selectedElementId]);


    const getElementBounds = (el: LabelElement): { width: number, height: number } => {
        // This is a rough estimation for bounding box, could be improved.
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return {width: 50, height: 20};

        switch(el.type){
            case ElementType.TEXT:
                tempCtx.font = `${el.fontSize}px sans-serif`;
                const metrics = tempCtx.measureText(el.text);
                return { width: metrics.width, height: el.fontSize};
            case ElementType.BARCODE:
                return { width: 200, height: el.height }; // JsBarcode doesn't give easy width
            case ElementType.QR_CODE:
                return { width: el.size, height: el.size };
            default:
                return { width: 50, height: 20 };
        }
    }


    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        let foundElement = false;
        // Iterate backwards to select top-most element
        for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i];
            const bounds = getElementBounds(el);
            if (x >= el.x && x <= el.x + bounds.width && y >= el.y && y <= el.y + bounds.height) {
                onSelectElement(el.id);
                setDraggingElement({ id: el.id, offsetX: x - el.x, offsetY: y - el.y });
                foundElement = true;
                break;
            }
        }
        if (!foundElement) {
             onSelectElement(null);
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!draggingElement) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        const originalElement = elements.find(el => el.id === draggingElement.id);
        if (originalElement) {
             onUpdateElement({
                ...originalElement,
                x: x - draggingElement.offsetX,
                y: y - draggingElement.offsetY,
            });
        }
    };

    const handleMouseUp = () => {
        setDraggingElement(null);
    };


    const canvasPixelWidth = labelConfig.width * DOTS_PER_MM;
    const canvasPixelHeight = labelConfig.height * DOTS_PER_MM;
    
    return (
        <div style={{ aspectRatio: `${canvasPixelWidth} / ${canvasPixelHeight}` }} className="max-w-full max-h-full">
            <canvas
                ref={canvasRef}
                width={canvasPixelWidth}
                height={canvasPixelHeight}
                className="w-full h-full object-contain cursor-pointer shadow-lg border-2 border-dashed border-gray-600 rounded-md"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />
        </div>
    );
};
