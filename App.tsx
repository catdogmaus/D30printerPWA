
import React, { useState, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { ControlsPanel } from './components/ControlsPanel';
import { CanvasPreview } from './components/CanvasPreview';
import { PrinterService } from './services/printerService';
import { generatePrintCommands } from './services/labelGenerator';
import type { LabelElement, LabelConfig, PrinterStatus } from './types';
import { ElementType } from './types';

const ConnectionGuide: React.FC = () => (
    <div className="flex flex-col h-full justify-center text-gray-300">
        <h2 className="text-xl font-bold text-cyan-400 mb-4 text-center">Welcome!</h2>
        <div className="bg-gray-700 rounded-lg p-4 border border-gray-600">
            <h3 className="font-semibold text-lg mb-2">How to Connect:</h3>
            <ol className="list-decimal list-inside space-y-2">
                <li>Make sure your printer is turned on.</li>
                <li>Enable Bluetooth on your device.</li>
                <li>
                    <strong>On Android, also enable Location services.</strong>
                    <span className="text-sm block text-gray-400">This is required by Android to scan for Bluetooth devices.</span>
                </li>
                <li>Click the 'Connect' button above.</li>
                <li>Select your printer (e.g., "D30") from the list.</li>
            </ol>
        </div>
    </div>
);


const App: React.FC = () => {
    const [printerStatus, setPrinterStatus] = useState<PrinterStatus>({ isConnected: false, deviceName: null });
    const [elements, setElements] = useState<LabelElement[]>([]);
    const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
    const [labelConfig, setLabelConfig] = useState<LabelConfig>({ width: 30, height: 12 });
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const printerService = PrinterService.getInstance();

    useEffect(() => {
        printerService.onStatusChange = setPrinterStatus;
    }, [printerService]);

    const handleConnect = useCallback(async () => {
        setError(null);
        if (printerStatus.isConnected) {
            await printerService.disconnect();
        } else {
            setIsLoading(true);
            try {
                await printerService.connect();
            } catch (err) {
                const error = err as Error;

                // Don't show an error if the user just cancels the device picker.
                if (error.name === 'NotFoundError') {
                    return; // The finally block will still run to set loading to false
                }
                
                let errorMessage = error.message;
                if (errorMessage.includes('Web Bluetooth API is not available')) {
                    errorMessage = 'Web Bluetooth is not supported by your browser. Please use Chrome on Android, Windows, or macOS.';
                } else if (error.name === 'NotAllowedError') {
                    errorMessage = 'Bluetooth permission was denied. Please grant permission in your browser settings and try again.';
                } else {
                    // Generic catch-all with helpful tip for the most common Android issue.
                    errorMessage = `Connection failed. On Android, please ensure both Bluetooth and Location services are enabled. (${error.message})`;
                }
                setError(errorMessage);

            } finally {
                setIsLoading(false);
            }
        }
    }, [printerStatus.isConnected, printerService]);

    const handlePrint = useCallback(async () => {
        if (!printerStatus.isConnected) {
            setError("Printer is not connected.");
            return;
        }
        setError(null);
        setIsLoading(true);
        try {
            const commands = await generatePrintCommands(elements, labelConfig);
            await printerService.print(commands);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [printerStatus.isConnected, elements, labelConfig, printerService]);
    
    const handleAddElement = (type: ElementType) => {
        const newElement: LabelElement = {
            id: Date.now().toString(),
            type,
            x: 10,
            y: 10,
            ...(type === ElementType.TEXT && { text: 'Hello World', fontSize: 24, rotate: 0 }),
            ...(type === ElementType.BARCODE && { data: '123456789', width: 2, height: 50, format: 'CODE128', displayValue: true, rotate: 0 }),
            ...(type === ElementType.QR_CODE && { data: 'https://react.dev', size: 80, rotate: 0 }),
        };
        setElements(prev => [...prev, newElement]);
        setSelectedElementId(newElement.id);
    };
    
    const handleUpdateElement = (updatedElement: LabelElement) => {
        setElements(prev => prev.map(el => el.id === updatedElement.id ? updatedElement : el));
    };

    const handleDeleteElement = (id: string) => {
        setElements(prev => prev.filter(el => el.id !== id));
        if (selectedElementId === id) {
            setSelectedElementId(null);
        }
    };
    
    const handleClearCanvas = () => {
        setElements([]);
        setSelectedElementId(null);
    };

    const selectedElement = elements.find(el => el.id === selectedElementId) || null;

    return (
        <div className="min-h-screen flex flex-col bg-gray-900 font-sans">
            <Header 
                onConnect={handleConnect}
                status={printerStatus}
                isLoading={isLoading && !printerStatus.isConnected}
            />
            {error && (
                <div className="bg-red-500 text-white p-3 text-center fixed top-16 w-full z-50 whitespace-pre-line">
                    Error: {error}
                </div>
            )}
            <main className="flex-grow flex flex-col lg:flex-row p-4 gap-4 mt-16">
                <div className="w-full lg:w-1/3 xl:w-1/4 bg-gray-800 rounded-lg p-4 shadow-lg overflow-y-auto max-h-[calc(100vh-100px)]">
                    {printerStatus.isConnected ? (
                        <ControlsPanel
                            elements={elements}
                            selectedElement={selectedElement}
                            labelConfig={labelConfig}
                            onAddElement={handleAddElement}
                            onUpdateElement={handleUpdateElement}
                            onDeleteElement={handleDeleteElement}
                            onUpdateLabelConfig={setLabelConfig}
                            onSelectElement={setSelectedElementId}
                        />
                    ) : (
                        <ConnectionGuide />
                    )}
                </div>
                <div className="flex-grow flex items-center justify-center bg-gray-800 rounded-lg p-4 shadow-lg">
                    <CanvasPreview
                        elements={elements}
                        labelConfig={labelConfig}
                        selectedElementId={selectedElementId}
                        onSelectElement={setSelectedElementId}
                        onUpdateElement={handleUpdateElement}
                    />
                </div>
            </main>
            <footer className="sticky bottom-0 bg-gray-800 bg-opacity-80 backdrop-blur-sm p-4 border-t border-gray-700 flex justify-center items-center gap-4">
                 <button 
                    onClick={handleClearCanvas}
                    className="px-6 py-3 bg-yellow-600 text-white font-bold rounded-lg shadow-md hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    Clear Canvas
                </button>
                <button 
                    onClick={handlePrint}
                    disabled={!printerStatus.isConnected || isLoading || elements.length === 0}
                    className="px-8 py-4 bg-cyan-600 text-white font-bold text-lg rounded-lg shadow-lg hover:bg-cyan-700 transition-transform transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
                >
                    {isLoading ? 'Printing...' : 'Print Label'}
                </button>
            </footer>
        </div>
    );
};

export default App;
