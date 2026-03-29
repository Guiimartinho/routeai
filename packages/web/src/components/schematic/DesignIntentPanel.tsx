/**
 * DesignIntentPanel - Block annotation UI for design intent.
 *
 * Features:
 * - Select components and assign natural language intent descriptions
 * - Shows generated constraints from intent processing
 * - Edit and delete intents
 * - "Propagate to Layout" button for pushing constraints downstream
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Brain,
  Plus,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  ArrowRightCircle,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  useSchematicStore,
  type DesignIntent,
  type GeneratedConstraint,
} from '../../stores/schematicStore';

// ---------------------------------------------------------------------------
// Constraint display
// ---------------------------------------------------------------------------

const CONSTRAINT_TYPE_COLORS: Record<string, string> = {
  impedance: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  length_match: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  spacing: 'text-green-400 bg-green-400/10 border-green-400/30',
  width: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  guard_trace: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
  copper_pour: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  thermal_relief: 'text-red-400 bg-red-400/10 border-red-400/30',
  diff_pair: 'text-pink-400 bg-pink-400/10 border-pink-400/30',
};

function ConstraintBadge({ constraint }: { constraint: GeneratedConstraint }) {
  const colorClass = CONSTRAINT_TYPE_COLORS[constraint.type] || 'text-gray-400 bg-gray-400/10 border-gray-400/30';
  return (
    <div className={`flex items-start gap-2 px-2 py-1.5 rounded border ${colorClass}`}>
      <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium capitalize">{constraint.type.replace('_', ' ')}</span>
          <span className="text-[10px] font-mono">
            {constraint.parameter}: {constraint.value}{constraint.unit ? ` ${constraint.unit}` : ''}
          </span>
        </div>
        <div className="text-[9px] opacity-70 mt-0.5">{constraint.rationale}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intent card
// ---------------------------------------------------------------------------

interface IntentCardProps {
  intent: DesignIntent;
  onEdit: () => void;
  onDelete: () => void;
  onSelectComponents: () => void;
  onRegenerate: () => void;
  isProcessing: boolean;
}

function IntentCard({
  intent,
  onEdit,
  onDelete,
  onSelectComponents,
  onRegenerate,
  isProcessing,
}: IntentCardProps) {
  const [expanded, setExpanded] = useState(true);
  const components = useSchematicStore((s) => s.components);

  const intentComponents = useMemo(() => {
    return intent.componentIds
      .map((id) => components.get(id))
      .filter(Boolean);
  }, [intent.componentIds, components]);

  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-2 px-3 py-2 bg-gray-800/30">
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 text-gray-500 hover:text-gray-300"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-200 leading-snug">{intent.description}</div>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={onSelectComponents}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              {intentComponents.length} component{intentComponents.length !== 1 ? 's' : ''}
            </button>
            <span className="text-[10px] text-gray-600">
              {intent.generatedConstraints.length} constraint{intent.generatedConstraints.length !== 1 ? 's' : ''}
            </span>
            <span className="text-[10px] text-gray-700">
              {new Date(intent.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isProcessing ? (
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          ) : intent.generatedConstraints.length > 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />
          )}
          <button
            onClick={onRegenerate}
            disabled={isProcessing}
            className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-30 transition-colors"
            title="Regenerate constraints"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={onEdit}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            title="Edit intent"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 text-gray-500 hover:text-red-400 transition-colors"
            title="Delete intent"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 py-2 space-y-2">
          {/* Associated components */}
          <div className="flex flex-wrap gap-1">
            {intentComponents.map((c) => c && (
              <span
                key={c.id}
                className="px-1.5 py-0.5 bg-gray-800 border border-gray-700/50 rounded text-[10px] text-gray-400 font-mono"
              >
                {c.reference}
              </span>
            ))}
          </div>

          {/* Generated constraints */}
          {intent.generatedConstraints.length > 0 ? (
            <div className="space-y-1">
              {intent.generatedConstraints.map((constraint, i) => (
                <ConstraintBadge key={i} constraint={constraint} />
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-gray-600 italic py-1">
              {isProcessing ? 'Processing intent...' : 'No constraints generated yet. Click regenerate.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add intent dialog
// ---------------------------------------------------------------------------

interface AddIntentDialogProps {
  onSubmit: (description: string, componentIds: string[]) => void;
  onCancel: () => void;
  editingIntent?: DesignIntent | null;
}

function AddIntentDialog({ onSubmit, onCancel, editingIntent }: AddIntentDialogProps) {
  const [description, setDescription] = useState(editingIntent?.description || '');
  const selectedIds = useSchematicStore((s) => s.selectedIds);
  const components = useSchematicStore((s) => s.components);

  const selectedComponentIds = useMemo(() => {
    if (editingIntent) return editingIntent.componentIds;
    const ids: string[] = [];
    selectedIds.forEach((id) => {
      if (components.has(id)) ids.push(id);
    });
    return ids;
  }, [selectedIds, components, editingIntent]);

  const selectedComponentsList = useMemo(() => {
    return selectedComponentIds
      .map((id) => components.get(id))
      .filter(Boolean);
  }, [selectedComponentIds, components]);

  const handleSubmit = useCallback(() => {
    if (!description.trim()) return;
    onSubmit(description.trim(), selectedComponentIds);
  }, [description, selectedComponentIds, onSubmit]);

  return (
    <div className="border border-blue-500/50 rounded-lg bg-gray-800/50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-medium text-blue-300">
          {editingIntent ? 'Edit Design Intent' : 'New Design Intent'}
        </span>
      </div>

      {/* Selected components */}
      <div>
        <label className="text-[10px] text-gray-500 mb-1 block">Associated Components</label>
        {selectedComponentsList.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedComponentsList.map((c) => c && (
              <span
                key={c.id}
                className="px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-[10px] text-gray-300 font-mono"
              >
                {c.reference} ({c.value})
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-yellow-400/70 italic">
            Select components on the schematic first, then add intent
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="text-[10px] text-gray-500 mb-1 block">Describe the design intent</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g., 1GHz clock distribution network, USB 2.0 high-speed interface, 5A buck converter output stage..."
          rows={3}
          autoFocus
          className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500 resize-none"
        />
      </div>

      {/* Example intents */}
      <div className="space-y-0.5">
        <label className="text-[10px] text-gray-600">Examples (click to use):</label>
        <div className="flex flex-wrap gap-1">
          {[
            '1GHz clock distribution',
            'USB 2.0 high-speed data lines',
            '5A power delivery section',
            'Low-noise analog frontend',
            'DDR4 memory interface',
            'SPI bus at 50MHz',
          ].map((example) => (
            <button
              key={example}
              onClick={() => setDescription(example)}
              className="px-1.5 py-0.5 bg-gray-800 border border-gray-700/50 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!description.trim()}
          className="px-3 py-1 bg-blue-600/30 text-blue-300 border border-blue-500/50 rounded text-xs hover:bg-blue-600/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {editingIntent ? 'Update' : 'Create'} Intent
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DesignIntentPanel
// ---------------------------------------------------------------------------

export default function DesignIntentPanel() {
  const designIntents = useSchematicStore((s) => s.designIntents);
  const addDesignIntent = useSchematicStore((s) => s.addDesignIntent);
  const updateDesignIntent = useSchematicStore((s) => s.updateDesignIntent);
  const removeDesignIntent = useSchematicStore((s) => s.removeDesignIntent);
  const selectedIds = useSchematicStore((s) => s.selectedIds);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingIntentId, setEditingIntentId] = useState<string | null>(null);
  const [processingIntents, setProcessingIntents] = useState<Set<string>>(new Set());

  const intentList = useMemo(() => Array.from(designIntents.values()), [designIntents]);

  const handleAddIntent = useCallback(
    (description: string, componentIds: string[]) => {
      const now = new Date().toISOString();
      const intent: DesignIntent = {
        id: `intent_${Date.now()}`,
        description,
        componentIds,
        generatedConstraints: [],
        createdAt: now,
        updatedAt: now,
      };
      addDesignIntent(intent);
      setShowAddDialog(false);
      // Auto-generate constraints
      generateConstraintsForIntent(intent);
    },
    [addDesignIntent],
  );

  const handleEditIntent = useCallback(
    (description: string, componentIds: string[]) => {
      if (!editingIntentId) return;
      updateDesignIntent(editingIntentId, {
        description,
        componentIds,
      });
      setEditingIntentId(null);
      // Re-generate constraints
      const intent = designIntents.get(editingIntentId);
      if (intent) {
        generateConstraintsForIntent({ ...intent, description, componentIds });
      }
    },
    [editingIntentId, updateDesignIntent, designIntents],
  );

  const generateConstraintsForIntent = useCallback(
    (intent: DesignIntent) => {
      setProcessingIntents((prev) => new Set([...prev, intent.id]));

      // Simulate LLM processing (in production this calls the intelligence API)
      // Parse intent description to generate constraints
      const constraints = parseIntentToConstraints(intent.description);

      // Simulate async delay for realism
      setTimeout(() => {
        updateDesignIntent(intent.id, {
          generatedConstraints: constraints,
        });
        setProcessingIntents((prev) => {
          const next = new Set(prev);
          next.delete(intent.id);
          return next;
        });
      }, 800);
    },
    [updateDesignIntent],
  );

  const handlePropagateAll = useCallback(() => {
    // Collect all constraints from all intents
    const allConstraints: GeneratedConstraint[] = [];
    designIntents.forEach((intent) => {
      allConstraints.push(...intent.generatedConstraints);
    });

    if (allConstraints.length === 0) {
      alert('No constraints to propagate. Add intents and generate constraints first.');
      return;
    }

    // In production, this would send constraints to the layout engine via API
    // For now, export as JSON
    const exportData = {
      source: 'design_intent',
      timestamp: new Date().toISOString(),
      intents: intentList.map((intent) => ({
        description: intent.description,
        componentRefs: intent.componentIds,
        constraints: intent.generatedConstraints,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'design_constraints.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [designIntents, intentList]);

  const handleSelectIntentComponents = useCallback(
    (intent: DesignIntent) => {
      const store = useSchematicStore.getState();
      store.deselectAll();
      intent.componentIds.forEach((id) => {
        store.select(id, true);
      });
    },
    [],
  );

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-semibold text-gray-300">Design Intent</h3>
            <span className="text-[10px] text-gray-600">({intentList.length})</span>
          </div>
          <button
            onClick={() => setShowAddDialog(true)}
            className="flex items-center gap-1 px-2 py-0.5 bg-purple-600/30 text-purple-300 border border-purple-500/50 rounded text-[10px] hover:bg-purple-600/50 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Intent
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {/* Add dialog */}
        {showAddDialog && !editingIntentId && (
          <AddIntentDialog
            onSubmit={handleAddIntent}
            onCancel={() => setShowAddDialog(false)}
          />
        )}

        {/* Edit dialog */}
        {editingIntentId && (
          <AddIntentDialog
            onSubmit={handleEditIntent}
            onCancel={() => setEditingIntentId(null)}
            editingIntent={designIntents.get(editingIntentId)}
          />
        )}

        {/* Intent list */}
        {intentList.length > 0 ? (
          intentList.map((intent) => (
            <IntentCard
              key={intent.id}
              intent={intent}
              isProcessing={processingIntents.has(intent.id)}
              onEdit={() => setEditingIntentId(intent.id)}
              onDelete={() => removeDesignIntent(intent.id)}
              onSelectComponents={() => handleSelectIntentComponents(intent)}
              onRegenerate={() => generateConstraintsForIntent(intent)}
            />
          ))
        ) : !showAddDialog ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-600">
            <Brain className="w-8 h-8 mb-3 opacity-30" />
            <span className="text-xs text-center mb-1">No design intents defined</span>
            <span className="text-[10px] text-center text-gray-700 max-w-[200px]">
              Select components on the schematic, then click "Add Intent" to describe what they do
            </span>
          </div>
        ) : null}
      </div>

      {/* Propagate button */}
      {intentList.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-800">
          <button
            onClick={handlePropagateAll}
            className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-gradient-to-r from-purple-600/30 to-blue-600/30 text-purple-200 border border-purple-500/40 rounded-lg text-xs font-medium hover:from-purple-600/40 hover:to-blue-600/40 transition-all"
          >
            <ArrowRightCircle className="w-4 h-4" />
            Propagate to Layout
          </button>
          <div className="text-[10px] text-gray-600 text-center mt-1">
            {intentList.reduce((sum, i) => sum + i.generatedConstraints.length, 0)} constraints from{' '}
            {intentList.length} intent{intentList.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intent-to-constraint parsing engine
// ---------------------------------------------------------------------------

/**
 * Parses a natural language design intent description into formal constraints.
 * This is a client-side heuristic engine. In production, this would call the
 * LLM-based DesignIntentProcessor on the intelligence backend.
 */
function parseIntentToConstraints(description: string): GeneratedConstraint[] {
  const lower = description.toLowerCase();
  const constraints: GeneratedConstraint[] = [];

  // Clock / high-speed signal detection
  const freqMatch = lower.match(/(\d+(?:\.\d+)?)\s*(ghz|mhz|khz)/);
  if (freqMatch) {
    const freq = parseFloat(freqMatch[1]);
    const unit = freqMatch[2];
    const freqHz = unit === 'ghz' ? freq * 1e9 : unit === 'mhz' ? freq * 1e6 : freq * 1e3;

    constraints.push({
      type: 'impedance',
      parameter: 'single-ended Z0',
      value: '50',
      unit: 'ohm',
      rationale: `${freq}${unit.toUpperCase()} signal requires controlled impedance to minimize reflections`,
    });

    if (freqHz >= 100e6) {
      constraints.push({
        type: 'length_match',
        parameter: 'max skew',
        value: freqHz >= 1e9 ? '2' : '5',
        unit: 'mil',
        rationale: `Length matching needed for ${freq}${unit.toUpperCase()} to ensure timing margin`,
      });
      constraints.push({
        type: 'guard_trace',
        parameter: 'guard spacing',
        value: '3x',
        unit: 'trace width',
        rationale: `Guard traces recommended for ${freq}${unit.toUpperCase()} to reduce crosstalk`,
      });
    }
  }

  // Clock distribution
  if (lower.includes('clock distribution') || lower.includes('clk distribution')) {
    constraints.push({
      type: 'length_match',
      parameter: 'group length match',
      value: '5',
      unit: 'mil',
      rationale: 'Clock distribution requires matched trace lengths for synchronous timing',
    });
  }

  // USB detection
  if (lower.includes('usb')) {
    const isUSB3 = lower.includes('usb 3') || lower.includes('usb3') || lower.includes('superspeed');
    const isUSB2HS = lower.includes('high-speed') || lower.includes('high speed') || lower.includes('usb 2');

    constraints.push({
      type: 'diff_pair',
      parameter: 'differential impedance',
      value: '90',
      unit: 'ohm',
      rationale: 'USB specification requires 90 ohm differential impedance (USB 2.0/3.x)',
    });
    constraints.push({
      type: 'length_match',
      parameter: 'intra-pair skew',
      value: isUSB3 ? '2' : '5',
      unit: 'mil',
      rationale: `USB ${isUSB3 ? '3.x' : '2.0'} differential pair length matching requirement`,
    });
    constraints.push({
      type: 'spacing',
      parameter: 'min spacing from other signals',
      value: isUSB3 ? '20' : '15',
      unit: 'mil',
      rationale: 'Isolation spacing to prevent crosstalk on USB differential pairs',
    });
  }

  // DDR memory
  if (lower.includes('ddr4') || lower.includes('ddr3') || lower.includes('ddr5')) {
    const ddrType = lower.includes('ddr5') ? 'DDR5' : lower.includes('ddr4') ? 'DDR4' : 'DDR3';
    constraints.push({
      type: 'impedance',
      parameter: 'single-ended Z0 (data/address)',
      value: ddrType === 'DDR5' ? '40' : '50',
      unit: 'ohm',
      rationale: `${ddrType} JEDEC specification single-ended impedance target`,
    });
    constraints.push({
      type: 'diff_pair',
      parameter: 'differential impedance (clock)',
      value: ddrType === 'DDR5' ? '80' : '100',
      unit: 'ohm',
      rationale: `${ddrType} JEDEC specification differential clock impedance`,
    });
    constraints.push({
      type: 'length_match',
      parameter: 'data byte lane match',
      value: ddrType === 'DDR5' ? '1' : '2',
      unit: 'mil',
      rationale: `${ddrType} JEDEC byte lane length matching within data group`,
    });
    constraints.push({
      type: 'length_match',
      parameter: 'address/command to clock match',
      value: '25',
      unit: 'mil',
      rationale: `${ddrType} JEDEC address/command to clock length matching`,
    });
  }

  // Power section detection
  const currentMatch = lower.match(/(\d+(?:\.\d+)?)\s*a(?:mp)?/);
  if (lower.includes('power') || lower.includes('buck') || lower.includes('boost') || lower.includes('ldo') || currentMatch) {
    const current = currentMatch ? parseFloat(currentMatch[1]) : 1;
    const traceWidthMil = Math.max(10, Math.round(current * 20));
    constraints.push({
      type: 'width',
      parameter: 'minimum trace width',
      value: String(traceWidthMil),
      unit: 'mil',
      rationale: `${current}A current capacity requires wider traces per IPC-2221 (1oz copper)`,
    });
    constraints.push({
      type: 'copper_pour',
      parameter: 'copper fill',
      value: 'required',
      unit: '',
      rationale: 'Copper pour recommended for power distribution to reduce resistance and improve thermal performance',
    });
    if (current >= 3) {
      constraints.push({
        type: 'thermal_relief',
        parameter: 'thermal via array',
        value: 'recommended',
        unit: '',
        rationale: `${current}A load requires thermal vias and adequate copper area for heat dissipation`,
      });
    }
  }

  // Buck converter loop area
  if (lower.includes('buck') || lower.includes('switching regulator') || lower.includes('switch mode')) {
    constraints.push({
      type: 'spacing',
      parameter: 'switching loop area',
      value: 'minimize',
      unit: '',
      rationale: 'Switching regulator hot loop must be minimized to reduce EMI emissions',
    });
  }

  // Analog / low-noise
  if (lower.includes('analog') || lower.includes('low-noise') || lower.includes('low noise')) {
    constraints.push({
      type: 'guard_trace',
      parameter: 'guard ring',
      value: 'recommended',
      unit: '',
      rationale: 'Guard ring around sensitive analog signals to prevent noise coupling',
    });
    constraints.push({
      type: 'spacing',
      parameter: 'separation from digital',
      value: '50',
      unit: 'mil',
      rationale: 'Analog signals should be separated from digital to prevent noise injection',
    });
  }

  // SPI bus
  if (lower.includes('spi')) {
    const spiFreqMatch = lower.match(/(\d+)\s*mhz/);
    const spiFreq = spiFreqMatch ? parseInt(spiFreqMatch[1]) : 10;
    if (spiFreq >= 20) {
      constraints.push({
        type: 'impedance',
        parameter: 'single-ended Z0',
        value: '50',
        unit: 'ohm',
        rationale: `SPI at ${spiFreq}MHz benefits from impedance control to reduce signal integrity issues`,
      });
    }
    constraints.push({
      type: 'length_match',
      parameter: 'SPI bus length match',
      value: '50',
      unit: 'mil',
      rationale: `SPI signals should be length-matched for reliable communication at ${spiFreq}MHz`,
    });
  }

  // I2C
  if (lower.includes('i2c') || lower.includes('i2c')) {
    constraints.push({
      type: 'spacing',
      parameter: 'max trace length',
      value: '300',
      unit: 'mil',
      rationale: 'I2C bus capacitance limit restricts maximum trace length',
    });
  }

  // If nothing matched, add a generic constraint
  if (constraints.length === 0) {
    constraints.push({
      type: 'spacing',
      parameter: 'design review recommended',
      value: 'manual',
      unit: '',
      rationale: `Intent "${description}" requires manual constraint definition. Use the intelligence API for detailed analysis.`,
    });
  }

  return constraints;
}
