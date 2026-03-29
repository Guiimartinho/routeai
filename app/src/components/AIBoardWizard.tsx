// ─── AIBoardWizard.tsx ── Multi-step AI board generation wizard ──────────────
// This is the flagship feature of RouteAI: AI-powered PCB board generation.
// Architecture: LLM handles intent/context/explanation ONLY.
// All placement coordinates come from the local Simulated Annealing solver.
// See: packages/intelligence/ARCHITECTURE.md - "never generate coordinates with LLM"

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { theme } from '../styles/theme';
import type {
  SchComponent, SchNet, BrdComponent, BrdPad, BoardState, BoardOutline, Point,
} from '../types';
import { useOllama } from '../hooks/useOllama';
import { useProjectStore } from '../store/projectStore';
import {
  solvePlacement,
  buildConstraintsFromBlocks,
  type PlacementConstraint,
  type ZoneDefinition,
  type ZoneType,
} from '../engine/placementSolver';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BoardSize = 'small' | 'medium' | 'large' | 'custom';
export type ApplicationType = 'iot' | 'wearable' | 'industrial' | 'automotive' | 'consumer' | 'medical' | 'power-supply';
export type LayerCount = 2 | 4 | 6;
export type OptimizationPriority = 'compact-size' | 'easy-routing' | 'thermal-management' | 'signal-integrity' | 'low-cost';
export type PowerRequirement = 'low' | 'medium' | 'high';
export type Environment = 'indoor' | 'outdoor' | 'high-temp' | 'vibration' | 'humidity';
export type FabTarget = 'jlcpcb' | 'pcbway' | 'custom';

export interface DesignIntent {
  boardSize: BoardSize;
  customWidth: number;
  customHeight: number;
  application: ApplicationType;
  layerCount: LayerCount;
  optimization: OptimizationPriority;
  powerReq: PowerRequirement;
  highSpeedInterfaces: string[];
  environment: Environment;
  fabTarget: FabTarget;
  quantity: number;
}

interface FunctionalBlock {
  name: string;
  type: 'power' | 'digital' | 'analog' | 'communication' | 'ui' | 'mechanical';
  components: string[];
  color: string;
}

interface CriticalNet {
  name: string;
  type: 'power' | 'high-speed' | 'analog' | 'clock' | 'differential';
  priority: number;
  notes: string;
}

interface DesignRule {
  name: string;
  value: string;
  unit: string;
  reasoning: string;
}

interface StackupLayer {
  name: string;
  type: 'copper' | 'prepreg' | 'core';
  thickness: string;
  purpose: string;
}

interface AIAnalysis {
  functionalBlocks: FunctionalBlock[];
  criticalNets: CriticalNet[];
  complexityScore: number;
  designRules: DesignRule[];
  stackup: StackupLayer[];
  stackupReasoning: string;
}

interface PlacedComponent {
  ref: string;
  x: number;
  y: number;
  rotation: number;
  layer: string;
  reasoning?: string;
}

interface DRCIssue {
  severity: 'error' | 'warning';
  message: string;
  components?: string[];
}

type WizardStep = 'intent' | 'analysis' | 'placement' | 'review';

