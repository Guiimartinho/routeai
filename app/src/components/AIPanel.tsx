// ─── AIPanel.tsx ── AI assistant panel with Ollama integration ──────────────
// Connected to actual design data via useProjectStore.
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import { auditSchematic, summarizeSuggestions } from '../engine/componentSuggester';
import { runDRC } from '../engine/drcEngine';
import type { SchematicState, BoardState, SchNet, SchComponent, BrdComponent } from '../types';
import { fetchGPUProfile, getBestAvailableModel } from '../hooks/useOllama';
import type { GPUProfile, TaskType } from '../hooks/useOllama';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  severity?: 'info' | 'warning' | 'error' | 'success';
  toolUsed?: string;
}

interface QuickAction {
  label: string;
  prompt: string;
  icon: string;
  color: string;
  handler?: 'review' | 'missing' | 'bom' | 'power';
}

interface AIPanelProps {
  visible?: boolean;
  onClose?: () => void;
  onApplySuggestion?: (suggestion: string) => void;
}

// ─── Design Context Builder ─────────────────────────────────────────────────

function buildDesignContext(
  schematic: SchematicState,
  board: BoardState,
  nets: SchNet[],
): string {
  const sections: string[] = [];

  // ── Components ──
  const schComps = schematic.components.filter(
    c => !['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee'].includes(c.type.toLowerCase())
      && !['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee'].includes(c.symbol.toLowerCase()),
  );
  if (schComps.length > 0) {
    const compLines = schComps.map(c =>
      `  ${c.ref}=${c.value} (${c.footprint || c.symbol}, ${c.pins.length} pins)`
    );
    sections.push(`COMPONENTS (${schComps.length}):\n${compLines.join('\n')}`);
  } else {
    sections.push('COMPONENTS: none placed yet');
  }

  // ── Nets ──
  if (nets.length > 0) {
    const netLines = nets
      .sort((a, b) => b.pins.length - a.pins.length)
      .slice(0, 30)
      .map(n => `  ${n.name} (${n.pins.length} pins)`);
    sections.push(`NETS (${nets.length}):\n${netLines.join('\n')}`);
  } else {
    sections.push('NETS: no nets extracted yet');
  }

  // ── Board info ──
  const outline = board.outline.points;
  if (outline.length >= 2) {
    const xs = outline.map(p => p.x);
    const ys = outline.map(p => p.y);
    const width = Math.round(Math.max(...xs) - Math.min(...xs));
    const height = Math.round(Math.max(...ys) - Math.min(...ys));
    const totalPads = board.components.reduce((sum, c) => sum + c.pads.length, 0);
    sections.push(
      `BOARD: ${width}x${height}mm, ${board.layers.filter(l => l.endsWith('.Cu')).length} copper layers, ` +
      `${board.components.length} components, ${totalPads} pads, ` +
      `${board.traces.length} traces, ${board.vias.length} vias, ${board.zones.length} zones`
    );
  }

  // ── Board component positions ──
  if (board.components.length > 0) {
    const posLines = board.components.map(c =>
      `  ${c.ref} (${c.footprint}) at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) rot=${c.rotation} layer=${c.layer}`
    );
    sections.push(`BOARD PLACEMENT:\n${posLines.join('\n')}`);
  }

  // ── DRC summary ──
  try {
    const drc = runDRC(board);
    if (drc.violations.length > 0) {
      const byRule: Record<string, number> = {};
      for (const v of drc.violations) {
        byRule[v.rule] = (byRule[v.rule] || 0) + 1;
      }
      const drcLines = Object.entries(byRule).map(([t, n]) => `  ${t}: ${n}`);
      sections.push(`DRC VIOLATIONS (${drc.violations.length}):\n${drcLines.join('\n')}`);
    } else {
      sections.push('DRC: 0 violations - board passes all checks');
    }
  } catch {
    // DRC may fail on empty boards, that's fine
  }

  // ── Power nets detail ──
  const powerNets = nets.filter(n => /^(VCC|VDD|GND|AGND|3V3|5V|12V|VBUS|AVCC|AVDD)/i.test(n.name));
  if (powerNets.length > 0) {
    const pwrLines = powerNets.map(n => {
      // Find which components connect to this net
      const connectedRefs: string[] = [];
      for (const comp of schematic.components) {
        for (const pin of comp.pins) {
          if (n.pins.includes(pin.id)) {
            if (!connectedRefs.includes(comp.ref)) connectedRefs.push(comp.ref);
          }
        }
      }
      return `  ${n.name}: ${n.pins.length} pins -> ${connectedRefs.join(', ') || 'none'}`;
    });
    sections.push(`POWER NETS:\n${pwrLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

// ─── Audit helpers ──────────────────────────────────────────────────────────

function runSchematicAudit(schematic: SchematicState): string {
  const result = auditSchematic(schematic.components);
  const lines: string[] = [];

  if (result.missing.length === 0 && result.notes.length === 0) {
    lines.push('## Schematic Audit: PASSED');
    lines.push('No missing support components detected. All recognized ICs have their required bypass caps, pull-ups, and supporting circuitry.');
    return lines.join('\n');
  }

  lines.push('## Schematic Audit Results\n');

  if (result.missing.length > 0) {
    lines.push(`**Missing Components (${result.missing.length}):**\n`);
    // Group by IC
    const byIC = new Map<string, typeof result.missing>();
    for (const m of result.missing) {
      const key = `${m.forIC} (${m.forICValue})`;
      if (!byIC.has(key)) byIC.set(key, []);
      byIC.get(key)!.push(m);
    }
    for (const [ic, items] of byIC) {
      lines.push(`For ${ic}:`);
      for (const item of items) {
        const role = item.component.role.replace(/_/g, ' ');
        lines.push(`- **[WARNING]** Missing ${role}: ${item.component.value} (${item.component.symbol}, ${item.component.footprint})`);
        if (item.component.reason) {
          lines.push(`  Note: ${item.component.reason}`);
        }
      }
      lines.push('');
    }
  }

  if (result.notes.length > 0) {
    lines.push('**Design Notes:**\n');
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}

function analyzePowerDelivery(schematic: SchematicState, board: BoardState, nets: SchNet[]): string {
  const lines: string[] = ['## Power Delivery Analysis\n'];

  const powerNets = nets.filter(n => /^(VCC|VDD|GND|AGND|3V3|5V|12V|VBUS|AVCC|AVDD)/i.test(n.name));

  if (powerNets.length === 0) {
    lines.push('No power nets detected. Add power symbols (VCC, GND, 3V3, etc.) to your schematic first.');
    return lines.join('\n');
  }

  for (const net of powerNets) {
    const connectedComps: string[] = [];
    for (const comp of schematic.components) {
      for (const pin of comp.pins) {
        if (net.pins.includes(pin.id) && !connectedComps.includes(comp.ref)) {
          connectedComps.push(comp.ref);
        }
      }
    }

    lines.push(`**${net.name}** (${net.pins.length} pins, ${connectedComps.length} components):`);
    lines.push(`  Connected: ${connectedComps.join(', ') || 'none'}`);

    // Check for bypass caps near ICs on this power net
    const ics = connectedComps.filter(r => r.startsWith('U'));
    const caps = connectedComps.filter(r => r.startsWith('C'));

    if (ics.length > 0 && caps.length === 0) {
      lines.push(`  **[WARNING]** No decoupling capacitors found on ${net.name} net for ICs: ${ics.join(', ')}`);
    }

    // Check board trace widths for power nets
    const powerTraces = board.traces.filter(t => {
      const netId = net.id;
      return t.netId === netId;
    });
    if (powerTraces.length > 0) {
      const minWidth = Math.min(...powerTraces.map(t => t.width));
      if (minWidth < 0.3) {
        lines.push(`  **[WARNING]** Trace width ${minWidth}mm may be too narrow for power. Recommend >= 0.3mm`);
      } else {
        lines.push(`  Trace width: ${minWidth}mm - OK`);
      }
    } else if (board.traces.length > 0) {
      lines.push(`  **[INFO]** No routed traces for this net yet`);
    }

    lines.push('');
  }

  // Check ground plane
  const gndZones = board.zones.filter(z => /gnd/i.test(z.netId));
  if (gndZones.length > 0) {
    lines.push(`**Ground Plane:** ${gndZones.length} zone(s) - Good`);
  } else if (board.zones.length === 0) {
    lines.push('**[WARNING]** No ground plane zone defined. Consider adding a GND copper pour on B.Cu.');
  }

  return lines.join('\n');
}

function analyzeBOM(schematic: SchematicState): string {
  const lines: string[] = ['## Bill of Materials Analysis\n'];

  const comps = schematic.components.filter(
    c => !['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee'].includes(c.type.toLowerCase())
      && !['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee'].includes(c.symbol.toLowerCase()),
  );

  if (comps.length === 0) {
    lines.push('No components in schematic to analyze.');
    return lines.join('\n');
  }

  // Group by value+footprint
  const groups = new Map<string, SchComponent[]>();
  for (const c of comps) {
    const key = `${c.value}|${c.footprint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  lines.push(`| Qty | Value | Footprint | Refs |`);
  lines.push(`|-----|-------|-----------|------|`);
  for (const [, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const refs = items.map(c => c.ref).sort().join(', ');
    lines.push(`| ${items.length} | ${items[0].value} | ${items[0].footprint} | ${refs} |`);
  }

  lines.push(`\n**Total: ${comps.length} components, ${groups.size} unique values**`);

  // Suggestions for optimization
  const suggestions: string[] = [];

  // Check for multiple resistor values that could be consolidated
  const resistorGroups = [...groups.entries()].filter(([k]) => k.startsWith('R_') || /^\d+[kKmM]?[\u03A9]?/.test(k.split('|')[0]));
  if (resistorGroups.length > 5) {
    suggestions.push('Consider consolidating resistor values where possible to reduce unique part count');
  }

  // Check for components without footprints
  const noFP = comps.filter(c => !c.footprint);
  if (noFP.length > 0) {
    suggestions.push(`${noFP.length} component(s) missing footprint assignment: ${noFP.map(c => c.ref).join(', ')}`);
  }

  if (suggestions.length > 0) {
    lines.push('\n**Optimization Suggestions:**');
    for (const s of suggestions) {
      lines.push(`- ${s}`);
    }
  }

  return lines.join('\n');
}

// ─── Quick Actions ──────────────────────────────────────────────────────────

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Review Schematic',
    prompt: 'Review my schematic for missing components and design issues.',
    icon: '\uD83D\uDD0D',
    color: theme.blue,
    handler: 'review',
  },
  {
    label: "What's Missing?",
    prompt: 'What components are missing from my design? Check for bypass caps, pull-ups, crystals, etc.',
    icon: '\u26A0',
    color: theme.orange,
    handler: 'missing',
  },
  {
    label: 'Optimize BOM',
    prompt: 'Analyze my bill of materials and suggest optimizations.',
    icon: '\uD83D\uDCE6',
    color: theme.green,
    handler: 'bom',
  },
  {
    label: 'Check Power',
    prompt: 'Analyze power delivery, decoupling, and power net integrity in my design.',
    icon: '\u26A1',
    color: theme.purple,
    handler: 'power',
  },
];

// ─── Loading dots animation ─────────────────────────────────────────────────

const LoadingDots: React.FC = () => {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const iv = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    return () => clearInterval(iv);
  }, []);
  return <span style={{ color: theme.textMuted }}>{`Thinking${dots}`}</span>;
};

