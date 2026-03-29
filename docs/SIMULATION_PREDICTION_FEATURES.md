# RouteAI: LLM-Powered Simulation, Prediction & What-If Analysis

> How LLMs can democratize SI/PI/thermal/EMI analysis for every PCB engineer
>
> Feature specification for RouteAI Intelligence + Solver integration

---

## Strategic Context

### The Problem

Current simulation tools (HyperLynx $20K/seat, ADS $50K/seat, HFSS $80K+/seat) require:
- Weeks of setup time per project
- Specialist knowledge (IBIS model parsing, port de-embedding, mesh tuning)
- Manual extraction of board geometry into the simulator
- Interpretation of results requires years of experience

**Result**: 85%+ of PCB designs ship without any SI/PI simulation. Engineers rely on rules-of-thumb, copy previous designs, and hope for the best. Problems surface at prototype stage ($10K-50K per respin).

### The RouteAI Advantage

RouteAI already has the foundation:
- **Solver layer**: Hammerstad-Jensen impedance, IPC-2141 crosstalk, IPC-2152 thermal, PDN impedance sweep (all implemented in `packages/solver/`)
- **Intelligence layer**: LLM agent with RAG, confidence scoring, citation checking (in `packages/intelligence/`)
- **Anti-hallucination pipeline**: LLM proposes, deterministic solver validates, engineer approves

The LLM bridges the gap between "engineer describes intent" and "solver produces numbers." The LLM translates natural language into solver parameters, interprets results in context, and explains what to do about problems.

---

## Feature 1: Design Feasibility Predictor ("Will This Work?")

### What It Does

Before running any simulation, the LLM examines the design's netlist, stackup, constraints, and component datasheets to produce a **risk scorecard** with pass/fail predictions for SI, PI, thermal, and EMI. Think of it as a 10-second triage that tells you "your DDR4 bus is high risk, your SPI bus is fine, your 12V rail needs attention."

### Why Current Tools Fail

No existing tool does this. Every simulator requires full setup before producing any output. An engineer must already know which nets to worry about -- but if they knew that, they would not need the tool. The result is that engineers either simulate everything (expensive, slow) or nothing (risky).

### How LLM + Solver Enables It

1. **LLM classifies every net** by interface type (DDR4, USB3, SPI, I2C, power, GPIO) using component references, pin names, and net names from the parsed schematic.
2. **LLM retrieves interface specs** from RAG: DDR4 at 3200MT/s needs 40-ohm single-ended, 80-ohm differential, +-50ps skew within byte lane, Vref accuracy +-0.5%.
3. **Solver runs lightweight checks**: impedance from stackup + trace width, propagation delay from trace length, crosstalk estimate from routing density.
4. **LLM synthesizes a risk score** per interface, citing specific violations.

### Example Scenario

Engineer uploads a 6-layer KiCad design with an STM32H7 + DDR3L at 1600MT/s + USB 2.0 + QSPI flash + 3.3V/1.8V/1.2V rails.

Output:
```
DESIGN FEASIBILITY REPORT
=========================
DDR3L (1600MT/s): HIGH RISK
  - Trace width 0.15mm on L1 (microstrip, h=0.11mm, Er=4.3) gives Z0=62 ohm
    Target: 50 ohm +/-10% per JEDEC JESD79-3F
  - DQS-to-DQ skew budget: 50ps. Max trace length delta in byte lane 0: 12mm
    = ~70ps at Er_eff=3.2. EXCEEDS BUDGET.
  - No length matching constraints defined for address bus.
  Action: Widen DDR traces to 0.2mm, add length matching.

USB 2.0 (480Mbps): PASS
  - Diff pair Z=88 ohm (target 90 +/-10%). Within spec.
  - Pair length: 42mm, skew: 0.3mm (<2mm limit). OK.

QSPI (133MHz): LOW RISK
  - Z0=55 ohm (no controlled impedance required for QSPI at 133MHz).
  - Max clock-to-data skew: 2ns budget, max delta: 8mm = 47ps. Well within spec.

3.3V Rail: MEDIUM RISK
  - Max current: 1.5A (estimated from STM32H7 Idd + peripherals).
  - Target Z: 3.3V * 5% / 1.5A = 110 mohm.
  - No decoupling capacitors detected near U3 (QSPI flash) power pins.
  Action: Add 100nF 0402 within 2mm of U3 VCC.

1.2V Rail: HIGH RISK
  - DDR3L VDDQ draws up to 0.8A transient.
  - Target Z: 1.2V * 3% / 0.8A = 45 mohm.
  - Only 2x 10uF bulk caps found. No high-frequency decoupling.
  - Plane capacitance estimate: 180pF (L3-L4 overlap, 0.2mm dielectric).
  Action: Add 4x 100nF 0402 + 2x 1nF 0201 at DDR VDD pins.

OVERALL: 65/100 -- Address DDR3L impedance and 1.2V PDN before prototype.
```

### Technical Implementation

```python
# New module: packages/intelligence/src/routeai_intelligence/agent/feasibility_predictor.py

class FeasibilityPredictor:
    """Pre-simulation risk assessment using LLM + lightweight solvers."""

    async def assess(self, board: SolverBoard, schematic: ParsedSchematic) -> FeasibilityReport:
        # Step 1: LLM classifies nets into interface groups
        interface_map = await self._classify_interfaces(schematic)
        # Returns: {"DDR3L": [net_DQ0, net_DQ1, ...], "USB2": [net_DP, net_DM], ...}

        # Step 2: For each interface, retrieve specs from RAG
        specs = await self._retrieve_interface_specs(interface_map)
        # RAG returns: {"DDR3L": {z0_target: 50, z_diff: 100, skew_ps: 50, ...}}

        # Step 3: Run solver checks per interface
        for iface_name, nets in interface_map.items():
            spec = specs[iface_name]
            # Impedance check via ImpedanceEngine
            z0_results = self.impedance_engine.analyze_nets(board, nets)
            # Length/skew check via trace length extraction
            lengths = self._extract_trace_lengths(board, nets)
            # PDN check via PDNAnalyzer (for power interfaces)
            if spec.is_power:
                pdn_result = self.pdn_analyzer.analyze(board, power_nets={...})

        # Step 4: LLM synthesizes risk report with citations
        report = await self._synthesize_report(results, specs)
        return report
```

Integration point: extend `AnalysisResult` in `packages/cli/src/routeai_cli/analyzer.py` to include `feasibility_report: FeasibilityReport`.

---

## Feature 2: Natural Language Simulation Setup

### What It Does

Engineer types: `"Check if my DDR4 will work at 3200MT/s"` or `"Will my USB3 pass eye mask at 5Gbps?"` The LLM translates this into a complete simulation configuration: which nets to analyze, what impedance targets, what timing budgets, what IBIS models to use, and which solver routines to invoke.

### Why Current Tools Fail