export interface AIBoardWizardProps {
  visible?: boolean;
  onClose?: () => void;
  schematicComponents?: SchComponent[];
  schematicNets?: SchNet[];
  onGenerateBoard?: (board: BoardState) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BOARD_SIZE_PRESETS: Record<BoardSize, { w: number; h: number; label: string }> = {
  small: { w: 30, h: 20, label: '30x20mm (IoT module)' },
  medium: { w: 60, h: 40, label: '60x40mm (Dev board)' },
  large: { w: 100, h: 80, label: '100x80mm (Full board)' },
  custom: { w: 0, h: 0, label: 'Custom size' },
};

const APPLICATION_LABELS: Record<ApplicationType, string> = {
  iot: 'IoT / Wireless',
  wearable: 'Wearable / Compact',
  industrial: 'Industrial / Rugged',
  automotive: 'Automotive',
  consumer: 'Consumer Electronics',
  medical: 'Medical Device',
  'power-supply': 'Power Supply / Converter',
};

const OPTIMIZATION_LABELS: Record<OptimizationPriority, string> = {
  'compact-size': 'Compact Size',
  'easy-routing': 'Easy Routing',
  'thermal-management': 'Thermal Management',
  'signal-integrity': 'Signal Integrity',
  'low-cost': 'Low Cost',
};

const ENVIRONMENT_LABELS: Record<Environment, string> = {
  indoor: 'Indoor / Controlled',
  outdoor: 'Outdoor / IP65+',
  'high-temp': 'High Temperature (>85C)',
  vibration: 'High Vibration',
  humidity: 'High Humidity',
};

const FAB_LABELS: Record<FabTarget, string> = {
  jlcpcb: 'JLCPCB',
  pcbway: 'PCBWay',
  custom: 'Custom / Other',
};

const BLOCK_COLORS: Record<string, string> = {
  power: theme.red,
  digital: theme.blue,
  analog: theme.green,
  communication: theme.purple,
  ui: theme.orange,
  mechanical: theme.cyan,
};

// ─── Helper: detect high-speed interfaces from nets ─────────────────────────

function detectHighSpeedInterfaces(nets: SchNet[]): string[] {
  const found = new Set<string>();
  const patterns: [RegExp, string][] = [
    [/USB/i, 'USB'],
    [/SPI/i, 'SPI'],
    [/I2C|SDA|SCL/i, 'I2C'],
    [/UART|TX|RX/i, 'UART'],
    [/DDR|SDRAM/i, 'DDR'],
    [/ETH|RMII|MII|MDIO/i, 'Ethernet'],
    [/SDIO|SD_/i, 'SDIO'],
    [/CAN/i, 'CAN'],
    [/JTAG|SWD|SWCLK|SWDIO/i, 'Debug (SWD/JTAG)'],
    [/HDMI/i, 'HDMI'],
    [/LVDS/i, 'LVDS'],
    [/ADC|DAC/i, 'ADC/DAC'],
  ];
  for (const net of nets) {
    for (const [pattern, label] of patterns) {
      if (pattern.test(net.name)) found.add(label);
    }
  }
  return Array.from(found);
}

// ─── Helper: recommend layer count ──────────────────────────────────────────

function recommendLayerCount(
  componentCount: number,
  netCount: number,
  highSpeedCount: number,
  powerReq: PowerRequirement
): { recommended: LayerCount; reasoning: string } {
  if (highSpeedCount >= 3 || componentCount > 40 || powerReq === 'high') {
    return { recommended: 6, reasoning: 'High-speed interfaces, high component density, or high-current requirements benefit from dedicated power/ground planes and additional routing layers.' };
  }
  if (componentCount > 15 || netCount > 20 || highSpeedCount >= 1 || powerReq === 'medium') {
    return { recommended: 4, reasoning: 'Moderate complexity with some high-speed signals. 4 layers provide dedicated ground plane and better signal integrity.' };
  }
  return { recommended: 2, reasoning: 'Simple design with few components and no high-speed requirements. 2 layers keeps cost low.' };
}

// ─── Helper: classify components into functional blocks ─────────────────────

function classifyComponents(components: SchComponent[], nets: SchNet[]): FunctionalBlock[] {
  const blocks: FunctionalBlock[] = [];
  const assigned = new Set<string>();

  // Power components
  const powerComps = components.filter(c => {
    const isPowerReg = /LDO|REG|DCDC|BUCK|BOOST|LM78|AMS|TPS|MP|AP/i.test(c.value) || /SOT-223|TO-252|PowerPAD/i.test(c.footprint);
    const isPowerCap = c.ref.startsWith('C') && c.pins.some(p => p.netId && /VCC|VDD|VIN|VOUT|5V|3V3|12V|VBUS/i.test(p.netId || ''));
    const isPowerInductor = c.ref.startsWith('L');
    const isPowerDiode = c.ref.startsWith('D') && c.pins.some(p => p.netId && /VCC|VDD|VIN|VBUS/i.test(p.netId || ''));
    return isPowerReg || isPowerCap || isPowerInductor || isPowerDiode;
  });
  if (powerComps.length > 0) {
    const refs = powerComps.map(c => c.ref);
    refs.forEach(r => assigned.add(r));
    blocks.push({ name: 'Power Supply', type: 'power', components: refs, color: BLOCK_COLORS.power });
  }

  // Communication (connectors, transceivers)
  const commComps = components.filter(c => {
    if (assigned.has(c.ref)) return false;
    return c.ref.startsWith('J') || /USB|UART|SPI|I2C|CAN|ETH|WIFI|BLE|RF/i.test(c.value);
  });
  if (commComps.length > 0) {
    const refs = commComps.map(c => c.ref);
    refs.forEach(r => assigned.add(r));
    blocks.push({ name: 'Communication', type: 'communication', components: refs, color: BLOCK_COLORS.communication });
  }

  // UI (LEDs, buttons, displays)
  const uiComps = components.filter(c => {
    if (assigned.has(c.ref)) return false;
    return /LED|BTN|SW|BUTTON|LCD|OLED|DISPLAY|BUZZER|SPEAKER/i.test(c.value) ||
      (c.ref.startsWith('LED') || c.ref.startsWith('SW') || c.ref.startsWith('BZ'));
  });
  if (uiComps.length > 0) {
    const refs = uiComps.map(c => c.ref);
    refs.forEach(r => assigned.add(r));
    blocks.push({ name: 'User Interface', type: 'ui', components: refs, color: BLOCK_COLORS.ui });
  }

  // Analog (op-amps, ADC, sensors)
  const analogComps = components.filter(c => {
    if (assigned.has(c.ref)) return false;
    return /OPA|LM|AD|MCP|ADS|SENSOR|THERM|NTC|PTC/i.test(c.value) ||
      c.pins.some(p => /ADC|AIN|AREF|AVCC|AGND/i.test(p.netId || ''));
  });
  if (analogComps.length > 0) {
    const refs = analogComps.map(c => c.ref);
    refs.forEach(r => assigned.add(r));
    blocks.push({ name: 'Analog', type: 'analog', components: refs, color: BLOCK_COLORS.analog });
  }

  // Everything else = digital
  const digitalComps = components.filter(c => !assigned.has(c.ref));
  if (digitalComps.length > 0) {
    blocks.push({ name: 'Digital Core', type: 'digital', components: digitalComps.map(c => c.ref), color: BLOCK_COLORS.digital });
  }

  return blocks;
}

// ─── Helper: identify critical nets ─────────────────────────────────────────

function identifyCriticalNets(nets: SchNet[]): CriticalNet[] {
  const critical: CriticalNet[] = [];

  for (const net of nets) {
    if (/VCC|VDD|3V3|5V|12V|VBUS|VIN|VOUT/i.test(net.name)) {
      critical.push({
        name: net.name,
        type: 'power',
        priority: 1,
        notes: `Power rail - use wider traces (0.3-1.0mm), add bypass caps at each IC`,
      });
    } else if (/GND|AGND|DGND|PGND/i.test(net.name)) {
      critical.push({
        name: net.name,
        type: 'power',
        priority: 1,
        notes: 'Ground - use ground plane, minimize impedance, single-point AG/DG connection',
      });
    } else if (/USB_D|USB_P|USB_N|ETH_T|ETH_R|LVDS|HDMI/i.test(net.name)) {
      critical.push({
        name: net.name,
        type: 'differential',
        priority: 2,
        notes: 'Differential pair - match lengths, maintain spacing, controlled impedance (90 ohm USB, 100 ohm Ethernet)',
      });
    } else if (/CLK|CLOCK|XTAL|OSC/i.test(net.name)) {
      critical.push({
        name: net.name,
        type: 'clock',
        priority: 2,
        notes: 'Clock signal - keep short, avoid vias, guard with ground, series termination',
      });
    } else if (/SPI.*CLK|SPI.*MOSI|SPI.*MISO|SCLK|SDIO/i.test(net.name)) {
      critical.push({
        name: net.name,
        type: 'high-speed',
        priority: 3,
        notes: 'High-speed bus - match group lengths, minimize crosstalk, maintain reference plane',
      });
    } else if (/ADC|AIN|AREF|SENSE/i.test(net.name)) {
      critical.push({
        name: net.name,
        type: 'analog',
        priority: 3,
        notes: 'Sensitive analog - guard ring, separate from digital, avoid routing near switching noise',
      });
    }
  }

  return critical.sort((a, b) => a.priority - b.priority);
}

// ─── Helper: generate default design rules ──────────────────────────────────

function generateDesignRules(intent: DesignIntent, fabTarget: FabTarget): DesignRule[] {
  const rules: DesignRule[] = [];

  // Fab-specific minimums
  const isJLC = fabTarget === 'jlcpcb';
  const minTrace = isJLC ? 0.127 : 0.1;
  const minSpace = isJLC ? 0.127 : 0.1;
  const minDrill = isJLC ? 0.3 : 0.2;
  const minVia = isJLC ? 0.45 : 0.4;

  rules.push({
    name: 'Min Trace Width',
    value: minTrace.toString(),
    unit: 'mm',
    reasoning: `${FAB_LABELS[fabTarget]} minimum capability for ${intent.layerCount}-layer board`,
  });
  rules.push({
    name: 'Min Clearance',
    value: minSpace.toString(),
    unit: 'mm',
    reasoning: `Minimum copper-to-copper spacing for ${FAB_LABELS[fabTarget]}`,
  });
  rules.push({
    name: 'Min Via Drill',
    value: minDrill.toString(),
    unit: 'mm',
    reasoning: `Standard mechanical drill for ${FAB_LABELS[fabTarget]}`,
  });
  rules.push({
    name: 'Min Via Size',
    value: minVia.toString(),
    unit: 'mm',
    reasoning: 'Via annular ring = drill + 0.15mm minimum',
  });

  // Power trace width
  const powerWidth = intent.powerReq === 'high' ? 1.0 : intent.powerReq === 'medium' ? 0.5 : 0.3;
  rules.push({
    name: 'Power Trace Width',
    value: powerWidth.toString(),
    unit: 'mm',
    reasoning: `For ${intent.powerReq} current requirement (${intent.powerReq === 'high' ? '>5A' : intent.powerReq === 'medium' ? '1-5A' : '<1A'})`,
  });

  // Signal trace width
  rules.push({
    name: 'Signal Trace Width',
    value: '0.2',
    unit: 'mm',
    reasoning: 'Standard signal trace for digital I/O',
  });

  // High-speed impedance
  if (intent.highSpeedInterfaces.includes('USB')) {
    rules.push({
      name: 'USB Diff Pair Width',
      value: '0.18',
      unit: 'mm',
      reasoning: '90 ohm differential impedance for USB 2.0 on FR4 (1.6mm, 4-layer)',
    });
  }

  return rules;
}

// ─── Helper: generate stackup ───────────────────────────────────────────────

function generateStackup(layerCount: LayerCount): { layers: StackupLayer[]; reasoning: string } {
  if (layerCount === 2) {
    return {
      layers: [
        { name: 'F.Cu', type: 'copper', thickness: '35um', purpose: 'Signal + Power routing' },
        { name: 'Core', type: 'core', thickness: '1.5mm', purpose: 'FR4 dielectric' },
        { name: 'B.Cu', type: 'copper', thickness: '35um', purpose: 'Ground plane + routing' },
      ],
      reasoning: '2-layer stackup: route on top, ground pour on bottom. Use wider traces for power. Total thickness: ~1.6mm.',
    };
  }
  if (layerCount === 4) {
    return {
      layers: [
        { name: 'F.Cu', type: 'copper', thickness: '35um', purpose: 'Signal routing (horizontal)' },
        { name: 'Prepreg', type: 'prepreg', thickness: '0.2mm', purpose: 'Dielectric (controlled impedance reference)' },
        { name: 'In1.Cu', type: 'copper', thickness: '17.5um', purpose: 'Ground plane (GND)' },
        { name: 'Core', type: 'core', thickness: '1.0mm', purpose: 'FR4 core' },
        { name: 'In2.Cu', type: 'copper', thickness: '17.5um', purpose: 'Power plane (VCC)' },
        { name: 'Prepreg', type: 'prepreg', thickness: '0.2mm', purpose: 'Dielectric' },
        { name: 'B.Cu', type: 'copper', thickness: '35um', purpose: 'Signal routing (vertical)' },
      ],
      reasoning: '4-layer stackup: Signal-Ground-Power-Signal. Inner ground plane provides excellent return path for high-speed signals. Power plane reduces PDN impedance. Total: ~1.6mm.',
    };
  }
  return {
    layers: [
      { name: 'F.Cu', type: 'copper', thickness: '35um', purpose: 'Signal routing' },
      { name: 'Prepreg', type: 'prepreg', thickness: '0.13mm', purpose: 'Dielectric' },
      { name: 'In1.Cu', type: 'copper', thickness: '17.5um', purpose: 'Ground plane' },
      { name: 'Core', type: 'core', thickness: '0.36mm', purpose: 'FR4 core' },
      { name: 'In2.Cu', type: 'copper', thickness: '17.5um', purpose: 'Signal routing (inner)' },
      { name: 'Prepreg', type: 'prepreg', thickness: '0.36mm', purpose: 'Dielectric' },
      { name: 'In3.Cu', type: 'copper', thickness: '17.5um', purpose: 'Power plane' },
      { name: 'Core', type: 'core', thickness: '0.36mm', purpose: 'FR4 core' },
      { name: 'In4.Cu', type: 'copper', thickness: '17.5um', purpose: 'Ground plane' },
      { name: 'Prepreg', type: 'prepreg', thickness: '0.13mm', purpose: 'Dielectric' },
      { name: 'B.Cu', type: 'copper', thickness: '35um', purpose: 'Signal routing' },
    ],
    reasoning: '6-layer stackup: Sig-GND-Sig-Pwr-GND-Sig. Two ground planes for optimal SI. Inner signal layer for dense routing. Total: ~1.6mm.',
  };
}

// ─── Helper: run basic DRC on placement ─────────────────────────────────────

function runPlacementDRC(
  placed: PlacedComponent[],
  boardW: number,
  boardH: number
): DRCIssue[] {
  const issues: DRCIssue[] = [];

  for (const comp of placed) {
    // Edge clearance
    if (comp.x < 1 || comp.y < 1 || comp.x > boardW - 1 || comp.y > boardH - 1) {
      issues.push({
        severity: 'error',
        message: `${comp.ref} is too close to board edge (min 1mm clearance required)`,
        components: [comp.ref],
      });
    }
  }

  // Component overlap check (simplified)
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const dist = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y);
      if (dist < 2) {
        issues.push({
          severity: 'error',
          message: `${placed[i].ref} and ${placed[j].ref} may overlap (${dist.toFixed(1)}mm apart)`,
          components: [placed[i].ref, placed[j].ref],
        });
      }
    }
  }

  // Check connectors near edges
  const connectors = placed.filter(c => c.ref.startsWith('J'));
  for (const conn of connectors) {
    const edgeDist = Math.min(conn.x, conn.y, boardW - conn.x, boardH - conn.y);
    if (edgeDist > 10) {
      issues.push({
        severity: 'warning',
        message: `Connector ${conn.ref} is ${edgeDist.toFixed(1)}mm from nearest edge; connectors should be at board edges`,
        components: [conn.ref],
      });
    }
  }

  return issues;
}

