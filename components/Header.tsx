
import React from 'react';
import type { PrinterStatus } from '../types';
import { IconBluetooth, IconBluetoothConnected, IconLoader } from './Icons';

interface HeaderProps {
    onConnect: () => void;
    status: PrinterStatus;
    isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onConnect, status, isLoading }) => {
    return (
        <header className="fixed top-0 left-0 right-0 bg-gray-800 bg-opacity-80 backdrop-blur-sm shadow-md p-4 flex justify-between items-center z-10 border-b border-gray-700">
            <h1 className="text-xl md:text-2xl font-bold text-cyan-400">
                Phomemo D30 Web Printer
            </h1>
            <div className="flex items-center gap-4">
                 {status.isConnected && (
                    <span className="text-sm text-gray-300 hidden sm:block">
                        Connected to: <span className="font-semibold text-cyan-300">{status.deviceName}</span>
                    </span>
                )}
                <button
                    onClick={onConnect}
                    disabled={isLoading}
                    className={`px-4 py-2 font-semibold rounded-lg flex items-center gap-2 transition-colors duration-200
                        ${status.isConnected 
                            ? 'bg-red-600 hover:bg-red-700 text-white' 
                            : 'bg-cyan-600 hover:bg-cyan-700 text-white'}
                        disabled:opacity-50 disabled:cursor-wait`}
                >
                    {isLoading ? (
                        <IconLoader className="animate-spin" />
                    ) : status.isConnected ? (
                        <IconBluetoothConnected />
                    ) : (
                        <IconBluetooth />
                    )}
                    <span>
                        {isLoading ? 'Connecting...' : status.isConnected ? 'Disconnect' : 'Connect'}
                    </span>
                </button>
            </div>
        </header>
    );
};
