# RouteAI — Master Implementation Plan

> Based on [ARCHITECTURE_GPU_OPTIMIZATION.md](./ARCHITECTURE_GPU_OPTIMIZATION.md).
> All inference is **100% local via Ollama**. No cloud APIs. No external dependencies.
> Primary development GPU: RTX 4070 (12GB VRAM).

---

## Table of Contents

- [Phase 0: Foundation (Weeks 1-3)](#phase-0-foundation-weeks-1-3)
- [Phase 1: Intelligence Core (Weeks 4-8)](#phase-1-intelligence-core-weeks-4-8)
- [Phase 2: Intent DSL & Solver Bridge (Weeks 9-14)](#phase-2-intent-dsl--solver-bridge-weeks-9-14)
- [Phase 3: Frontend Integration (Weeks 15-18)](#phase-3-frontend-integration-weeks-15-18)
- [Phase 4: Advanced Agents (Weeks 19-24)](#phase-4-advanced-agents-weeks-19-24)
- [Phase 5: Polish & Production (Weeks 25-30)](#phase-5-polish--production-weeks-25-30)

---

## Phase 0: Foundation (Weeks 1-3)

**Goal:** Build the GPU-aware infrastructure that everything else depends on.

---

### P0.1 — VRAM Detection & GPU Profiling

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/llm/gpu_detect.py`

**What it does:**
- Auto-detect GPU model and VRAM via `nvidia-smi` subprocess call
- Return structured `GPUInfo(name, vram_total_mb, vram_free_mb, compute_capability)`
- Fallback: if `nvidia-smi` not found, assume 8GB (conservative)
- Cache result on first call (GPU doesn't change mid-session)

```python
# gpu_detect.py
import subprocess
from dataclasses import dataclass

@dataclass(frozen=True)
class GPUInfo:
    name: str
    vram_total_mb: int
    vram_free_mb: int
    compute_capability: str

def detect_gpu() -> GPUInfo:
    """Auto-detect NVIDIA GPU via nvidia-smi. Returns conservative defaults on failure."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,compute_cap",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True, text=True, timeout=5,
        )
        parts = result.stdout.strip().split(", ")
        return GPUInfo(
            name=parts[0],
            vram_total_mb=int(parts[1]),
            vram_free_mb=int(parts[2]),
            compute_capability=parts[3],
        )
    except Exception:
        return GPUInfo(name="Unknown", vram_total_mb=8192, vram_free_mb=6144, compute_capability="0.0")

_cached: GPUInfo | None = None

def get_gpu_info() -> GPUInfo:
    global _cached
    if _cached is None:
        _cached = detect_gpu()
    return _cached
```

**Tests:** Mock `nvidia-smi` output, test fallback path, test caching.

---

### P0.2 — Model Manager (VRAM-Aware)

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/llm/model_manager.py`

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/llm/router.py` — integrate ModelManager
- `packages/intelligence/src/routeai_intelligence/llm/__init__.py` — export new classes

**What it does:**
- Define `GPUProfile` dataclass mapping VRAM ranges to model assignments
- Define `TASK_TIER_MAP` mapping every task type to a tier (T1/T2/T3)
- `ModelManager.select_model(task_type)` returns the best model for the current GPU
- `ModelManager.needs_swap(target_model)` checks if Ollama needs to swap models
- Integrate with existing `LLMRouter` — router calls `ModelManager.select_model()` before choosing provider

**GPU Profiles (from architecture doc):**

| VRAM (GB) | T3 Resident | T2 Swap | T1 Strategy | max_context |
|-----------|-------------|---------|-------------|-------------|
| 6 | phi3.5:3.8b | qwen2.5:7b | Decompose + 7B | 2048 |
| 8 | phi3.5:3.8b | qwen2.5:7b | Decompose + 7B | 4096 |
| 10 | qwen2.5:7b | qwen2.5-coder:14b | Decompose + 14B | 4096 |
| 12 | qwen2.5:7b | qwen2.5-coder:14b | Decompose + 14B | 4096 |
| 16 | qwen2.5:7b | qwen2.5-coder:14b | Decompose + 14B | 8192 |
| 24 | qwen2.5:7b | qwen2.5:32b | 32B handles T1 | 8192 |

**Task-to-Tier Map (all 27 agents):**

```python
TASK_TIER_MAP = {
    # T1 — Heavy reasoning (decomposed into sub-tasks locally)
    "design_review": "T1",
    "schematic_review": "T1",
    "return_path_analysis": "T1",
    "semantic_erc": "T1",
    "routing_critic": "T1",
    "cross_datasheet": "T1",
    "power_budget": "T1",
    # T2 — Structured JSON/DSL output
    "constraint_generation": "T2",
    "placement_strategy": "T2",
    "routing_director": "T2",
    "intent_aware_router": "T2",
    "stackup_advisor": "T2",
    "bga_fanout": "T2",
    "circuit_synthesizer": "T2",
    "pdn_designer": "T2",
    "thermal_analyzer": "T2",
    "fabrication_advisor": "T2",
    "routing_style_learner": "T2",
    # T3 — Fast validation and chat
    "schema_validation": "T3",
    "citation_check": "T3",
    "explain_placement": "T3",
    "component_search": "T3",
    "chat": "T3",
    "signal_flow_floorplan": "T3",
    "routing_style_applier": "T3",
    "circuit_suggester": "T3",
}
```

**Integration with LLMRouter:**

Modify `router.py` to accept `task_type` parameter:
```python
# Current signature
async def generate(self, messages, system, tools, temperature, max_tokens) -> LLMResponse

# New signature
async def generate(self, messages, system, tools, temperature, max_tokens, task_type="chat") -> LLMResponse
```

The router uses `ModelManager` to pick the right Ollama model for the task, then calls
`OllamaProvider` with the selected model override. If swap is needed, the router handles
the model loading wait internally.

**Tests:** Test model selection for each GPU profile. Test tier assignment for all task types. Test swap detection logic.

---

### P0.3 — Ollama Model Swap Manager

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/llm/ollama_provider.py`

**What it does:**
- Add `async swap_model(new_model: str)` method to `OllamaProvider`
- Before generating, check if the requested model is loaded
- If not loaded, call Ollama `/api/generate` with `keep_alive: "10m"` to preload
- Track `current_loaded_model` to avoid unnecessary swaps
- Add `OLLAMA_KEEP_ALIVE` config (default 10m) for model unload timeout

**Implementation in OllamaProvider:**

```python
async def ensure_model_loaded(self, model: str) -> float:
    """Load model into VRAM if not already loaded. Returns swap time in seconds."""
    if model == self._current_model:
        return 0.0

    start = time.monotonic()
    # Send a minimal generate request to force model load
    async with aiohttp.ClientSession() as session:
        await session.post(
            f"{self._host}/api/generate",
            json={"model": model, "prompt": "", "keep_alive": "10m"},
            timeout=aiohttp.ClientTimeout(total=120),
        )
    elapsed = time.monotonic() - start
    self._current_model = model
    return elapsed
```

**Tests:** Test model preload, test swap tracking, test timeout handling.

---

### P0.4 — ReAct State Management

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/react_state.py`

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/agent/core.py` — integrate ReActState into `_execute_react_loop()`

**What it does:**
- `ReActState` dataclass with tool call cache, progress tracking, circuit breaker
- Tool call deduplication: hash(tool_name + sorted params) → cached result
- Progress guard: 3 consecutive iterations with zero new findings → force FINAL_ANSWER
- State injection: at each iteration, inject cached results and progress summary into system prompt

```python
# react_state.py
@dataclass
class ReActState:
    iteration: int = 0
    max_iterations: int = 15

    # Tool dedup
    tool_call_log: list[ToolCall] = field(default_factory=list)
    tool_result_cache: dict[str, str] = field(default_factory=dict)

    # Progress
    findings_count: int = 0
    consecutive_no_progress: int = 0
    MAX_NO_PROGRESS: int = 3

    def call_hash(self, tool: str, params: dict) -> str:
        return hashlib.md5(f"{tool}:{json.dumps(params, sort_keys=True)}".encode()).hexdigest()

    def is_duplicate(self, tool: str, params: dict) -> bool:
        return self.call_hash(tool, params) in self.tool_result_cache

    def register_call(self, tool: str, params: dict, result: str) -> str | None:
        h = self.call_hash(tool, params)
        if h in self.tool_result_cache:
            return f"CACHED: {self.tool_result_cache[h][:300]}"
        self.tool_result_cache[h] = result
        self.tool_call_log.append(ToolCall(tool=tool, params=params))
        return None

    def update_progress(self, new_findings: int) -> str | None:
        if new_findings == 0:
            self.consecutive_no_progress += 1
        else:
            self.consecutive_no_progress = 0
            self.findings_count += new_findings
        if self.consecutive_no_progress >= self.MAX_NO_PROGRESS:
            return "STOP: 3 iterations without progress. Synthesize your findings now."
        return None

    def build_state_prompt(self) -> str:
        lines = [f"Iteration {self.iteration}/{self.max_iterations} | Findings: {self.findings_count}"]
        if self.tool_result_cache:
            lines.append("CACHED RESULTS (do NOT re-call these):")
            for h, result in list(self.tool_result_cache.items())[:10]:
                lines.append(f"  - {result[:120]}")
        lines.append("RULE: If you have no new questions to investigate, emit FINAL_ANSWER.")
        return "\n".join(lines)
```

**Integration with core.py `_execute_react_loop()`:**

1. Create `ReActState` at loop start
2. Before each tool call: check `state.is_duplicate()` → if yes, return cached result without calling
3. After tool execution: `state.register_call(tool, params, result)`
4. After each iteration: check `state.update_progress(new_findings)` → if STOP, break loop
5. At each LLM call: append `state.build_state_prompt()` to the system message

**Tests:** Test dedup hashing, test circuit breaker triggers after 3 stale iterations, test state prompt generation.

---

### P0.5 — Gate 2 Physics Boundary Checks

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/validation/confidence.py`

**What it does:**

Add deterministic physics checks to the existing `ConfidenceChecker`. These checks run
**before** the LLM confidence score is considered and can reject results with zero LLM cost.

```python
# Add to confidence.py

PHYSICS_BOUNDARIES = {
    "impedance_ohm": (20.0, 150.0),          # PCB trace impedance range
    "crosstalk_db": (-80.0, 0.0),             # Always negative
    "voltage_drop_mv": (0.0, None),           # Can't be negative
    "junction_temp_c": (-40.0, 200.0),        # Standard package range
    "trace_width_mm": (0.05, 10.0),           # Physical limits
    "clearance_mm": (0.05, 50.0),             # Physical limits
    "via_drill_mm": (0.1, 6.35),              # Standard PCB drills
    "current_capacity_a": (0.0, 100.0),       # Practical PCB limits
    "dielectric_constant": (1.0, 15.0),       # Material range (air to ceramic)
    "copper_thickness_mm": (0.005, 0.210),     # 0.25oz to 6oz copper
}

def physics_check(result: dict) -> tuple[float, list[str]]:
    """Check if LLM output contains physically impossible values. Returns (score, violations)."""
    score = 1.0
    violations = []

    for key, (lo, hi) in PHYSICS_BOUNDARIES.items():
        value = _deep_get(result, key)
        if value is None:
            continue
        if not isinstance(value, (int, float)):
            continue
        if lo is not None and value < lo:
            violations.append(f"{key}={value} below minimum {lo}")
            score -= 0.3
        if hi is not None and value > hi:
            violations.append(f"{key}={value} above maximum {hi}")
            score -= 0.3

    # Crosstalk sign check
    xtalk = _deep_get(result, "crosstalk_db")
    if isinstance(xtalk, (int, float)) and xtalk > 0:
        violations.append(f"crosstalk_db={xtalk} must be negative")
        score -= 0.5

    # Voltage drop vs supply check
    vdrop = _deep_get(result, "voltage_drop_mv")
    vsupply = _deep_get(result, "supply_voltage_mv")
    if isinstance(vdrop, (int, float)) and isinstance(vsupply, (int, float)):
        if vdrop > vsupply * 0.1:
            violations.append(f"voltage_drop {vdrop}mV exceeds 10% of supply {vsupply}mV")
            score -= 0.3

    return (max(0.0, score), violations)

def _deep_get(d: dict, key: str) -> Any:
    """Search for key recursively in nested dict."""
    if key in d:
        return d[key]
    for v in d.values():
        if isinstance(v, dict):
            result = _deep_get(v, key)
            if result is not None:
                return result
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    result = _deep_get(item, key)
                    if result is not None:
                        return result
    return None
```

**Integration with existing `ConfidenceChecker.check()`:**

Add physics check as first step before LLM confidence evaluation:
```python
def check(self, suggestions: list[dict]) -> list[dict]:
    flagged = []
    for item in suggestions:
        # NEW: Physics boundary check first (zero LLM cost)
        physics_score, physics_violations = physics_check(item)
        if physics_score < 0.5:
            flagged.append({**item, "action": "reject", "reason": f"Physics violation: {'; '.join(physics_violations)}"})
            continue

        # EXISTING: LLM confidence check
        confidence = item.get("confidence", 1.0)
        # ... existing logic
```

**Local Escalation Policy (new):**

```python
class LocalEscalationPolicy:
    THRESHOLDS = {
        "si_pi_analysis": 0.75,
        "thermal_analysis": 0.70,
        "design_review": 0.65,
        "constraint_gen": 0.60,
        "placement_intent": 0.55,
        "general_chat": 0.40,
    }

    def should_retry(self, task_type: str, physics_score: float, confidence: float) -> str:
        threshold = self.THRESHOLDS.get(task_type, 0.60)
        composite = 0.5 * physics_score + 0.5 * confidence
        if composite >= threshold:
            return "pass"
        if composite >= threshold - 0.15:
            return "retry_bigger_model"    # Swap to T2 and retry
        if composite >= threshold - 0.30:
            return "decompose"             # Break into sub-tasks
        return "human_review"              # Flag for engineer
```

**Tests:** Test each physics boundary. Test deep_get on nested dicts. Test escalation policy thresholds.

---

## Phase 1: Intelligence Core (Weeks 4-8)

**Goal:** Wire up model tier routing end-to-end and implement T1 task decomposition.

---

### P1.1 — Task Type Propagation Through the Stack

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/agent/core.py`
- `packages/intelligence/src/routeai_intelligence/llm/router.py`
- `packages/intelligence/src/routeai_intelligence/llm/ollama_provider.py`

**What it does:**

Every public method on `RouteAIAgent` already maps to a task type. Pass it down:

```python
# core.py
async def analyze_design(self, board, schematic) -> DesignReview:
    # ... existing code ...
    response = await self._llm.generate(
        messages=messages,
        system=system_prompt,
        tools=get_tool_schemas(),
        task_type="design_review",   # NEW: passed to router
    )

async def generate_constraints(self, schematic, components, board_params) -> ConstraintSet:
    response = await self._llm.generate(
        ...,
        task_type="constraint_generation",
    )

async def chat(self, message, context) -> ChatResponse:
    response = await self._llm.generate(
        ...,
        task_type="chat",
    )

async def generate_routing_strategy(self, board, constraints, schematic) -> dict:
    response = await self._llm.generate(
        ...,
        task_type="routing_director",
    )
```

**Router picks model based on task_type:**
```python
# router.py
async def generate(self, ..., task_type: str = "chat") -> LLMResponse:
    model = self._model_manager.select_model(task_type)
    provider = self._get_provider_for_model(model)
    if isinstance(provider, OllamaProvider):
        await provider.ensure_model_loaded(model)
    return await provider.generate(messages, system, tools, temperature, max_tokens, model_override=model)
```

**OllamaProvider accepts model override:**
```python
# ollama_provider.py
async def generate(self, ..., model_override: str | None = None) -> LLMResponse:
    model = model_override or self._model
    # ... existing code uses `model` instead of `self._model`
```

**Tests:** Integration test: T3 task uses 7B, T2 task uses 14B, verify model names in requests.

---

### P1.2 — T1 Task Decomposition Framework

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/decomposer.py`

**What it does:**

T1 tasks (design review, schematic review, etc.) are too complex for a 14B model in one shot.
The decomposer breaks them into a sequence of T2/T3 sub-tasks that the local model handles well.

```python
# decomposer.py

DECOMPOSITION_TEMPLATES = {
    "design_review": [
        {"task": "List all high-speed nets and their impedance requirements", "tier": "T2", "tool": "impedance_calc"},
        {"task": "For each power net, check trace width vs current requirement", "tier": "T2", "tool": "current_capacity"},
        {"task": "Identify components with thermal dissipation > 0.5W", "tier": "T2", "tool": None},
        {"task": "Check decoupling cap placement (distance to IC < 2mm)", "tier": "T2", "tool": None},
        {"task": "Run DRC and list violations by severity", "tier": "T2", "tool": "drc_check"},
        {"task": "Synthesize all findings into categorized report", "tier": "T2", "tool": None},
    ],
    "schematic_review": [
        {"task": "List all ICs and verify bypass cap presence", "tier": "T2", "tool": None},
        {"task": "Check power pin connections and voltage levels", "tier": "T2", "tool": None},
        {"task": "Verify ESD/TVS protection on external interfaces", "tier": "T2", "tool": None},
        {"task": "Check pull-up/pull-down resistor values on I2C/SPI", "tier": "T2", "tool": None},
        {"task": "Analyze power budget by operating mode", "tier": "T2", "tool": None},
        {"task": "Synthesize findings into review report", "tier": "T2", "tool": None},
    ],
    "return_path_analysis": [
        {"task": "Identify all signals that cross layer boundaries", "tier": "T2", "tool": None},
        {"task": "For each layer transition, check reference plane continuity", "tier": "T2", "tool": None},
        {"task": "List stitching via locations near signal vias", "tier": "T2", "tool": None},
        {"task": "Synthesize return path findings", "tier": "T2", "tool": None},
    ],
    "semantic_erc": [
        {"task": "List all nets by electrical type (power, signal, ground)", "tier": "T2", "tool": None},
        {"task": "Check power net connections match expected voltage levels", "tier": "T2", "tool": None},
        {"task": "Verify bidirectional pin directions are consistent", "tier": "T2", "tool": None},
        {"task": "Check for floating inputs and unconnected outputs", "tier": "T2", "tool": None},
        {"task": "Synthesize ERC findings", "tier": "T2", "tool": None},
    ],
}

class TaskDecomposer:
    def __init__(self, agent: "RouteAIAgent"):
        self._agent = agent

    async def execute_decomposed(self, task_type: str, context: dict) -> dict:
        template = DECOMPOSITION_TEMPLATES.get(task_type)
        if not template:
            raise ValueError(f"No decomposition template for {task_type}")

        all_findings = []
        for step in template:
            prompt = self._build_step_prompt(step, context, all_findings)
            response = await self._agent._llm.generate(
                messages=[{"role": "user", "content": prompt}],
                system=self._build_step_system(step),
                tools=get_tool_schemas() if step["tool"] else [],
                task_type=step["tier"].lower() + "_task",
            )
            findings = self._extract_findings(response)
            all_findings.extend(findings)

        return {"findings": all_findings, "decomposed": True, "steps": len(template)}
```

**Integration with core.py:**

```python
async def analyze_design(self, board, schematic) -> DesignReview:
    if self._model_manager.is_t1_decomposed():
        # GPU can't handle T1 directly — decompose
        decomposer = TaskDecomposer(self)
        result = await decomposer.execute_decomposed(
            "design_review",
            {"board": board, "schematic": schematic},
        )
        return self._build_review_from_decomposed(result)
    else:
        # Large GPU (24GB+) — run T1 directly
        return await self._run_monolithic_review(board, schematic)
```

**Tests:** Test decomposition template for design_review produces correct sub-task sequence. Test synthesis step aggregates findings.

---

### P1.3 — Ollama Configuration Endpoint

**Files to modify:**
- `packages/api/handlers/health.go`

**What it does:**

Add `/api/ollama/config` endpoint that the frontend can call to:
1. Get current GPU info (name, VRAM)
2. Get recommended models for each tier
3. Get currently loaded model
4. Allow user to override model preferences

```go
// handlers/health.go — add new handler

func OllamaConfig(c *gin.Context) {
    // Call ML service for GPU info
    resp, err := http.Get(mlServiceURL + "/ml/gpu-info")
    if err != nil {
        c.JSON(200, gin.H{
            "gpu": gin.H{"name": "Unknown", "vram_mb": 8192},
            "models": gin.H{
                "t3_resident": "qwen2.5:7b",
                "t2_swap": "qwen2.5-coder:14b",
                "t1_strategy": "decompose",
            },
        })
        return
    }
    // Forward GPU info from ML service
    // ...
}
```

**New ML service endpoint:**

```python
# packages/intelligence/src/routeai_intelligence/ml_service.py — add endpoint

@app.get("/ml/gpu-info")
async def gpu_info():
    gpu = get_gpu_info()
    manager = ModelManager(gpu.vram_total_mb // 1024)
    return {
        "gpu": {"name": gpu.name, "vram_total_mb": gpu.vram_total_mb, "vram_free_mb": gpu.vram_free_mb},
        "profile": {
            "resident_model": manager.profile.resident_model,
            "swap_model": manager.profile.swap_model,
            "max_context": manager.profile.max_context,
            "max_parallel": manager.profile.max_parallel,
        },
        "tiers": {
            "t3": manager.profile.resident_model,
            "t2": manager.profile.swap_model or manager.profile.resident_model,
            "t1_strategy": "direct" if manager.profile.vram_gb >= 24 else "decompose",
        },
    }
```

**Tests:** Test endpoint returns valid GPU profile. Test fallback when nvidia-smi unavailable.

---

## Phase 2: Intent DSL & Solver Bridge (Weeks 9-14)

**Goal:** Create the formal contract between LLM agents and C++ solvers.

---

### P2.1 — Placement Intent DSL (Pydantic Models)

**Files to create:**
- `packages/core/src/routeai_core/models/intent.py`

**What it does:**

Define Pydantic v2 models for the Placement Intent and Routing Intent DSLs.
These are the **contracts** between the intelligence layer and the solver layer.

```python
# intent.py — Placement Intent models

from pydantic import BaseModel, Field, field_validator
from typing import Literal

class ClusteringIntent(BaseModel):
    strategy: Literal["minimize_loop_area", "minimize_trace_length", "thermal_spread", "functional_group"]
    anchor_component: str
    max_spread_mm: float = Field(ge=1.0, le=500.0)
    orientation_preference: str | None = None

class ThermalIntent(BaseModel):
    max_junction_temp_c: float = Field(ge=-40, le=200)
    keepout_radius_mm: float = Field(ge=0, le=50)
    requires_thermal_vias: bool = False
    copper_pour_layers: list[str] = []
    airflow_direction: Literal["left_to_right", "right_to_left", "bottom_to_top", "top_to_bottom"] | None = None

class PowerPlaneIntent(BaseModel):
    voltage_rail: str
    target_voltage_drop_mv: float = Field(ge=0, le=500)
    min_copper_area_mm2: float = Field(ge=0)

class PlacementZone(BaseModel):
    zone_id: str
    zone_type: Literal["functional_group", "power_stage", "high_speed", "analog", "digital", "rf", "connector"]
    components: list[str] = Field(min_length=1)
    clustering: ClusteringIntent | None = None
    thermal: ThermalIntent | None = None
    power_plane: PowerPlaneIntent | None = None

class CriticalPair(BaseModel):
    pair: tuple[str, str]
    constraint: Literal["minimize_distance", "decoupling", "differential", "thermal_separation"]
    max_distance_mm: float = Field(ge=0, le=500)
    reason: str

class KeepoutIntent(BaseModel):
    type: Literal["thermal", "mechanical", "electrical", "rf"]
    source_component: str | None = None
    radius_mm: float = Field(ge=0, le=100)
    excluded_components: list[str] = []
    reason: str

class GroundPlaneIntent(BaseModel):
    layer: str
    type: Literal["solid_pour", "hatched", "split_plane"]
    net: str
    split_allowed: bool = True
    reason: str

class PlacementIntent(BaseModel):
    """The complete placement intent emitted by the LLM for the C++ solver."""
    schema_version: str = "routeai/placement-intent/v1"
    board_id: str
    zones: list[PlacementZone] = []
    critical_pairs: list[CriticalPair] = []
    keepouts: list[KeepoutIntent] = []
    ground_planes: list[GroundPlaneIntent] = []
```

**Tests:** Test Pydantic validation — invalid impedance_ohm=-5 raises, valid intent serializes to JSON.

---

### P2.2 — Routing Intent DSL (Pydantic Models)

**Files to modify:**
- `packages/core/src/routeai_core/models/intent.py` (append to same file)

```python
# intent.py — Routing Intent models (continued)

class ImpedanceTarget(BaseModel):
    type: Literal["single_ended", "differential"]
    target_ohm: float = Field(ge=20, le=150)
    tolerance_percent: float = Field(ge=1, le=30, default=10)
    coupling_gap_mm: float | None = None  # for differential only

class LengthMatchingIntent(BaseModel):
    group: str
    max_skew_mm: float = Field(ge=0, le=50)
    reference_net: str | None = None

class ViaStrategyIntent(BaseModel):
    type: Literal["through", "blind_microvia", "buried", "any"]
    max_vias_per_net: int = Field(ge=0, le=50, default=10)
    via_size_mm: float = Field(ge=0.1, le=1.0, default=0.3)

class DiffPairIntent(BaseModel):
    max_intra_pair_skew_mm: float = Field(ge=0, le=10)
    max_parallel_length_mm: float = Field(ge=0)
    min_spacing_to_other_diff_mm: float = Field(ge=0)

class NetClassIntent(BaseModel):
    name: str
    nets: list[str] = Field(min_length=1)
    impedance: ImpedanceTarget | None = None
    width_mm: float = Field(ge=0.05, le=10.0)
    clearance_mm: float = Field(ge=0.05, le=10.0)
    layer_preference: list[str] = []
    length_matching: LengthMatchingIntent | None = None
    via_strategy: ViaStrategyIntent | None = None
    differential_pair: DiffPairIntent | None = None
    routing_priority: int = Field(ge=1, le=100, default=50)
    max_total_length_mm: float | None = None

class RoutingOrderEntry(BaseModel):
    priority: int = Field(ge=1, le=100)
    net_class: str
    reason: str

class LayerTransitionIntent(BaseModel):
    max_layer_changes_per_net: int = Field(ge=0, le=20, default=4)
    preferred_via_layers: list[tuple[str, str]] = []

class LayerAssignmentIntent(BaseModel):
    signal_layers: list[str]
    reference_planes: dict[str, str] = {}  # signal_layer -> reference_plane
    layer_transitions: LayerTransitionIntent | None = None

class CostWeights(BaseModel):
    via_cost: float = Field(ge=0, le=100, default=10.0)
    layer_change_cost: float = Field(ge=0, le=100, default=8.0)
    length_cost: float = Field(ge=0, le=100, default=1.0)
    congestion_cost: float = Field(ge=0, le=100, default=5.0)
    reference_plane_violation_cost: float = Field(ge=0, le=1000, default=100.0)

class VoltageDropTarget(BaseModel):
    net: str
    source_component: str
    sink_components: list[str]
    max_drop_mv: float = Field(ge=0, le=1000)
    max_current_a: float = Field(ge=0, le=100)
    min_trace_width_mm: float = Field(ge=0.05, le=10.0)

class RoutingIntent(BaseModel):
    """The complete routing intent emitted by the LLM for the C++ solver."""
    schema_version: str = "routeai/routing-intent/v1"
    board_id: str
    net_classes: list[NetClassIntent] = []
    routing_order: list[RoutingOrderEntry] = []
    layer_assignment: LayerAssignmentIntent | None = None
    cost_weights: CostWeights = CostWeights()
    voltage_drop_targets: list[VoltageDropTarget] = []
```

**Tests:** Test impedance target validation (20-150 range), test full RoutingIntent serialization round-trip.

---

### P2.3 — Intent DSL JSON Schemas (for Gate 1 Validation)

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/schemas/placement_intent_schema.json`
- `packages/intelligence/src/routeai_intelligence/agent/schemas/routing_intent_schema.json`

**What it does:**

Auto-generate JSON schemas from the Pydantic models for Gate 1 validation:

```python
# One-time script or in __init__.py
from routeai_core.models.intent import PlacementIntent, RoutingIntent
import json

placement_schema = PlacementIntent.model_json_schema()
routing_schema = RoutingIntent.model_json_schema()

# Write to schema files
with open("schemas/placement_intent_schema.json", "w") as f:
    json.dump(placement_schema, f, indent=2)
```

Modify `SchemaValidator` to recognize new schema names: `"placement_intent"`, `"routing_intent"`.

**Tests:** Validate sample DSL JSON against generated schemas.

---

### P2.4 — Placement Strategy Agent (Intent DSL Output)

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/placement/strategy.py` (or create if stub)

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/prompts/placement_intent.py`

**What it does:**

Update the Placement Strategy agent to emit `PlacementIntent` DSL instead of free-text.

**System prompt for placement (placement_intent.py):**

```python
PLACEMENT_INTENT_PROMPT = """You are a PCB placement strategy generator.

Given the board design and schematic, generate a PlacementIntent JSON that the C++ solver
will use to compute optimal component positions.

RULES:
- Never output coordinates. Only component references, zone types, and constraints.
- Every constraint must have a 'reason' field citing IPC standards or physics.
- Thermal keepouts are mandatory for any component dissipating > 0.5W.
- Decoupling caps must be paired with their IC (max_distance_mm <= 2.0).
- Differential pairs must be in the same zone.

OUTPUT FORMAT: A single JSON object matching PlacementIntent schema.
{schema}
"""
```

**Agent method:**
```python
async def generate_placement_intent(self, board, schematic) -> PlacementIntent:
    schema_json = PlacementIntent.model_json_schema()
    response = await self._llm.generate_json(
        messages=[{"role": "user", "content": self._build_placement_context(board, schematic)}],
        system=PLACEMENT_INTENT_PROMPT.format(schema=json.dumps(schema_json, indent=2)),
        schema=schema_json,
        task_type="placement_strategy",
    )
    intent = PlacementIntent.model_validate(response)
    return intent
```

**Tests:** Mock LLM output with valid placement JSON, verify Pydantic model parses correctly.

---

### P2.5 — Routing Director Agent (Intent DSL Output)

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/agent/routing_director.py`

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/prompts/routing_intent.py`

**What it does:**

Same pattern as P2.4 but for routing. The existing `routing_director.py` already generates
routing strategy — update it to emit `RoutingIntent` DSL.

**Tests:** Mock LLM output, verify RoutingIntent Pydantic validation, verify cost_weights have valid ranges.

---

### P2.6 — Solver Adapter (Intent DSL → C++ Router Parameters)

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/bridge/intent_to_solver.py`

**What it does:**

Translate `RoutingIntent` Pydantic model → protobuf `RoutingRequest` for the C++ router.
Translate `PlacementIntent` → parameters for the placement solver.

```python
# intent_to_solver.py

def routing_intent_to_proto(intent: RoutingIntent, board: BoardDesign) -> RoutingRequest:
    """Convert RoutingIntent DSL to protobuf RoutingRequest for C++ router."""
    request = RoutingRequest()

    # Set board state from core model
    request.board.CopyFrom(board_to_proto(board))

    # Apply cost weights
    # The C++ router reads these from the request
    request.strategy = _map_strategy(intent)
    request.max_iterations = 50

    # Apply net constraints from intent
    for nc in intent.net_classes:
        for net_name in nc.nets:
            constraint = request.constraints.add()
            constraint.net_name = net_name
            if nc.impedance:
                constraint.target_impedance = nc.impedance.target_ohm
            if nc.length_matching:
                constraint.length_match_group = nc.length_matching.group
                constraint.max_skew = nc.length_matching.max_skew_mm
            if nc.via_strategy:
                constraint.max_vias = nc.via_strategy.max_vias_per_net
            constraint.min_clearance = nc.clearance_mm
            constraint.max_length = nc.max_total_length_mm or 0

    return request
```

**Tests:** Convert sample RoutingIntent to proto, verify constraint propagation.

---

## Phase 3: Frontend Integration (Weeks 15-18)

**Goal:** Wire the new intelligence features into the React frontend.

---

### P3.1 — GPU Status Panel

**Files to modify:**
- `app/src/components/AIPanel.tsx`

**What it does:**

Add a GPU status indicator in the AI panel showing:
- GPU name and VRAM
- Currently loaded model and tier
- Swap status (loading indicator during model swap)

**Frontend calls:** `GET /api/ollama/config` → displays GPU profile.

---

### P3.2 — Model Tier Indicator

**Files to modify:**
- `app/src/hooks/useOllama.ts`

**What it does:**

Update the Ollama hook to be tier-aware:
- `useOllama()` now accepts `taskType` parameter
- The hook calls `/api/ollama/config` to get the model for that tier
- Shows which model is being used in the UI: "Using qwen2.5:7b (fast)" vs "Loading qwen2.5-coder:14b..."
- During model swap (~4s), show a spinner with "Switching to analysis model..."

---

### P3.3 — Streaming Progress for T1 Decomposed Tasks

**Files to modify:**
- `app/src/components/AIDesignReview.tsx`
- `packages/api/handlers/workflow.go`

**What it does:**

T1 decomposed tasks run 4-6 sub-steps. Show progress:
- "Step 1/6: Analyzing high-speed nets..."
- "Step 2/6: Checking current capacity..."
- Progress bar updates via WebSocket

**Backend:** Modify `workflow.go` to stream progress events per sub-task.
**Frontend:** Update `AIDesignReview` to show step-by-step progress.

---

### P3.4 — Intent DSL Preview Panel

**Files to create:**
- `app/src/components/IntentPreview.tsx`

**What it does:**

Before the solver runs, show the user the PlacementIntent or RoutingIntent DSL in a readable
format (not raw JSON). Let them review and approve/edit before solver execution.

**UI:**
- Collapsible sections: Zones, Critical Pairs, Keepouts, Net Classes, Routing Order
- Each item shows component names, constraint values, and reason
- "Approve & Run Solver" button
- "Edit" opens JSON editor for advanced users

---

### P3.5 — Update Frontend Ollama Model Preferences

**Files to modify:**
- `app/src/hooks/useOllama.ts`

**What it does:**

Current hook has hardcoded model preference list. Update to use the model manager's recommendations:

```typescript
// Current (hardcoded)
const MODEL_PREFERENCE = ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', ...];

// New (dynamic from backend)
const getModelForTask = async (taskType: string): Promise<string> => {
    const config = await fetch('/api/ollama/config').then(r => r.json());
    return config.tiers[taskType] || config.tiers.t3;
};
```

---

## Phase 4: Advanced Agents (Weeks 19-24)

**Goal:** Implement remaining specialized agents from the 27-agent roster.

---

### P4.1 — Routing Critic Agent

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/routing_critic.py`

**What it does:**

Runs **after** the C++ solver produces routed traces. Analyzes the actual result (not intent).

Checks:
- Impedance violations (trace width vs. target)
- Via count vs. budget
- Length matching compliance
- Reference plane violations (signal crossing split plane)
- Congestion hotspots

Emits: List of findings with severity, location (net + layer), and recommendation.

---

### P4.2 — Conflict Resolution System

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/conflict_resolver.py`

**What it does:**

Compares PlacementIntent and RoutingIntent for contradictions:
- Thermal keepout zone overlaps with "minimize_distance" critical pair
- Power trace width requirement blocks signal routing corridor
- Layer assignment conflicts between agents

Uses the `DOMAIN_PRIORITY` table from the architecture doc to auto-resolve or escalate to Routing Critic.

---

### P4.3 — Routing Style Learner

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/style_learner.py`
- `packages/intelligence/src/routeai_intelligence/agent/style_profile.py`

**What it does:**

Extracts `RoutingStyleProfile` from existing `.kicad_pcb` files:
1. Parse board via `packages/parsers`
2. Extract statistical features (trace width histogram, via density, angle preferences, etc.)
3. Generate semantic summary via T3 model (one-time, ~500 tokens)
4. Store profile + embedding in pgvector

---

### P4.4 — Remaining Schematic Agents

**Files to create/update:**
- `packages/intelligence/src/routeai_intelligence/agent/schematic_reviewer.py` (exists, enhance)
- `packages/intelligence/src/routeai_intelligence/agent/power_budget.py`
- `packages/intelligence/src/routeai_intelligence/agent/semantic_erc.py`

**What they do:**
- **Schematic Reviewer:** Enhanced with decomposition for deep review
- **Power Budget Analyzer:** Analyzes power tree by operating mode (active, sleep, shutdown)
- **Semantic ERC:** Function-based electrical rule check beyond connectivity

All use T2 model with tool calls to solvers.

---

### P4.5 — Fabrication & Thermal Agents

**Files to create:**
- `packages/intelligence/src/routeai_intelligence/agent/thermal_advisor.py`
- `packages/intelligence/src/routeai_intelligence/agent/fabrication_advisor.py`

**What they do:**
- **Thermal Advisor:** Calls `thermal.py` solver, interprets results, recommends copper pours and thermal vias
- **Fabrication Advisor:** Analyzes DFM violations, recommends process changes

---

## Phase 5: Polish & Production (Weeks 25-30)

**Goal:** Harden everything for real-world use.

---

### P5.1 — End-to-End Integration Tests

**Files to create:**
- `tests/integration/test_full_pipeline.py`

**Tests:**
1. Upload `.kicad_pcb` → parse → generate PlacementIntent → validate DSL → run solver → route → critique
2. Full design review with decomposed T1 on 12GB profile
3. Model swap under load (T3 → T2 → T3)
4. ReAct loop with circuit breaker (ensure no more than 15 iterations)
5. Gate 2 physics check rejects impossible values

---

### P5.2 — Performance Benchmarks

**Files to create:**
- `scripts/benchmark_inference.py`

**Benchmarks:**
- T3 (7B) latency: first token, full response for chat
- T2 (14B) latency: first token, full DSL generation
- Model swap time: 7B → 14B → 7B
- ReAct loop completion time for design review (with/without dedup)
- Memory usage during inference (VRAM + RAM)

Target:
- T3 chat: < 500ms first token
- T2 DSL generation: < 5s for constraint set
- Model swap: < 5s on RTX 4070
- Design review (decomposed): < 60s total

---

### P5.3 — Ollama Auto-Setup

**Files to create:**
- `scripts/setup_ollama.sh`

**What it does:**

First-run script that:
1. Detects GPU and VRAM
2. Recommends and pulls the right models via `ollama pull`
3. Sets optimal `OLLAMA_*` environment variables
4. Runs a quick inference test to verify everything works

```bash
#!/bin/bash
VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null)
VRAM_GB=$((VRAM / 1024))

echo "Detected GPU VRAM: ${VRAM_GB}GB"

if [ "$VRAM_GB" -ge 24 ]; then
    echo "Pulling models for 24GB+ GPU..."
    ollama pull qwen2.5:7b
    ollama pull qwen2.5:32b
elif [ "$VRAM_GB" -ge 10 ]; then
    echo "Pulling models for 10-16GB GPU..."
    ollama pull qwen2.5:7b
    ollama pull qwen2.5-coder:14b
elif [ "$VRAM_GB" -ge 8 ]; then
    echo "Pulling models for 8GB GPU..."
    ollama pull phi3.5:3.8b
    ollama pull qwen2.5:7b
else
    echo "Pulling minimal model for <8GB GPU..."
    ollama pull phi3.5:3.8b
fi

echo "Testing inference..."
ollama run qwen2.5:7b "Say OK" --format json
echo "Setup complete."
```

---

### P5.4 — Documentation

**Files to update:**
- `README.md` — Add GPU requirements section, model recommendations
- `docs/ARCHITECTURE_GPU_OPTIMIZATION.md` — Keep in sync with implementation

**New sections in README:**
- GPU Requirements table
- `scripts/setup_ollama.sh` usage
- Performance expectations by GPU tier

---

### P5.5 — Remove Cloud Provider References

**Files to modify:**
- `packages/intelligence/src/routeai_intelligence/llm/router.py` — remove Anthropic/Gemini fallback
- `packages/intelligence/src/routeai_intelligence/llm/anthropic_provider.py` — keep file but don't auto-detect
- `packages/intelligence/src/routeai_intelligence/llm/gemini_provider.py` — keep file but don't auto-detect

**What it does:**

The router should **only** auto-detect Ollama. Anthropic/Gemini providers remain in the code
(for developers who want to test against cloud APIs) but are **never** part of the automatic
fallback chain. They can only be activated by explicit configuration.

```python
# router.py — modified initialize()
async def initialize(self) -> None:
    # ONLY auto-detect Ollama (local)
    ollama = await self._try_ollama()
    if ollama:
        self.add_provider(ollama, primary=True)
    else:
        raise RuntimeError(
            "Ollama not available. RouteAI requires Ollama for local LLM inference. "
            "Install: curl -fsSL https://ollama.ai/install.sh | sh"
        )
    # Cloud providers NOT auto-detected. Manual only via add_provider().
```

---

## Summary: File Change Map

### New Files (create)

| File | Phase | Purpose |
|------|-------|---------|
| `packages/intelligence/.../llm/gpu_detect.py` | P0.1 | GPU VRAM detection |
| `packages/intelligence/.../llm/model_manager.py` | P0.2 | VRAM-aware model selection |
| `packages/intelligence/.../agent/react_state.py` | P0.4 | ReAct loop state management |
| `packages/core/.../models/intent.py` | P2.1-2.2 | Placement + Routing Intent DSL models |
| `packages/intelligence/.../agent/schemas/placement_intent_schema.json` | P2.3 | Auto-generated JSON schema |
| `packages/intelligence/.../agent/schemas/routing_intent_schema.json` | P2.3 | Auto-generated JSON schema |
| `packages/intelligence/.../agent/prompts/placement_intent.py` | P2.4 | Placement agent prompt |
| `packages/intelligence/.../agent/prompts/routing_intent.py` | P2.5 | Routing agent prompt |
| `packages/intelligence/.../bridge/intent_to_solver.py` | P2.6 | DSL → Protobuf converter |
| `app/src/components/IntentPreview.tsx` | P3.4 | DSL preview UI |
| `packages/intelligence/.../agent/routing_critic.py` | P4.1 | Post-solver critique agent |
| `packages/intelligence/.../agent/conflict_resolver.py` | P4.2 | Multi-agent conflict resolution |
| `packages/intelligence/.../agent/style_learner.py` | P4.3 | Routing style extraction |
| `packages/intelligence/.../agent/style_profile.py` | P4.3 | Style profile dataclass |
| `packages/intelligence/.../agent/power_budget.py` | P4.4 | Power budget analysis |
| `packages/intelligence/.../agent/semantic_erc.py` | P4.4 | Semantic ERC agent |
| `packages/intelligence/.../agent/thermal_advisor.py` | P4.5 | Thermal recommendations |
| `packages/intelligence/.../agent/fabrication_advisor.py` | P4.5 | DFM recommendations |
| `tests/integration/test_full_pipeline.py` | P5.1 | End-to-end tests |
| `scripts/benchmark_inference.py` | P5.2 | Performance benchmarks |
| `scripts/setup_ollama.sh` | P5.3 | First-run GPU setup |

### Modified Files

| File | Phase | Change |
|------|-------|--------|
| `packages/intelligence/.../llm/router.py` | P0.2, P1.1, P5.5 | Add ModelManager, task_type param, remove cloud auto-detect |
| `packages/intelligence/.../llm/ollama_provider.py` | P0.3, P1.1 | Add model swap, model_override param |
| `packages/intelligence/.../llm/__init__.py` | P0.2 | Export new classes |
| `packages/intelligence/.../agent/core.py` | P0.4, P1.1, P1.2 | Integrate ReActState, task_type, decomposer |
| `packages/intelligence/.../validation/confidence.py` | P0.5 | Add physics boundary checks |
| `packages/intelligence/.../validation/schema_validator.py` | P2.3 | Register new DSL schemas |
| `packages/intelligence/.../agent/routing_director.py` | P2.5 | Emit RoutingIntent DSL |
| `packages/intelligence/.../placement/strategy.py` | P2.4 | Emit PlacementIntent DSL |
| `packages/intelligence/.../ml_service.py` | P1.3 | Add /ml/gpu-info endpoint |
| `packages/intelligence/.../agent/schematic_reviewer.py` | P4.4 | Enhanced with decomposition |
| `packages/api/handlers/health.go` | P1.3 | Add /api/ollama/config endpoint |
| `packages/api/handlers/workflow.go` | P3.3 | Stream progress for decomposed tasks |
| `app/src/components/AIPanel.tsx` | P3.1 | GPU status indicator |
| `app/src/components/AIDesignReview.tsx` | P3.3 | Step-by-step progress |
| `app/src/hooks/useOllama.ts` | P3.2, P3.5 | Tier-aware model selection |
| `README.md` | P5.4 | GPU requirements |

---

## Verification Checklist

After each phase, verify:

### Phase 0
- [ ] `nvidia-smi` detected, GPUInfo returned correctly
- [ ] ModelManager selects correct model for each tier on 12GB profile
- [ ] Ollama model swap completes in < 5 seconds
- [ ] ReAct loop deduplicates identical tool calls
- [ ] ReAct loop stops after 3 stale iterations
- [ ] Physics check rejects impedance=500 ohm, crosstalk=+10dB
- [ ] Local escalation retries with bigger model on low confidence

### Phase 1
- [ ] `task_type` propagates from agent method → router → Ollama provider
- [ ] T3 task uses 7B model, T2 task uses 14B model
- [ ] Design review decomposes into 6 sub-tasks on 12GB GPU
- [ ] `/ml/gpu-info` returns correct profile
- [ ] `/api/ollama/config` returns model recommendations

### Phase 2
- [ ] PlacementIntent validates with Pydantic (rejects invalid ranges)
- [ ] RoutingIntent validates with Pydantic (rejects impedance < 20 ohm)
- [ ] Gate 1 validates DSL JSON against auto-generated schema
- [ ] Placement agent emits valid PlacementIntent JSON
- [ ] Routing Director emits valid RoutingIntent JSON
- [ ] `intent_to_solver.py` converts RoutingIntent to protobuf RoutingRequest

### Phase 3
- [ ] GPU status shows in AI panel (name, VRAM, current model)
- [ ] Model swap shows spinner in frontend
- [ ] T1 decomposed tasks show step-by-step progress
- [ ] IntentPreview renders DSL in readable format
- [ ] Frontend uses backend-recommended models (not hardcoded)

### Phase 4
- [ ] Routing Critic analyzes actual solver output (not intent)
- [ ] Conflict resolver detects thermal vs SI placement conflict
- [ ] Style Learner extracts profile from .kicad_pcb
- [ ] All new agents emit structured JSON through 3-Gate pipeline

### Phase 5
- [ ] Full pipeline test passes: upload → parse → intent → solve → route → critique
- [ ] Benchmark: T3 < 500ms first token, T2 DSL < 5s, swap < 5s
- [ ] `setup_ollama.sh` pulls correct models for detected GPU
- [ ] Router raises error if Ollama not available (no silent cloud fallback)
- [ ] README documents GPU requirements