// ─── Component ──────────────────────────────────────────────────────────────

const AIBoardWizard: React.FC<AIBoardWizardProps> = (props) => {
  const store = useProjectStore();
  const visible = props.visible ?? true;
  const onClose = props.onClose ?? (() => {});
  const schematicComponents = props.schematicComponents ?? store.schematic.components;
  const schematicNets = props.schematicNets ?? store.nets;
  const onGenerateBoard = props.onGenerateBoard ?? (() => {});
  const ollama = useOllama();

  // Wizard state
  const [step, setStep] = useState<WizardStep>('intent');
  const [intent, setIntent] = useState<DesignIntent>(() => {
    const detected = detectHighSpeedInterfaces(schematicNets);
    const rec = recommendLayerCount(
      schematicComponents.length,
      schematicNets.length,
      detected.length,
      'low'
    );
    return {
      boardSize: 'medium',
      customWidth: 60,
      customHeight: 40,
      application: 'consumer',
      layerCount: rec.recommended,
      optimization: 'easy-routing',
      powerReq: 'low',
      highSpeedInterfaces: detected,
      environment: 'indoor',
      fabTarget: 'jlcpcb',
      quantity: 5,
    };
  });

  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [placedComponents, setPlacedComponents] = useState<PlacedComponent[]>([]);
  const [placementGenerating, setPlacementGenerating] = useState(false);
  const [drcIssues, setDrcIssues] = useState<DRCIssue[]>([]);
  const [draggingComp, setDraggingComp] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const previewRef = useRef<HTMLDivElement>(null);

  // Derived board dimensions
  const boardW = intent.boardSize === 'custom' ? intent.customWidth : BOARD_SIZE_PRESETS[intent.boardSize].w;
  const boardH = intent.boardSize === 'custom' ? intent.customHeight : BOARD_SIZE_PRESETS[intent.boardSize].h;

  // ── Step 1: Design Intent handlers ─────────────────────────────

  const updateIntent = useCallback(<K extends keyof DesignIntent>(key: K, value: DesignIntent[K]) => {
    setIntent(prev => {
      const next = { ...prev, [key]: value };
      // Auto-recommend layers when power changes
      if (key === 'powerReq' || key === 'highSpeedInterfaces') {
        const rec = recommendLayerCount(
          schematicComponents.length,
          schematicNets.length,
          (key === 'highSpeedInterfaces' ? value as string[] : next.highSpeedInterfaces).length,
          key === 'powerReq' ? value as PowerRequirement : next.powerReq
        );
        next.layerCount = rec.recommended;
      }
      return next;
    });
  }, [schematicComponents.length, schematicNets.length]);

  const layerRec = useMemo(() => recommendLayerCount(
    schematicComponents.length,
    schematicNets.length,
    intent.highSpeedInterfaces.length,
    intent.powerReq
  ), [schematicComponents.length, schematicNets.length, intent.highSpeedInterfaces.length, intent.powerReq]);

  // ── Step 2: AI Analysis ────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    setStep('analysis');
    setAnalysisProgress('Identifying functional blocks...');

    const blocks = classifyComponents(schematicComponents, schematicNets);
    await new Promise(r => setTimeout(r, 300));

    setAnalysisProgress('Analyzing critical nets...');
    const critNets = identifyCriticalNets(schematicNets);
    await new Promise(r => setTimeout(r, 300));

    setAnalysisProgress('Computing design rules...');
    const rules = generateDesignRules(intent, intent.fabTarget);
    await new Promise(r => setTimeout(r, 200));

    setAnalysisProgress('Building stackup recommendation...');
    const { layers: stackupLayers, reasoning: stackupReasoning } = generateStackup(intent.layerCount);
    await new Promise(r => setTimeout(r, 200));

    // Complexity score
    const compCount = schematicComponents.length;
    const netCount = schematicNets.length;
    const hsCount = intent.highSpeedInterfaces.length;
    const complexityScore = Math.min(100, Math.round(
      (compCount * 2) + (netCount * 1.5) + (hsCount * 10) +
      (intent.powerReq === 'high' ? 15 : intent.powerReq === 'medium' ? 8 : 0)
    ));

    setAnalysisProgress('Consulting AI for design intent analysis...');

    // LLM is used ONLY for design intent analysis, constraint recommendations,
    // and explanation. It NEVER generates x/y coordinates or placement data.
    // The solver (solvePlacement) is the sole source of component positions.
    let aiInsights = '';
    try {
      const prompt = `You are a PCB design assistant. Analyze this design and provide:
1. Any placement CONSTRAINTS or ZONE recommendations (e.g., "keep analog section away from switching regulators")
2. Thermal concerns (which components need heatsinking or copper pours)
3. Signal integrity warnings (which nets need length matching, guard traces, etc.)

Do NOT output any x,y coordinates or component positions. Focus only on qualitative design guidance.

Components: ${compCount} total (${blocks.map(b => `${b.name}: ${b.components.length}`).join(', ')})
Nets: ${netCount} total (${critNets.filter(n => n.type === 'power').length} power, ${critNets.filter(n => n.type === 'high-speed' || n.type === 'differential').length} high-speed)
Application: ${APPLICATION_LABELS[intent.application]}
Board: ${boardW}x${boardH}mm, ${intent.layerCount} layers
High-speed: ${intent.highSpeedInterfaces.join(', ') || 'None'}
Power requirement: ${intent.powerReq}
Environment: ${ENVIRONMENT_LABELS[intent.environment]}

Keep response under 200 words. Output only qualitative constraints and warnings.`;

      const response = await ollama.generate([{ role: 'user', content: prompt }]);
      if (response && typeof response === 'string') {
        aiInsights = response;
      }
    } catch {
      // Analysis works without AI enhancement - solver handles placement independently
    }

    setAnalysis({
      functionalBlocks: blocks,
      criticalNets: critNets,
      complexityScore,
      designRules: rules,
      stackup: stackupLayers,
      stackupReasoning: stackupReasoning + (aiInsights ? `\n\nAI Design Notes:\n${aiInsights}` : ''),
    });

    setAnalysisProgress('');
  }, [schematicComponents, schematicNets, intent, boardW, boardH, ollama]);

  // ── Step 3: Solver Placement ─────────────────────────────────────
  // ARCHITECTURE RULE: solvePlacement() is the SOLE source of component
  // positions. LLM output (functional blocks, critical nets) feeds into
  // the solver's constraint model, but the LLM NEVER generates x,y
  // coordinates. This is enforced by design: the solver takes
  // PlacementConstraint (zones, critical pairs, board dimensions) and
  // returns optimized positions via Simulated Annealing.

  const [solverStats, setSolverStats] = useState<{ iterations: number; improvement: number; finalCost: number } | null>(null);

  const generatePlacement = useCallback(async () => {
    setPlacementGenerating(true);
    setSolverStats(null);

    // Small delay to let the UI render the spinner
    await new Promise(r => setTimeout(r, 50));

    // Build BrdComponent stubs from schematic components (for the solver)
    const brdStubs: BrdComponent[] = schematicComponents.map(c => ({
      id: `stub_${c.id}`,
      ref: c.ref,
      value: c.value,
      footprint: c.footprint,
      x: 0,
      y: 0,
      rotation: 0,
      layer: 'F.Cu',
      pads: c.pins.map((pin, i) => ({
        id: `pad_${c.ref}_${pin.number}`,
        number: pin.number,
        x: 0,
        y: 0,
        width: 1,
        height: 0.5,
        shape: 'rect' as const,
        layers: ['F.Cu'],
        netId: pin.netId,
      })),
    }));

    // Build constraints from the analysis functional blocks
    const blocks = analysis?.functionalBlocks || classifyComponents(schematicComponents, schematicNets);
    const constraints = buildConstraintsFromBlocks(
      blocks.map(b => ({ name: b.name, type: b.type, components: b.components })),
      brdStubs,
      boardW,
      boardH,
    );

    // Enable thermal cost term when "Thermal Management" optimization is selected
    if (intent.optimization === 'thermal-management') {
      constraints.thermalOptimize = true;
    }

    // Run simulated annealing solver (pure math, no LLM)
    const result = solvePlacement(brdStubs, constraints, {
      initialTemperature: 1000,
      coolingRate: 0.995,
      iterationsPerTemp: 100,
      seed: Date.now() % 100000,
    });

    setSolverStats({
      iterations: result.iterations,
      improvement: result.improvement,
      finalCost: result.finalCost,
    });

    // Map solver output to placed components with zone-based reasoning
    const refToBlock = new Map<string, string>();
    for (const block of blocks) {
      for (const ref of block.components) {
        refToBlock.set(ref, block.name);
      }
    }

    setPlacedComponents(result.components.map(c => ({
      ref: c.ref,
      x: c.x,
      y: c.y,
      rotation: c.rotation,
      layer: c.layer,
      reasoning: refToBlock.has(c.ref)
        ? `Placed in ${refToBlock.get(c.ref)} zone by simulated annealing solver`
        : 'Optimized by simulated annealing solver',
    })));

    setPlacementGenerating(false);
  }, [schematicComponents, schematicNets, boardW, boardH, analysis, intent.optimization]);

  // NOTE: Legacy generateFallbackPlacement was removed. All placement MUST go
  // through solvePlacement() (Simulated Annealing). The solver handles zone
  // constraints, overlap avoidance, critical pair proximity, and wire length
  // optimization. LLM informs constraints; solver produces coordinates.

  // DRC on placement change
  useEffect(() => {
    if (placedComponents.length > 0) {
      setDrcIssues(runPlacementDRC(placedComponents, boardW, boardH));
    }
  }, [placedComponents, boardW, boardH]);

  // ── Placement preview drag ─────────────────────────────────────

  const handlePreviewMouseDown = useCallback((ref: string, e: React.MouseEvent) => {
    e.preventDefault();
    const comp = placedComponents.find(c => c.ref === ref);
    if (!comp || !previewRef.current) return;

    const rect = previewRef.current.getBoundingClientRect();
    const scaleX = rect.width / boardW;
    const scaleY = rect.height / boardH;
    const mouseX = (e.clientX - rect.left) / scaleX;
    const mouseY = (e.clientY - rect.top) / scaleY;

    setDraggingComp(ref);
    setDragOffset({ x: mouseX - comp.x, y: mouseY - comp.y });
  }, [placedComponents, boardW, boardH]);

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingComp || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const scaleX = rect.width / boardW;
    const scaleY = rect.height / boardH;
    const mouseX = (e.clientX - rect.left) / scaleX;
    const mouseY = (e.clientY - rect.top) / scaleY;
    const newX = Math.max(1, Math.min(boardW - 1, mouseX - dragOffset.x));
    const newY = Math.max(1, Math.min(boardH - 1, mouseY - dragOffset.y));

    setPlacedComponents(prev => prev.map(c =>
      c.ref === draggingComp ? { ...c, x: newX, y: newY } : c
    ));
  }, [draggingComp, dragOffset, boardW, boardH]);

  const handlePreviewMouseUp = useCallback(() => {
    setDraggingComp(null);
  }, []);

  // ── Step 4: Generate Board ─────────────────────────────────────

  const handleGenerate = useCallback(() => {
    // Convert placed components to board state
    const brdComponents: BrdComponent[] = placedComponents.map(pc => {
      const schComp = schematicComponents.find(c => c.ref === pc.ref);
      if (!schComp) {
        return {
          id: `brd_${pc.ref}_${Date.now()}`,
          ref: pc.ref,
          value: '',
          footprint: '',
          x: pc.x,
          y: pc.y,
          rotation: pc.rotation,
          layer: pc.layer,
          pads: [],
        };
      }

      const pads: BrdPad[] = schComp.pins.map((pin, i) => {
        const isIC = /QFP|BGA|QFN|LQFP|TSSOP|SOIC/i.test(schComp.footprint);
        const pinCount = schComp.pins.length;
        const padW = isIC ? 1.6 : 0.8;
        const padH = isIC ? 0.5 : 0.6;
        // Arrange pads around IC perimeter or inline for passives
        let px: number, py: number;
        if (isIC && pinCount > 4) {
          const side = Math.floor(i / Math.ceil(pinCount / 4));
          const posInSide = i % Math.ceil(pinCount / 4);
          const span = Math.ceil(pinCount / 4) * 0.8;
          const offset = -span / 2 + posInSide * 0.8;
          const halfSize = span / 2 + 1;
          if (side === 0) { px = -halfSize; py = offset; }
          else if (side === 1) { px = offset; py = halfSize; }
          else if (side === 2) { px = halfSize; py = offset; }
          else { px = offset; py = -halfSize; }
        } else {
          px = (i - (pinCount - 1) / 2) * 1.2;
          py = 0;
        }

        return {
          id: `pad_${pc.ref}_${pin.number}`,
          number: pin.number,
          x: px,
          y: py,
          width: padW,
          height: padH,
          shape: 'rect' as const,
          layers: [pc.layer],
          netId: pin.netId,
        };
      });

      return {
        id: `brd_${schComp.id}`,
        ref: pc.ref,
        value: schComp.value,
        footprint: schComp.footprint,
        x: pc.x,
        y: pc.y,
        rotation: pc.rotation,
        layer: pc.layer,
        pads,
      };
    });

    const outline: BoardOutline = {
      points: [
        { x: 0, y: 0 },
        { x: boardW, y: 0 },
        { x: boardW, y: boardH },
        { x: 0, y: boardH },
      ],
    };

    const layerNames = intent.layerCount === 2
      ? ['F.Cu', 'B.Cu']
      : intent.layerCount === 4
        ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']
        : ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'B.Cu'];

    const board: BoardState = {
      components: brdComponents,
      traces: [],
      vias: [],
      zones: [],
      outline,
      layers: [...layerNames, 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'],
    };

    onGenerateBoard(board);
    onClose();
  }, [placedComponents, schematicComponents, boardW, boardH, intent.layerCount, onGenerateBoard, onClose]);

  // ── Render ─────────────────────────────────────────────────────

  if (!visible) return null;

  const steps: { id: WizardStep; label: string; num: number }[] = [
    { id: 'intent', label: 'Design Intent', num: 1 },
    { id: 'analysis', label: 'AI Analysis', num: 2 },
    { id: 'placement', label: 'Component Placement', num: 3 },
    { id: 'review', label: 'Review & Generate', num: 4 },
  ];

  const stepIndex = steps.findIndex(s => s.id === step);

  return (
    <div style={styles.overlay}>
      <div style={styles.wizard}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.aiIcon}>AI</div>
            <div>
              <div style={styles.title}>Generate Board</div>
              <div style={styles.subtitle}>
                {schematicComponents.length} components, {schematicNets.length} nets
              </div>
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
        </div>

        {/* Step indicator */}
        <div style={styles.stepBar}>
          {steps.map((s, i) => (
            <div key={s.id} style={styles.stepItem}>
              <div style={{
                ...styles.stepCircle,
                ...(i < stepIndex ? styles.stepDone : {}),
                ...(i === stepIndex ? styles.stepActive : {}),
              }}>
                {i < stepIndex ? '\u2713' : s.num}
              </div>
              <span style={{
                ...styles.stepLabel,
                ...(i === stepIndex ? styles.stepLabelActive : {}),
              }}>
                {s.label}
              </span>
              {i < steps.length - 1 && <div style={styles.stepLine} />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={styles.content}>
          {/* ── Step 1: Design Intent ──────────────────────────── */}
          {step === 'intent' && (
            <div style={styles.intentGrid}>
              {/* Board Size */}
              <div style={styles.field}>
                <label style={styles.fieldLabel}>
                  What is the target board size?
                </label>
                <div style={styles.optionRow}>
                  {(Object.entries(BOARD_SIZE_PRESETS) as [BoardSize, typeof BOARD_SIZE_PRESETS['small']][]).map(([key, val]) => (
                    <button
                      key={key}
                      style={{
                        ...styles.optionBtn,
                        ...(intent.boardSize === key ? styles.optionBtnActive : {}),
                      }}
                      onClick={() => updateIntent('boardSize', key)}
                    >
                      {val.label}
                    </button>
                  ))}
                </div>
                {intent.boardSize === 'custom' && (
                  <div style={styles.customSize}>
                    <input
                      style={styles.sizeInput}
                      type="number"
                      value={intent.customWidth}
                      onChange={e => updateIntent('customWidth', Number(e.target.value))}
                      min={10}
                      max={500}
                    />
                    <span style={styles.sizeX}>x</span>
                    <input
                      style={styles.sizeInput}
                      type="number"
                      value={intent.customHeight}
                      onChange={e => updateIntent('customHeight', Number(e.target.value))}
                      min={10}
                      max={500}
                    />
                    <span style={styles.sizeUnit}>mm</span>
                  </div>
                )}
              </div>

              {/* Application */}
              <div style={styles.field}>
                <label style={styles.fieldLabel}>
                  What is this board for?
                </label>
                <div style={styles.optionRow}>
                  {(Object.entries(APPLICATION_LABELS) as [ApplicationType, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      style={{
                        ...styles.optionBtn,
                        ...(intent.application === key ? styles.optionBtnActive : {}),
                      }}
                      onClick={() => updateIntent('application', key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Layer Count */}
              <div style={styles.field}>
                <label style={styles.fieldLabel}>
                  How many layers?
                  <span style={styles.fieldHint}>
                    AI recommends {layerRec.recommended} layers: {layerRec.reasoning}
                  </span>
                </label>
                <div style={styles.optionRow}>
                  {([2, 4, 6] as LayerCount[]).map(n => (
                    <button
                      key={n}
                      style={{
                        ...styles.optionBtn,
                        ...(intent.layerCount === n ? styles.optionBtnActive : {}),
                        ...(n === layerRec.recommended ? styles.optionBtnRecommended : {}),
                      }}
                      onClick={() => updateIntent('layerCount', n)}
                    >
                      {n} Layers
                      {n === layerRec.recommended && (
                        <span style={styles.recBadge}>REC</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Optimization */}
              <div style={styles.field}>
                <label style={styles.fieldLabel}>
                  Optimization priority
                </label>
                <div style={styles.optionRow}>
                  {(Object.entries(OPTIMIZATION_LABELS) as [OptimizationPriority, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      style={{
                        ...styles.optionBtn,
                        ...(intent.optimization === key ? styles.optionBtnActive : {}),
                      }}
                      onClick={() => updateIntent('optimization', key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Power Requirements */}
              <div style={styles.field}>
                <label style={styles.fieldLabel}>
                  Max current on any trace?
                </label>
                <div style={styles.optionRow}>
                  {([
                    ['low', 'Low (<1A)'],
                    ['medium', 'Medium (1-5A)'],
                    ['high', 'High (>5A)'],
                  ] as [PowerRequirement, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      style={{
                        ...styles.optionBtn,
                        ...(intent.powerReq === key ? styles.optionBtnActive : {}),
                      }}
                      onClick={() => updateIntent('powerReq', key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* High-speed interfaces (auto-detected) */}
              <div style={styles.field}>
                <label style={styles.fieldLabel}>
                  High-speed interfaces detected
                  <span style={styles.fieldHint}>Auto-detected from schematic nets</span>
                </label>
                <div style={styles.chipRow}>
                  {intent.highSpeedInterfaces.length === 0 ? (
                    <span style={styles.noneText}>None detected</span>
                  ) : (
                    intent.highSpeedInterfaces.map(iface => (
                      <span key={iface} style={styles.chip}>{iface}</span>
                    ))
                  )}
                </div>
              </div>

              {/* Environment & Fab (compact row) */}
              <div style={styles.fieldRow}>
                <div style={styles.fieldHalf}>
                  <label style={styles.fieldLabel}>Environment</label>
                  <select
                    style={styles.select}
                    value={intent.environment}
                    onChange={e => updateIntent('environment', e.target.value as Environment)}
                  >
                    {(Object.entries(ENVIRONMENT_LABELS) as [Environment, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.fieldHalf}>
                  <label style={styles.fieldLabel}>Target Fab</label>
                  <select
                    style={styles.select}
                    value={intent.fabTarget}
                    onChange={e => updateIntent('fabTarget', e.target.value as FabTarget)}
                  >
                    {(Object.entries(FAB_LABELS) as [FabTarget, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.fieldHalf}>
                  <label style={styles.fieldLabel}>Quantity</label>
                  <input
                    style={styles.qtyInput}
                    type="number"
                    value={intent.quantity}
                    onChange={e => updateIntent('quantity', Math.max(1, Number(e.target.value)))}
                    min={1}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: AI Analysis ───────────────────────────── */}
          {step === 'analysis' && (
            <div style={styles.analysisContainer}>
              {!analysis ? (
                <div style={styles.analyzing}>
                  <div style={styles.spinner} />
                  <div style={styles.analyzeText}>{analysisProgress || 'Analyzing design...'}</div>
                </div>
              ) : (
                <>
                  {/* Functional Blocks */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Functional Blocks Identified</div>
                    <div style={styles.blocksGrid}>
                      {analysis.functionalBlocks.map(block => (
                        <div key={block.name} style={{ ...styles.blockCard, borderLeftColor: block.color }}>
                          <div style={{ ...styles.blockName, color: block.color }}>{block.name}</div>
                          <div style={styles.blockComps}>
                            {block.components.join(', ')}
                          </div>
                          <div style={styles.blockCount}>{block.components.length} components</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Critical Nets */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Critical Nets</div>
                    <div style={styles.netList}>
                      {analysis.criticalNets.slice(0, 10).map(net => (
                        <div key={net.name} style={styles.netRow}>
                          <span style={{
                            ...styles.netBadge,
                            background: net.type === 'power' ? theme.redDim :
                              net.type === 'differential' ? theme.purpleDim :
                              net.type === 'clock' ? theme.orangeDim :
                              net.type === 'high-speed' ? theme.blueDim : theme.greenDim,
                            color: net.type === 'power' ? theme.red :
                              net.type === 'differential' ? theme.purple :
                              net.type === 'clock' ? theme.orange :
                              net.type === 'high-speed' ? theme.blue : theme.green,
                          }}>
                            {net.type.toUpperCase()}
                          </span>
                          <span style={styles.netName}>{net.name}</span>
                          <span style={styles.netNotes}>{net.notes}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Complexity Score */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Board Complexity</div>
                    <div style={styles.scoreBar}>
                      <div style={{
                        ...styles.scoreFill,
                        width: `${analysis.complexityScore}%`,
                        background: analysis.complexityScore < 30 ? theme.green :
                          analysis.complexityScore < 60 ? theme.orange : theme.red,
                      }} />
                    </div>
                    <div style={styles.scoreLabel}>
                      {analysis.complexityScore}/100
                      ({analysis.complexityScore < 30 ? 'Simple' :
                        analysis.complexityScore < 60 ? 'Moderate' : 'Complex'})
                    </div>
                  </div>

                  {/* Design Rules */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Recommended Design Rules</div>
                    <div style={styles.rulesGrid}>
                      {analysis.designRules.map(rule => (
                        <div key={rule.name} style={styles.ruleCard}>
                          <div style={styles.ruleName}>{rule.name}</div>
                          <div style={styles.ruleValue}>{rule.value} {rule.unit}</div>
                          <div style={styles.ruleReason}>{rule.reasoning}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stackup */}
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>Recommended Stackup</div>
                    <div style={styles.stackup}>
                      {analysis.stackup.map((layer, i) => (
                        <div key={i} style={{
                          ...styles.stackupLayer,
                          background: layer.type === 'copper' ? 'rgba(240,160,48,0.15)' :
                            layer.type === 'core' ? 'rgba(77,158,255,0.08)' : 'rgba(60,220,124,0.08)',
                          borderColor: layer.type === 'copper' ? 'rgba(240,160,48,0.3)' :
                            layer.type === 'core' ? 'rgba(77,158,255,0.15)' : 'rgba(60,220,124,0.15)',
                        }}>
                          <span style={styles.stackupName}>{layer.name}</span>
                          <span style={styles.stackupThick}>{layer.thickness}</span>
                          <span style={styles.stackupPurpose}>{layer.purpose}</span>
                        </div>
                      ))}
                    </div>
                    <div style={styles.stackupNote}>{analysis.stackupReasoning}</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Component Placement ───────────────────── */}
          {step === 'placement' && (
            <div style={styles.placementContainer}>
              {placementGenerating ? (
                <div style={styles.analyzing}>
                  <div style={styles.spinner} />
                  <div style={styles.analyzeText}>Solver: running simulated annealing...</div>
                  <div style={styles.analyzeSubtext}>Optimizing placement with zone constraints, overlap avoidance, and wire length minimization</div>
                </div>
              ) : placedComponents.length === 0 ? (
                <div style={styles.placementEmpty}>
                  <div style={styles.placementEmptyText}>
                    Click "Generate Placement" to run the constraint-based solver
                  </div>
                  <button style={styles.generateBtn} onClick={generatePlacement}>
                    Generate Placement
                  </button>
                </div>
              ) : (
                <div style={styles.placementLayout}>
                  {/* Board preview */}
                  <div style={styles.previewArea}>
                    <div style={styles.previewHeader}>
                      <span>Board Preview ({boardW}x{boardH}mm)</span>
                      <button style={styles.reoptBtn} onClick={generatePlacement}>
                        Re-optimize
                      </button>
                    </div>
                    <div
                      ref={previewRef}
                      style={{
                        ...styles.boardPreview,
                        aspectRatio: `${boardW} / ${boardH}`,
                      }}
                      onMouseMove={handlePreviewMouseMove}
                      onMouseUp={handlePreviewMouseUp}
                      onMouseLeave={handlePreviewMouseUp}
                    >
                      {/* Grid lines */}
                      <svg
                        style={styles.previewSvg}
                        viewBox={`0 0 ${boardW} ${boardH}`}
                        preserveAspectRatio="xMidYMid meet"
                      >
                        {/* Board outline */}
                        <rect
                          x={0} y={0} width={boardW} height={boardH}
                          fill="none" stroke={theme.yellow} strokeWidth={0.3}
                        />
                        {/* Grid */}
                        {Array.from({ length: Math.floor(boardW / 5) }, (_, i) => (
                          <line key={`gv${i}`} x1={(i + 1) * 5} y1={0} x2={(i + 1) * 5} y2={boardH}
                            stroke={theme.gridColor} strokeWidth={0.1} />
                        ))}
                        {Array.from({ length: Math.floor(boardH / 5) }, (_, i) => (
                          <line key={`gh${i}`} x1={0} y1={(i + 1) * 5} x2={boardW} y2={(i + 1) * 5}
                            stroke={theme.gridColor} strokeWidth={0.1} />
                        ))}
                        {/* Components */}
                        {placedComponents.map(comp => {
                          const schComp = schematicComponents.find(c => c.ref === comp.ref);
                          const isIC = schComp && /QFP|BGA|QFN|LQFP|TSSOP|SOIC|DIP/i.test(schComp.footprint);
                          const isConnector = comp.ref.startsWith('J');
                          const isPassive = comp.ref.startsWith('R') || comp.ref.startsWith('C') || comp.ref.startsWith('L');
                          const w = isIC ? 8 : isConnector ? 6 : 2;
                          const h = isIC ? 8 : isConnector ? 4 : 1.2;
                          const color = isIC ? theme.blue : isConnector ? theme.purple :
                            comp.ref.startsWith('Y') ? theme.orange :
                            comp.ref.startsWith('LED') || comp.ref.startsWith('D') ? theme.green :
                            theme.textMuted;

                          return (
                            <g key={comp.ref}
                              transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}
                              style={{ cursor: 'grab' }}
                              onMouseDown={(e) => handlePreviewMouseDown(comp.ref, e as any)}
                            >
                              <rect
                                x={-w / 2} y={-h / 2} width={w} height={h}
                                fill={`${color}22`} stroke={color} strokeWidth={0.2}
                                rx={0.3}
                              />
                              <text
                                x={0} y={0.4}
                                textAnchor="middle"
                                fontSize={isPassive ? 1.2 : 1.8}
                                fill={color}
                                fontFamily={theme.fontMono}
                              >
                                {comp.ref}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                    <div style={styles.previewHint}>
                      Drag components to adjust placement
                    </div>
                    {solverStats && (
                      <div style={styles.solverStats}>
                        <span style={styles.solverStatItem}>
                          Iterations: {solverStats.iterations.toLocaleString()}
                        </span>
                        <span style={styles.solverStatItem}>
                          Cost improvement: {solverStats.improvement.toFixed(1)}%
                        </span>
                        <span style={styles.solverStatItem}>
                          Final cost: {solverStats.finalCost.toFixed(0)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Component list with reasoning */}
                  <div style={styles.compList}>
                    <div style={styles.compListTitle}>Placement Details</div>
                    <div style={styles.compListScroll}>
                      {placedComponents.map(comp => (
                        <div key={comp.ref} style={styles.compItem}>
                          <div style={styles.compItemHeader}>
                            <span style={styles.compRef}>{comp.ref}</span>
                            <span style={styles.compPos}>
                              ({comp.x.toFixed(1)}, {comp.y.toFixed(1)}) {comp.rotation > 0 ? `${comp.rotation}\u00B0` : ''}
                            </span>
                          </div>
                          {comp.reasoning && (
                            <div style={styles.compReasoning}>{comp.reasoning}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Review & Generate ─────────────────────── */}
          {step === 'review' && (
            <div style={styles.reviewContainer}>
              {/* Summary */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Board Summary</div>
                <div style={styles.summaryGrid}>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Board Size</div>
                    <div style={styles.summaryValue}>{boardW} x {boardH} mm</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Layers</div>
                    <div style={styles.summaryValue}>{intent.layerCount}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Components</div>
                    <div style={styles.summaryValue}>{placedComponents.length}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Application</div>
                    <div style={styles.summaryValue}>{APPLICATION_LABELS[intent.application]}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Optimization</div>
                    <div style={styles.summaryValue}>{OPTIMIZATION_LABELS[intent.optimization]}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Target Fab</div>
                    <div style={styles.summaryValue}>{FAB_LABELS[intent.fabTarget]}</div>
                  </div>
                </div>
              </div>

              {/* DRC Pre-check */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Placement DRC Pre-check</div>
                {drcIssues.length === 0 ? (
                  <div style={styles.drcPass}>
                    <span style={styles.drcPassIcon}>{'\u2713'}</span>
                    No placement issues found
                  </div>
                ) : (
                  <div style={styles.drcList}>
                    {drcIssues.map((issue, i) => (
                      <div key={i} style={{
                        ...styles.drcItem,
                        borderLeftColor: issue.severity === 'error' ? theme.red : theme.orange,
                      }}>
                        <span style={{
                          ...styles.drcSeverity,
                          color: issue.severity === 'error' ? theme.red : theme.orange,
                        }}>
                          {issue.severity.toUpperCase()}
                        </span>
                        <span style={styles.drcMessage}>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Engine status */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Engine Status</div>
                <div style={styles.ollamaStatus}>
                  <div style={{
                    ...styles.statusDot,
                    background: theme.green,
                  }} />
                  <span>
                    Placement Solver: Simulated Annealing (local, no LLM)
                  </span>
                </div>
                {ollama.status.connected && (
                  <div style={{ ...styles.ollamaStatus, marginTop: 4 }}>
                    <div style={{
                      ...styles.statusDot,
                      background: theme.green,
                    }} />
                    <span>
                      LLM ({ollama.config.model}): available for analysis/explanation
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <div style={styles.footerLeft}>
            {step !== 'intent' && (
              <button
                style={styles.backBtn}
                onClick={() => {
                  const prev = steps[stepIndex - 1];
                  if (prev) setStep(prev.id);
                }}
              >
                Back
              </button>
            )}
          </div>
          <div style={styles.footerRight}>
            {step === 'intent' && (
              <button
                style={styles.nextBtn}
                onClick={runAnalysis}
              >
                Analyze Design
              </button>
            )}
            {step === 'analysis' && analysis && (
              <button
                style={styles.nextBtn}
                onClick={() => { setStep('placement'); generatePlacement(); }}
              >
                Generate Placement
              </button>
            )}
            {step === 'placement' && placedComponents.length > 0 && (
              <button
                style={styles.nextBtn}
                onClick={() => setStep('review')}
              >
                Review
              </button>
            )}
            {step === 'review' && (
              <button
                style={styles.generateBoardBtn}
                onClick={handleGenerate}
                disabled={drcIssues.some(d => d.severity === 'error')}
              >
                Generate Board
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    fontFamily: theme.fontSans,
  },
  wizard: {
    width: 920,
    maxWidth: '95vw',
    maxHeight: '90vh',
    background: theme.bg1,
    borderRadius: theme.radiusLg,
    border: theme.border,
    boxShadow: theme.shadowLg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  aiIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.radiusMd,
    background: `linear-gradient(135deg, ${theme.purple}, ${theme.blue})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 800,
    fontFamily: theme.fontMono,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontLg,
    fontWeight: 700,
  },
  subtitle: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    marginTop: 1,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 16,
    cursor: 'pointer',
    padding: 6,
    borderRadius: theme.radiusSm,
  },

  // Step bar
  stepBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 24px',
    borderBottom: theme.border,
    background: theme.bg1,
    gap: 0,
    flexShrink: 0,
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: theme.bg3,
    border: `2px solid ${theme.bg3}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.textMuted,
    fontSize: '10px',
    fontWeight: 700,
    fontFamily: theme.fontMono,
    flexShrink: 0,
  },
  stepDone: {
    background: theme.greenDim,
    borderColor: theme.green,
    color: theme.green,
  },
  stepActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  stepLabel: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  stepLabelActive: {
    color: theme.blue,
  },
  stepLine: {
    width: 40,
    height: 1,
    background: theme.bg3,
    margin: '0 8px',
  },

  // Content area
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 24px',
  },

  // Intent fields
  intentGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fieldLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontWeight: 600,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  fieldHint: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontWeight: 400,
    fontStyle: 'italic',
  },
  optionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  optionBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    padding: '5px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    fontWeight: 500,
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  optionBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  optionBtnRecommended: {
    boxShadow: `0 0 0 1px ${theme.green}33`,
  },
  recBadge: {
    fontSize: '7px',
    fontWeight: 800,
    color: theme.green,
    background: theme.greenDim,
    padding: '1px 3px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
  },
  customSize: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  sizeInput: {
    width: 70,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    padding: '4px 8px',
    fontFamily: theme.fontMono,
    outline: 'none',
    textAlign: 'center',
  },
  sizeX: {
    color: theme.textMuted,
    fontSize: theme.fontSm,
  },
  sizeUnit: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  chip: {
    background: theme.purpleDim,
    border: `1px solid ${theme.purple}44`,
    borderRadius: theme.radiusSm,
    color: theme.purple,
    fontSize: theme.fontXs,
    padding: '2px 8px',
    fontWeight: 500,
  },
  noneText: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontStyle: 'italic',
  },
  fieldRow: {
    display: 'flex',
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  select: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    padding: '5px 8px',
    fontFamily: theme.fontSans,
    cursor: 'pointer',
    outline: 'none',
  },
  qtyInput: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    padding: '5px 8px',
    fontFamily: theme.fontMono,
    outline: 'none',
    width: '100%',
  },

  // Analysis
  analysisContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  analyzing: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
    gap: 16,
  },
  spinner: {
    width: 32,
    height: 32,
    border: `3px solid ${theme.bg3}`,
    borderTopColor: theme.blue,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  analyzeText: {
    color: theme.textSecondary,
    fontSize: theme.fontMd,
    fontWeight: 500,
  },
  analyzeSubtext: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontWeight: 700,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  blocksGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 6,
  },
  blockCard: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    padding: '8px 10px',
    borderLeft: '3px solid',
  },
  blockName: {
    fontSize: theme.fontSm,
    fontWeight: 600,
    marginBottom: 2,
  },
  blockComps: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    wordBreak: 'break-all',
  },
  blockCount: {
    color: theme.textMuted,
    fontSize: '9px',
    marginTop: 4,
  },
  netList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  netRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '4px 0',
  },
  netBadge: {
    fontSize: '8px',
    fontWeight: 700,
    padding: '1px 5px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
    flexShrink: 0,
    marginTop: 1,
  },
  netName: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    fontFamily: theme.fontMono,
    minWidth: 60,
    flexShrink: 0,
  },
  netNotes: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    lineHeight: 1.3,
  },
  scoreBar: {
    height: 8,
    background: theme.bg3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.5s ease',
  },
  scoreLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    marginTop: 4,
    fontWeight: 500,
  },
  rulesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 6,
  },
  ruleCard: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    padding: '8px 10px',
    border: theme.border,
  },
  ruleName: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    marginBottom: 2,
  },
  ruleValue: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 700,
    fontFamily: theme.fontMono,
  },
  ruleReason: {
    color: theme.textMuted,
    fontSize: '9px',
    marginTop: 4,
    lineHeight: 1.3,
  },
  stackup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  stackupLayer: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: 2,
    border: '1px solid',
    gap: 12,
  },
  stackupName: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    fontFamily: theme.fontMono,
    minWidth: 60,
  },
  stackupThick: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    minWidth: 50,
  },
  stackupPurpose: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
  },
  stackupNote: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 1.4,
  },

  // Placement
  placementContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  placementEmpty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
    gap: 16,
  },
  placementEmptyText: {
    color: theme.textMuted,
    fontSize: theme.fontSm,
  },
  generateBtn: {
    background: `linear-gradient(135deg, ${theme.purple}, ${theme.blue})`,
    border: 'none',
    borderRadius: theme.radiusMd,
    color: '#fff',
    fontSize: theme.fontSm,
    fontWeight: 600,
    padding: '10px 24px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  placementLayout: {
    display: 'flex',
    gap: 16,
    flex: 1,
    minHeight: 0,
  },
  previewArea: {
    flex: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 500,
  },
  reoptBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.purple,
    fontSize: theme.fontXs,
    padding: '3px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    fontWeight: 500,
  },
  boardPreview: {
    background: theme.brdBackground,
    border: theme.border,
    borderRadius: theme.radiusSm,
    position: 'relative',
    overflow: 'hidden',
    maxHeight: 400,
    width: '100%',
  },
  previewSvg: {
    width: '100%',
    height: '100%',
  },
  previewHint: {
    color: theme.textMuted,
    fontSize: '9px',
    textAlign: 'center',
  },
  solverStats: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    padding: '4px 0',
    marginTop: 2,
  },
  solverStatItem: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
    background: theme.bg2,
    padding: '2px 6px',
    borderRadius: theme.radiusSm,
    border: theme.border,
  },
  compList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 220,
  },
  compListTitle: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  compListScroll: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    maxHeight: 380,
  },
  compItem: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    padding: '6px 8px',
    border: theme.border,
  },
  compItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  compRef: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    fontFamily: theme.fontMono,
  },
  compPos: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
  },
  compReasoning: {
    color: theme.textMuted,
    fontSize: '9px',
    marginTop: 2,
    lineHeight: 1.3,
  },

  // Review
  reviewContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
  },
  summaryItem: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    padding: '10px 12px',
    border: theme.border,
  },
  summaryLabel: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    marginBottom: 2,
  },
  summaryValue: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  drcPass: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: theme.greenDim,
    border: `1px solid ${theme.green}44`,
    borderRadius: theme.radiusSm,
    padding: '10px 14px',
    color: theme.green,
    fontSize: theme.fontSm,
    fontWeight: 500,
  },
  drcPassIcon: {
    fontSize: 16,
    fontWeight: 700,
  },
  drcList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  drcItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '6px 10px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    borderLeft: '3px solid',
  },
  drcSeverity: {
    fontSize: '8px',
    fontWeight: 700,
    fontFamily: theme.fontMono,
    flexShrink: 0,
    marginTop: 2,
  },
  drcMessage: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    lineHeight: 1.3,
  },
  ollamaStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },

  // Footer
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderTop: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  footerLeft: {
    display: 'flex',
    gap: 8,
  },
  footerRight: {
    display: 'flex',
    gap: 8,
  },
  backBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontWeight: 500,
    padding: '8px 20px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  nextBtn: {
    background: theme.blueDim,
    border: `1px solid ${theme.blue}`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    fontSize: theme.fontSm,
    fontWeight: 600,
    padding: '8px 24px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  generateBoardBtn: {
    background: `linear-gradient(135deg, ${theme.purple}, ${theme.blue})`,
    border: 'none',
    borderRadius: theme.radiusMd,
    color: '#fff',
    fontSize: theme.fontSm,
    fontWeight: 700,
    padding: '10px 32px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    letterSpacing: '0.3px',
  },
};

// Inject animation keyframes
if (typeof document !== 'undefined') {
  const styleEl = document.getElementById('ai-wizard-styles') || document.createElement('style');
  styleEl.id = 'ai-wizard-styles';
  styleEl.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  if (!document.getElementById('ai-wizard-styles')) {
    document.head.appendChild(styleEl);
  }
}

export default AIBoardWizard;
