# RouteAI — Architectural Deep Dive: GPU-First Local Optimization

> All LLM inference is **100% local via Ollama**. No cloud APIs. No external dependencies.
> RouteAI is a local software designed for air-gapped and offline environments.

---

## Table of Contents

1. [System Context](#1-system-context)
2. [Agent vs. Model Matrix (Local Only)](#2-agent-vs-model-matrix-local-only)
3. [GPU VRAM Profiles (RTX 3050 — RTX 4090)](#3-gpu-vram-profiles-rtx-3050--rtx-4090)
4. [Intent DSL Specification](#4-intent-dsl-specification)
5. [Routing Style Learner Strategy](#5-routing-style-learner-strategy)
6. [ReAct Loop Optimization](#6-react-loop-optimization)
7. [Gate 2 Confidence Scoring & Local Escalation](#7-gate-2-confidence-scoring--local-escalation)
8. [Multi-Agent Conflict Resolution](#8-multi-agent-conflict-resolution)
9. [Information Flow Diagram](#9-information-flow-diagram)
10. [Implementation Priorities](#10-implementation-priorities)
11. [Current State Assessment](#11-current-state-assessment)

---

## 1. System Context

RouteAI is an open-source, **fully local** EDA platform that uses LLMs via Ollama to automate
PCB design workflows, integrating AI with deterministic solvers (C++17, Z3, PostGIS).

**Core Principles:**
- LLMs generate *intent*, never coordinates. Deterministic solvers handle all math.
- **100% local inference.** All models run on the user's GPU via Ollama. No cloud APIs.
- Must run smoothly on consumer GPUs from RTX 3050 (8GB) to RTX 4090 (24GB).
- **Primary development target: RTX 4070 (12GB VRAM).**

### 27+ LLM Integration Points

**Core Agent (ReAct Loop)**
- Design Review — analyzes PCB and generates categorized findings (SI, thermal, DRC, placement, manufacturing, power integrity)
- Constraint Generation — analyzes schematics and generates net classes, diff pairs, length groups
- Chat — answers engineering questions in natural language with access to 7 calculation tools
- ReAct Tool Loop — up to 15 iterations calling tools (impedance, DRC, datasheet lookup, current capacity) and reasoning over results

**Routing**
- Routing Director — generates routing strategy (net ordering, layer assignment, via strategy, cost weights)
- Intent-Aware Router — translates interface descriptions into formal constraints
- Signal Flow Floorplanner — suggests floorplan based on signal flow
- Return Path Analyzer — explains return path issues grounded in physics
- Stackup Advisor — recommends multi-layer stackup with impedance targets
- BGA Fanout Strategist — plans BGA escape routing
- Routing Style Learner — learns routing style from existing boards
- Routing Style Applier — applies learned style to new routing
- Routing Critic — critiques existing routing and suggests improvements

**Placement**
- Placement Strategy Generator — generates placement zones, critical pairs, ground/power planes
- Explain Placement — explains the reasoning behind positioning decisions

**Schematic**
- Schematic Reviewer — deep schematic review (incorrect values, missing protection, SI, thermal, EMC/EMI)
- Datasheet Circuit Synthesizer — natural language description to complete circuit with MPNs
- Cross-Datasheet Analyzer — verifies IC-to-IC compatibility using datasheets
- Intent-Preserving Refactorer — topology changes with impact analysis
- Power Budget Analyzer — power tree analysis by operating mode
- Semantic ERC — function-based electrical rule check (not just connectivity)

**Components**
- Component Selector — intelligent component search beyond local database
- Circuit Suggester — designs complete circuits from description

**Fabrication & Thermal**
- PDN Designer — power delivery network analysis
- Thermal Analyzer — thermal management recommendations
- Fabrication Advisor — manufacturing process optimization

**RAG**
- Datasheet Constraint Extractor — extracts layout guidelines from datasheets/PDFs
- RAG Pipeline — searches IPC standards and datasheets to ground recommendations with citations

**Validation (3-Gate Pipeline)**
- Gate 1: Schema Validation — validates JSON output against expected schema
- Gate 2: Confidence Scoring — physics plausibility + confidence scoring
- Gate 3: Citation Checking — verifies recommendations have citations from real sources

---

## 2. Agent vs. Model Matrix (Local Only)

Since everything runs locally, the strategy is: **use the biggest model that fits in VRAM for
the task, and compensate for smaller models with smarter prompts and task decomposition.**

### Tier Classification

| Tier | Task Complexity | Agents | Strategy on 12GB GPU |
|------|----------------|--------|---------------------|
| **T1 — Heavy Reasoning** | Multi-step physics, trade-offs, deep review | Return Path Analyzer, Semantic ERC, Routing Critic, Cross-Datasheet Analyzer, Power Budget Analyzer, Design Review, Schematic Reviewer | **Decompose into T2 sub-tasks** + chain-of-thought prompting with 14B model. If 14B can't handle, flag for human review. |
| **T2 — Structured Output** | JSON/DSL generation, constraints | Constraint Generation, Placement Strategy, Routing Director, Intent-Aware Router, Stackup Advisor, BGA Fanout, Datasheet Circuit Synthesizer, PDN Designer | **Primary workhorse model** — 14B code-specialized. Swap into VRAM on demand. |
| **T3 — Fast Validation** | Classification, extraction, simple Q&A | Gate 1 Schema Validation, Gate 3 Citation Checking, Explain Placement, Signal Flow Floorplanner, Component Selector, Chat | **Always-resident small model** — 7B. Instant responses. |

### Recommended Local Models (Ollama)

| Tier | Primary Model | VRAM | Alternative | Why |
|------|--------------|------|-------------|-----|
| T1 | Qwen2.5:14B Q4_K_M (same as T2, with specialized prompts) | 9 GB | DeepSeek-R1:14B (better reasoning) | On 12GB, 14B is the max. Compensate with task decomposition and chain-of-thought. |
| T2 | Qwen2.5-Coder:14B Q4_K_M | 9 GB | DeepSeek-Coder-V2:16B Q4 | Code-specialized = better JSON output, fewer hallucinated fields. |
| T3 | Qwen2.5:7B Q4_K_M | 5 GB | Phi-3.5-mini:3.8B (for 6-8GB GPUs) | Fast, always loaded, handles validation and chat. |

### How T1 Tasks Work Without Cloud

The key insight: **you don't need a 72B model if you decompose the task.**

Example — Design Review (normally T1):

```
BEFORE (monolithic, needs 72B):
  "Analyze this entire PCB for SI, thermal, DRC, placement, power integrity issues"

AFTER (decomposed into T2 sub-tasks, works with 14B):
  Step 1: "List all high-speed nets and their impedance targets" (T2 structured)
  Step 2: "For each net, check: does trace width match impedance?" (T2 + tool call)
  Step 3: "List all power components and thermal dissipation" (T2 structured)
  Step 4: "For each hot component, check clearance to neighbors" (T2 + tool call)
  Step 5: "Synthesize findings into categorized report" (T2 structured)
```

Each sub-task is simple enough for a 14B model. The ReAct loop orchestrates the sequence.
The quality comes from **tool calls to deterministic solvers** (impedance calc, DRC engine),
not from the LLM's raw reasoning ability.

---

## 3. GPU VRAM Profiles (RTX 3050 — RTX 4090)

### Consumer GPU Compatibility Matrix

| GPU | VRAM | T3 (Resident) | T2 (Swap) | T1 Strategy | Expected Feel |
|-----|------|---------------|-----------|-------------|---------------|
| **RTX 3050** | 8 GB | Phi-3.5:3.8B (3GB) | Qwen2.5:7B Q4 (5GB) | Decompose + 7B | Functional, slower T2 |
| **RTX 3060** | 12 GB | Qwen2.5:7B (5GB) | Qwen2.5-Coder:14B Q4 (9GB) | Decompose + 14B | Good |
| **RTX 3070** | 8 GB | Phi-3.5:3.8B (3GB) | Qwen2.5:7B Q4 (5GB) | Decompose + 7B | Same as 3050 |
| **RTX 3080** | 10 GB | Qwen2.5:7B (5GB) | Qwen2.5-Coder:14B Q4 (9GB) | Decompose + 14B (tight) | Good, less KV cache |
| **RTX 4050** | 6 GB | Phi-3.5:3.8B (3GB) | Qwen2.5:7B Q4 (5GB) | Decompose + 7B | Functional, basic |
| **RTX 4060** | 8 GB | Phi-3.5:3.8B (3GB) | Qwen2.5:7B Q4 (5GB) | Decompose + 7B | Functional |
| **RTX 4060 Ti** | 16 GB | Qwen2.5:7B (5GB) | Qwen2.5-Coder:14B Q4 (9GB) | 14B with larger context | Very good |
| **RTX 4070** | **12 GB** | **Qwen2.5:7B (5GB)** | **Qwen2.5-Coder:14B Q4 (9GB)** | **Decompose + 14B** | **Good — primary target** |
| **RTX 4070 Ti** | 12 GB | Qwen2.5:7B (5GB) | Qwen2.5-Coder:14B Q4 (9GB) | Decompose + 14B | Good, faster than 4070 |
| **RTX 4080** | 16 GB | Qwen2.5:7B (5GB) | Qwen2.5-Coder:14B Q4 (9GB) | T2+T3 co-resident | Very good |
| **RTX 4090** | 24 GB | Qwen2.5:7B (5GB) | Qwen2.5:32B Q4 (20GB) | 32B handles T1 directly | Excellent |

### RTX 4070 (12GB) — Primary Target Profile

```
VRAM Budget: 12,282 MB
├── Mode A (default): Qwen2.5:7B Q4_K_M    →  5,120 MB  (T3 — validation, chat, fast)
│   Free VRAM: ~7 GB — system + KV cache
│   Inference: ~40 tok/s — feels instant
│
├── Mode B (on-demand): Qwen2.5-Coder:14B  →  9,216 MB  (T2 — DSL, constraints)
│   Free VRAM: ~3 GB — tight, limit num_ctx to 4096
│   Inference: ~18 tok/s — responsive, not instant
│   Swap time: ~3-5 seconds (show spinner to user)
│
└── Mode C (T1 tasks): Same 14B model with decomposed prompts
    Uses ReAct loop to break complex analysis into tool-assisted sub-tasks
    Quality comes from solvers, not from model size
```

### Ollama Configuration

```bash
# Recommended for 12GB GPU
export OLLAMA_MAX_LOADED_MODELS=1        # NEVER two models at once on 12GB
export OLLAMA_NUM_PARALLEL=2             # Max 2 concurrent requests per model
export OLLAMA_FLASH_ATTENTION=1          # Reduces VRAM usage for KV cache
export OLLAMA_GPU_OVERHEAD=512           # Reserve 512MB for OS/display
export OLLAMA_KEEP_ALIVE=10m             # Unload idle model after 10 min

# For 8GB GPUs
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_NUM_PARALLEL=1             # Only 1 request at a time
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_GPU_OVERHEAD=768           # More headroom needed

# For 24GB GPUs
export OLLAMA_MAX_LOADED_MODELS=2        # Can keep T3 resident while running T2
export OLLAMA_NUM_PARALLEL=4
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_GPU_OVERHEAD=512
```

### VRAM-Aware Model Manager

```python
# packages/intelligence/llm/model_manager.py

from enum import Enum
from dataclasses import dataclass

class ModelTier(Enum):
    T3_FAST = "fast"
    T2_STRUCTURED = "structured"
    T1_HEAVY = "heavy"  # Decomposed into T2 sub-tasks locally

@dataclass
class GPUProfile:
    vram_gb: int
    resident_model: str       # Always loaded
    swap_model: str | None    # Loaded on demand
    max_context: int          # num_ctx limit
    max_parallel: int         # Concurrent requests

# Auto-detected based on nvidia-smi output
GPU_PROFILES = {
    6:  GPUProfile(6,  "phi3.5:3.8b",       "qwen2.5:7b",         2048, 1),
    8:  GPUProfile(8,  "phi3.5:3.8b",       "qwen2.5:7b",         4096, 1),
    10: GPUProfile(10, "qwen2.5:7b",        "qwen2.5-coder:14b",  4096, 2),
    12: GPUProfile(12, "qwen2.5:7b",        "qwen2.5-coder:14b",  4096, 2),
    16: GPUProfile(16, "qwen2.5:7b",        "qwen2.5-coder:14b",  8192, 2),
    24: GPUProfile(24, "qwen2.5:7b",        "qwen2.5:32b",        8192, 4),
}

TASK_TIER_MAP = {
    # T1 — Heavy reasoning (decomposed locally)
    "design_review": ModelTier.T1_HEAVY,
    "schematic_review": ModelTier.T1_HEAVY,
    "return_path_analysis": ModelTier.T1_HEAVY,
    "semantic_erc": ModelTier.T1_HEAVY,
    "routing_critic": ModelTier.T1_HEAVY,
    "cross_datasheet": ModelTier.T1_HEAVY,
    "power_budget": ModelTier.T1_HEAVY,
    # T2 — Structured output
    "constraint_generation": ModelTier.T2_STRUCTURED,
    "placement_strategy": ModelTier.T2_STRUCTURED,
    "routing_director": ModelTier.T2_STRUCTURED,
    "intent_aware_router": ModelTier.T2_STRUCTURED,
    "stackup_advisor": ModelTier.T2_STRUCTURED,
    "bga_fanout": ModelTier.T2_STRUCTURED,
    "circuit_synthesizer": ModelTier.T2_STRUCTURED,
    "pdn_designer": ModelTier.T2_STRUCTURED,
    # T3 — Fast
    "schema_validation": ModelTier.T3_FAST,
    "citation_check": ModelTier.T3_FAST,
    "explain_placement": ModelTier.T3_FAST,
    "component_search": ModelTier.T3_FAST,
    "chat": ModelTier.T3_FAST,
    "signal_flow_floorplan": ModelTier.T3_FAST,
}

class ModelManager:
    def __init__(self, vram_gb: int):
        # Round down to nearest known profile
        known = sorted(GPU_PROFILES.keys())
        profile_key = max([k for k in known if k <= vram_gb], default=6)
        self.profile = GPU_PROFILES[profile_key]
        self.current_model: str | None = None

    def select_model(self, task_type: str) -> str:
        tier = TASK_TIER_MAP.get(task_type, ModelTier.T3_FAST)

        if tier == ModelTier.T3_FAST:
            return self.profile.resident_model

        if tier in (ModelTier.T2_STRUCTURED, ModelTier.T1_HEAVY):
            # T1 uses the same model as T2, but with decomposed prompts
            return self.profile.swap_model or self.profile.resident_model

    def needs_swap(self, target_model: str) -> bool:
        return self.current_model != target_model

    def get_context_limit(self) -> int:
        return self.profile.max_context

    def detect_vram() -> int:
        """Auto-detect GPU VRAM via nvidia-smi."""
        import subprocess
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True
            )
            return int(result.stdout.strip()) // 1024  # MB to GB
        except Exception:
            return 8  # Conservative fallback
```

### Anti-Stutter Rules

1. **NEVER load two models simultaneously** on <= 16GB — Ollama will OOM or swap to RAM (10x slower)
2. **T3 (7B) is the default** — loads in <2 seconds, handles 80% of user interactions
3. **T2 (14B) loads on demand** — user sees "Generating constraints..." spinner during ~4s swap
4. **Batch T2 tasks** — if multiple T2 tasks are queued, run them all before swapping back to T3
5. **Stream all responses** — start sending tokens to UI immediately, never wait for full completion
6. **KV cache limit** — `num_ctx: 4096` for T2 on 12GB (saves ~1GB VRAM). Only 8192 on 16GB+.
7. **Always Q4_K_M quantization** — never Q5 or Q8 on consumer GPUs
8. **T1 tasks = decomposed T2** — break complex analysis into sequential sub-tasks the 14B can handle

### Inference Speed Reference (Q4_K_M quantization)

| Model | VRAM | RTX 3060 | RTX 4070 | RTX 4090 | Feel |
|-------|------|----------|----------|----------|------|
| Phi-3.5:3.8B | 3 GB | ~45 tok/s | ~60 tok/s | ~90 tok/s | Instant |
| Qwen2.5:7B | 5 GB | ~25 tok/s | ~40 tok/s | ~65 tok/s | Fast |
| Qwen2.5-Coder:14B | 9 GB | ~12 tok/s | ~18 tok/s | ~35 tok/s | Responsive |
| Qwen2.5:32B | 20 GB | Won't fit | Won't fit | ~12 tok/s | Slow but capable |

---

## 4. Intent DSL Specification

The critical contract between the intelligence layer (Python/LLM) and the solver layer (C++).
The LLM emits intent; the solver produces coordinates. Never the reverse.

### 4.1 Placement Intent DSL

```json
{
  "$schema": "routeai/placement-intent/v1",
  "board_id": "uuid",
  "intent_version": "1.0.0",

  "zones": [
    {
      "zone_id": "power_stage",
      "zone_type": "functional_group",
      "components": ["U1", "U2", "L1", "L2", "C1", "C2", "C3", "C4"],
      "clustering": {
        "strategy": "minimize_loop_area",
        "anchor_component": "U1",
        "max_spread_mm": 25.0,
        "orientation_preference": "input_left_output_right"
      },
      "thermal": {
        "max_junction_temp_c": 105,
        "keepout_radius_mm": 3.0,
        "requires_thermal_vias": true,
        "copper_pour_layers": ["F.Cu", "B.Cu"],
        "airflow_direction": "left_to_right"
      },
      "power_plane": {
        "voltage_rail": "VCC_3V3",
        "target_voltage_drop_mv": 50,
        "min_copper_area_mm2": 200
      }
    }
  ],

  "critical_pairs": [
    {
      "pair": ["U3", "Y1"],
      "constraint": "minimize_distance",
      "max_distance_mm": 5.0,
      "reason": "crystal_oscillator_trace_length"
    },
    {
      "pair": ["U1", "C10"],
      "constraint": "decoupling",
      "max_distance_mm": 2.0,
      "placement_side": "same_side"
    }
  ],

  "keepouts": [
    {
      "type": "thermal",
      "source_component": "U1",
      "radius_mm": 5.0,
      "excluded_components": ["U5", "U6"],
      "reason": "MOSFET_driver_thermal_dissipation_2.5W"
    },
    {
      "type": "mechanical",
      "region": {
        "type": "rectangle",
        "anchor": "board_edge_left",
        "offset_mm": 2.0,
        "width_mm": 10.0,
        "height_mm": 50.0
      },
      "reason": "connector_clearance"
    }
  ],

  "ground_planes": [
    {
      "layer": "In1.Cu",
      "type": "solid_pour",
      "net": "GND",
      "split_allowed": false,
      "reason": "return_path_continuity_for_high_speed_signals"
    }
  ]
}
```

### 4.2 Routing Intent DSL

```json
{
  "$schema": "routeai/routing-intent/v1",
  "board_id": "uuid",

  "net_classes": [
    {
      "name": "DDR3_DQ",
      "nets": ["DDR_D0", "DDR_D1", "DDR_D2", "DDR_D3"],
      "impedance": {
        "type": "single_ended",
        "target_ohm": 50,
        "tolerance_percent": 10
      },
      "width_mm": 0.1,
      "clearance_mm": 0.127,
      "layer_preference": ["In1.Cu", "In2.Cu"],
      "length_matching": {
        "group": "DDR3_BYTE0",
        "max_skew_mm": 1.27,
        "reference_net": "DDR_DQS0"
      },
      "via_strategy": {
        "type": "blind_microvia",
        "max_vias_per_net": 2,
        "via_size_mm": 0.15
      }
    },
    {
      "name": "USB_DP_DM",
      "nets": ["USB_DP", "USB_DM"],
      "impedance": {
        "type": "differential",
        "target_ohm": 90,
        "tolerance_percent": 10,
        "coupling_gap_mm": 0.15
      },
      "differential_pair": {
        "max_intra_pair_skew_mm": 0.127,
        "max_parallel_length_mm": 500,
        "min_spacing_to_other_diff_mm": 0.5
      },
      "routing_priority": 1,
      "max_total_length_mm": 80
    }
  ],

  "routing_order": [
    {"priority": 1, "net_class": "USB_DP_DM", "reason": "impedance_critical"},
    {"priority": 2, "net_class": "DDR3_DQ", "reason": "length_matching_group"},
    {"priority": 3, "net_class": "POWER", "reason": "wide_traces_route_first"},
    {"priority": 99, "net_class": "GPIO", "reason": "flexible_non_critical"}
  ],

  "layer_assignment": {
    "signal_layers": ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"],
    "reference_planes": {
      "F.Cu": "In1.Cu_GND",
      "In2.Cu": "In1.Cu_GND",
      "B.Cu": "In2.Cu_PWR"
    },
    "layer_transitions": {
      "max_layer_changes_per_net": 2,
      "preferred_via_layers": [["F.Cu", "In1.Cu"], ["In2.Cu", "B.Cu"]]
    }
  },

  "cost_weights": {
    "via_cost": 10.0,
    "layer_change_cost": 8.0,
    "length_cost": 1.0,
    "congestion_cost": 5.0,
    "reference_plane_violation_cost": 100.0
  },

  "voltage_drop_targets": [
    {
      "net": "VCC_3V3",
      "source_component": "U_REG1",
      "sink_components": ["U1", "U2", "U3"],
      "max_drop_mv": 50,
      "max_current_a": 2.5,
      "min_trace_width_mm": 0.5
    }
  ]
}
```

### 4.3 DSL Design Principles

1. **Every field has a unit** — `_mm`, `_ohm`, `_mv`, `_a`, `_c` suffix convention
2. **Every field has a valid range** — enforced by Pydantic validators in `packages/core`
3. **Every field has a default** — partial DSL output still produces valid solver input
4. **`reason` field on every constraint** — forces LLM to justify, improves Gate 3
5. **No coordinates** — only component references, net names, layer names, relative terms

---

## 5. Routing Style Learner Strategy

### Problem

A `.kicad_pcb` with 500 nets and 3000 track segments won't fit in any context window as raw text.

### Solution: Statistical Feature Vector + Semantic Summary

**Step 1 — Extract numerical features (Python parser, no LLM needed):**

```python
@dataclass
class RoutingStyleProfile:
    # Track geometry distribution
    trace_width_histogram: dict[float, int]      # {0.15: 234, 0.2: 89}
    trace_width_by_net_class: dict[str, float]    # {"power": 0.5, "signal": 0.15}

    # Via usage patterns
    via_density_per_cm2: float
    via_types_ratio: dict[str, float]             # {"through": 0.8, "blind": 0.15}
    avg_vias_per_net: float

    # Routing preferences
    preferred_angles: list[int]                   # [0, 45, 90] or [0, 90]
    avg_segment_length_mm: float
    routing_density_heatmap: list[list[float]]    # 10x10 grid normalized

    # Layer usage
    layer_utilization: dict[str, float]           # {"F.Cu": 0.65, "In1.Cu": 0.30}
    layer_transitions_per_net: float

    # Spacing behavior
    avg_clearance_mm: float
    min_clearance_mm: float
    diff_pair_gap_ratio: float                    # gap/width ratio

    # Topology
    avg_manhattan_ratio: float                    # actual_length / manhattan_distance
    bus_parallelism_score: float                  # 0-1
    symmetry_score: float                         # 0-1
```

**Step 2 — Generate semantic summary (LLM, one-time per board, ~500 tokens):**

```
Board: 4-layer DDR3 design, 127 nets.
Style: Conservative Manhattan routing (98% 0/45/90). Heavy ground pours on L2.
Power: Wide traces (0.5mm), star topology from regulator.
High-speed: DDR on inner layers, length matched (max skew 0.8mm).
Vias: Through-hole 0.3mm drill. Avg 1.2 vias/net.
Notable: 45 deg entry into pads. Diff pairs 3:1 gap:width.
```

**Step 3 — Store in pgvector:**

```sql
INSERT INTO routing_styles (board_id, profile_json, summary, embedding)
VALUES ($1, $2, $3, embed($summary));
```

**Context window impact:** ~800 tokens per board. 3 reference boards = under 3K tokens.

**Current codebase status:** Parser exists (`packages/parsers`), data model has all fields. Feature extraction, style storage, and Style Learner/Applier agents are not yet implemented. Phase 3 priority.

---

## 6. ReAct Loop Optimization

### Current State

ReAct loop in `packages/intelligence/agent/core.py`: 15 iterations, 6 tools, working.
**Problem:** No deduplication, no state management, no circuit breaker.

### Proposed: Stateful Tool Memory + Progress Guard

```python
@dataclass
class ReActState:
    iteration: int = 0
    max_iterations: int = 15

    # Tool call deduplication
    tool_call_log: list[ToolCall] = field(default_factory=list)
    tool_result_cache: dict[str, Any] = field(default_factory=dict)

    # Progress tracking
    findings: list[Finding] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)
    resolved_questions: list[str] = field(default_factory=list)

    # Circuit breakers
    consecutive_no_progress: int = 0
    MAX_NO_PROGRESS: int = 3

    def call_hash(self, tool: str, params: dict) -> str:
        return hashlib.md5(
            f"{tool}:{json.dumps(params, sort_keys=True)}".encode()
        ).hexdigest()

    def is_duplicate_call(self, tool: str, params: dict) -> bool:
        return self.call_hash(tool, params) in self.tool_result_cache

    def register_call(self, tool: str, params: dict, result: Any) -> str | None:
        h = self.call_hash(tool, params)
        if h in self.tool_result_cache:
            return f"DUPLICATE: Already called. Result: {self.tool_result_cache[h][:200]}"
        self.tool_result_cache[h] = str(result)
        self.tool_call_log.append(ToolCall(tool=tool, params=params, result=result))
        return None

    def check_progress(self, new_findings: int) -> str | None:
        if new_findings == 0:
            self.consecutive_no_progress += 1
        else:
            self.consecutive_no_progress = 0
        if self.consecutive_no_progress >= self.MAX_NO_PROGRESS:
            return "STOP: 3 iterations with no new findings. Synthesize."
        return None
```

### System Prompt Injection per Iteration

```
Iteration {n}/15 | Findings: {count} | Open questions: {open}
CACHED RESULTS (do NOT re-call):
- impedance(w=0.15, h=0.2, er=4.3) = 52.3 ohm
- current_capacity(w=0.5, cu=1oz) = 2.1 A
RULE: No new questions? Emit FINAL_ANSWER.
```

**Impact on 12GB GPU:** Saves ~30% of iterations = ~15-30 seconds per design review. Critical for local inference where every token costs GPU time.

---

## 7. Gate 2 Confidence Scoring & Local Escalation

### Current State

Gate 2 checks `confidence < 0.7` per item. No physics checks, no local escalation.

### Proposed: Physics Checks + Local Model Escalation

Since there is no cloud fallback, the escalation chain is:

```
T3 model (7B) fails → swap to T2 model (14B) → retry with better prompt
    → still fails → decompose into sub-tasks → retry
        → still fails → flag for HUMAN REVIEW
```

### Physics Boundary Checks (No LLM Needed — Deterministic)

```python
def si_pi_semantic_check(result: dict) -> float:
    """Hard physics boundaries. If violated, answer is wrong."""
    score = 1.0

    z = result.get("impedance_ohm", 0)
    if not (20 <= z <= 150):
        score -= 0.4  # PCB impedance is always 20-150 ohm

    xtalk = result.get("crosstalk_db", 0)
    if xtalk > 0:
        score -= 0.5  # Crosstalk is always negative dB

    vdrop = result.get("voltage_drop_mv", 0)
    vsupply = result.get("supply_voltage_mv", 3300)
    if vdrop > vsupply * 0.1:
        score -= 0.3  # Drop > 10% of supply is wrong

    tj = result.get("junction_temp_c", 0)
    if tj > 200:
        score -= 0.5  # Standard packages don't exceed 200C

    tw = result.get("trace_width_mm", 0)
    if tw <= 0 or tw > 10:
        score -= 0.5  # Invalid trace width

    return max(0.0, score)
```

### Local Escalation Policy

```python
class LocalEscalationPolicy:
    THRESHOLDS = {
        "si_pi_analysis":    0.75,  # High bar
        "thermal_analysis":  0.70,
        "design_review":     0.65,
        "constraint_gen":    0.60,
        "placement_intent":  0.55,
        "general_chat":      0.40,
    }

    ESCALATION_CHAIN = [
        "resident_model",    # T3 (7B) — fast attempt
        "swap_model",        # T2 (14B) — retry with bigger model
        "decompose",         # Break into sub-tasks + retry with T2
        "human_review",      # Flag for engineer
    ]

    def should_escalate(self, task_type: str, score: float, current_step: int) -> str | None:
        threshold = self.THRESHOLDS.get(task_type, 0.60)
        if score >= threshold:
            return None
        if current_step < len(self.ESCALATION_CHAIN) - 1:
            return self.ESCALATION_CHAIN[current_step + 1]
        return "human_review"
```

**Key insight:** Physics has hard boundaries. If impedance < 20 ohm, it's wrong — the 7B model knows that too. The deterministic checks catch 80% of bad outputs before wasting GPU time on retry.

---

## 8. Multi-Agent Conflict Resolution

### Conflict Map

| Agent A | Agent B | Conflict | Example |
|---------|---------|----------|---------|
| Placement (thermal) | Routing (SI) | Spread vs. short traces | MOSFET far (heat) vs. close (SI) |
| Placement (thermal) | Placement (density) | Keepouts vs. area | Small board, big keepouts |
| Routing Director | BGA Fanout | Min vias vs. via forest | Transitions vs. escape routing |
| Stackup Advisor | Cost | More layers = better SI | 6-layer ideal, budget = 4-layer |
| PDN Designer | Routing Director | Wide power vs. routing space | 0.5mm trace blocks signal |
| Semantic ERC | Circuit Suggester | ERC flags vs. intended | Pull-up flagged but correct |

### Resolution: Weighted Priority System

```python
DOMAIN_PRIORITY = {
    "safety":            100,  # Non-negotiable
    "signal_integrity":   80,
    "power_integrity":    75,
    "thermal":            70,
    "manufacturability":  60,
    "density":            40,
    "cost":               30,
    "aesthetics":         10,
}
```

If priority gap > 20 points: higher domain wins automatically.
If close: Routing Critic mediates and proposes a compromise DSL.
Safety (voltage clearance, current capacity) **never** loses.

---

## 9. Information Flow Diagram

```
Input (.kicad_sch / .kicad_pcb)
         |
         |  packages/parsers
         v
+-----------------+
|  Unified Data   |  <-- Pydantic v2 (packages/core)
|  Model          |
+--------+--------+
         |
    +----+----+-----------+-----------+
    v         v           v           v
+--------+ +----------+ +--------+ +--------+
|Schem.  | |Constraint| |Compon. | |Design  |
|Reviewer| |Generator | |Selector| |Review  |
|(14B)   | |(14B)     | |(7B)    | |(14B)   |
+---+----+ +----+-----+ +---+----+ +---+----+
    |           |            |          |
    |    +------v------+     |          |
    |    | Placement   |<----+          |
    |    | Intent DSL  |               |
    |    +------+------+               |
    |           |                      |
    |    +------v------+               |
    |    | Conflict    |  <-- only if  |
    |    | Resolver    |  contradictions
    |    +------+------+               |
    |           |                      |
    |    +------v------+               |
    |    | C++ Solver  |  <-- coords   |
    |    | (Placement) |  generated    |
    |    +------+------+  HERE         |
    |           |                      |
    |    +------v------+               |
    |    | Routing     |               |
    |    | Intent DSL  |               |
    |    +------+------+               |
    |           |                      |
    |    +------v------+               |
    |    | C++ Solver  |  <-- traces   |
    |    | (A*/Lee/Z3) |  routed HERE  |
    |    +------+------+               |
    |           |                      |
    |    +------v------+               |
    |    | Routing     |  <-- critique |
    |    | Critic (14B)|  RESULT not   |
    |    +------+------+  intent       |
    |           |                      |
    +-----------+----------+-----------+
                           v
              +------------------------+
              |  3-GATE VALIDATION     |
              |                        |
              |  Gate 1: Schema (7B)   | <-- JSON check
              |     | pass             |
              |  Gate 2: Confidence    | <-- Physics checks
              |     | pass / ESCALATE  |     (deterministic)
              |     | to 14B or human  |
              |  Gate 3: Citation (7B) | <-- IPC/datasheet
              |     | pass             |
              |  OUTPUT TO USER        |
              +------------------------+

All models: Ollama local. No cloud. No external calls.
```

---

## 10. Implementation Priorities

| # | What | Effort | Impact | Phase | Status |
|---|------|--------|--------|-------|--------|
| 1 | **Intent DSL** (Placement + Routing schemas) | High | Critical | Phase 1-2 | 3 schemas exist but LLM->user, not LLM->solver |
| 2 | **ReAct State Management** (cache + breaker) | Medium | High | Phase 0-1 | Loop exists, no dedup/state |
| 3 | **Gate 2 physics checks** | Low | High | Phase 0-1 | Gate 2 exists, no physics |
| 4 | **VRAM-aware model manager** | Medium | High | Phase 1 | Not implemented |
| 5 | **Model tier routing** by task type | Medium | Medium | Phase 1 | Same model for all tasks |
| 6 | **T1 task decomposition** framework | Medium | High | Phase 1 | Not implemented |
| 7 | **Routing Style Learner** | High | Medium | Phase 3 | Parser exists, rest missing |
| 8 | **Conflict resolution** system | High | Medium | Phase 4 | Needs DSL first |

### Critical Path

```
VRAM manager (P4) --> Model tier routing (P5) --> T1 decomposition (P6)
       |
DSL schemas (P1) --> Conflict resolution (P8) --> Style Learner (P7)
       |
ReAct state (P2) --> Gate 2 physics (P3)
```

P1-P4 are what separates "chatbot about PCBs" from "EDA tool that works."

---

## 11. Current State Assessment

### What Is Real and Working

| Component | Lines | Status |
|-----------|-------|--------|
| ReAct agent loop | 634 | Working — 15 iterations, 6 tools |
| LLM provider routing (Ollama) | 300+ | Working — tool-use, JSON mode |
| 3-Gate validation | 3 modules | Working — schema, confidence, citation |
| Impedance calculator | 300+ | Working — Hammerstad-Jensen (IPC-2141A) |
| DRC engine | 3 modules | Working — geometric, electrical, manufacturing |
| Z3 constraint solver | 250+ | Working — length matching, skew verification |
| Thermal analysis | 300+ | Working — IPC-2152 empirical model |
| Crosstalk analysis | 250+ | Working — NEXT/FEXT |
| SI/PI solvers | 6 modules | Working — impedance, crosstalk, return path, PDN, copper, IR drop |
| Manufacturing export | 6 modules | Working — Gerber, drill, BOM, P&P, IPC-2581, ODB++ |
| C++ routing engine | 2,452 | Working — A*, Lee, diff pair, global router |
| Go API gateway | 4,638 | Working — auth, projects, chat, review, tools, WS |
| React frontend | 20+ components | Working — editor, 3D viewer, AI panels |
| Pydantic data model | 6 files | Working — complete PCB data model |

### What Needs To Be Built

| Component | Dependency | Phase |
|-----------|-----------|-------|
| Intent DSL (LLM->Solver) | Core architecture | 1-2 |
| ReAct state management | Standalone | 0-1 |
| Physics boundary checks | Standalone | 0-1 |
| VRAM-aware model manager | nvidia-smi detection | 1 |
| Model tier routing | VRAM manager | 1 |
| T1 task decomposition | Tier routing | 1 |
| Routing Style Learner | Feature extraction | 3 |
| Conflict resolution | DSL + agents | 4 |

---

## Design Decisions

1. **27 agents → target ~18-20.** Merge: Style Learner + Applier = 1 agent. Circuit Suggester + Datasheet Synthesizer = 1 agent.

2. **The DSL is the product.** If the Intent DSL is solid, model swaps are transparent. Invest 80% of validation effort on DSL correctness.

3. **14B is the workhorse.** On 12GB, the 14B model handles both T2 (directly) and T1 (decomposed). Quality comes from tool calls to deterministic solvers, not raw model size.

4. **Routing Critic runs AFTER the solver.** Critique actual routed boards, not intent. Critiquing intent is speculative; critiquing results is actionable.

5. **Physics checks are free.** Deterministic boundary checks (impedance range, crosstalk sign, thermal limits) catch 80% of bad outputs at zero GPU cost.

6. **Model swap takes 3-5 seconds.** Always show a spinner. Batch same-tier tasks together. Never swap mid-conversation without user feedback.
