
export enum ElementType {
    TEXT = 'text',
    BARCODE = 'barcode',
    QR_CODE = 'qr_code',
}

interface BaseElement {
    id: string;
    type: ElementType;
    x: number;
    y: number;
    rotate: number;
}

export interface TextElement extends BaseElement {
    type: ElementType.TEXT;
    text: string;
    fontSize: number;
}

export interface BarcodeElement extends BaseElement {
    type: ElementType.BARCODE;
    data: string;
    width: number;
    height: number;
    format: string; // e.g., 'CODE128'
    displayValue: boolean;
}

export interface QrElement extends BaseElement {
    type: ElementType.QR_CODE;
    data: string;
    size: number;
}

export type LabelElement = TextElement | BarcodeElement | QrElement;

export interface LabelConfig {
    width: number; // in mm
    height: number; // in mm
}

export interface PrinterStatus {
    isConnected: boolean;
    deviceName: string | null;
}
