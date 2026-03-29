/**
 * ComponentLibrary - Searchable library panel for schematic components.
 *
 * Features:
 * - Categories: Passive, Active, IC, Connectors, Power, Mechanical
 * - Search filtering across name, description, and MPN
 * - Symbol preview for each entry
 * - Drag-to-place functionality
 * - Favorites and recently used tracking
 * - Supplier integration display (price, stock)
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  Star,
  Clock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Package,
  GripVertical,
} from 'lucide-react';
import SymbolRenderer from './SymbolRenderer';
import {
  useSchematicStore,
  type SchematicComponent,
  type SchematicPin,
  type SymbolType,
} from '../../stores/schematicStore';

// ---------------------------------------------------------------------------
// Library data types
// ---------------------------------------------------------------------------

export interface LibraryComponent {
  id: string;
  name: string;
  description: string;
  category: ComponentCategory;
  symbolType: SymbolType;
  defaultValue: string;
  defaultFootprint: string;
  referencePrefix: string;
  pins: LibraryPin[];
  datasheet: string;
  mpn: string;
  manufacturer: string;
  suppliers: SupplierInfo[];
  tags: string[];
}

interface LibraryPin {
  number: string;
  name: string;
  type: SchematicPin['type'];
  relativePosition: { x: number; y: number };
  orientation: SchematicPin['orientation'];
}

export interface SupplierInfo {
  name: string;
  url: string;
  price: number | null;
  currency: string;
  stock: number | null;
  moq: number;
}

type ComponentCategory = 'passive' | 'active' | 'ic' | 'connector' | 'power' | 'mechanical';

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  passive: 'Passive',
  active: 'Active',
  ic: 'Integrated Circuits',
  connector: 'Connectors',
  power: 'Power',
  mechanical: 'Mechanical',
};

const CATEGORY_ORDER: ComponentCategory[] = ['passive', 'active', 'ic', 'connector', 'power', 'mechanical'];

// ---------------------------------------------------------------------------
// Built-in library of common components
// ---------------------------------------------------------------------------

function makePin(number: string, name: string, x: number, y: number, orientation: SchematicPin['orientation'], type: SchematicPin['type'] = 'passive'): LibraryPin {
  return { number, name, type, relativePosition: { x, y }, orientation };
}

const BUILTIN_LIBRARY: LibraryComponent[] = [
  // Passive
  {
    id: 'lib_resistor',
    name: 'Resistor',
    description: 'Generic resistor',
    category: 'passive',
    symbolType: 'resistor',
    defaultValue: '10k',
    defaultFootprint: '0402',
    referencePrefix: 'R',
    pins: [
      makePin('1', '1', -20, 0, 'left'),
      makePin('2', '2', 20, 0, 'right'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['resistor', 'passive', 'R'],
  },
  {
    id: 'lib_capacitor',
    name: 'Capacitor',
    description: 'Generic capacitor',
    category: 'passive',
    symbolType: 'capacitor',
    defaultValue: '100nF',
    defaultFootprint: '0402',
    referencePrefix: 'C',
    pins: [
      makePin('1', '1', -20, 0, 'left'),
      makePin('2', '2', 20, 0, 'right'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['capacitor', 'passive', 'C', 'decoupling', 'bypass'],
  },
  {
    id: 'lib_inductor',
    name: 'Inductor',
    description: 'Generic inductor',
    category: 'passive',
    symbolType: 'inductor',
    defaultValue: '10uH',
    defaultFootprint: '0805',
    referencePrefix: 'L',
    pins: [
      makePin('1', '1', -20, 0, 'left'),
      makePin('2', '2', 20, 0, 'right'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['inductor', 'passive', 'L', 'coil'],
  },
  {
    id: 'lib_crystal',
    name: 'Crystal',
    description: 'Quartz crystal oscillator',
    category: 'passive',
    symbolType: 'crystal',
    defaultValue: '8MHz',
    defaultFootprint: 'HC49',
    referencePrefix: 'Y',
    pins: [
      makePin('1', '1', -20, 0, 'left'),
      makePin('2', '2', 20, 0, 'right'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['crystal', 'oscillator', 'clock'],
  },
  {
    id: 'lib_fuse',
    name: 'Fuse',
    description: 'Circuit protection fuse',
    category: 'passive',
    symbolType: 'fuse',
    defaultValue: '500mA',
    defaultFootprint: '1206',
    referencePrefix: 'F',
    pins: [
      makePin('1', '1', -20, 0, 'left'),
      makePin('2', '2', 20, 0, 'right'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['fuse', 'protection'],
  },
  // Active
  {
    id: 'lib_diode',
    name: 'Diode',
    description: 'Generic signal diode',
    category: 'active',
    symbolType: 'diode',
    defaultValue: '1N4148',
    defaultFootprint: 'SOD-323',
    referencePrefix: 'D',
    pins: [
      makePin('1', 'A', -20, 0, 'left'),
      makePin('2', 'K', 20, 0, 'right'),
    ],
    datasheet: '',
    mpn: '1N4148',
    manufacturer: 'ON Semiconductor',
    suppliers: [
      { name: 'LCSC', url: 'https://lcsc.com', price: 0.01, currency: 'USD', stock: 500000, moq: 100 },
      { name: 'DigiKey', url: 'https://digikey.com', price: 0.02, currency: 'USD', stock: 250000, moq: 1 },
    ],
    tags: ['diode', 'signal', 'rectifier'],
  },
  {
    id: 'lib_led',
    name: 'LED',
    description: 'Light emitting diode',
    category: 'active',
    symbolType: 'led',
    defaultValue: 'Green',
    defaultFootprint: '0603',
    referencePrefix: 'D',
    pins: [
      makePin('1', 'A', -20, 0, 'left'),
      makePin('2', 'K', 20, 0, 'right'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['led', 'indicator', 'light'],
  },
  {
    id: 'lib_npn',
    name: 'NPN Transistor',
    description: 'NPN bipolar junction transistor',
    category: 'active',
    symbolType: 'transistor_npn',
    defaultValue: '2N2222',
    defaultFootprint: 'SOT-23',
    referencePrefix: 'Q',
    pins: [
      makePin('1', 'B', -20, 0, 'left'),
      makePin('2', 'C', 10, -20, 'up'),
      makePin('3', 'E', 10, 20, 'down'),
    ],
    datasheet: '',
    mpn: '2N2222',
    manufacturer: 'ON Semiconductor',
    suppliers: [
      { name: 'LCSC', url: 'https://lcsc.com', price: 0.03, currency: 'USD', stock: 300000, moq: 100 },
    ],
    tags: ['transistor', 'npn', 'bjt', 'switch', 'amplifier'],
  },
  {
    id: 'lib_pnp',
    name: 'PNP Transistor',
    description: 'PNP bipolar junction transistor',
    category: 'active',
    symbolType: 'transistor_pnp',
    defaultValue: '2N2907',
    defaultFootprint: 'SOT-23',
    referencePrefix: 'Q',
    pins: [
      makePin('1', 'B', -20, 0, 'left'),
      makePin('2', 'C', 10, -20, 'up'),
      makePin('3', 'E', 10, 20, 'down'),
    ],
    datasheet: '',
    mpn: '2N2907',
    manufacturer: 'ON Semiconductor',
    suppliers: [],
    tags: ['transistor', 'pnp', 'bjt'],
  },
  {
    id: 'lib_opamp',
    name: 'Op-Amp',
    description: 'Operational amplifier',
    category: 'active',
    symbolType: 'opamp',
    defaultValue: 'LM358',
    defaultFootprint: 'SOIC-8',
    referencePrefix: 'U',
    pins: [
      makePin('2', 'IN+', -25, -10, 'left', 'input'),
      makePin('3', 'IN-', -25, 10, 'left', 'input'),
      makePin('1', 'OUT', 30, 0, 'right', 'output'),
      makePin('8', 'V+', 0, -20, 'up', 'power'),
      makePin('4', 'V-', 0, 20, 'down', 'power'),
    ],
    datasheet: '',
    mpn: 'LM358',
    manufacturer: 'Texas Instruments',
    suppliers: [
      { name: 'DigiKey', url: 'https://digikey.com', price: 0.45, currency: 'USD', stock: 80000, moq: 1 },
      { name: 'LCSC', url: 'https://lcsc.com', price: 0.15, currency: 'USD', stock: 200000, moq: 10 },
    ],
    tags: ['opamp', 'amplifier', 'analog', 'op-amp'],
  },
  // IC
  {
    id: 'lib_ic_generic_8',
    name: 'IC 8-pin',
    description: 'Generic 8-pin IC (DIP/SOIC)',
    category: 'ic',
    symbolType: 'ic',
    defaultValue: '',
    defaultFootprint: 'SOIC-8',
    referencePrefix: 'U',
    pins: [
      makePin('1', 'Pin1', -25, -18, 'left'),
      makePin('2', 'Pin2', -25, -6, 'left'),
      makePin('3', 'Pin3', -25, 6, 'left'),
      makePin('4', 'Pin4', -25, 18, 'left'),
      makePin('5', 'Pin5', 25, 18, 'right'),
      makePin('6', 'Pin6', 25, 6, 'right'),
      makePin('7', 'Pin7', 25, -6, 'right'),
      makePin('8', 'Pin8', 25, -18, 'right'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['ic', 'generic', '8-pin'],
  },
  {
    id: 'lib_stm32_qfp48',
    name: 'STM32F103',
    description: 'ARM Cortex-M3 MCU, 48-pin',
    category: 'ic',
    symbolType: 'ic',
    defaultValue: 'STM32F103C8T6',
    defaultFootprint: 'LQFP-48',
    referencePrefix: 'U',
    pins: [
      makePin('1', 'VBAT', -30, -36, 'left', 'power'),
      makePin('2', 'PC13', -30, -24, 'left'),
      makePin('3', 'PC14', -30, -12, 'left'),
      makePin('4', 'PC15', -30, 0, 'left'),
      makePin('5', 'PD0', -30, 12, 'left'),
      makePin('6', 'PD1', -30, 24, 'left'),
      makePin('7', 'NRST', -30, 36, 'left', 'input'),
      makePin('8', 'VSSA', 30, -36, 'right', 'power'),
      makePin('9', 'VDDA', 30, -24, 'right', 'power'),
      makePin('10', 'PA0', 30, -12, 'right'),
      makePin('11', 'PA1', 30, 0, 'right'),
      makePin('12', 'PA2', 30, 12, 'right'),
      makePin('13', 'PA3', 30, 24, 'right'),
      makePin('14', 'PA4', 30, 36, 'right'),
    ],
    datasheet: 'https://www.st.com/resource/en/datasheet/stm32f103c8.pdf',
    mpn: 'STM32F103C8T6',
    manufacturer: 'STMicroelectronics',
    suppliers: [
      { name: 'LCSC', url: 'https://lcsc.com/product-detail/STM32F103C8T6.html', price: 2.50, currency: 'USD', stock: 50000, moq: 1 },
      { name: 'DigiKey', url: 'https://www.digikey.com/en/products/detail/STM32F103C8T6', price: 4.20, currency: 'USD', stock: 15000, moq: 1 },
    ],
    tags: ['mcu', 'arm', 'cortex-m3', 'stm32', 'microcontroller'],
  },
  // Connectors
  {
    id: 'lib_conn_2pin',
    name: '2-Pin Header',
    description: '2-pin pin header connector',
    category: 'connector',
    symbolType: 'connector',
    defaultValue: '',
    defaultFootprint: 'PinHeader_1x02_P2.54mm',
    referencePrefix: 'J',
    pins: [
      makePin('1', '1', -12, -6, 'left'),
      makePin('2', '2', -12, 6, 'left'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['connector', 'header', '2-pin'],
  },
  {
    id: 'lib_conn_usb_c',
    name: 'USB Type-C',
    description: 'USB Type-C receptacle',
    category: 'connector',
    symbolType: 'connector',
    defaultValue: 'USB-C',
    defaultFootprint: 'USB_C_Receptacle',
    referencePrefix: 'J',
    pins: [
      makePin('A1', 'GND', -12, -36, 'left', 'power'),
      makePin('A4', 'VBUS', -12, -24, 'left', 'power'),
      makePin('A6', 'D+', -12, -12, 'left', 'bidirectional'),
      makePin('A7', 'D-', -12, 0, 'left', 'bidirectional'),
      makePin('A5', 'CC1', -12, 12, 'left'),
      makePin('B5', 'CC2', -12, 24, 'left'),
      makePin('S1', 'SHIELD', -12, 36, 'left', 'passive'),
    ],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [
      { name: 'LCSC', url: 'https://lcsc.com', price: 0.30, currency: 'USD', stock: 100000, moq: 10 },
    ],
    tags: ['usb', 'usb-c', 'type-c', 'connector'],
  },
  // Power
  {
    id: 'lib_ldo_3v3',
    name: 'LDO 3.3V',
    description: 'Low-dropout voltage regulator 3.3V',
    category: 'power',
    symbolType: 'ic',
    defaultValue: 'AMS1117-3.3',
    defaultFootprint: 'SOT-223',
    referencePrefix: 'U',
    pins: [
      makePin('1', 'GND', 0, 20, 'down', 'power'),
      makePin('2', 'OUT', 25, 0, 'right', 'output'),
      makePin('3', 'IN', -25, 0, 'left', 'input'),
    ],
    datasheet: '',
    mpn: 'AMS1117-3.3',
    manufacturer: 'Advanced Monolithic Systems',
    suppliers: [
      { name: 'LCSC', url: 'https://lcsc.com', price: 0.08, currency: 'USD', stock: 1000000, moq: 100 },
    ],
    tags: ['ldo', 'regulator', 'voltage', 'power', '3.3v'],
  },
  // Mechanical
  {
    id: 'lib_mounting_hole',
    name: 'Mounting Hole',
    description: 'PCB mounting hole (M3)',
    category: 'mechanical',
    symbolType: 'generic',
    defaultValue: 'M3',
    defaultFootprint: 'MountingHole_3.2mm',
    referencePrefix: 'H',
    pins: [],
    datasheet: '',
    mpn: '',
    manufacturer: '',
    suppliers: [],
    tags: ['mounting', 'hole', 'mechanical'],
  },
];

// ---------------------------------------------------------------------------
// Ref counter for unique references
// ---------------------------------------------------------------------------

const refCounters: Record<string, number> = {};
function nextReference(prefix: string): string {
  if (!refCounters[prefix]) refCounters[prefix] = 0;
  refCounters[prefix]++;
  return `${prefix}${refCounters[prefix]}`;
}

// ---------------------------------------------------------------------------
// Component preview
// ---------------------------------------------------------------------------

interface SymbolPreviewProps {
  symbolType: SymbolType;
  pins: LibraryPin[];
  size?: number;
}

function SymbolPreview({ symbolType, pins, size = 48 }: SymbolPreviewProps) {
  const dummyPins: SchematicPin[] = pins.map((p, i) => ({
    id: `preview_pin_${i}`,
    number: p.number,
    name: p.name,
    position: p.relativePosition,
    orientation: p.orientation,
    type: p.type,
    connectedNetId: null,
  }));

  return (
    <svg width={size} height={size} viewBox="-35 -30 70 60" className="flex-shrink-0">
      <SymbolRenderer
        symbolType={symbolType}
        pins={dummyPins}
        showPinNames={false}
        showPinNumbers={false}
        scale={0.7}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Supplier badge
// ---------------------------------------------------------------------------

function SupplierBadge({ supplier }: { supplier: SupplierInfo }) {
  const stockColor = supplier.stock !== null
    ? supplier.stock > 1000 ? 'text-green-400' : supplier.stock > 0 ? 'text-yellow-400' : 'text-red-400'
    : 'text-gray-500';

  return (
    <div className="flex items-center gap-2 text-[10px] text-gray-400">
      <span className="font-medium">{supplier.name}</span>
      {supplier.price !== null && (
        <span className="text-emerald-400">${supplier.price.toFixed(2)}</span>
      )}
      {supplier.stock !== null && (
        <span className={stockColor}>
          {supplier.stock > 1000 ? `${(supplier.stock / 1000).toFixed(0)}k` : supplier.stock} in stock
        </span>
      )}
      <a
        href={supplier.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library entry row
// ---------------------------------------------------------------------------

interface LibraryEntryProps {
  component: LibraryComponent;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onStartPlace: () => void;
}

function LibraryEntry({ component, isFavorite, onToggleFavorite, onStartPlace }: LibraryEntryProps) {
  const [expanded, setExpanded] = useState(false);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-schematic-component', component.id);
      e.dataTransfer.effectAllowed = 'copy';
      onStartPlace();
    },
    [component.id, onStartPlace],
  );

  return (
    <div
      className="group border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
      draggable
      onDragStart={handleDragStart}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <GripVertical className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100 cursor-grab" />
        <SymbolPreview symbolType={component.symbolType} pins={component.pins} size={32} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-gray-200 truncate">{component.name}</span>
            {component.mpn && (
              <span className="text-[10px] text-gray-500 font-mono truncate">{component.mpn}</span>
            )}
          </div>
          <div className="text-[10px] text-gray-500 truncate">{component.description}</div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={`p-1 rounded transition-colors ${
            isFavorite ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-400'
          }`}
        >
          <Star className="w-3 h-3" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStartPlace();
          }}
          className="px-2 py-0.5 text-[10px] bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/50 transition-colors"
        >
          Place
        </button>
        {expanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
      </div>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <div>
              <span className="text-gray-500">Footprint: </span>
              <span className="text-gray-300">{component.defaultFootprint}</span>
            </div>
            <div>
              <span className="text-gray-500">Default: </span>
              <span className="text-gray-300">{component.defaultValue}</span>
            </div>
            {component.manufacturer && (
              <div>
                <span className="text-gray-500">Mfr: </span>
                <span className="text-gray-300">{component.manufacturer}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">Pins: </span>
              <span className="text-gray-300">{component.pins.length}</span>
            </div>
          </div>
          {component.datasheet && (
            <a
              href={component.datasheet}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
            >
              <ExternalLink className="w-3 h-3" />
              Datasheet
            </a>
          )}
          {component.suppliers.length > 0 && (
            <div className="space-y-0.5 pt-1 border-t border-gray-800/50">
              <span className="text-[10px] text-gray-500 font-medium">Suppliers:</span>
              {component.suppliers.map((s, i) => (
                <SupplierBadge key={i} supplier={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ComponentLibrary
// ---------------------------------------------------------------------------

export interface ComponentLibraryProps {
  onComponentSelected?: (component: LibraryComponent) => void;
  additionalComponents?: LibraryComponent[];
}

export default function ComponentLibrary({ onComponentSelected, additionalComponents }: ComponentLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ComponentCategory | 'all' | 'favorites' | 'recent'>('all');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('schematic_favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('schematic_recent');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const allComponents = useMemo(
    () => [...BUILTIN_LIBRARY, ...(additionalComponents || [])],
    [additionalComponents],
  );

  const filteredComponents = useMemo(() => {
    let filtered = allComponents;

    // Category filter
    if (selectedCategory === 'favorites') {
      filtered = filtered.filter((c) => favorites.has(c.id));
    } else if (selectedCategory === 'recent') {
      const recent = recentIds.slice(0, 20);
      filtered = filtered.filter((c) => recent.includes(c.id));
      filtered.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    } else if (selectedCategory !== 'all') {
      filtered = filtered.filter((c) => c.category === selectedCategory);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.mpn.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return filtered;
  }, [allComponents, selectedCategory, searchQuery, favorites, recentIds]);

  const groupedByCategory = useMemo(() => {
    if (selectedCategory !== 'all' || searchQuery.trim()) {
      return null; // Show flat list
    }
    const groups = new Map<ComponentCategory, LibraryComponent[]>();
    filteredComponents.forEach((c) => {
      const list = groups.get(c.category) || [];
      list.push(c);
      groups.set(c.category, list);
    });
    return groups;
  }, [filteredComponents, selectedCategory, searchQuery]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('schematic_favorites', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const addToRecent = useCallback((id: string) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 30);
      localStorage.setItem('schematic_recent', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleStartPlace = useCallback(
    (libComponent: LibraryComponent) => {
      addToRecent(libComponent.id);

      const ref = nextReference(libComponent.referencePrefix);
      const pins: SchematicPin[] = libComponent.pins.map((p, i) => ({
        id: `${ref}_pin_${i}`,
        number: p.number,
        name: p.name,
        position: p.relativePosition,
        orientation: p.orientation,
        type: p.type,
        connectedNetId: null,
      }));

      const component: SchematicComponent = {
        id: `placing_${Date.now()}`,
        symbolType: libComponent.symbolType,
        reference: ref,
        value: libComponent.defaultValue,
        footprint: libComponent.defaultFootprint,
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: false,
        pins,
        properties: {},
        description: libComponent.description,
        datasheet: libComponent.datasheet,
        libraryId: libComponent.id,
        selected: false,
      };

      useSchematicStore.getState().startPlacingComponent(component);
      onComponentSelected?.(libComponent);
    },
    [addToRecent, onComponentSelected],
  );

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-gray-400" />
          <h3 className="text-xs font-semibold text-gray-300">Component Library</h3>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search components..."
            className="w-full pl-7 pr-2 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-gray-800">
        {[
          { key: 'all' as const, label: 'All' },
          { key: 'favorites' as const, label: 'Favorites', icon: <Star className="w-3 h-3" /> },
          { key: 'recent' as const, label: 'Recent', icon: <Clock className="w-3 h-3" /> },
          ...CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSelectedCategory(tab.key)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
              selectedCategory === tab.key
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            {'icon' in tab && tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Component list */}
      <div className="flex-1 overflow-y-auto">
        {groupedByCategory ? (
          // Grouped view
          CATEGORY_ORDER.map((cat) => {
            const items = groupedByCategory.get(cat);
            if (!items || items.length === 0) return null;
            const collapsed = collapsedCategories.has(cat);
            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCategory(cat)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 bg-gray-850 border-b border-gray-800 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
                >
                  {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {CATEGORY_LABELS[cat]}
                  <span className="text-gray-600 text-[10px]">({items.length})</span>
                </button>
                {!collapsed &&
                  items.map((c) => (
                    <LibraryEntry
                      key={c.id}
                      component={c}
                      isFavorite={favorites.has(c.id)}
                      onToggleFavorite={() => toggleFavorite(c.id)}
                      onStartPlace={() => handleStartPlace(c)}
                    />
                  ))}
              </div>
            );
          })
        ) : (
          // Flat filtered view
          filteredComponents.length > 0 ? (
            filteredComponents.map((c) => (
              <LibraryEntry
                key={c.id}
                component={c}
                isFavorite={favorites.has(c.id)}
                onToggleFavorite={() => toggleFavorite(c.id)}
                onStartPlace={() => handleStartPlace(c)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-gray-600">
              <Package className="w-6 h-6 mb-2" />
              <span className="text-xs">No components found</span>
            </div>
          )
        )}
      </div>

      {/* Footer with count */}
      <div className="px-3 py-1 border-t border-gray-800 text-[10px] text-gray-600">
        {filteredComponents.length} components
        {favorites.size > 0 && ` | ${favorites.size} favorites`}
      </div>
    </div>
  );
}
