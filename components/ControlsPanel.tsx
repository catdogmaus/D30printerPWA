
import React from 'react';
import type { LabelElement, LabelConfig, TextElement, BarcodeElement, QrElement } from '../types';
import { ElementType } from '../types';
import { IconBarcode, IconQrCode, IconText, IconTrash } from './Icons';

interface ControlsPanelProps {
    elements: LabelElement[];
    selectedElement: LabelElement | null;
    labelConfig: LabelConfig;
    onAddElement: (type: ElementType) => void;
    onUpdateElement: (element: LabelElement) => void;
    onDeleteElement: (id: string) => void;
    onUpdateLabelConfig: (config: LabelConfig) => void;
    onSelectElement: (id: string | null) => void;
}

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
    elements,
    selectedElement,
    labelConfig,
    onAddElement,
    onUpdateElement,
    onDeleteElement,
    onUpdateLabelConfig,
    onSelectElement
}) => {
    const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onUpdateLabelConfig({ ...labelConfig, [e.target.name]: Number(e.target.value) });
    };

    const handleElementChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        if (!selectedElement) return;
        const { name, value, type } = e.target;
        const isCheckbox = type === 'checkbox';
        const checked = (e.target as HTMLInputElement).checked;

        onUpdateElement({
            ...selectedElement,
            [name]: isCheckbox ? checked : (type === 'number' ? Number(value) : value),
        });
    };

    return (
        <div className="flex flex-col gap-6 text-gray-300">
            {/* Add Elements */}
            <div>
                <h2 className="text-lg font-semibold mb-3 text-cyan-400 border-b border-gray-600 pb-2">Add Element</h2>
                <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => onAddElement(ElementType.TEXT)} className="p-2 bg-gray-700 hover:bg-cyan-600 rounded-lg flex flex-col items-center gap-1 transition-colors"><IconText /> Text</button>
                    <button onClick={() => onAddElement(ElementType.BARCODE)} className="p-2 bg-gray-700 hover:bg-cyan-600 rounded-lg flex flex-col items-center gap-1 transition-colors"><IconBarcode /> Barcode</button>
                    <button onClick={() => onAddElement(ElementType.QR_CODE)} className="p-2 bg-gray-700 hover:bg-cyan-600 rounded-lg flex flex-col items-center gap-1 transition-colors"><IconQrCode /> QR Code</button>
                </div>
            </div>

            {/* Label Settings */}
            <div>
                <h2 className="text-lg font-semibold mb-3 text-cyan-400 border-b border-gray-600 pb-2">Label Settings</h2>
                <div className="flex items-center gap-4">
                    <label className="flex-1">Width (mm) <input type="number" name="width" value={labelConfig.width} onChange={handleConfigChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label>
                    <label className="flex-1">Height (mm) <input type="number" name="height" value={labelConfig.height} onChange={handleConfigChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label>
                </div>
            </div>
            
             {/* Element List */}
             {elements.length > 0 && <div>
                <h2 className="text-lg font-semibold mb-3 text-cyan-400 border-b border-gray-600 pb-2">Elements</h2>
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2">
                    {elements.map(el => (
                         <li key={el.id} onClick={() => onSelectElement(el.id)} className={`p-2 rounded-lg cursor-pointer flex justify-between items-center transition-colors ${selectedElement?.id === el.id ? 'bg-cyan-800' : 'bg-gray-700 hover:bg-gray-600'}`}>
                            <span className="capitalize">{el.type.replace('_',' ')}</span>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteElement(el.id); }} className="p-1 text-red-400 hover:text-red-300"><IconTrash size={18}/></button>
                         </li>
                    ))}
                </ul>
            </div>}

            {/* Element Properties */}
            {selectedElement && (
                <div>
                    <h2 className="text-lg font-semibold mb-3 text-cyan-400 border-b border-gray-600 pb-2">Properties: <span className="capitalize text-white">{selectedElement.type.replace('_', ' ')}</span></h2>
                    <div className="space-y-3">
                         {/* Common Properties */}
                        <div className="flex items-center gap-4">
                            <label className="flex-1">X: <input type="number" name="x" value={selectedElement.x} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label>
                            <label className="flex-1">Y: <input type="number" name="y" value={selectedElement.y} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label>
                        </div>
                        <div>
                             <label>Rotate (°): <input type="number" name="rotate" value={selectedElement.rotate} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label>
                        </div>
                        {/* Type Specific Properties */}
                        {selectedElement.type === 'text' && (
                            <>
                                <div><label>Text: <input type="text" name="text" value={(selectedElement as TextElement).text} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label></div>
                                <div><label>Font Size: <input type="number" name="fontSize" value={(selectedElement as TextElement).fontSize} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label></div>
                            </>
                        )}
                        {selectedElement.type === 'barcode' && (
                           <>
                                <div><label>Data: <input type="text" name="data" value={(selectedElement as BarcodeElement).data} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label></div>
                                <div className="flex items-center gap-4">
                                    <label className="flex-1">Width: <input type="number" name="width" value={(selectedElement as BarcodeElement).width} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label>
                                    <label className="flex-1">Height: <input type="number" name="height" value={(selectedElement as BarcodeElement).height} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label>
                                </div>
                                <div><label><input type="checkbox" name="displayValue" checked={(selectedElement as BarcodeElement).displayValue} onChange={handleElementChange} className="mr-2" />Display Value</label></div>
                           </>
                        )}
                        {selectedElement.type === 'qr_code' && (
                            <>
                                <div><label>Data: <input type="text" name="data" value={(selectedElement as QrElement).data} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label></div>
                                <div><label>Size: <input type="number" name="size" value={(selectedElement as QrElement).size} onChange={handleElementChange} className="w-full bg-gray-700 p-1 rounded mt-1 border border-gray-600" /></label></div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
