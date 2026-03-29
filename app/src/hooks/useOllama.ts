// ─── useOllama.ts ── Ollama LLM integration hook for PCB AI features ───────
import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  SchComponent, SchNet, BrdComponent, BoardState,
} from '../types';

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'qwen2.5-coder:14b';
// All Ollama calls go through Go backend proxy at /api/ollama/*
const OLLAMA_PROXY_BASE = '/api/ollama';

// Model preference order: best to worst for PCB design tasks
const MODEL_PREFERENCE = [
  'qwen2.5-coder:14b',
  'qwen2.5-coder:7b',
  'qwen2.5:14b',
  'qwen2.5:7b',
  'codellama:13b',
  'llama3.2',
];

/**
 * Query Ollama for available models and pick the best one based on preference.
 * Falls back to the first available model if none from the preference list is found.
 */
export async function getBestAvailableModel(): Promise<{ model: string; available: string[]; fallback: boolean }> {
  try {
    const res = await fetch(`${OLLAMA_PROXY_BASE}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models: string[] = (data.models || []).map((m: any) => m.name || m.model);

    if (models.length === 0) {
      return { model: DEFAULT_MODEL, available: [], fallback: true };
    }

    // Try each preferred model in order
    for (const preferred of MODEL_PREFERENCE) {
      const match = models.find(
        (m) => m === preferred || m.startsWith(preferred + ':') || m === preferred.split(':')[0],
      );
      if (match) {
        return { model: match, available: models, fallback: false };
      }
    }

    // No preferred model found -- use the first available
    return { model: models[0], available: models, fallback: true };
  } catch {
    return { model: DEFAULT_MODEL, available: [], fallback: true };
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OllamaStatus {
  connected: boolean;
  model: string;
  availableModels: string[];
  error: string | null;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamToken {
  content: string;
  done: boolean;
}

export interface OllamaConfig {
  url: string; // kept for backward compat, but all calls go through Go proxy
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface PlacementResult {
  components: Array<{
    ref: string;
    x: number;
    y: number;
    rotation: number;
    layer: string;
    reasoning?: string;
  }>;
  boardOutline?: { width: number; height: number };
}

export interface RoutingStrategyResult {
  netOrder: Array<{
    netId: string;
    netName: string;
    priority: number;
    layer: string;
    width: number;
    reasoning: string;
  }>;
  layerAssignment: Record<string, string>;
  impedanceNets: Array<{
    netName: string;
    targetImpedance: number;
    traceWidth: number;
    spacing: number;
  }>;
  generalNotes: string[];
}

export interface DesignFinding {
  id: string;
  severity: 'critical' | 'warning' | 'suggestion' | 'info';
  category: 'placement' | 'routing' | 'thermal' | 'signal-integrity' | 'power-integrity' | 'dfm' | 'emc';
  title: string;
  description: string;
  affectedComponents: string[];
  suggestedFix: string;
  autoFixable: boolean;
  x?: number;
  y?: number;
}

export interface DesignReviewResult {
  findings: DesignFinding[];
  overallScore: number;
  summary: string;
}

// ─── PCB Domain Prompts ─────────────────────────────────────────────────────

const PCB_SYSTEM_PROMPT = `You are an expert PCB layout engineer AI integrated into an EDA tool called RouteAI.
You have deep knowledge of:
- PCB layout best practices (IPC standards, manufacturer guidelines)
- Signal integrity: impedance matching, crosstalk, return paths, via transitions
- Power integrity: decoupling strategy, PDN impedance, current capacity
- EMC: separation of analog/digital, ground plane continuity, shielding
- Thermal management: copper pours, thermal vias, component spacing
- DFM: minimum trace/space, drill sizes, solder mask rules, panelization
- Component placement rules: decoupling within 2mm of IC pins, crystals close to MCU,
  connectors at board edges, power section grouped, sensitive analog away from noise
- High-speed design: differential pairs, length matching, controlled impedance

CRITICAL: Always respond with valid JSON when asked for structured output.
Never include markdown code fences or explanation text outside the JSON structure.
When providing coordinates, use millimeters. Origin is top-left corner.`;

export function buildPlacementPrompt(
  components: Array<{ ref: string; type: string; value: string; footprint: string; pins: string[] }>,
  nets: Array<{ name: string; pins: string[] }>,
  boardWidth: number,
  boardHeight: number,
  constraints: {
    optimization: string;
    layerCount: number;
    application: string;
  }
): string {
  const compList = components.map(c =>
    `  ${c.ref}: ${c.type} (${c.value}), footprint=${c.footprint}, ${c.pins.length} pins`
  ).join('\n');

  const netList = nets.slice(0, 40).map(n =>
    `  ${n.name}: connects ${n.pins.join(', ')}`
  ).join('\n');

  return `Generate optimal component placement for a PCB board.

BOARD DIMENSIONS: ${boardWidth}mm x ${boardHeight}mm
LAYER COUNT: ${constraints.layerCount}
APPLICATION: ${constraints.application}
OPTIMIZATION: ${constraints.optimization}

COMPONENTS:
${compList}

KEY NETS:
${netList}

PLACEMENT RULES TO FOLLOW:
1. Decoupling capacitors within 2mm of their IC power pins
2. Crystal/oscillator as close as possible to MCU with minimal trace length
3. Connectors placed at board edges
4. Power regulation section grouped together, preferably near power input
5. Sensitive analog components away from switching regulators and digital noise
6. LEDs and indicators in accessible locations near board edge
7. Test points in accessible locations, not under components
8. Maintain 1mm minimum clearance from board edge for all components
9. Group functionally related components together
10. Consider signal flow direction (input left/top, output right/bottom)
11. Thermal-sensitive components away from heat sources

Respond with ONLY valid JSON in this exact format:
{
  "components": [
    { "ref": "U1", "x": 25.0, "y": 20.0, "rotation": 0, "layer": "F.Cu", "reasoning": "Center of board for short traces to peripherals" }
  ],
  "boardOutline": { "width": ${boardWidth}, "height": ${boardHeight} }
}`;
}

export function buildRoutingStrategyPrompt(
  components: BrdComponent[],
  nets: SchNet[],
  boardState: BoardState,
  layerCount: number
): string {
  const compSummary = components.map(c =>
    `  ${c.ref}: ${c.footprint} at (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`
  ).join('\n');

  const netSummary = nets.map(n => {
    const pinCount = n.pins.length;
    const isHighSpeed = /USB|ETH|SPI.*CLK|SDIO|DDR|LVDS|HDMI/i.test(n.name);
    const isPower = /VCC|VDD|GND|VBUS|3V3|5V|12V|AVCC|AGND/i.test(n.name);
    const tag = isPower ? ' [POWER]' : isHighSpeed ? ' [HIGH-SPEED]' : '';
    return `  ${n.name}: ${pinCount} pins${tag}`;
  }).join('\n');

  return `Generate a routing strategy for this PCB board.

BOARD: ${boardState.outline.points.length > 0 ? 'Custom outline' : 'Rectangular'}
LAYERS: ${layerCount} (${layerCount === 2 ? 'F.Cu, B.Cu' : layerCount === 4 ? 'F.Cu, In1.Cu, In2.Cu, B.Cu' : 'F.Cu, In1-In' + (layerCount - 2) + '.Cu, B.Cu'})

COMPONENTS:
${compSummary}

NETS:
${netSummary}

ROUTING GUIDELINES:
1. Route power nets first with wider traces (0.3-1.0mm depending on current)
2. Route high-speed signals next with impedance control
3. Differential pairs must be routed together with matched length
4. Keep analog and digital grounds separate, join at a single point
5. Avoid routing under crystals/oscillators
6. Use 45-degree bends (no 90-degree corners on signal traces)
7. Place ground stitching vias near signal vias
8. Keep high-speed traces on one layer to minimize via transitions
9. Route clocks with short, direct paths

Respond with ONLY valid JSON:
{
  "netOrder": [
    { "netId": "n_gnd", "netName": "GND", "priority": 1, "layer": "B.Cu", "width": 0.5, "reasoning": "Ground plane on bottom layer" }
  ],
  "layerAssignment": { "F.Cu": "Signal routing (horizontal preferred)", "B.Cu": "Ground plane + vertical signals" },
  "impedanceNets": [
    { "netName": "USB_D+", "targetImpedance": 90, "traceWidth": 0.18, "spacing": 0.15 }
  ],
  "generalNotes": ["Route USB differential pair first", "Add via stitching along board edges"]
}`;
}

export function buildDesignReviewPrompt(
  components: BrdComponent[],
  nets: SchNet[],
  boardState: BoardState
): string {
  const compDetails = components.map(c => {
    const padNets = c.pads.map(p => `${p.number}:${p.netId || 'NC'}`).join(', ');
    return `  ${c.ref} (${c.footprint}) at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) rot=${c.rotation} layer=${c.layer} pads=[${padNets}]`;
  }).join('\n');

  const traceDetails = boardState.traces.map(t =>
    `  ${t.netId}: layer=${t.layer} width=${t.width}mm points=${t.points.length}`
  ).join('\n');

  // Find decoupling cap distances
  const ics = components.filter(c => c.footprint.match(/QFP|BGA|QFN|LQFP|TSSOP|SOIC/i));
  const caps = components.filter(c => c.ref.startsWith('C'));
  const decapIssues: string[] = [];
  for (const ic of ics) {
    const powerPads = ic.pads.filter(p => p.netId && /VCC|VDD|3V3|5V/i.test(p.netId));
    for (const pp of powerPads) {
      const padX = ic.x + pp.x;
      const padY = ic.y + pp.y;
      const nearCap = caps.find(cap => {
        const dist = Math.hypot(cap.x - padX, cap.y - padY);
        return dist < 3 && cap.pads.some(cp => cp.netId === pp.netId);
      });
      if (!nearCap) {
        decapIssues.push(`${ic.ref} pad ${pp.number} (${pp.netId}) has no decoupling cap within 3mm`);
      }
    }
  }

  return `Review this PCB design for issues and improvements.

BOARD OUTLINE: ${JSON.stringify(boardState.outline.points)}
LAYER COUNT: ${boardState.layers.length}

COMPONENTS:
${compDetails}

TRACES:
${traceDetails}

VIAS: ${boardState.vias.length} total
ZONES: ${boardState.zones.length} total

KNOWN DECOUPLING ISSUES:
${decapIssues.length > 0 ? decapIssues.join('\n') : '  None detected'}

Check for:
1. PLACEMENT: Decoupling cap proximity, crystal placement, connector edge alignment, thermal spacing
2. ROUTING: Trace width adequacy for current, clearance violations, acute angles, stub traces
3. THERMAL: Components needing thermal relief, missing thermal vias under QFN/BGA
4. SIGNAL INTEGRITY: Impedance discontinuities, unmatched differential pairs, long stubs
5. POWER INTEGRITY: Insufficient trace width for power nets, missing bulk capacitors
6. DFM: Minimum trace/space violations, drill size issues, solder mask clearance
7. EMC: Analog/digital separation, ground plane splits, unshielded high-speed traces

Respond with ONLY valid JSON:
{
  "findings": [
    {
      "severity": "warning",
      "category": "placement",
      "title": "Decoupling cap too far from IC",
      "description": "C1 is 5.2mm from U1 VCC pin, should be within 2mm",
      "affectedComponents": ["C1", "U1"],
      "suggestedFix": "Move C1 to within 2mm of U1 pin 1",
      "autoFixable": true,
      "x": 18.0,
      "y": 18.0
    }
  ],
  "overallScore": 72,
  "summary": "Board has good general layout but needs decoupling improvements"
}`;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useOllama(initialConfig?: Partial<OllamaConfig>) {
  const [config, setConfig] = useState<OllamaConfig>({
    url: initialConfig?.url || OLLAMA_PROXY_BASE,
    model: initialConfig?.model || DEFAULT_MODEL,
    temperature: initialConfig?.temperature ?? 0.3,
    topP: initialConfig?.topP ?? 0.9,
    maxTokens: initialConfig?.maxTokens ?? 4096,
  });

  const [status, setStatus] = useState<OllamaStatus>({
    connected: false,
    model: config.model,
    availableModels: [],
    error: null,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // ── Check connection ────────────────────────────────────────────

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${OLLAMA_PROXY_BASE}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models: string[] = (data.models || []).map((m: any) => m.name || m.model);

      // Auto-select best model if current model is not available
      let activeModel = config.model;
      if (models.length > 0 && !models.some((m) => m === config.model || m.startsWith(config.model))) {
        const best = await getBestAvailableModel();
        activeModel = best.model;
        setConfig((prev) => ({ ...prev, model: activeModel }));
      }

      setStatus({
        connected: true,
        model: activeModel,
        availableModels: models,
        error: null,
      });
      return true;
    } catch (err: any) {
      setStatus(prev => ({
        ...prev,
        connected: false,
        error: `Cannot connect to Ollama via Go proxy: ${err.message}`,
      }));
      return false;
    }
  }, [config.model]);

  // Check on mount and config change
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // ── Send prompt (non-streaming) ─────────────────────────────────

  const generate = useCallback(async (
    messages: OllamaMessage[],
    options?: { json?: boolean }
  ): Promise<string> => {
    setIsGenerating(true);
    setStreamContent('');

    // Try Ollama first
    const ollamaOk = status.connected || await checkConnection();

    if (ollamaOk) {
      try {
        abortRef.current = new AbortController();
        const body: any = {
          model: config.model,
          messages: [
            { role: 'system', content: PCB_SYSTEM_PROMPT },
            ...messages,
          ],
          stream: false,
          options: {
            temperature: config.temperature,
            top_p: config.topP,
            num_predict: config.maxTokens,
          },
        };
        if (options?.json) {
          body.format = 'json';
        }

        const res = await fetch(`${OLLAMA_PROXY_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(`Ollama proxy error: ${res.status}`);
        const data = await res.json();
        const content = data.message?.content || '';
        setIsGenerating(false);
        return content;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setIsGenerating(false);
          throw new Error('Generation cancelled');
        }
        setIsGenerating(false);
        throw new Error(`Ollama unavailable: ${err.message}`);
      }
    }

    // Ollama not connected
    setIsGenerating(false);
    throw new Error('Ollama is not connected. Start Ollama and try again.');
  }, [config, status.connected, checkConnection]);

  // ── Stream prompt ───────────────────────────────────────────────

  const generateStream = useCallback(async (
    messages: OllamaMessage[],
    onToken: (token: StreamToken) => void
  ): Promise<string> => {
    setIsGenerating(true);
    setStreamContent('');
    let fullContent = '';

    const ollamaOk = status.connected || await checkConnection();

    if (ollamaOk) {
      try {
        abortRef.current = new AbortController();
        const res = await fetch(`${OLLAMA_PROXY_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: PCB_SYSTEM_PROMPT },
              ...messages,
            ],
            stream: true,
            options: {
              temperature: config.temperature,
              top_p: config.topP,
              num_predict: config.maxTokens,
            },
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(`Ollama proxy stream error: ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Ollama streams newline-delimited JSON
          const lines = chunk.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              const token = parsed.message?.content || '';
              fullContent += token;
              setStreamContent(fullContent);
              onToken({ content: token, done: parsed.done || false });
            } catch {
              // skip malformed chunks
            }
          }
        }
        setIsGenerating(false);
        return fullContent;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setIsGenerating(false);
          return fullContent;
        }
        console.warn('Ollama stream failed:', err.message);
      }
    }

    // Fallback: non-streaming from backend
    try {
      const result = await generate(messages);
      onToken({ content: result, done: true });
      return result;
    } catch {
      setIsGenerating(false);
      return '';
    }
  }, [config, status.connected, checkConnection, generate]);

  // ── Parse JSON from AI response ─────────────────────────────────

  const parseJsonResponse = useCallback(<T>(text: string): T | null => {
    // Try direct parse
    try {
      return JSON.parse(text) as T;
    } catch {
      // noop
    }

    // Try extracting JSON from markdown code blocks
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]) as T;
      } catch {
        // noop
      }
    }

    // Try finding the first { ... } or [ ... ] block
    let depth = 0;
    let start = -1;
    const braceIdx = text.indexOf('{');
    const bracketIdx = text.indexOf('[');
    const opener = braceIdx >= 0 && (bracketIdx < 0 || braceIdx < bracketIdx) ? '{' : '[';
    const closer = opener === '{' ? '}' : ']';

    for (let i = 0; i < text.length; i++) {
      if (text[i] === opener) {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === closer) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            return JSON.parse(text.slice(start, i + 1)) as T;
          } catch {
            start = -1;
          }
        }
      }
    }

    return null;
  }, []);

  // ── Cancel ──────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, []);

  // ── Update config ───────────────────────────────────────────────

  const updateConfig = useCallback((patch: Partial<OllamaConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  }, []);

  return {
    config,
    updateConfig,
    status,
    checkConnection,
    isGenerating,
    streamContent,
    generate,
    generateStream,
    parseJsonResponse,
    cancel,
  };
}

export default useOllama;
