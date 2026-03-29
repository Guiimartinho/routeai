/**
 * PropertyEditor - Panel for editing selected component properties.
 *
 * Features:
 * - Shows properties of the selected component(s)
 * - Editable fields: reference, value, footprint, custom fields
 * - Bulk edit mode for multiple selections
 * - Footprint picker with preview
 * - Datasheet link button
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Settings,
  ExternalLink,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Package,
  Copy,
  Hash,
  Tag,
  FileText,
  Cpu,
  Edit3,
} from 'lucide-react';
import { useSchematicStore, type SchematicComponent } from '../../stores/schematicStore';
import SymbolRenderer from './SymbolRenderer';

// ---------------------------------------------------------------------------
// Common footprint presets
// ---------------------------------------------------------------------------

const FOOTPRINT_PRESETS: Record<string, string[]> = {
  Resistor: ['0201', '0402', '0603', '0805', '1206', '1210', '2010', '2512'],
  Capacitor: ['0201', '0402', '0603', '0805', '1206', '1210'],
  Inductor: ['0402', '0603', '0805', '1008', '1210', '1812'],
  IC: ['SOT-23', 'SOT-23-5', 'SOT-23-6', 'SOIC-8', 'SOIC-14', 'SOIC-16', 'TSSOP-14', 'TSSOP-16', 'TSSOP-20', 'QFN-16', 'QFN-20', 'QFN-24', 'QFN-32', 'QFN-48', 'QFP-32', 'QFP-48', 'QFP-64', 'QFP-100', 'LQFP-48', 'LQFP-64', 'BGA-256'],
  Connector: ['PinHeader_1x02_P2.54mm', 'PinHeader_1x03_P2.54mm', 'PinHeader_1x04_P2.54mm', 'PinHeader_1x06_P2.54mm', 'PinHeader_2x05_P2.54mm', 'PinHeader_2x10_P2.54mm', 'USB_C_Receptacle', 'USB_Micro_B'],
  Diode: ['SOD-123', 'SOD-323', 'SMA', 'SMB', 'SMC'],
  Transistor: ['SOT-23', 'SOT-223', 'DPAK', 'D2PAK', 'TO-220'],
  LED: ['0402', '0603', '0805', '1206', '3528', '5050'],
};

function getFootprintPresets(symbolType: string): string[] {
  const mapping: Record<string, string> = {
    resistor: 'Resistor',
    capacitor: 'Capacitor',
    inductor: 'Inductor',
    ic: 'IC',
    connector: 'Connector',
    diode: 'Diode',
    led: 'LED',
    transistor_npn: 'Transistor',
    transistor_pnp: 'Transistor',
    opamp: 'IC',
    crystal: 'Capacitor',
    fuse: 'Resistor',
  };
  const key = mapping[symbolType] || 'IC';
  return FOOTPRINT_PRESETS[key] || [];
}

// ---------------------------------------------------------------------------
// Editable field component
// ---------------------------------------------------------------------------

interface EditableFieldProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  presets?: string[];
}

function EditableField({ label, value, icon, onChange, placeholder, mono, multiline, presets }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    setShowPresets(false);
    if (draft !== value) {
      onChange(draft);
    }
  }, [draft, value, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) {
        commit();
      }
      if (e.key === 'Escape') {
        setDraft(value);
        setEditing(false);
        setShowPresets(false);
      }
    },
    [commit, value, multiline],
  );

  return (
    <div className="space-y-0.5">
      <label className="flex items-center gap-1 text-[10px] text-gray-500 font-medium">
        {icon}
        {label}
      </label>
      {editing ? (
        <div className="relative">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={handleKeyDown}
              autoFocus
              rows={3}
              className={`w-full px-2 py-1 bg-gray-800 border border-blue-500 rounded text-xs text-gray-200 outline-none resize-none ${
                mono ? 'font-mono' : ''
              }`}
            />
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={handleKeyDown}
              autoFocus
              placeholder={placeholder}
              className={`w-full px-2 py-1 bg-gray-800 border border-blue-500 rounded text-xs text-gray-200 outline-none ${
                mono ? 'font-mono' : ''
              }`}
            />
          )}
          {presets && presets.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowPresets(!showPresets)}
                className="absolute right-0 -top-6 p-0.5 text-gray-500 hover:text-gray-300"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              {showPresets && (
                <div className="absolute z-10 top-0 left-0 right-0 max-h-32 overflow-y-auto bg-gray-800 border border-gray-700 rounded shadow-lg">
                  {presets.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setDraft(p);
                        onChange(p);
                        setEditing(false);
                        setShowPresets(false);
                      }}
                      className="block w-full text-left px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 font-mono"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={() => setEditing(true)}
          className={`px-2 py-1 bg-gray-800/50 border border-gray-700/50 rounded text-xs text-gray-200 cursor-text hover:border-gray-600 transition-colors min-h-[24px] ${
            mono ? 'font-mono' : ''
          } ${!value ? 'text-gray-600 italic' : ''}`}
        >
          {value || placeholder || '(empty)'}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom properties section
// ---------------------------------------------------------------------------

interface CustomPropertiesProps {
  properties: Record<string, string>;
  onUpdate: (key: string, value: string) => void;
  onDelete: (key: string) => void;
  onAdd: (key: string, value: string) => void;
}

function CustomProperties({ properties, onUpdate, onDelete, onAdd }: CustomPropertiesProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const entries = Object.entries(properties);

  const handleAddProperty = useCallback(() => {
    if (newKey.trim()) {
      onAdd(newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
      setAddingNew(false);
    }
  }, [newKey, newValue, onAdd]);

  return (
    <div className="border-t border-gray-800 pt-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1 text-[10px] text-gray-500 font-medium hover:text-gray-300"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Custom Properties ({entries.length})
        </button>
        <button
          onClick={() => setAddingNew(true)}
          className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
          title="Add property"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {!collapsed && (
        <div className="mt-1 space-y-1">
          {entries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500 font-mono min-w-[60px] truncate">{key}:</span>
              <input
                type="text"
                value={val}
                onChange={(e) => onUpdate(key, e.target.value)}
                className="flex-1 px-1.5 py-0.5 bg-gray-800/50 border border-gray-700/50 rounded text-[10px] text-gray-300 font-mono outline-none focus:border-blue-500"
              />
              <button
                onClick={() => onDelete(key)}
                className="p-0.5 text-gray-600 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {addingNew && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Key"
                autoFocus
                className="w-20 px-1.5 py-0.5 bg-gray-800 border border-blue-500 rounded text-[10px] text-gray-300 font-mono outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddProperty();
                  if (e.key === 'Escape') setAddingNew(false);
                }}
              />
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Value"
                className="flex-1 px-1.5 py-0.5 bg-gray-800 border border-blue-500 rounded text-[10px] text-gray-300 font-mono outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddProperty();
                  if (e.key === 'Escape') setAddingNew(false);
                }}
              />
              <button onClick={handleAddProperty} className="px-1.5 py-0.5 bg-blue-600/30 text-blue-300 rounded text-[10px]">
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk edit panel
// ---------------------------------------------------------------------------

interface BulkEditPanelProps {
  components: SchematicComponent[];
}

function BulkEditPanel({ components }: BulkEditPanelProps) {
  const updateComponentProperties = useSchematicStore((s) => s.updateComponentProperties);
  const updateComponentProperty = useSchematicStore((s) => s.updateComponentProperty);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkFootprint, setBulkFootprint] = useState('');

  const handleApplyValue = useCallback(() => {
    if (!bulkValue.trim()) return;
    components.forEach((c) => {
      updateComponentProperties(c.id, { value: bulkValue });
    });
  }, [bulkValue, components, updateComponentProperties]);

  const handleApplyFootprint = useCallback(() => {
    if (!bulkFootprint.trim()) return;
    components.forEach((c) => {
      updateComponentProperties(c.id, { footprint: bulkFootprint });
    });
  }, [bulkFootprint, components, updateComponentProperties]);

  // Find common properties
  const commonSymbolType = components.every((c) => c.symbolType === components[0].symbolType)
    ? components[0].symbolType
    : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Edit3 className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs font-medium text-yellow-400">Bulk Edit ({components.length} selected)</span>
      </div>

      {/* Component list */}
      <div className="px-1 space-y-0.5 max-h-32 overflow-y-auto">
        {components.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-[10px]">
            <span className="text-blue-300 font-mono">{c.reference}</span>
            <span className="text-gray-500">{c.value}</span>
            <span className="text-gray-600 font-mono">{c.footprint}</span>
          </div>
        ))}
      </div>

      {/* Bulk value */}
      <div className="space-y-0.5">
        <label className="text-[10px] text-gray-500">Set Value for All</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            placeholder="e.g., 10k, 100nF"
            className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 outline-none focus:border-blue-500"
          />
          <button
            onClick={handleApplyValue}
            disabled={!bulkValue.trim()}
            className="px-2 py-1 bg-yellow-600/30 text-yellow-300 rounded text-[10px] hover:bg-yellow-600/50 disabled:opacity-30 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Bulk footprint */}
      <div className="space-y-0.5">
        <label className="text-[10px] text-gray-500">Set Footprint for All</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={bulkFootprint}
            onChange={(e) => setBulkFootprint(e.target.value)}
            placeholder="e.g., 0402, SOIC-8"
            className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 outline-none focus:border-blue-500"
          />
          <button
            onClick={handleApplyFootprint}
            disabled={!bulkFootprint.trim()}
            className="px-2 py-1 bg-yellow-600/30 text-yellow-300 rounded text-[10px] hover:bg-yellow-600/50 disabled:opacity-30 transition-colors"
          >
            Apply
          </button>
        </div>
        {commonSymbolType && (
          <div className="flex flex-wrap gap-1 mt-1">
            {getFootprintPresets(commonSymbolType).slice(0, 8).map((fp) => (
              <button
                key={fp}
                onClick={() => {
                  setBulkFootprint(fp);
                  components.forEach((c) => {
                    updateComponentProperties(c.id, { footprint: fp });
                  });
                }}
                className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-400 hover:text-gray-200 hover:border-gray-600 font-mono"
              >
                {fp}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk custom property */}
      <BulkCustomProperty components={components} />
    </div>
  );
}

function BulkCustomProperty({ components }: { components: SchematicComponent[] }) {
  const updateComponentProperty = useSchematicStore((s) => s.updateComponentProperty);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const handleApply = useCallback(() => {
    if (!key.trim()) return;
    components.forEach((c) => {
      updateComponentProperty(c.id, key.trim(), value);
    });
    setKey('');
    setValue('');
  }, [key, value, components, updateComponentProperty]);

  return (
    <div className="space-y-0.5 border-t border-gray-800 pt-2">
      <label className="text-[10px] text-gray-500">Set Custom Property for All</label>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Key"
          className="w-20 px-1.5 py-1 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-200 font-mono outline-none focus:border-blue-500"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          className="flex-1 px-1.5 py-1 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-200 font-mono outline-none focus:border-blue-500"
        />
        <button
          onClick={handleApply}
          disabled={!key.trim()}
          className="px-2 py-1 bg-yellow-600/30 text-yellow-300 rounded text-[10px] hover:bg-yellow-600/50 disabled:opacity-30 transition-colors"
        >
          Set
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PropertyEditor
// ---------------------------------------------------------------------------

export default function PropertyEditor() {
  const selectedIds = useSchematicStore((s) => s.selectedIds);
  const components = useSchematicStore((s) => s.components);
  const wires = useSchematicStore((s) => s.wires);
  const labels = useSchematicStore((s) => s.labels);
  const updateComponentProperties = useSchematicStore((s) => s.updateComponentProperties);
  const updateComponentProperty = useSchematicStore((s) => s.updateComponentProperty);

  const selectedComponents = useMemo(() => {
    const result: SchematicComponent[] = [];
    selectedIds.forEach((id) => {
      const comp = components.get(id);
      if (comp) result.push(comp);
    });
    return result;
  }, [selectedIds, components]);

  const selectedWireCount = useMemo(() => {
    let count = 0;
    selectedIds.forEach((id) => {
      if (wires.has(id)) count++;
    });
    return count;
  }, [selectedIds, wires]);

  const selectedLabelCount = useMemo(() => {
    let count = 0;
    selectedIds.forEach((id) => {
      if (labels.has(id)) count++;
    });
    return count;
  }, [selectedIds, labels]);

  // No selection
  if (selectedIds.size === 0) {
    return (
      <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800">
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-300">Properties</h3>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600 px-4">
          <Settings className="w-6 h-6 mb-2 opacity-40" />
          <span className="text-xs text-center">Select a component to edit its properties</span>
        </div>
      </div>
    );
  }

  // Multiple components selected => bulk edit
  if (selectedComponents.length > 1) {
    return (
      <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800">
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-300">Properties</h3>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <BulkEditPanel components={selectedComponents} />
        </div>
      </div>
    );
  }

  // Single component selected
  if (selectedComponents.length === 1) {
    const comp = selectedComponents[0];
    const footprintPresets = getFootprintPresets(comp.symbolType);

    return (
      <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800">
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-300">Properties</h3>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {/* Symbol preview */}
          <div className="flex items-center gap-3 pb-2 border-b border-gray-800">
            <svg width={56} height={48} viewBox="-35 -30 70 60" className="flex-shrink-0 bg-gray-800/50 rounded">
              <SymbolRenderer
                symbolType={comp.symbolType}
                pins={comp.pins}
                rotation={0}
                mirror={false}
                showPinNames={false}
                showPinNumbers={false}
                scale={0.6}
              />
            </svg>
            <div>
              <div className="text-xs font-medium text-gray-200">{comp.reference}</div>
              <div className="text-[10px] text-gray-500 capitalize">{comp.symbolType.replace('_', ' ')}</div>
              <div className="text-[10px] text-gray-600">{comp.pins.length} pins</div>
            </div>
          </div>

          {/* Core fields */}
          <EditableField
            label="Reference"
            value={comp.reference}
            icon={<Hash className="w-3 h-3" />}
            onChange={(v) => updateComponentProperties(comp.id, { reference: v })}
            placeholder="R1"
            mono
          />

          <EditableField
            label="Value"
            value={comp.value}
            icon={<Tag className="w-3 h-3" />}
            onChange={(v) => updateComponentProperties(comp.id, { value: v })}
            placeholder="10k"
          />

          <EditableField
            label="Footprint"
            value={comp.footprint}
            icon={<Package className="w-3 h-3" />}
            onChange={(v) => updateComponentProperties(comp.id, { footprint: v })}
            placeholder="0402"
            mono
            presets={footprintPresets}
          />

          {/* Quick footprint presets */}
          {footprintPresets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {footprintPresets.slice(0, 6).map((fp) => (
                <button
                  key={fp}
                  onClick={() => updateComponentProperties(comp.id, { footprint: fp })}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    comp.footprint === fp
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                      : 'bg-gray-800 text-gray-500 border border-gray-700/50 hover:text-gray-300 hover:border-gray-600'
                  }`}
                >
                  {fp}
                </button>
              ))}
            </div>
          )}

          <EditableField
            label="Description"
            value={comp.description}
            icon={<FileText className="w-3 h-3" />}
            onChange={(v) => updateComponentProperties(comp.id, { description: v })}
            placeholder="Component description"
            multiline
          />

          {/* Datasheet */}
          <div className="space-y-0.5">
            <label className="flex items-center gap-1 text-[10px] text-gray-500 font-medium">
              <ExternalLink className="w-3 h-3" />
              Datasheet
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={comp.datasheet}
                onChange={(e) => updateComponentProperties(comp.id, { datasheet: e.target.value })}
                placeholder="URL or file path"
                className="flex-1 px-2 py-1 bg-gray-800/50 border border-gray-700/50 rounded text-xs text-gray-300 font-mono outline-none focus:border-blue-500 truncate"
              />
              {comp.datasheet && (
                <a
                  href={comp.datasheet}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/50 transition-colors"
                  title="Open datasheet"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          {/* Position info */}
          <div className="border-t border-gray-800 pt-2">
            <label className="flex items-center gap-1 text-[10px] text-gray-500 font-medium mb-1">
              <Cpu className="w-3 h-3" />
              Position &amp; Orientation
            </label>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <span className="text-gray-600">X: </span>
                <span className="text-gray-300 font-mono">{comp.position.x.toFixed(1)}</span>
              </div>
              <div>
                <span className="text-gray-600">Y: </span>
                <span className="text-gray-300 font-mono">{comp.position.y.toFixed(1)}</span>
              </div>
              <div>
                <span className="text-gray-600">Rotation: </span>
                <span className="text-gray-300 font-mono">{comp.rotation} deg</span>
              </div>
              <div>
                <span className="text-gray-600">Mirror: </span>
                <span className="text-gray-300">{comp.mirror ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          {/* Pin list */}
          <div className="border-t border-gray-800 pt-2">
            <label className="flex items-center gap-1 text-[10px] text-gray-500 font-medium mb-1">
              Pins ({comp.pins.length})
            </label>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {comp.pins.map((pin) => (
                <div key={pin.id} className="flex items-center gap-2 text-[10px] px-1 py-0.5 rounded hover:bg-gray-800/30">
                  <span className="text-gray-500 font-mono w-6 text-right">{pin.number}</span>
                  <span className="text-gray-300 flex-1">{pin.name}</span>
                  <span className="text-gray-600 text-[9px]">{pin.type}</span>
                  {pin.connectedNetId && (
                    <span className="text-green-400 text-[9px] font-mono">{pin.connectedNetId}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Custom properties */}
          <CustomProperties
            properties={comp.properties}
            onUpdate={(key, value) => updateComponentProperty(comp.id, key, value)}
            onDelete={(key) => {
              const newProps = { ...comp.properties };
              delete newProps[key];
              // Remove by setting all properties
              const comps = useSchematicStore.getState().components;
              const updated = comps.get(comp.id);
              if (updated) {
                comps.set(comp.id, { ...updated, properties: newProps });
                useSchematicStore.setState({ components: new Map(comps) });
              }
            }}
            onAdd={(key, value) => updateComponentProperty(comp.id, key, value)}
          />

          {/* Library ID */}
          {comp.libraryId && (
            <div className="border-t border-gray-800 pt-2">
              <div className="flex items-center gap-1 text-[10px] text-gray-600">
                <Copy className="w-3 h-3" />
                <span>Library: {comp.libraryId}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Only wires/labels selected
  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800">
      <div className="px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-semibold text-gray-300">Properties</h3>
        </div>
      </div>
      <div className="flex-1 px-3 py-3 space-y-2">
        <div className="text-xs text-gray-400">
          {selectedIds.size} items selected
        </div>
        {selectedWireCount > 0 && (
          <div className="text-[10px] text-gray-500">{selectedWireCount} wire(s)</div>
        )}
        {selectedLabelCount > 0 && (
          <div className="text-[10px] text-gray-500">{selectedLabelCount} label(s)</div>
        )}
        {selectedComponents.length > 0 && (
          <div className="text-[10px] text-gray-500">{selectedComponents.length} component(s)</div>
        )}
      </div>
    </div>
  );
}
