// Fix: Add missing Web Bluetooth types to fix compilation errors.
// This is normally solved by adding "webbluetooth" to compilerOptions.lib in tsconfig.json.
declare global {
    interface Navigator {
        bluetooth: {
            requestDevice(options?: any): Promise<BluetoothDevice>;
        };
    }

    interface BluetoothDevice {
        name?: string;
        addEventListener(type: string, listener: any): void;
        gatt?: {
            connect(): Promise<BluetoothRemoteGATTServer>;
            disconnect(): void;
        };
    }

    interface BluetoothRemoteGATTServer {
        getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
    }

    interface BluetoothRemoteGATTService {
        getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
    }

    interface BluetoothRemoteGATTCharacteristic {
        writeValueWithoutResponse(value: BufferSource): Promise<void>;
    }
}

import type { PrinterStatus } from '../types';

const PRINTER_NAME_PREFIX = 'D30';
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';
const MAX_CHUNK_SIZE = 100;

export class PrinterService {
    private static instance: PrinterService;
    private device: BluetoothDevice | null = null;
    private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
    
    public onStatusChange: (status: PrinterStatus) => void = () => {};

    private constructor() {}

    public static getInstance(): PrinterService {
        if (!PrinterService.instance) {
            PrinterService.instance = new PrinterService();
        }
        return PrinterService.instance;
    }

    private updateStatus(isConnected: boolean, deviceName: string | null) {
        this.onStatusChange({ isConnected, deviceName });
    }

    async connect(): Promise<void> {
        if (!navigator.bluetooth) {
            throw new Error('Web Bluetooth API is not available on this browser. Please use Chrome on Android, macOS, or Windows.');
        }

        try {
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: PRINTER_NAME_PREFIX }],
                optionalServices: [PRINTER_SERVICE_UUID],
            });

            if (!this.device) {
                throw new Error("No device selected.");
            }

            this.device.addEventListener('gattserverdisconnected', this.onDisconnected.bind(this));
            
            const server = await this.device.gatt?.connect();
            if (!server) {
                throw new Error("Failed to connect to GATT server.");
            }
            
            const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
            this.characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

            this.updateStatus(true, this.device.name || 'D30');

        } catch (error) {
            this.disconnect();
            throw error;
        }
    }

    private onDisconnected() {
        this.device = null;
        this.characteristic = null;
        this.updateStatus(false, null);
    }

    async disconnect(): Promise<void> {
        if (this.device) {
            this.device.gatt?.disconnect();
            // The onDisconnected event handler will clean up state.
        }
    }

    async print(data: Uint8Array): Promise<void> {
        if (!this.characteristic) {
            throw new Error('Printer is not connected or characteristic not found.');
        }

        for (let i = 0; i < data.length; i += MAX_CHUNK_SIZE) {
            const chunk = data.slice(i, i + MAX_CHUNK_SIZE);
            await this.characteristic.writeValueWithoutResponse(chunk);
        }
    }
}