Setting up a DDR4 simulation in HyperLynx requires:
1. Importing the board (30 min with manual fixes)
2. Assigning IBIS models to every driver/receiver (1-2 hours; finding the right IBIS model from the vendor's website is itself a project)
3. Defining stimulus (PRBS pattern, data rate, address patterns)
4. Setting up the correct analysis type (time domain, frequency domain, S-parameter extraction)
5. Configuring termination, ODT settings, drive strength

Total: 4-8 hours for a DDR4 analysis. Most engineers give up before step 2.

### How LLM + Solver Enables It

1. **LLM parses the natural language request** and identifies: interface=DDR4, data_rate=3200MT/s, analysis_type=signal_integrity.
2. **LLM retrieves DDR4 spec** from RAG: JEDEC JESD79-4C timing parameters, impedance requirements, eye mask.
3. **LLM identifies components** from schematic: driver (STM32H7 LQFP144), receiver (IS43TR16512B DDR3L-1600), and maps them to IBIS models in the database.
4. **LLM configures solver parameters**: calls `ImpedanceEngine`, `CrosstalkEngine`, calculates propagation delay, estimates ISI from trace loss.
5. **Results presented in context**: "Your DDR4 byte lane 0 has 62-ohm impedance where 40 ohm is needed. Here is what a 40-ohm trace looks like on your stackup: 0.178mm width on L1."

### Example Scenario

```
User: "check if my ddr4 will work at 3200 megatransfers"

RouteAI: Analyzing DDR4 interface at 3200MT/s...

Identified components:
  - Controller: STM32H7 (U1) -- 16-bit DDR4 interface on port SDRAM_*
  - Memory: MT41K256M16TW (U5) -- DDR4-3200, 8Gbit

Stackup analysis (your 6-layer board):
  Layer  Type        h(mm)  Er    Signal routing
  L1     Microstrip  0.11   4.3   DDR4 DQ/DQS (currently routed here)
  L2     GND plane   --     --    Reference plane for L1
  L3     Stripline   0.20   4.2   DDR4 address/command
  L4     VDD plane   --     --
  L5     Stripline   0.20   4.2   --
  L6     Microstrip  0.11   4.3   --

Signal Integrity Results:
=========================

1. IMPEDANCE: FAIL
   DQ traces on L1: w=0.127mm -> Z0=68.2 ohm (target: 40 +/-10%)
   Required width for 40 ohm: 0.254mm
   DQS diff pairs on L1: s=0.127mm, w=0.127mm -> Z_diff=96 ohm (target: 80 +/-10%)
   Required: w=0.178mm, s=0.178mm for Z_diff=80 ohm

2. TIMING: MARGINAL
   Byte lane 0 DQ-to-DQS skew:
     DQ0: 32.1mm, DQ1: 33.8mm, DQ2: 31.5mm, ... DQS0: 33.0mm
     Max skew: |33.8-33.0|*6.7ps/mm = 5.4ps (budget: 50ps) -- OK
   Address bus CK-to-CMD skew:
     Max delta: 15.2mm = 102ps (budget: tIS=125ps) -- MARGINAL, 82% of budget

3. CROSSTALK: WARNING
   DQ0 to DQ1 on L1: parallel run 28mm at 0.15mm spacing
   FEXT coefficient: -22dB (threshold: -30dB) -- EXCEEDS
   Recommendation: Increase DQ spacing to 3W (0.38mm) or route on L3 (stripline)

4. SIGNAL LOSS (estimated):
   Trace loss at 1.6GHz (Nyquist): 0.8dB for 35mm (FR4, Df=0.02)
   Via transition loss: ~0.3dB per via (2 vias in path) = 0.6dB
   Total insertion loss: ~1.4dB -- within DDR4 channel budget of 5dB

5. POWER INTEGRITY:
   VDDQ (1.2V) target impedance: 36 mohm (1.2V * 3% / 1.0A)
   Current PDN meets target up to 85 MHz. Gap at 85-400 MHz.
   Suggestion: Add 4x 100nF 0402 at U5 pins.

VERDICT: DDR4 at 3200MT/s will NOT work with current trace widths.
Fix impedance first (widen DQ to 0.254mm), then re-check timing.
```

### Technical Implementation

```python
# New module: packages/intelligence/src/routeai_intelligence/agent/prompts/simulation_setup.py

SIMULATION_SETUP_PROMPT = """
You are a signal integrity engineer configuring a simulation.

Given the user's request and the board data, determine:
1. Which interface is being analyzed
2. The relevant specification (JEDEC, USB-IF, PCI-SIG, etc.)
3. Which nets are involved
4. What analysis types are needed (impedance, timing, crosstalk, loss, PDN)
5. The specific pass/fail criteria with numbers

Output a SimulationConfig JSON:
{
    "interface": "DDR4",
    "data_rate_mt_s": 3200,
    "nets": {"dq": [...], "dqs": [...], "addr": [...], "clk": [...]},
    "analyses": [
        {"type": "impedance", "target_z0": 40, "tolerance_pct": 10},
        {"type": "timing", "max_skew_ps": 50, "group": "byte_lane"},
        {"type": "crosstalk", "max_fext_db": -30},
        {"type": "loss", "max_insertion_loss_db": 5, "freq_ghz": 1.6},
        {"type": "pdn", "rail": "VDDQ", "voltage": 1.2, "max_current_a": 1.0}
    ],
    "ibis_models": {"U1": "stm32h7_ibis_v2.3", "U5": "mt41k_ibis_ddr4"},
    "citations": ["JEDEC JESD79-4C Table 90", "...]
}
"""

class NaturalLanguageSimulator:
    async def run(self, user_query: str, board: SolverBoard, schematic: ParsedSchematic):
        # LLM generates SimulationConfig
        config = await self.agent.generate_config(user_query, board, schematic)
        # Validated through Gate 1 (schema validation)
        validated = self.schema_validator.validate(config, SimulationConfigSchema)
        # Execute each analysis through existing solver engines
        results = {}
        for analysis in config.analyses:
            if analysis.type == "impedance":
                results["impedance"] = self.impedance_engine.analyze_nets(board, config.nets)
            elif analysis.type == "crosstalk":
                results["crosstalk"] = self.crosstalk_engine.analyze_board(board)
            elif analysis.type == "pdn":
                results["pdn"] = self.pdn_analyzer.analyze(board, power_nets={...})
        # LLM interprets results against spec
        report = await self.agent.interpret_results(results, config)
        return report
```

---

## Feature 3: Instant Impedance & Crosstalk Estimation

### What It Does

Real-time impedance and crosstalk estimation as the engineer types stackup parameters or modifies trace geometry. No simulation launch, no waiting -- results update in sub-second as parameters change. "What impedance do I get with 0.15mm trace on layer 3 of this stackup?" answered in 50ms.

### Why Current Tools Fail

Even "fast" impedance calculators like Saturn PCB Toolkit require manual entry of every parameter. Crosstalk estimation requires exporting geometry to a 2.5D or 3D solver (minutes to hours). There is no tool that takes a real board file and gives instant per-net impedance across the whole design.

### How LLM + Solver Enables It

The solver layer already implements Hammerstad-Jensen (microstrip), Wadell/Cohn (stripline), and IPC-2141 (differential/crosstalk) -- all closed-form equations that execute in microseconds. The LLM's role:

1. **Extract parameters automatically** from the parsed board: for each trace segment, identify the layer, find the stackup entry, determine microstrip vs. stripline, extract w, h, Er, t.
2. **Present results intelligently**: flag only the nets that are out of spec, group by interface, suggest the trace width needed to hit target.
3. **Handle natural language queries**: "what impedance is net CLK_100MHz?" triggers a targeted lookup.

### Example Scenario

```
User: "show me impedance for all DDR nets"

RouteAI: Impedance analysis for 52 DDR nets on your 4-layer stackup:

Stackup:     L1 (0.035mm Cu) / prepreg (0.11mm, Er=4.3) / L2 GND / core (1.0mm) / L3 PWR / prepreg (0.11mm) / L4 (0.035mm Cu)

Net Group       Layer  Width   Type         Z0 actual  Z0 target  Status
-----------     -----  ------  -----------  ---------  ---------  ------
DDR_DQ[0:7]     L1     0.127mm Microstrip   68.2 ohm   50 ohm     FAIL
DDR_DQ[8:15]    L1     0.127mm Microstrip   68.2 ohm   50 ohm     FAIL
DDR_DQS0+/-     L1     0.127mm Diff pair    118 ohm    100 ohm    FAIL
DDR_DQS1+/-     L1     0.127mm Diff pair    118 ohm    100 ohm    FAIL
DDR_A[0:13]     L1     0.15mm  Microstrip   62.1 ohm   50 ohm     FAIL
DDR_CLK+/-      L1     0.15mm  Diff pair    108 ohm    100 ohm    MARGINAL
DDR_CKE         L1     0.15mm  Microstrip   62.1 ohm   N/A        INFO

To achieve 50 ohm on L1: trace width = 0.227mm (microstrip, h=0.11mm, Er=4.3)
To achieve 100 ohm differential on L1: w=0.127mm, s=0.254mm

Crosstalk hotspots:
  DDR_DQ0 <-> DDR_DQ1: 28mm parallel at 0.15mm gap -> FEXT=-22dB (limit: -30dB)
  DDR_A0 <-> DDR_A1: 35mm parallel at 0.20mm gap -> FEXT=-26dB (limit: -30dB)
  Apply 3W rule (spacing >= 3x width) to fix both.
```

### Technical Implementation

This uses the existing `ImpedanceEngine` and `CrosstalkEngine` directly -- no new solver code needed. The LLM adds the interface-awareness layer.

```python
# Extend: packages/solver/src/routeai_solver/si/impedance_engine.py

class ImpedanceEngine:
    # Existing method already does per-segment analysis.
    # Add a batch method for the CLI:

    def quick_summary(self, board: BoardDesign) -> dict[str, list[PerNetResult]]:
        """Group impedance results by interface for instant display."""
        report = self.analyze_board(board)
        # LLM-classified interface grouping applied post-analysis
        return group_by_interface(report)

    def solve_for_width(self, target_z0: float, layer: Layer,
                        stackup: list[StackupLayer]) -> float:
        """Binary search for trace width that achieves target impedance."""
        lo, hi = 0.01, 5.0  # mm
        for _ in range(50):  # converges in ~17 iterations to 0.001mm
            mid = (lo + hi) / 2
            z0 = self._calculate_segment_impedance(
                TraceSegment(start_x=0, start_y=0, end_x=1, end_y=0, width=mid),
                layer, stackup)
            if z0 > target_z0:
                lo = mid  # wider trace -> lower impedance
            else:
                hi = mid
        return (lo + hi) / 2
```

---

## Feature 4: Eye Diagram Prediction

### What It Does

Predicts whether a serial link will pass its eye mask test based on board geometry, stackup loss, via model, and IBIS model parameters -- without running a full transient simulation. Produces a statistical eye diagram estimate with voltage and timing margins.

### Why Current Tools Fail

Eye diagram simulation requires:
- IBIS or IBIS-AMI models (many engineers cannot find or parse these)
- S-parameter extraction of the channel (requires 3D EM simulation)
- Time-domain convolution of the channel response with the bit pattern
- Proper termination and equalization modeling

This takes hours in HyperLynx, days in HFSS, and is completely inaccessible to non-SI-specialists.

### How LLM + Solver Enables It

**Approach: Analytical eye estimation, not full transient simulation.**

1. **Channel loss model**: estimate insertion loss from trace length, dielectric loss (Df), copper roughness (Rz), and via transitions using closed-form transmission line equations. The solver already calculates Er_eff and delay.
2. **ISI estimation**: from the channel transfer function, compute the pulse response duration. If the pulse spreads beyond 1 UI (unit interval), ISI degrades the eye opening.
3. **Eye height/width estimation**:
   - Eye height = V_swing * (1 - 2 * ISI_factor) - noise_margin
   - Eye width = UI - 2 * jitter_total
   - Jitter components: Tj = Dj (deterministic from ISI) + Rj (random, from IBIS model or default 5ps RMS)
4. **LLM contextualizes**: retrieves the eye mask from the interface spec (USB3: 200mV minimum eye height at 5Gbps, PCIe Gen3: mask defined in PCI-SIG spec), compares with estimated eye, reports margin or violation.

### Example Scenario

```
User: "will my 10Gbps SerDes link pass?"

RouteAI: Analyzing 10Gbps serial link (U1 pin TX+ to J3 pin RX+)...

Channel topology:
  U1 TX+ -> 1.2mm on-die -> pad -> via (L1->L3) -> 55mm stripline L3 ->
  via (L3->L1) -> 18mm microstrip L1 -> AC coupling cap C22 ->
  3mm microstrip -> J3 RX+

Loss breakdown at 5 GHz (Nyquist):
  Trace dielectric loss (55mm stripline, Df=0.02):    -3.8 dB
  Trace dielectric loss (21mm microstrip, Df=0.02):   -1.5 dB
  Copper loss (skin effect, Rz=3um):                  -1.2 dB
  Via transition loss (2 vias):                        -0.6 dB
  AC coupling cap (100nF, ESL=0.3nH):                 -0.1 dB
  Connector (SMA, from typical data):                  -0.5 dB
  TOTAL insertion loss at 5 GHz:                       -7.7 dB

Eye estimation (NRZ, 10Gbps, UI=100ps):
  Tx swing: 800 mVpp differential (from IBIS model, default drive)
  Channel attenuation at Nyquist: 7.7 dB -> voltage factor 0.41
  ISI penalty (3-tap approximation): 2.1 dB
  Eye height: ~180 mVpp (after ISI)
  Jitter: Dj=12ps (ISI-induced), Rj=5ps RMS -> Tj=22ps (at BER=1e-12)
  Eye width: 100ps - 22ps = 78ps

  Eye mask comparison (assuming 10GBASE-KR):
    Min eye height: 50 mV -> PASS (margin: 130 mV)
    Min eye width: 37.5 ps -> PASS (margin: 40.5 ps)

VERDICT: Link will pass with ~3.5 dB margin. Consider 2-tap TX FIR EQ
for additional margin if layout changes are not possible.
```

### Technical Implementation

```python
# New module: packages/solver/src/routeai_solver/si/eye_estimator.py

@dataclass
class ChannelLossModel:
    """Frequency-dependent channel loss model."""
    trace_segments: list[TraceSegmentLoss]  # each with length, type, stackup
    via_transitions: int
    connector_loss_db: float = 0.5

    def insertion_loss_at(self, freq_ghz: float) -> float:
        """Total insertion loss in dB at given frequency."""
        total = 0.0
        for seg in self.trace_segments:
            # Dielectric loss: alpha_d = pi * f * sqrt(Er_eff) * tan_delta / c
            alpha_d = (math.pi * freq_ghz * 1e9 * math.sqrt(seg.er_eff)
                       * seg.loss_tangent / C_0)  # Np/m
            loss_db = 20 * math.log10(math.e) * alpha_d * seg.length_m
            total += loss_db
            # Copper loss (skin effect): alpha_c = Rs / (w * Z0)
            # Rs = sqrt(pi * f * mu0 * rho_cu)
            rs = math.sqrt(math.pi * freq_ghz * 1e9 * 4e-7 * math.pi * 1.724e-8)
            alpha_c = rs / (seg.width_m * seg.z0)
            total += 20 * math.log10(math.e) * alpha_c * seg.length_m
        total += self.via_transitions * 0.3  # dB per via
        total += self.connector_loss_db
        return total

    def estimate_eye(self, data_rate_gbps: float, tx_swing_mv: float) -> EyeEstimate:
        """Estimate eye diagram parameters."""
        nyquist_ghz = data_rate_gbps / 2.0
        ui_ps = 1000.0 / data_rate_gbps

        il_db = self.insertion_loss_at(nyquist_ghz)
        voltage_factor = 10 ** (-il_db / 20)

        # 3-tap ISI penalty estimation
        il_at_half = self.insertion_loss_at(nyquist_ghz / 2)
        isi_penalty_db = abs(il_db - il_at_half) * 0.5
        isi_factor = 1 - 10 ** (-isi_penalty_db / 20)

        eye_height_mv = tx_swing_mv * voltage_factor * (1 - 2 * isi_factor)
        dj_ps = isi_factor * ui_ps * 0.3
        rj_rms_ps = 5.0  # typical
        tj_ps = dj_ps + 14 * rj_rms_ps  # at BER=1e-12
        eye_width_ps = ui_ps - tj_ps

        return EyeEstimate(eye_height_mv, eye_width_ps, il_db, ui_ps)
```

---

## Feature 5: Power Integrity Quick Check

### What It Does

Analyzes the entire power distribution network in seconds: calculates target impedance for each rail, estimates plane capacitance, evaluates decoupling capacitor adequacy, identifies frequency gaps in the impedance profile, and recommends a specific decap strategy with part numbers and placement locations.

### Why Current Tools Fail

PDN analysis in commercial tools requires:
- Building a full PDN model (VRM, planes, decaps, IC models)
- Running frequency-domain impedance sweep
- Interpreting the impedance vs. frequency plot
- Iterating on decap selection

Most engineers use the "place 100nF near every IC" heuristic and pray. When it does not work, they add caps at random until the scope shows clean power.

### How LLM + Solver Enables It

The existing `PDNAnalyzer` in `packages/solver/src/routeai_solver/si/pdn_analyzer.py` already computes target impedance, models plane capacitance, sweeps PDN impedance across frequency, and suggests decaps. The LLM layer:

1. **Identifies power rails automatically** from net names and component datasheets.
2. **Estimates current requirements** per rail by summing IC current specs from RAG (datasheet-sourced Idd values).
3. **Runs PDNAnalyzer** with correct parameters.
4. **Explains the results**: "Your 1.2V rail has a resonance at 50 MHz where the impedance peaks at 200 mohm -- 4x your target of 45 mohm. Adding 2x 2.2uF 0805 caps will move this resonance below the target."
5. **Suggests specific parts**: "Use Murata GRM155R61A104KA01 (100nF 0402, ESR=30mohm, ESL=0.5nH)" from a component database.

### Example Scenario

```
User: "check my power integrity"

RouteAI: Analyzing 4 power rails...

Rail: VCC_3V3 (3.3V)
  Consumers: STM32H7 (350mA), QSPI Flash (50mA), Level Shifters (20mA)
  Total max current: 420 mA
  Target impedance: 3.3V * 5% / 0.42A = 393 mohm
  Current decaps: 2x 10uF 0805, 4x 100nF 0402
  Plane capacitance: 320 pF (L2-L4, 50x40mm overlap, 0.8mm dielectric)
  PDN impedance:
    DC - 100kHz:   8 mohm (VRM dominates) -- PASS
    100kHz - 5MHz: 85 mohm (bulk caps)    -- PASS
    5MHz - 80MHz:  150 mohm (100nF caps)  -- PASS
    80MHz - 300MHz: 520 mohm (GAP!)       -- FAIL
    300MHz - 1GHz: 290 mohm (plane cap)   -- PASS
  Fix: Add 2x 1nF 0201 (Murata GRM033R60J102KE19) at U1 pin 23/24.
  Cost: $0.02. This closes the 80-300MHz gap.
  Status: MARGINAL (will pass with suggested fix)

Rail: VDDQ_1V2 (1.2V)
  Consumers: DDR3L (800mA peak transient)
  Target impedance: 1.2V * 3% / 0.8A = 45 mohm
  Current decaps: 2x 10uF 0805 only
  PDN impedance:
    DC - 50kHz:   5 mohm    -- PASS
    50kHz - 2MHz: 38 mohm   -- PASS
    2MHz - 1GHz:  180 mohm  -- FAIL (4x over target!)
  Fix: Add 4x 100nF 0402 + 2x 2.2nF 0201 at DDR IC power pins.
  Cost: $0.08. Critical for DDR3L stability.
  Status: FAIL
```

### Technical Implementation

No new solver code required -- the existing `PDNAnalyzer` already does the heavy lifting. New intelligence layer code:

```python
# New module: packages/intelligence/src/routeai_intelligence/agent/pdn_advisor.py

class PDNAdvisor:
    """LLM-powered PDN analysis and recommendation engine."""

    async def analyze(self, board: SolverBoard, schematic: ParsedSchematic) -> PDNAdvisoryReport:
        # Step 1: LLM identifies power rails and estimates current
        rails = await self._identify_power_rails(schematic)
        # Step 2: Run PDNAnalyzer for each rail
        pdn_results = {}
        for rail in rails:
            pdn_results[rail.name] = self.pdn_analyzer.analyze(
                board, power_nets={rail.name: rail.to_dict()})
        # Step 3: LLM recommends specific caps from component DB
        recommendations = await self._recommend_decaps(pdn_results)
        # Step 4: Re-run with suggested caps to verify fix
        for rec in recommendations:
            verified = self._verify_fix(pdn_results[rec.rail], rec.suggested_decaps)
        return PDNAdvisoryReport(rails=pdn_results, recommendations=recommendations)
```

---

## Feature 6: Thermal Hotspot Prediction

### What It Does

Predicts thermal hotspots on the PCB based on component power dissipation, copper area distribution, and board geometry. Identifies components that may exceed their junction temperature rating and suggests thermal relief strategies (copper pours, thermal vias, heatsinks).

### Why Current Tools Fail

Thermal simulation requires computational fluid dynamics (CFD) tools like Ansys Icepak ($30K+/seat) or FloTHERM ($25K+/seat). These require a complete 3D model, airflow conditions, and take hours to solve. No PCB engineer has access to these tools.

### How LLM + Solver Enables It

**Approach: thermal resistance network, not CFD.**

1. **Extract power dissipation** per component from datasheets via RAG (LLM queries: "what is the typical power dissipation of STM32H743 at 480MHz?")
2. **Build thermal resistance network**: junction-to-case (from datasheet theta_JC), case-to-board (depends on package, pad area, and thermal via count), board-to-ambient (depends on copper area, airflow)
3. **Solver computes junction temperature** for each component: Tj = Ta + P * (theta_JC + theta_CB + theta_BA)
4. **LLM identifies hotspots** and suggests mitigations

### Example Scenario

```
User: "will anything overheat on my board?"

RouteAI: Thermal analysis (ambient: 40C, natural convection)

Component       Package    P_diss   Tj_max  Tj_est  Margin  Status
-----------     -------    ------   ------  ------  ------  ------
U1 STM32H743    LQFP144    1.2W     105C    82C     23C     OK
U2 LDO 3.3V     SOT-223    0.6W     125C    118C    7C      WARNING
U5 DDR3L         BGA-96    0.35W    85C     68C     17C     OK
U3 QSPI Flash   SOIC-8     0.1W     85C     52C     33C     OK
Q1 MOSFET        DPAK      2.5W     150C    135C    15C     WARNING
D1 Schottky      SMA       0.8W     125C    95C     30C     OK

HOTSPOTS DETECTED:

1. U2 (LDO, SOT-223): Tj=118C, only 7C margin
   - Input: 5V, output: 3.3V, Iout=350mA -> Pdiss = (5-3.3)*0.35 = 0.6W
   - SOT-223 theta_JA = 130 C/W (still air, no copper pour)
   - With 1 sq inch copper pour: theta_JA drops to 52 C/W -> Tj=71C
   Fix: Add copper pour on L1 under U2 (min 25x25mm). Cost: $0.
   Alternative: Replace with switching regulator. Eliminates heat entirely.

2. Q1 (DPAK MOSFET): Tj=135C, 15C margin
   - RDS_on = 50mohm at 10A -> P = I^2 * R = 2.5W
   - DPAK theta_JA = 38 C/W (board-mounted)
   Fix: Add 6x thermal vias (0.3mm drill) under DPAK pad.
     Reduces theta_JC_board from 15 to 5 C/W -> Tj=115C (35C margin).
```

### Technical Implementation

```python
# New module: packages/solver/src/routeai_solver/physics/thermal_network.py

@dataclass
class ThermalNode:
    component_ref: str
    package: str
    power_watts: float
    theta_jc: float   # junction-to-case (C/W), from datasheet
    theta_cb: float   # case-to-board (C/W), depends on mounting
    theta_ba: float   # board-to-ambient (C/W), depends on copper area
    tj_max: float     # max junction temp from datasheet

    @property
    def tj_estimated(self, ambient: float = 40.0) -> float:
        return ambient + self.power_watts * (self.theta_jc + self.theta_cb + self.theta_ba)

class ThermalNetworkAnalyzer:
    def analyze(self, board: SolverBoard, component_thermal_data: list[ThermalNode],
                ambient_c: float = 40.0) -> ThermalReport:
        results = []
        for node in component_thermal_data:
            # Estimate theta_BA from copper area around component
            copper_area = self._estimate_copper_area(board, node.component_ref)
            node.theta_ba = self._copper_area_to_theta_ba(copper_area, airflow="natural")
            tj = node.tj_estimated(ambient_c)
            margin = node.tj_max - tj
            results.append(ThermalResult(node, tj, margin))
        return ThermalReport(results)
```

---

## Feature 7: EMI Prediction ("Will This Pass FCC?")

### What It Does

Estimates radiated emissions from the PCB design based on clock frequencies, loop areas, cable connections, and return path discontinuities. Predicts whether the design will pass FCC Part 15 Class B (or Class A) limits before the first prototype.

### Why Current Tools Fail

EMI prediction with commercial tools requires full 3D electromagnetic simulation in HFSS or CST ($80K+/seat), accurate modeling of cables, enclosure, and PCB together, and weeks of simulation time. Even experts cannot accurately predict EMI -- they mitigate known risk factors and rely on testing.

### How LLM + Solver Enables It

**Approach: Heuristic risk assessment, not full EM simulation.** The LLM does not predict exact emission levels in dBuV/m. Instead, it identifies the top EMI risk factors from the design and flags likely failures.

1. **Identify all clocks and high-frequency signals** from schematic (crystal oscillators, PLLs, data buses)
2. **Calculate loop areas** for critical signals: area = trace_length * dielectric_height for signals with continuous return path; much larger if return path is broken
3. **Check return path continuity**: detect split planes, reference plane changes at vias without stitching
4. **Estimate radiated emission**: E = 1.316 * f^2 * A * I / r (simplified dipole model) where A is loop area, f is frequency, I is current, r is distance (3m for FCC)
5. **Compare against FCC limits**: Class B limit at 100MHz is ~40 dBuV/m at 3m
6. **LLM synthesizes risk report** with specific remediation

### Example Scenario

```
User: "will this pass FCC class B?"

RouteAI: EMI Risk Assessment (FCC Part 15 Class B)

Clock sources detected:
  Y1: 25 MHz crystal -> STM32H7 HSE input
  PLL: 25 MHz * 19.2 = 480 MHz internal (STM32H7 PLL)
  USB: 480 MHz (HS) on DP/DM to connector J2
  DDR3L: 800 MHz clock (fundamental), data at 1600 MT/s
  QSPI: 133 MHz

Risk Assessment by Frequency:

25 MHz (fundamental) + harmonics:
  3rd harmonic (75 MHz): Loop area = 2.1 mm^2 (trace on L1, return on L2)
  Estimated emission at 3m: 28 dBuV/m. FCC Class B limit: 43.5 dBuV/m. PASS.
  5th harmonic (125 MHz): 32 dBuV/m. Limit: 46 dBuV/m. PASS.
  BUT: Crystal trace Y1 to U1 has no ground guard. Adjacent SPI_CLK trace
  at 0.2mm spacing can couple clock harmonics to the SPI bus, which routes
  to edge connector J5 (potential antenna).
  Risk: MEDIUM. Add ground guard traces around crystal.

480 MHz (USB HS):
  USB cable at J2 acts as antenna (common-mode radiation).
  USB traces DP/DM: diff pair, 88 ohm, well-matched.
  However: no common-mode choke detected on USB lines.
  Estimated CM current: 100uA at 480MHz (typical without CMC).
  Estimated emission from 1m USB cable: 52 dBuV/m at 3m.
  FCC Class B limit at 480 MHz: 46 dBuV/m. FAIL.
  Fix: Add Murata DLW21SN900SQ2 common-mode choke at J2.
  Cost: $0.15. This typically provides 25dB CM rejection -> 27 dBuV/m. PASS.

800 MHz (DDR3L clock):
  DDR traces are internal (L3 stripline). Minimal radiation.
  BUT: DDR address bus on L1 (microstrip) has 35mm trace with reference
  plane change at via from L2 (GND) to L4 (VDD). No stitching via.
  This creates a slot antenna effect.
  Risk: HIGH. Add stitching capacitor (100nF) between L2-L4 within 1mm
  of the signal via.

OVERALL EMI RISK: HIGH (USB 480MHz emissions, DDR return path gap)
Estimated FCC test outcome: FAIL at 480 MHz.
Required fixes: (1) USB CM choke, (2) DDR stitching vias. Total cost: $0.20.
```

### Technical Implementation

```python
# New module: packages/solver/src/routeai_solver/si/emi_predictor.py

class EMIPredictor:
    """Heuristic EMI risk assessment based on design analysis."""

    FCC_CLASS_B_LIMITS = {
        # frequency_mhz: limit_dBuV_m at 3m
        30: 40.0, 88: 43.5, 216: 46.0, 960: 54.0, 1000: 54.0,
    }

    def estimate_radiation(self, freq_mhz: float, loop_area_mm2: float,
                          current_ma: float, distance_m: float = 3.0) -> float:
        """Estimate radiated E-field from a current loop (dBuV/m)."""
        # Simplified small loop antenna model:
        # E = 1.316e-14 * f^2 * A * I / r  (SI units: f in Hz, A in m^2, I in A, r in m)
        f_hz = freq_mhz * 1e6
        area_m2 = loop_area_mm2 * 1e-6
        current_a = current_ma * 1e-3
        e_field = 1.316e-14 * f_hz**2 * area_m2 * current_a / distance_m  # V/m
        e_field_uv = e_field * 1e6  # uV/m
        if e_field_uv > 0:
            return 20 * math.log10(e_field_uv)  # dBuV/m
        return -100.0

    def check_return_path_continuity(self, board: SolverBoard) -> list[ReturnPathGap]:
        """Find vias that transition between different reference planes without stitching."""
        gaps = []
        for via in board.vias:
            start_ref = self._find_reference_plane(via.start_layer, board.stackup)
            end_ref = self._find_reference_plane(via.end_layer, board.stackup)
            if start_ref != end_ref:
                # Check for nearby stitching via/cap
                has_stitch = self._find_stitching_via(via, board, radius_mm=1.0)
                if not has_stitch:
                    gaps.append(ReturnPathGap(via, start_ref, end_ref))
        return gaps
```

---

## Feature 8: What-If Stackup Analysis

### What It Does

Instantly answers questions like "what happens if I change from 4 to 6 layers?" or "what if I use Rogers 4350B instead of FR4?" by re-running all impedance, crosstalk, and PDN calculations with the modified stackup and presenting a before/after comparison.

### Why Current Tools Fail

Changing the stackup in a commercial tool requires re-importing the board, re-assigning layer mappings, re-running simulation. Each iteration takes 30-60 minutes. Engineers pick a stackup early and stick with it, even if it is suboptimal, because changing is too painful.

### How LLM + Solver Enables It

All impedance and crosstalk calculations are closed-form. Changing the stackup parameters and re-running takes milliseconds. The LLM:
1. Parses the what-if query
2. Generates the modified stackup
3. Runs the solver with both original and modified stackup
4. Presents a diff showing what improved and what degraded

### Example Scenario

```
User: "what if I change from 4 layers to 6 layers?"

RouteAI: Comparing 4-layer vs 6-layer stackup for your design:

4-LAYER (current):                    6-LAYER (proposed):
L1 Signal  (0.035mm Cu)              L1 Signal  (0.035mm Cu)
   Prepreg  (0.11mm, Er=4.3)            Prepreg  (0.09mm, Er=4.3)
L2 GND     (0.035mm Cu)              L2 GND     (0.035mm Cu)
   Core     (1.0mm, Er=4.5)             Prepreg  (0.20mm, Er=4.2)
L3 VDD     (0.035mm Cu)              L3 Signal  (0.035mm Cu)
   Prepreg  (0.11mm, Er=4.3)            Core     (0.80mm, Er=4.5)
L4 Signal  (0.035mm Cu)              L4 Signal  (0.035mm Cu)
                                         Prepreg  (0.20mm, Er=4.2)
Board: 1.39mm                        L5 VDD     (0.035mm Cu)
                                         Prepreg  (0.09mm, Er=4.3)
                                      L6 Signal  (0.035mm Cu)
                                      Board: 1.54mm

IMPACT ANALYSIS:
                            4-layer         6-layer        Change
DDR DQ Z0 (L1, 0.127mm)    68.2 ohm       60.1 ohm       -12% (closer to 50)
DDR DQ Z0 needed width      0.227mm        0.170mm        -25% (easier routing)
DDR Diff Z (L1, 0.127mm)    118 ohm        103 ohm        -13% (closer to 100)
Crosstalk DQ0-DQ1 FEXT      -22 dB         -28 dB         -6 dB (improved)
PDN target Z (1.2V rail)    45 mohm        45 mohm        same
Plane capacitance            320 pF         1200 pF        +275% (L2-L5 closer)
PDN gap freq range           80-300 MHz     200-500 MHz    gap shifted up (better)
DDR routing on L3            not available  stripline      much better SI

COST IMPACT (estimated):
  4-layer: $3.50/board (5-piece prototype at JLCPCB)
  6-layer: $12.00/board (5-piece prototype)
  Production (1000 pcs): 4-layer $1.20 -> 6-layer $2.80 (+$1.60/board)

RECOMMENDATION:
The 6-layer stackup resolves your DDR impedance problem without trace width
changes, provides stripline routing on L3/L4 for better crosstalk isolation,
and dramatically improves PDN performance through increased plane capacitance.
The $1.60/board additional cost is justified for a DDR3L design.
```

### Technical Implementation

```python
# New module: packages/intelligence/src/routeai_intelligence/agent/what_if_analyzer.py

class WhatIfAnalyzer:
    COMMON_STACKUPS = {
        4: [...],  # standard 4-layer stackup definitions
        6: [...],  # standard 6-layer stackup definitions
        8: [...],
    }

    async def compare_stackups(self, board: SolverBoard,
                                original_stackup: list[StackupLayer],
                                modified_stackup: list[StackupLayer]) -> ComparisonReport:
        # Run impedance analysis on both stackups
        imp_orig = self.impedance_engine.analyze_board(board, stackup=original_stackup)
        imp_mod = self.impedance_engine.analyze_board(board, stackup=modified_stackup)

        # Run crosstalk on both
        xt_orig = self.crosstalk_engine.analyze_board(board, stackup=original_stackup)
        xt_mod = self.crosstalk_engine.analyze_board(board, stackup=modified_stackup)

        # Run PDN on both
        pdn_orig = self.pdn_analyzer.analyze(board, stackup=original_stackup)
        pdn_mod = self.pdn_analyzer.analyze(board, stackup=modified_stackup)

        # LLM generates comparison narrative
        return await self._generate_comparison(imp_orig, imp_mod, xt_orig, xt_mod,
                                                pdn_orig, pdn_mod)
```

---

## Feature 9: Sensitivity Analysis

### What It Does

Identifies which design parameter has the most impact on a given performance metric. For a 10Gbps link, is it trace width, dielectric thickness, dielectric constant, trace length, or via count that matters most? Produces a tornado chart ranking parameters by sensitivity.

### Why Current Tools Fail

Sensitivity analysis in commercial tools means running N simulations with one parameter varied at a time. For 6 parameters with 5 values each = 30 simulations, each taking 10-60 minutes. Nobody does this.

### How LLM + Solver Enables It

Closed-form equations execute in microseconds. Running 1000 parameter combinations takes under a second. The LLM:
1. Identifies the relevant parameters for the given metric
2. Defines reasonable variation ranges
3. Runs a parameter sweep using the solver
4. Computes sensitivity coefficients (partial derivatives)
5. Presents a ranked tornado chart with actionable interpretation

### Example Scenario

```
User: "which parameter matters most for my DDR4 impedance?"

RouteAI: Sensitivity analysis for DDR4 single-ended impedance
         (baseline: L1 microstrip, w=0.127mm, h=0.11mm, Er=4.3, t=0.035mm)
         Baseline Z0 = 68.2 ohm

Parameter sweep (+/-10% each):

Parameter           -10%         +10%        Delta Z0    Sensitivity
-----------         ----         ----        --------    -----------
Trace width (w)     0.114mm      0.140mm     +5.8/-4.9   HIGH (|10.7| ohm)
  Z0 = 74.0 ohm    Z0 = 63.3 ohm

Dielectric h        0.099mm      0.121mm     -4.2/+3.8   HIGH (|8.0| ohm)
  Z0 = 64.0 ohm    Z0 = 72.0 ohm

Dielectric Er       3.87         4.73        +2.8/-2.5   MEDIUM (|5.3| ohm)
  Z0 = 71.0 ohm    Z0 = 65.7 ohm

Copper thickness    0.0315mm     0.0385mm    +0.4/-0.3   LOW (|0.7| ohm)
  Z0 = 68.6 ohm    Z0 = 67.9 ohm

TORNADO CHART:
Trace width   |============================================| 10.7 ohm
Dielectric h  |====================================|         8.0 ohm
Dielectric Er |==========================|                   5.3 ohm
Copper thick  |===|                                          0.7 ohm

KEY INSIGHT:
Trace width dominates. A +-0.013mm (+-0.5mil) manufacturing tolerance on
your 0.127mm trace causes +-5 ohm impedance swing. Your fab house quotes
+-0.025mm (+-1mil) tolerance on trace width, meaning your actual impedance
range is 58-79 ohm. This ALONE puts you outside your 50 ohm +-10% spec.

To reduce sensitivity: widen the trace. At w=0.227mm (target 50 ohm),
a +-1mil tolerance causes only +-2.5 ohm swing (50 +/-5%).
```

### Technical Implementation

```python
# New module: packages/solver/src/routeai_solver/si/sensitivity.py

class SensitivityAnalyzer:
    def sweep_impedance(self, base_params: dict, param_name: str,
                        variation_pct: float = 10.0, steps: int = 21) -> list[float]:
        """Sweep one parameter and return Z0 values."""
        base_val = base_params[param_name]
        results = []
        for i in range(steps):
            factor = 1.0 + variation_pct / 100 * (2 * i / (steps - 1) - 1)
            params = {**base_params, param_name: base_val * factor}
            z0 = microstrip_impedance(params["w"], params["h"], params["er"], params["t"]).z0
            results.append(z0)
        return results

    def tornado(self, base_params: dict, target_metric: str = "z0",
                variation_pct: float = 10.0) -> list[SensitivityResult]:
        """Run tornado analysis for all parameters."""
        results = []
        for param in base_params:
            sweep = self.sweep_impedance(base_params, param, variation_pct)
            delta = max(sweep) - min(sweep)
            results.append(SensitivityResult(param, delta, sweep))
        results.sort(key=lambda r: r.delta, reverse=True)
        return results
```

---

## Feature 10: Monte Carlo Tolerance Analysis

### What It Does

Runs thousands of impedance/timing calculations with randomly varied manufacturing tolerances to produce a statistical distribution. "If my fab's Er tolerance is +/-10% and trace width is +/-1mil, what percentage of boards will meet the 50 ohm +/-10% spec?"

### Why Current Tools Fail

Monte Carlo simulation in commercial tools is prohibitively expensive computationally. Each sample requires a full EM simulation. Running 10,000 samples at 10 minutes each = 69 days. Nobody does this.

### How LLM + Solver Enables It

Closed-form impedance equations execute in <1 microsecond. Running 100,000 Monte Carlo samples takes <1 second. The LLM:
1. Identifies the relevant tolerances (from the user's natural language or from fab capability databases)
2. Sets up the Monte Carlo run with proper statistical distributions
3. Runs the solver 100K times with randomized parameters
4. Computes yield (% of samples meeting spec), mean, sigma, and distribution shape
5. Recommends process changes or design changes to improve yield

### Example Scenario

```
User: "what if Er varies +/-10% and trace width varies +/-1mil?"

RouteAI: Monte Carlo tolerance analysis (100,000 samples)

Parameters:
  Trace width: 0.227mm nominal, +/-0.025mm (1mil), normal distribution, 3-sigma
  Dielectric Er: 4.3 nominal, +/-0.43 (10%), uniform distribution
  Dielectric h: 0.11mm nominal, +/-0.01mm (fab tolerance), normal, 3-sigma
  Copper t: 0.035mm nominal, +/-0.005mm, normal, 3-sigma

Target: 50 ohm +/-10% (45.0 to 55.0 ohm)

Results:
  Mean Z0: 50.1 ohm
  Std dev: 3.8 ohm
  Min:     38.2 ohm
  Max:     64.1 ohm
  Yield:   82.3% within spec

Distribution:
  <40    |##                                  |   1.2%
  40-45  |########                            |   8.4%
  45-50  |#########################           |  38.7%   PASS
  50-55  |#######################             |  43.6%   PASS
  55-60  |######                              |   7.1%
  >60    |#                                   |   1.0%

YIELD IS 82.3% -- below typical target of 99%.

The dominant variance contributor is dielectric Er (+/-10% uniform).
If you specify Er tolerance to the fab as +/-5% (costs ~$0.50/board more):
  Revised yield: 95.8%
If you also tighten trace width to +/-0.5mil (advanced fab, ~$1.00/board more):
  Revised yield: 99.4%

Alternatively: design for robustness. At w=0.24mm, the nominal Z0 shifts
to 48 ohm, but the 45-55 ohm yield improves to 91.2% even with +/-10% Er.
```

### Technical Implementation

```python
# New module: packages/solver/src/routeai_solver/si/monte_carlo.py

import numpy as np

class MonteCarloImpedance:
    def run(self, nominal: dict, tolerances: dict, target_z0: float,
            tolerance_pct: float = 10.0, n_samples: int = 100_000) -> MonteCarloResult:
        rng = np.random.default_rng(42)

        z0_samples = np.empty(n_samples)
        for i in range(n_samples):
            params = {}
            for param, nom_val in nominal.items():
                tol = tolerances.get(param, {"type": "normal", "sigma_pct": 1.0})
                if tol["type"] == "normal":
                    params[param] = rng.normal(nom_val, nom_val * tol["sigma_pct"] / 100 / 3)
                elif tol["type"] == "uniform":
                    half = nom_val * tol["range_pct"] / 100
                    params[param] = rng.uniform(nom_val - half, nom_val + half)
            z0_samples[i] = microstrip_impedance(
                params["w"], params["h"], params["er"], params["t"]).z0

        z_min = target_z0 * (1 - tolerance_pct / 100)
        z_max = target_z0 * (1 + tolerance_pct / 100)
        yield_pct = np.mean((z0_samples >= z_min) & (z0_samples <= z_max)) * 100

        return MonteCarloResult(
            mean=float(np.mean(z0_samples)),
            std=float(np.std(z0_samples)),
            min=float(np.min(z0_samples)),
            max=float(np.max(z0_samples)),
            yield_pct=yield_pct,
            samples=z0_samples,
        )
```

---

## Feature 11: Pre-Layout SI Estimation

### What It Does

Before any routing is done, estimates whether the design's signal integrity constraints are achievable given the component placement, stackup, and board dimensions. Answers: "Can I route DDR4 at 3200MT/s on this 4-layer board with these component positions?"

### Why Current Tools Fail

No commercial tool offers pre-layout SI estimation. Simulation requires routed traces to exist. Engineers place components, route the board, then discover SI problems, and must redo placement -- the most expensive iteration cycle in PCB design.

### How LLM + Solver Enables It

1. **Estimate trace lengths** from Manhattan distance between component pads (multiply by 1.3-1.5 routing overhead factor)
2. **Estimate impedance** from stackup (already known pre-layout)
3. **Estimate timing budget** from estimated trace lengths
4. **Estimate crosstalk risk** from component density and available routing area
5. **Estimate PDN feasibility** from plane overlap and cap placement area

### Example Scenario

```
User: "can I route DDR4 on 4 layers with this placement?"

RouteAI: Pre-layout SI estimation for DDR4 at 3200MT/s

Component placement analysis:
  U1 (STM32H7) center: (40, 35) mm
  U5 (DDR4 IC) center: (60, 35) mm
  Distance: 20mm center-to-center

Estimated trace lengths (Manhattan * 1.4 routing factor):
  DQ bus: 15-25mm (byte lane 0), 18-28mm (byte lane 1)
  Address/CMD: 22-35mm
  Clock: 25mm (matched to DQS)

Pre-layout assessment:

1. IMPEDANCE: FEASIBLE on 6-layer, DIFFICULT on 4-layer
   4-layer L1 microstrip (h=0.11mm): need 0.227mm width for 50 ohm.
   Available routing channel between ICs: 20mm wide, need to route 16 DQ +
   4 DQS + 14 ADDR + 2 CLK = 36 signals minimum.
   At 0.227mm width with 3W spacing (0.681mm pitch): 20mm / 0.681 = 29 tracks.
   INSUFFICIENT for 36 signals on one layer. Need 2 signal layers.
   On 4-layer: only L1 and L4 are signal layers. L4 is on opposite side of
   board from DDR ICs (through-hole via required for every signal). Not recommended.

2. TIMING: FEASIBLE
   Max DQ-to-DQS length delta (estimated): 10mm -> 67ps
   Budget: 50ps at 3200MT/s. MARGINAL.
   Length matching required to +/-5mm.

3. CONCLUSION: 4-layer is NOT recommended for DDR4 at 3200MT/s.
   Minimum: 6-layer (L1+L3 for DDR signals, L2=GND, L4=GND, L5=VDD, L6=bottom).
   Alternative: Reduce to DDR4-2400MT/s on 4-layer (relaxed timing, wider traces OK).
```

### Technical Implementation

This is primarily LLM reasoning + simple geometry calculations. Leverage the existing board model to extract component positions and compute Manhattan distances. The solver provides impedance calculations for the "what width do I need?" answer.

---

## Feature 12: Design Similarity Comparison

### What It Does

Compares the current design against a database of reference designs that are known to work (or known to have failed). "Your DDR4 layout is similar to reference design X which passed SI validation at 2400MT/s but failed at 3200MT/s because of insufficient trace spacing."

### Why Current Tools Fail

No commercial tool has a design similarity database. Each design is simulated in isolation. Engineers rely on tribal knowledge ("I did something similar 3 years ago and it worked").

### How LLM + Solver Enables It

1. **Feature extraction**: for each design, extract a fingerprint: stackup parameters, interface types, data rates, trace widths, trace lengths, layer assignments, decap counts, component density.
2. **Vector embedding**: embed the design fingerprint using the RAG system (already in `packages/intelligence/src/routeai_intelligence/rag/`).
3. **Similarity search**: find the K nearest reference designs using pgvector cosine similarity.
4. **LLM comparison**: explain what is similar, what is different, and what the implications are.

### Example Scenario

```
User: "has anyone built something like this before?"

RouteAI: Found 3 similar reference designs:

1. STM32F7-Discovery (92% similarity)
   Match: Same MCU family, DDR3L, 6-layer, similar board size
   Difference: Discovery uses DDR3L-1066 (your design: 1600MT/s)
   Discovery stackup: h=0.15mm vs your h=0.11mm
   Outcome: Discovery board validated, passes SI at 1066MT/s.
   Relevance: Your higher data rate needs tighter impedance control.

2. Community design "high-speed-stm32h7" (85% similarity)
   Match: Same MCU, DDR3L-1600, 4-layer
   Difference: Uses IS42S16320F (different DDR IC)
   Outcome: FAILED SI validation. DDR errors under thermal stress.
   Root cause: 4-layer stackup insufficient for DDR3L-1600 impedance.
   Relevance: DIRECTLY APPLICABLE. Your 4-layer design has the same risk.

3. NXP i.MX RT1060 EVK (78% similarity)
   Match: DDR3L-1600, 6-layer, similar trace lengths
   Difference: Different MCU, different DDR IC
   Outcome: Production-validated, ships in volume.
   Stackup: h=0.1mm, w=0.178mm for 50 ohm. Your stackup matches.
   Relevance: Confirms that 6-layer with h=0.1mm works for DDR3L-1600.
```

### Technical Implementation

```python
# New module: packages/intelligence/src/routeai_intelligence/rag/design_similarity.py

@dataclass
class DesignFingerprint:
    layer_count: int
    interfaces: list[str]
    max_data_rate_mts: float
    stackup_hash: str  # hash of stackup parameters
    component_density: float  # components per cm^2
    trace_width_distribution: list[float]  # histogram
    decap_count: int
    board_area_mm2: float

class DesignSimilarityEngine:
    def fingerprint(self, board: SolverBoard, schematic: ParsedSchematic) -> DesignFingerprint:
        """Extract design fingerprint for similarity matching."""
        ...

    async def find_similar(self, fingerprint: DesignFingerprint, k: int = 5) -> list[SimilarDesign]:
        """Query pgvector for similar reference designs."""
        embedding = await self.embeddings.embed(fingerprint.to_vector())
        return await self.retriever.query(embedding, k=k)
```

---

## Feature 13: Failure Mode Prediction

### What It Does

Predicts what will go wrong under specific operating conditions: voltage droop, temperature extremes, component aging, ESD events. "If your 3.3V rail drops to 3.0V during a current transient, here are the ICs that will malfunction and why."

### Why Current Tools Fail

No simulation tool connects electrical simulation results to component-level failure modes. An engineer must manually cross-reference simulation results with every datasheet's absolute maximum ratings, recommended operating conditions, and derating curves.

### How LLM + Solver Enables It

The LLM has absorbed knowledge from thousands of datasheets and application notes. Combined with the parsed design data:

1. **Extract operating conditions** for each component from RAG (Vcc_min, Vcc_max, Tj_max, input threshold voltages)
2. **Model power rail behavior** under transient load (PDN analyzer)
3. **Check each component** against its operating limits at the worst-case rail voltage
4. **Identify cascading failures**: if VCC_IO drops, output levels drop, downstream receivers may see invalid logic levels

### Example Scenario

```
User: "what happens if my 3.3V rail drops to 3.0V?"

RouteAI: Failure mode analysis for VCC_3V3 = 3.0V (nominal: 3.3V, -9.1%)

Component-by-component impact:

U1 (STM32H7): SAFE
  VDD range: 1.62V - 3.6V. At 3.0V: within spec.
  But: GPIO output VOH drops from 2.8V to 2.4V (0.7 * VDD).
  Impact on downstream components: see below.

U3 (W25Q128, QSPI Flash): WARNING
  VCC range: 2.7V - 3.6V. At 3.0V: within spec but near minimum.
  At 3.0V, max SPI clock drops from 133MHz to 104MHz per datasheet Table 9.
  If you're running QSPI at 133MHz: DATA CORRUPTION RISK.
  Fix: Reduce QSPI clock to 100MHz, or ensure rail stays above 3.1V.

U4 (ATECC608, Crypto IC): FAIL
  VCC range: 2.0V - 5.5V. At 3.0V: within spec. No issue.

U6 (TXB0108, Level Shifter): CRITICAL
  VCCA range: 1.65V - 3.6V. At 3.0V: within spec.
  But: VCCB is 5.0V. At VCCA=3.0V, the voltage delta is 2.0V.
  TXB0108 requires VCCA >= VCCB - 3.3V (= 1.7V). At 3.0V: OK.
  However, output drive strength degrades. Rise time at 3.0V: 12ns vs 8ns at 3.3V.
  Impact: I2C bus at 400kHz: OK. At 1MHz: MARGINAL (rise time spec: 120ns for FM+,
  but bus capacitance of 200pF adds 10ns -> total 22ns, still OK).

CASCADING FAILURE:
  STM32H7 GPIO VOH = 2.4V at VCC=3.0V.
  Signal SPI_CS connects to U3 (W25Q128).
  W25Q128 VIH = 0.7 * VCC = 0.7 * 3.0V = 2.1V.
  2.4V > 2.1V: PASS (barely).
  Noise margin: 2.4V - 2.1V = 0.3V. Normal margin at 3.3V: 0.49V.
  REDUCED NOISE MARGIN on SPI_CS. May be susceptible to coupled noise.

SUMMARY: At 3.0V, your QSPI Flash may fail at 133MHz clock. Reduce to 100MHz
or add a bulk cap (47uF) to keep rail above 3.1V during transients.
```

### Technical Implementation

Primarily LLM-driven with RAG retrieval of component operating conditions. The solver provides the PDN voltage droop calculation. The LLM performs the cross-referencing logic.

---

## Feature 14: Cost-Performance Trade-Off Analysis

### What It Does

Quantifies the cost impact of design decisions in both directions: "spending $0.50 more on Rogers material saves you a board respin" and "you can save $2/board by switching from 6 to 4 layers if you reduce DDR speed to 2400MT/s."

### Why Current Tools Fail

Simulation tools have no concept of cost. They tell you if a design meets specs, but not whether the cheapest approach was chosen. Engineers make cost decisions and performance decisions in separate conversations, often with different people.

### How LLM + Solver Enables It

1. **Cost database**: fab pricing models (layer count, board size, material, surface finish, tolerances), component pricing (decaps, CM chokes, ferrites).
2. **Performance calculator**: the solver engines quantify the performance impact of each option.
3. **LLM connects the two**: "Adding 4x 100nF caps ($0.08 total) closes your PDN gap and avoids a potential respin ($15,000 for 10 new prototypes + 2 weeks delay)."

### Example Scenario

```
User: "how can I reduce board cost?"

RouteAI: Cost optimization analysis

Current design cost breakdown (1000 units):
  PCB fabrication (6-layer, FR4, ENIG, 1.6mm):    $2.80/board
  Decoupling caps (12x 100nF + 4x 10uF):          $0.18/board
  CM choke (USB):                                  $0.15/board
  Total relevant components:                       $3.13/board

Optimization options (ranked by savings, with SI impact):

1. SWITCH TO 4-LAYER: Save $1.60/board
   SI Impact: DDR3L impedance degrades (68 ohm vs target 50 ohm).
   Mitigation: Reduce DDR speed to 1066MT/s. Application uses <10% memory
   bandwidth. LLM analysis of your firmware: max burst size 256 bytes,
   average throughput 50MB/s. DDR3L-1066 provides 4.2GB/s. SUFFICIENT.
   Verdict: VIABLE if application permits lower DDR speed.

2. SWITCH FROM ENIG TO HASL: Save $0.40/board
   SI Impact: None for your design (no BGA components requiring flatness).
   Reliability: HASL has thicker solder on pads, acceptable for LQFP/SOIC.
   Verdict: SAFE. Recommended.

3. REMOVE CM CHOKE ON USB: Save $0.15/board
   SI Impact: USB signal quality unaffected (it's for EMI only).
   EMI Impact: Estimated 6 dB increase in CM emissions at 480MHz.
   Current estimate: 27 dBuV/m (with choke). Without: 33 dBuV/m.
   FCC limit: 46 dBuV/m. Still passes with 13dB margin.
   Verdict: RISKY but feasible. Keep choke for safety.

4. REDUCE DECAP COUNT (12x -> 8x 100nF): Save $0.04/board
   SI Impact: PDN impedance at 50-200MHz increases from 120mohm to 180mohm.
   Target: 393mohm. Still within spec.
   Verdict: SAFE. The removed caps are redundant for your current draw.

TOTAL POTENTIAL SAVINGS: $2.04/board (if all applied)
At 1000 units: $2,040 savings.
At 10,000 units: $20,400 savings.
```

---

## Implementation Roadmap

### Phase 1 (V1 Core) -- Weeks 3-6

| Feature | Priority | Effort | Dependencies |
|---------|----------|--------|-------------|
| Feature 3: Instant Impedance/Crosstalk | P0 | 1 week | Existing ImpedanceEngine, CrosstalkEngine |
| Feature 5: PDN Quick Check | P0 | 1 week | Existing PDNAnalyzer |
| Feature 1: Design Feasibility Predictor | P0 | 2 weeks | Features 3 + 5 + LLM net classification |

### Phase 2 (V1.1) -- Weeks 7-12

| Feature | Priority | Effort | Dependencies |
|---------|----------|--------|-------------|
| Feature 2: Natural Language Simulation | P1 | 2 weeks | Phase 1 features + RAG |
| Feature 6: Thermal Hotspot Prediction | P1 | 1 week | New thermal network solver |
| Feature 8: What-If Stackup Analysis | P1 | 1 week | Phase 1 features |
| Feature 9: Sensitivity Analysis | P1 | 1 week | Impedance solver |
| Feature 10: Monte Carlo Tolerance | P1 | 1 week | Impedance solver + numpy |

### Phase 3 (V1.2) -- Weeks 13-18

| Feature | Priority | Effort | Dependencies |
|---------|----------|--------|-------------|
| Feature 7: EMI Prediction | P2 | 2 weeks | Return path analyzer + new EMI model |
| Feature 11: Pre-Layout SI Estimation | P2 | 1 week | Component placement data |
| Feature 13: Failure Mode Prediction | P2 | 2 weeks | RAG with component specs |

### Phase 4 (V2) -- Weeks 19-24

| Feature | Priority | Effort | Dependencies |
|---------|----------|--------|-------------|
| Feature 4: Eye Diagram Prediction | P2 | 3 weeks | New channel loss model |
| Feature 12: Design Similarity | P3 | 2 weeks | pgvector + reference design DB |
| Feature 14: Cost-Performance Trade-Off | P3 | 2 weeks | Cost database + all analysis engines |

---

## Architecture Integration

All features follow the existing RouteAI anti-hallucination pipeline:

```
User Query (natural language)
    |
    v
Gate 1: LLM generates structured SimulationConfig (JSON Schema validated)
    |       - Interface classification
    |       - Parameter extraction
    |       - Spec retrieval from RAG
    |       - Confidence score >= 0.95 for safety-critical
    v
Gate 2: Deterministic Solver Execution
    |       - ImpedanceEngine (Hammerstad-Jensen, IPC-2141)
    |       - CrosstalkEngine (coupled T-line model)
    |       - PDNAnalyzer (frequency-domain sweep)
    |       - ThermalNetworkAnalyzer (resistance network)
    |       - EMIPredictor (loop antenna model)
    |       - SensitivityAnalyzer (parameter sweep)
    |       - MonteCarloImpedance (statistical sampling)
    |       - EyeEstimator (analytical channel model)
    v
Gate 3: LLM Interprets Results + Human Review
    |       - Natural language explanation with citations
    |       - Visual diffs (before/after for what-if)
    |       - Actionable recommendations with costs
    |       - Confidence-tagged (high/medium/low per finding)
    v
Engineer Approves / Modifies / Rejects
```

### Key Principle

The LLM NEVER produces physics numbers. It translates intent to parameters and results to explanations. All numerical results come from deterministic solvers with known accuracy bounds (Hammerstad-Jensen: +/-2% vs measurement for microstrip, IPC-2141: +/-5% for crosstalk). This is what makes the system trustworthy for engineering use.