// ─── Component ──────────────────────────────────────────────────────────────

const AIPanel: React.FC<AIPanelProps> = (props) => {
  const visible = props.visible ?? true;
  const onClose = props.onClose ?? (() => {});
  const onApplySuggestion = props.onApplySuggestion;
  // ── Project store ──
  const schematic = useProjectStore(s => s.schematic);
  const board = useProjectStore(s => s.board);
  const nets = useProjectStore(s => s.nets);
  const metadata = useProjectStore(s => s.metadata);
  const designRules = useProjectStore(s => s.designRules);

  // ── Local state ──
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hello! I\'m your PCB design assistant. I have access to your current design data and can review your schematic, check for missing components, analyze power delivery, and help optimize your BOM. How can I help?',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5-coder:14b');
  // All Ollama calls go through Go backend proxy
  const ollamaUrl = '/api/ollama';
  const [showSettings, setShowSettings] = useState(false);
  const [gpuProfile, setGpuProfile] = useState<GPUProfile | null>(null);
  const [modelStatusText, setModelStatusText] = useState<string | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const gpuProfileLoaded = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Lazy GPU profile fetch (only when panel is visible) ──
  useEffect(() => {
    if (!visible || gpuProfileLoaded.current) return;
    gpuProfileLoaded.current = true;
    fetchGPUProfile().then(profile => {
      if (profile) {
        setGpuProfile(profile);
        // Auto-set model from profile resident model
        setOllamaModel(profile.tiers.t3_fast);
      }
    });
  }, [visible]);

  // ── Build design context (memoized) ──
  const designContext = useMemo(
    () => buildDesignContext(schematic, board, nets),
    [schematic, board, nets],
  );

  // ── Design summary for status bar ──
  const designSummary = useMemo(() => {
    const compCount = schematic.components.filter(
      c => !['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee'].includes(c.type.toLowerCase())
        && !['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee'].includes(c.symbol.toLowerCase()),
    ).length;
    return `${metadata.name} | ${compCount} comps | ${nets.length} nets`;
  }, [schematic, nets, metadata.name]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Build system prompt with design context ──
  const buildSystemPrompt = useCallback(() => {
    return `You are RouteAI, an AI PCB design assistant integrated into an EDA tool.
You are powered by a code-optimized LLM. Leverage your strengths in structured output and technical analysis.

## Expertise
- PCB layout best practices and design rules (IPC-2221, IPC-2152, IPC-7351)
- Signal integrity: impedance matching, crosstalk, return paths, via transitions
- Power integrity: decoupling strategy, PDN impedance, copper pours
- Thermal management: thermal vias, copper area, component spacing
- Component selection and placement optimization
- Manufacturing (DFM) and assembly (DFA) guidelines
- High-speed digital design: DDR, USB, Ethernet, differential pairs
- RF design: transmission lines, shielding, ground plane continuity
- EMC: analog/digital separation, filtering, ground plane integrity

## PCB Terminology Glossary
- **DRC**: Design Rule Check -- automated validation of trace/space/drill rules
- **PDN**: Power Distribution Network -- the system of planes, traces, and caps delivering power
- **SI**: Signal Integrity -- analysis of signal quality (reflections, crosstalk, loss)
- **PI**: Power Integrity -- analysis of voltage ripple, impedance, and decoupling
- **DFM**: Design for Manufacturing -- rules ensuring the board can be fabricated reliably
- **DFA**: Design for Assembly -- rules ensuring components can be soldered properly
- **BGA**: Ball Grid Array -- IC package with solder balls on bottom
- **QFN**: Quad Flat No-lead -- IC package with pads on bottom edges
- **Via stitching**: Ground vias placed to connect ground planes and reduce loop area
- **Decoupling cap**: Capacitor placed near IC power pins to filter high-frequency noise
- **Differential pair**: Two complementary signal traces carrying opposite-polarity signals
- **Controlled impedance**: Trace geometry designed to achieve a target characteristic impedance
- **Copper pour / zone**: Large copper fill area, typically for ground or power planes
- **Thermal via**: Via connecting a component pad to an inner copper plane for heat dissipation

## Output Format Rules
- When asked for structured data, ALWAYS return valid JSON. Do not wrap JSON in markdown code fences.
- When providing explanations, use markdown formatting: ## headers, **bold**, - bullet lists, numbered lists.
- Use tables (markdown pipe tables) for comparative data.
- Severity levels: CRITICAL (must fix before production), WARNING (should fix), INFO (suggestion).
- All coordinates in millimeters, origin at top-left corner.

## Current Design Context
${designContext}

## Active Design Rules
- Answer questions about THIS specific design. Reference actual component refs (${
  schematic.components.filter(c => !['gnd','vcc','3v3','5v','12v','vdd','vss','vee'].includes(c.type.toLowerCase())).map(c => c.ref).join(', ') || 'none yet'
}) and net names (${nets.map(n => n.name).join(', ') || 'none yet'}).
- When discussing placement, reference actual coordinates and positions from the board data.
- When discussing component relationships, use the actual net connectivity.
- Provide specific, actionable recommendations with severity levels.
- Format findings as numbered lists when appropriate.
- If the design is empty, guide the user on getting started.
- When asked "why" about a placement, explain the electrical reasoning (loop area, decoupling, thermal, etc.).`;
  }, [designContext, schematic, nets]);

  // ── Handle quick action with local analysis ──
  const handleLocalAnalysis = useCallback((handler: string): string | null => {
    switch (handler) {
      case 'review':
        return runSchematicAudit(schematic);
      case 'missing': {
        const result = auditSchematic(schematic.components);
        if (result.missing.length === 0) {
          return '## Component Check: All Good!\n\nNo missing support components detected for the recognized ICs in your schematic.';
        }
        const lines: string[] = ['## Missing Components\n'];
        const byIC = new Map<string, typeof result.missing>();
        for (const m of result.missing) {
          const key = `${m.forIC} (${m.forICValue})`;
          if (!byIC.has(key)) byIC.set(key, []);
          byIC.get(key)!.push(m);
        }
        for (const [ic, items] of byIC) {
          lines.push(`**${ic}** needs:`);
          for (const item of items) {
            const role = item.component.role.replace(/_/g, ' ');
            lines.push(`- ${item.component.value} ${item.component.symbol} (${role})`);
          }
          lines.push('');
        }
        lines.push(`**Total missing: ${result.missing.length} component(s)**`);
        lines.push(`\nSummary: ${summarizeSuggestions(result.missing)}`);
        return lines.join('\n');
      }
      case 'bom':
        return analyzeBOM(schematic);
      case 'power':
        return analyzePowerDelivery(schematic, board, nets);
      default:
        return null;
    }
  }, [schematic, board, nets]);

  // ── Send to Ollama ──
  const sendToOllama = useCallback(async (userMessage: string, quickHandler?: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // If a quick action has a local handler, run it first and prepend results
    let localAnalysis = '';
    let toolUsed: string | undefined;
    if (quickHandler) {
      const result = handleLocalAnalysis(quickHandler);
      if (result) {
        localAnalysis = result;
        toolUsed = quickHandler === 'review' ? 'Schematic Auditor' :
                   quickHandler === 'missing' ? 'Component Suggester' :
                   quickHandler === 'bom' ? 'BOM Analyzer' :
                   quickHandler === 'power' ? 'Power Analyzer' : undefined;
      }
    }

    try {
      const systemPrompt = buildSystemPrompt();

      // If we have local analysis, ask the LLM to elaborate on it
      const enrichedMessage = localAnalysis
        ? `The user asked: "${userMessage}"\n\nHere is the automated analysis result:\n\n${localAnalysis}\n\nPlease provide additional expert commentary, recommendations, and any issues the automated check may have missed. Reference specific components and nets from the design.`
        : userMessage;

      // Determine task type from handler for tier-aware model selection
      const taskType: TaskType =
        quickHandler === 'review' || quickHandler === 'power' ? 'structured' :
        quickHandler === 'missing' || quickHandler === 'bom' ? 'fast' :
        'fast';

      // Resolve best model for this task type
      let targetModel = ollamaModel;
      if (gpuProfile) {
        const best = await getBestAvailableModel(taskType);
        targetModel = best.model;

        // Detect model swap (any non-fast task may require loading a larger model)
        const needsSwap = targetModel !== gpuProfile.tiers.t3_fast
          && taskType !== 'fast';
        if (needsSwap) {
          setIsSwapping(true);
          setModelStatusText(`Switching to ${targetModel}...`);
        } else {
          setModelStatusText(`Analyzing with ${targetModel}...`);
        }
      } else {
        setModelStatusText(`Analyzing with ${targetModel}...`);
      }

      const response = await fetch(`${ollamaUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.filter(m => m.role !== 'system').map(m => ({
              role: m.role,
              content: m.content,
            })),
            { role: 'user', content: enrichedMessage },
          ],
          stream: true,
        }),
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

      // Stream the response using NDJSON format from Ollama
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body stream available');

      const assistantMsgId = `asst-${Date.now()}`;
      const prefix = localAnalysis
        ? `${localAnalysis}\n\n---\n\n**AI Commentary:**\n`
        : '';

      // Add initial assistant message (with local analysis prefix if any)
      setMessages(prev => [...prev, {
        id: assistantMsgId,
        role: 'assistant' as const,
        content: prefix,
        timestamp: Date.now(),
        toolUsed,
      }]);
      setStreaming(true);

      const decoder = new TextDecoder();
      let streamedContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            if (chunk.message?.content) {
              streamedContent += chunk.message.content;
              const fullContent = prefix + streamedContent;
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId ? { ...m, content: fullContent } : m
              ));
            }
            if (chunk.done) break;
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      setStreaming(false);

      // Final update with severity and tool detection
      const assistantContent = streamedContent || 'No response received.';
      const fullContent = prefix + assistantContent;

      // Detect tool usage from content
      if (!toolUsed) {
        if (assistantContent.includes('impedance') || assistantContent.includes('trace width')) toolUsed = 'Impedance Calculator';
        else if (assistantContent.includes('thermal') || assistantContent.includes('temperature')) toolUsed = 'Thermal Analyzer';
        else if (assistantContent.includes('clearance') || assistantContent.includes('spacing')) toolUsed = 'DRC Engine';
      }

      // Detect severity
      let severity: ChatMessage['severity'] = 'info';
      const lower = fullContent.toLowerCase();
      if (lower.includes('critical') || lower.includes('error') || lower.includes('must fix')) severity = 'error';
      else if (lower.includes('warning') || lower.includes('should') || lower.includes('recommend') || lower.includes('missing')) severity = 'warning';
      else if (lower.includes('looks good') || lower.includes('no issues') || lower.includes('passed') || lower.includes('all good')) severity = 'success';

      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId ? { ...m, content: fullContent, severity, toolUsed } : m
      ));
      setModelStatusText(null);
      setIsSwapping(false);
    } catch (err: any) {
      setStreaming(false);
      setModelStatusText(null);
      setIsSwapping(false);
      // Fallback: if Ollama is unavailable, use the local analysis alone or generate a context-aware fallback
      let content: string;
      if (localAnalysis) {
        content = localAnalysis + '\n\n*Note: Could not reach Ollama for additional AI commentary. The above is from local analysis.*';
      } else {
        // Generate a context-aware fallback response
        content = generateOfflineFallback(userMessage, schematic, board, nets);
      }

      const fallbackMsg: ChatMessage = {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        severity: localAnalysis ? 'warning' : 'info',
        toolUsed: toolUsed || 'Offline Analysis',
      };
      setMessages(prev => [...prev, fallbackMsg]);
    }

    setLoading(false);
  }, [messages, ollamaModel, ollamaUrl, buildSystemPrompt, handleLocalAnalysis, gpuProfile]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput('');
    sendToOllama(trimmed);
  }, [input, loading, sendToOllama]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleQuickAction = useCallback((action: QuickAction) => {
    if (loading) return;
    sendToOllama(action.prompt, action.handler);
  }, [loading, sendToOllama]);

  if (!visible) return null;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.aiIcon}>AI</div>
          <span style={styles.title}>Design Assistant</span>
        </div>
        <div style={styles.headerRight}>
          <button
            style={styles.settingsBtn}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            {'\u2699'}
          </button>
          <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
        </div>
      </div>

      {/* Design context status bar */}
      <div style={styles.contextBar}>
        <span style={styles.contextDot} />
        <span style={styles.contextText}>{designSummary}</span>
      </div>

      {/* GPU status indicator */}
      <div style={styles.gpuBar}>
        {gpuProfile ? (
          <>
            <span style={styles.gpuChip}>{'\u2B22'}</span>
            <span style={styles.gpuText}>
              {gpuProfile.gpu.name} {'\u2022'} {gpuProfile.profile.vram_gb}GB VRAM {'\u2022'} Model: {ollamaModel || 'detecting...'}
            </span>
          </>
        ) : (
          <>
            <span style={{ ...styles.gpuChip, color: theme.textMuted }}>{'\u2B22'}</span>
            <span style={styles.gpuText}>GPU: detecting...</span>
          </>
        )}
      </div>

      {/* Settings */}
      {showSettings && (
        <div style={styles.settings}>
          <div style={styles.settingRow}>
            <span style={styles.settingLabel}>Model:</span>
            <input
              style={styles.settingInput}
              value={ollamaModel}
              onChange={e => setOllamaModel(e.target.value)}
              placeholder="llama3.2"
            />
          </div>
          <div style={styles.settingRow}>
            <span style={styles.settingLabel}>Route:</span>
            <span style={{ color: '#888', fontSize: 12 }}>Via Go backend proxy → Ollama</span>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div style={styles.quickActions}>
        {QUICK_ACTIONS.map(action => (
          <button
            key={action.label}
            style={{
              ...styles.quickBtn,
              borderColor: action.color,
              opacity: loading ? 0.5 : 1,
            }}
            onClick={() => handleQuickAction(action)}
            disabled={loading}
          >
            <span style={styles.quickIcon}>{action.icon}</span>
            <span style={styles.quickLabel}>{action.label}</span>
          </button>
        ))}
      </div>

      {/* Chat messages */}
      <div style={styles.chatArea}>
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              ...styles.message,
              ...(msg.role === 'user' ? styles.userMessage : styles.assistantMessage),
            }}
          >
            {/* Severity badge */}
            {msg.severity && msg.role === 'assistant' && (
              <div style={styles.badgeRow}>
                <span style={{
                  ...styles.severityBadge,
                  background: msg.severity === 'error' ? theme.red :
                              msg.severity === 'warning' ? theme.orange :
                              msg.severity === 'success' ? theme.green : theme.blue,
                }}>
                  {msg.severity.toUpperCase()}
                </span>
                {msg.toolUsed && (
                  <span style={styles.toolBadge}>
                    {'\uD83D\uDD27'} {msg.toolUsed}
                  </span>
                )}
              </div>
            )}

            {/* Content */}
            <div style={styles.messageContent}>
              {msg.content.split('\n').map((line, i) => {
                // Basic markdown rendering
                if (line.startsWith('## ')) {
                  return <div key={i} style={styles.mdH2}>{line.slice(3)}</div>;
                }
                if (line.startsWith('**') && line.endsWith('**')) {
                  return <div key={i} style={styles.mdBold}>{line.slice(2, -2)}</div>;
                }
                if (line.startsWith('---')) {
                  return <hr key={i} style={styles.mdHr} />;
                }
                if (line.match(/^\d+\.\s/)) {
                  const parts: React.ReactNode[] = [];
                  let text = line;
                  const boldRegex = /\*\*(.+?)\*\*/g;
                  let lastIdx = 0;
                  let match;
                  while ((match = boldRegex.exec(text)) !== null) {
                    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
                    const boldText = match[1];
                    let badgeColor: string = theme.textPrimary;
                    if (boldText.includes('ERROR')) badgeColor = theme.red;
                    else if (boldText.includes('WARNING')) badgeColor = theme.orange;
                    else if (boldText.includes('INFO')) badgeColor = theme.blue;
                    parts.push(<strong key={match.index} style={{ color: badgeColor }}>{boldText}</strong>);
                    lastIdx = match.index + match[0].length;
                  }
                  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
                  return <div key={i} style={styles.mdListItem}>{parts}</div>;
                }
                if (line.startsWith('- ')) {
                  // Render inline bold in bullet items
                  const parts: React.ReactNode[] = [];
                  const boldRegex = /\*\*(.+?)\*\*/g;
                  let lastIdx = 0;
                  let match;
                  while ((match = boldRegex.exec(line)) !== null) {
                    if (match.index > lastIdx) parts.push(line.slice(lastIdx, match.index));
                    const boldText = match[1];
                    let badgeColor: string = theme.textPrimary;
                    if (boldText.includes('ERROR')) badgeColor = theme.red;
                    else if (boldText.includes('WARNING')) badgeColor = theme.orange;
                    else if (boldText.includes('INFO')) badgeColor = theme.blue;
                    parts.push(<strong key={match.index} style={{ color: badgeColor }}>{boldText}</strong>);
                    lastIdx = match.index + match[0].length;
                  }
                  if (lastIdx < line.length) parts.push(line.slice(lastIdx));
                  return <div key={i} style={styles.mdBullet}>{parts.length > 0 ? parts : line}</div>;
                }
                if (line.startsWith('|') && line.endsWith('|')) {
                  // Simple table rendering
                  if (line.includes('---')) return null; // Skip separator rows
                  const cells = line.split('|').filter(Boolean).map(c => c.trim());
                  return (
                    <div key={i} style={styles.mdTableRow}>
                      {cells.map((cell, ci) => (
                        <span key={ci} style={styles.mdTableCell}>{cell}</span>
                      ))}
                    </div>
                  );
                }
                if (line.trim() === '') return <div key={i} style={{ height: 6 }} />;
                // Render inline bold in regular lines
                const parts: React.ReactNode[] = [];
                const boldRegex = /\*\*(.+?)\*\*/g;
                let lastIdx = 0;
                let match;
                while ((match = boldRegex.exec(line)) !== null) {
                  if (match.index > lastIdx) parts.push(line.slice(lastIdx, match.index));
                  parts.push(<strong key={match.index}>{match[1]}</strong>);
                  lastIdx = match.index + match[0].length;
                }
                if (lastIdx < line.length) parts.push(line.slice(lastIdx));
                if (parts.length > 0) return <div key={i}>{parts}</div>;
                return <div key={i}>{line}</div>;
              })}
            </div>

            {/* Apply button for assistant messages */}
            {msg.role === 'assistant' && onApplySuggestion && msg.id !== 'welcome' && (
              <button
                style={styles.applyBtn}
                onClick={() => onApplySuggestion(msg.content)}
              >
                Apply Suggestions
              </button>
            )}
          </div>
        ))}

        {loading && !streaming && (
          <div style={{ ...styles.message, ...styles.assistantMessage }}>
            <div style={styles.loadingContainer}>
              <div style={styles.loadingDots}>
                <div style={{ ...styles.dot, animationDelay: '0s' }} />
                <div style={{ ...styles.dot, animationDelay: '0.2s' }} />
                <div style={{ ...styles.dot, animationDelay: '0.4s' }} />
              </div>
              {modelStatusText ? (
                <span style={{ color: isSwapping ? theme.orange : theme.textMuted, fontSize: theme.fontXs, fontFamily: theme.fontMono }}>
                  {modelStatusText}
                </span>
              ) : (
                <LoadingDots />
              )}
            </div>
          </div>
        )}
        {streaming && (
          <div style={styles.typingIndicator}>
            <span style={{ color: theme.purple, fontSize: theme.fontXs, fontFamily: theme.fontMono }}>
              {modelStatusText || 'typing...'}
            </span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <textarea
          ref={inputRef}
          style={styles.textInput}
          placeholder="Ask about your PCB design..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: (!input.trim() || loading) ? 0.4 : 1,
          }}
          onClick={handleSend}
          disabled={!input.trim() || loading}
        >
          {'\u2191'}
        </button>
      </div>
    </div>
  );
};

// ─── Offline fallback that uses actual design data ──────────────────────────

function generateOfflineFallback(
  userMessage: string,
  schematic: SchematicState,
  board: BoardState,
  nets: SchNet[],
): string {
  const lower = userMessage.toLowerCase();

  // Component position query (e.g., "why is C1 near U1?")
  const compRefMatch = lower.match(/\b([a-z]\d+)\b/gi);
  if (compRefMatch && compRefMatch.length >= 1) {
    const refs = compRefMatch.map(r => r.toUpperCase());
    const foundComps: { ref: string; brd?: BrdComponent; sch?: SchComponent }[] = [];
    for (const ref of refs) {
      const brd = board.components.find(c => c.ref.toUpperCase() === ref);
      const sch = schematic.components.find(c => c.ref.toUpperCase() === ref);
      if (brd || sch) foundComps.push({ ref, brd: brd || undefined, sch: sch || undefined });
    }

    if (foundComps.length >= 2) {
      const lines: string[] = [`## Component Relationship: ${foundComps.map(c => c.ref).join(' & ')}\n`];

      for (const c of foundComps) {
        if (c.brd) {
          lines.push(`**${c.ref}** (${c.brd.value}, ${c.brd.footprint}): at (${c.brd.x.toFixed(1)}, ${c.brd.y.toFixed(1)}) on ${c.brd.layer}`);
        } else if (c.sch) {
          lines.push(`**${c.ref}** (${c.sch.value}, ${c.sch.footprint}): schematic only (not on board yet)`);
        }
      }

      // Check if they share nets
      if (foundComps.length >= 2) {
        const sharedNets: string[] = [];
        for (const net of nets) {
          const connectedRefs: string[] = [];
          for (const comp of schematic.components) {
            for (const pin of comp.pins) {
              if (net.pins.includes(pin.id) && !connectedRefs.includes(comp.ref)) {
                connectedRefs.push(comp.ref);
              }
            }
          }
          const matchingRefs = foundComps.filter(c => connectedRefs.includes(c.ref));
          if (matchingRefs.length >= 2) {
            sharedNets.push(net.name);
          }
        }
        if (sharedNets.length > 0) {
          lines.push(`\n**Shared nets:** ${sharedNets.join(', ')}`);
          lines.push(`\nThese components are electrically connected through ${sharedNets.length} net(s). `);
          // Check if one is a cap near an IC
          const capRef = foundComps.find(c => c.ref.startsWith('C'));
          const icRef = foundComps.find(c => c.ref.startsWith('U'));
          if (capRef && icRef) {
            lines.push(`${capRef.ref} is likely a bypass/decoupling capacitor for ${icRef.ref}. Best practice is to place decoupling caps within 2mm of the IC power pins to minimize loop inductance and provide high-frequency noise filtering.`);
          }
        }

        // Distance on board
        if (foundComps[0].brd && foundComps[1].brd) {
          const dist = Math.hypot(
            foundComps[0].brd.x - foundComps[1].brd.x,
            foundComps[0].brd.y - foundComps[1].brd.y,
          );
          lines.push(`\n**Board distance:** ${dist.toFixed(1)}mm`);
        }
      }

      lines.push('\n\n*Ollama unavailable - this analysis is from local design data.*');
      return lines.join('\n');
    }

    if (foundComps.length === 1) {
      const c = foundComps[0];
      const lines: string[] = [`## Component: ${c.ref}\n`];
      if (c.sch) {
        lines.push(`**Value:** ${c.sch.value}`);
        lines.push(`**Footprint:** ${c.sch.footprint || 'not assigned'}`);
        lines.push(`**Symbol:** ${c.sch.symbol}`);
        lines.push(`**Pins:** ${c.sch.pins.length}`);
        // List connected nets
        const connNets: string[] = [];
        for (const pin of c.sch.pins) {
          const net = nets.find(n => n.pins.includes(pin.id));
          if (net && !connNets.includes(net.name)) connNets.push(net.name);
        }
        if (connNets.length > 0) {
          lines.push(`**Connected nets:** ${connNets.join(', ')}`);
        }
      }
      if (c.brd) {
        lines.push(`**Board position:** (${c.brd.x.toFixed(1)}, ${c.brd.y.toFixed(1)}) on ${c.brd.layer}`);
        lines.push(`**Rotation:** ${c.brd.rotation} deg`);
      }
      lines.push('\n*Ollama unavailable - this analysis is from local design data.*');
      return lines.join('\n');
    }
  }

  // Generic fallback with design stats
  if (lower.includes('review') || lower.includes('check')) {
    return runSchematicAudit(schematic) + '\n\n*Ollama unavailable - showing local analysis only.*';
  }
  if (lower.includes('power') || lower.includes('decoupl')) {
    return analyzePowerDelivery(schematic, board, nets) + '\n\n*Ollama unavailable - showing local analysis only.*';
  }
  if (lower.includes('bom') || lower.includes('bill') || lower.includes('material')) {
    return analyzeBOM(schematic) + '\n\n*Ollama unavailable - showing local analysis only.*';
  }
  if (lower.includes('missing') || lower.includes('bypass') || lower.includes('pull-up')) {
    const result = auditSchematic(schematic.components);
    if (result.missing.length === 0) {
      return '## No Missing Components Detected\n\nAll recognized ICs have their required support components.\n\n*Ollama unavailable.*';
    }
    const summary = summarizeSuggestions(result.missing);
    return `## Missing Components\n\n${summary}\n\nRun "Review Schematic" for full details.\n\n*Ollama unavailable.*`;
  }

  // Default: show what we know
  const comps = schematic.components.filter(
    c => !['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee'].includes(c.type.toLowerCase()),
  );
  return `I couldn't connect to Ollama, but here's what I know about your design:\n\n` +
    `**Project:** ${useProjectStore.getState().metadata.name}\n` +
    `**Components:** ${comps.length}\n` +
    `**Nets:** ${nets.length}\n` +
    `**Board components:** ${board.components.length}\n` +
    `**Traces:** ${board.traces.length}\n\n` +
    `Try the quick action buttons above for local analysis that doesn't require Ollama.`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 380,
    height: '100%',
    background: theme.bg1,
    borderLeft: theme.border,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: theme.fontSans,
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  aiIcon: {
    width: 24,
    height: 24,
    borderRadius: theme.radiusSm,
    background: `linear-gradient(135deg, ${theme.purple}, ${theme.blue})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '9px',
    fontWeight: 800,
    fontFamily: theme.fontMono,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  settingsBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
  },
  contextBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderBottom: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  contextDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: theme.green,
    flexShrink: 0,
  },
  contextText: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  gpuBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 12px',
    borderBottom: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  gpuChip: {
    fontSize: 7,
    color: theme.green,
    flexShrink: 0,
  },
  gpuText: {
    color: theme.textMuted,
    fontSize: '11px',
    fontFamily: theme.fontMono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  settings: {
    padding: '8px 12px',
    borderBottom: theme.border,
    background: theme.bg2,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  },
  settingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  settingLabel: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    width: 44,
    flexShrink: 0,
  },
  settingInput: {
    flex: 1,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    padding: '3px 6px',
    fontFamily: theme.fontMono,
    outline: 'none',
  },
  quickActions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    padding: '8px 10px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  quickBtn: {
    background: theme.bg2,
    border: theme.border,
    borderRadius: theme.radiusSm,
    padding: '6px 8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'all 0.15s',
  },
  quickIcon: {
    fontSize: 12,
  },
  quickLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 500,
    fontFamily: theme.fontSans,
  },
  chatArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  message: {
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    fontSize: theme.fontSm,
    lineHeight: 1.5,
    maxWidth: '95%',
  },
  userMessage: {
    background: theme.blueDim,
    color: theme.textPrimary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2,
  },
  assistantMessage: {
    background: theme.bg2,
    color: theme.textSecondary,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
  },
  badgeRow: {
    display: 'flex',
    gap: 6,
    marginBottom: 6,
    flexWrap: 'wrap' as const,
  },
  severityBadge: {
    fontSize: '8px',
    fontWeight: 700,
    color: '#fff',
    padding: '1px 5px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
  },
  toolBadge: {
    fontSize: '9px',
    color: theme.textMuted,
    background: theme.bg3,
    padding: '1px 5px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
  },
  messageContent: {
    wordBreak: 'break-word' as const,
  },
  mdH2: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 700,
    marginBottom: 4,
  },
  mdBold: {
    color: theme.textPrimary,
    fontWeight: 600,
    marginTop: 6,
  },
  mdHr: {
    border: 'none',
    borderTop: `1px solid ${theme.textMuted}33`,
    margin: '8px 0',
  },
  mdListItem: {
    paddingLeft: 4,
    marginBottom: 4,
    lineHeight: 1.4,
  },
  mdBullet: {
    paddingLeft: 8,
    color: theme.textSecondary,
    marginBottom: 2,
  },
  mdTableRow: {
    display: 'flex',
    gap: 8,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '1px 0',
  },
  mdTableCell: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  applyBtn: {
    marginTop: 8,
    background: theme.bg3,
    border: `1px solid ${theme.green}`,
    borderRadius: theme.radiusSm,
    color: theme.green,
    fontSize: theme.fontXs,
    padding: '3px 8px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    fontWeight: 500,
  },
  typingIndicator: {
    padding: '2px 10px',
    alignSelf: 'flex-start',
  },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  loadingDots: {
    display: 'flex',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: theme.purple,
    opacity: 0.6,
  },
  inputArea: {
    display: 'flex',
    gap: 6,
    padding: '8px 10px',
    borderTop: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  textInput: {
    flex: 1,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    padding: '6px 8px',
    fontFamily: theme.fontSans,
    outline: 'none',
    resize: 'none' as const,
    lineHeight: 1.4,
  },
  sendBtn: {
    width: 32,
    height: 32,
    background: `linear-gradient(135deg, ${theme.blue}, ${theme.purple})`,
    border: 'none',
    borderRadius: theme.radiusSm,
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    flexShrink: 0,
  },
};

export default AIPanel;
