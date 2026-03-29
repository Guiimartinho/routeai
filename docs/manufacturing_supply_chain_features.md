# RouteAI: Manufacturing, Supply Chain & Product Lifecycle Features

## Executive Summary

RouteAI already has a strong foundation: KiCad parsing, DRC engine, LLM-powered design review with ReAct loop and tool calling, BOM validation, and component selection. **What is completely missing is the bridge between design decisions and manufacturing/business outcomes.** The existing `AnalysisResult` captures impedance warnings, thermal warnings, and manufacturing warnings from DRC -- but none of these connect to actual fab house capabilities, real component pricing, supply chain lead times, or lifecycle risk.

This document specifies 15 features that close that gap. Each one is designed to integrate with the existing `routeai_intelligence` agent architecture (ReAct loop, tool calling, RAG retrieval, 3-gate validation) and the `routeai_solver`/`routeai_parsers` data models.

---

## Feature 1: Real-Time DFM Cost Annotation

### What It Does
As the engineer designs, every physical design choice (via size, trace width, board outline, drill count, copper weight, surface finish) is continuously evaluated against fabrication house capability profiles. Instead of a post-design DFM check that returns pass/fail, the system attaches **dollar amounts** to each decision. Annotations appear inline: "This 0.2mm via drill adds $0.08/board at JLCPCB because it falls below their standard 0.3mm minimum and triggers the 'advanced' price tier."

### Why No Current EDA Tool Does This
Altium, KiCad, and Cadence all have DFM rule checks, but they operate as binary pass/fail gates against abstract design rules. They have no concept of cost tiers, fab house pricing models, or the fact that a "passing" design at one fab may cost 3x more at another. EDA vendors do not want to maintain fab house pricing databases -- it changes weekly and requires business relationships with manufacturers.

### How LLM + Data Integration Enables It
1. **Fab house capability profiles** are stored as structured JSON in the RAG knowledge base. Each profile contains drill size tiers, layer count pricing, minimum feature size breakpoints, and surface finish costs. These are fetched periodically via API from fab houses that expose pricing (JLCPCB, PCBWay, OSH Park) or scraped from published capability tables.
2. The **LLM agent** receives the current board state (from the existing `convert_to_solver_board` pipeline) and the fab profile, then reasons about which design features trigger cost escalation. It can explain *why* in natural language: "Your 6 vias with 0.2mm drill push the board from Standard to Advanced capability class at JLCPCB, adding $0.48 total at qty 100."
3. A new **`dfm_cost_calc` tool** is added to the agent's tool registry (alongside `impedance_calc`, `clearance_lookup`, etc.) that accepts a board feature set and fab profile, and returns itemized cost impacts.

### Example Scenario
An engineer adds a BGA with 0.2mm vias on a 4-layer board destined for JLCPCB at 100 qty:

| Design Choice | Standard Tier | Triggered Tier | Cost Delta/Board |
|---|---|---|---|
| Via drill 0.2mm (48 vias) | 0.3mm min | Advanced ($0.01/via surcharge) | +$0.48 |
| 4-layer 1.0mm total | 1.6mm standard | Custom stackup | +$2.10 |
| ENIG finish | HASL default | ENIG upgrade | +$1.20 |
| Board 50x50mm | -- | -- | base $1.85 |
| **Total** | | | **$5.63 vs $1.85 base** |

The LLM surfaces: "Switching to 0.25mm vias saves $0.48/board and is still manufacturable at JLCPCB. Alternatively, use via-in-pad with resin fill at $0.12/via for BGA escape."

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    __init__.py
    fab_profiles.py        -- FabProfile dataclass, loader from RAG/JSON
    dfm_cost_engine.py     -- DFMCostEngine class, per-feature cost calculation
    dfm_tool.py            -- Tool handler for agent integration

Modify:
  packages/intelligence/src/routeai_intelligence/agent/tools.py
    -- Register DFM_COST_TOOL in ALL_TOOLS
  packages/cli/src/routeai_cli/analyzer.py
    -- Add dfm_cost field to AnalysisResult
    -- Call DFMCostEngine after DRC in analyze_project()
```

Key data structures:
- `FabProfile`: name, drill_tiers (list of {min_mm, max_mm, tier_name, cost_per_via}), layer_pricing (dict of layer_count -> base_cost), feature_surcharges, surface_finish_costs, minimum_features
- `DFMCostBreakdown`: per_feature_costs (list of {feature, current_value, tier_triggered, cost_delta, suggestion}), total_cost, fab_name, quantity

---

## Feature 2: Smart BOM Consolidation & Optimization

### What It Does
Analyzes the entire BOM and identifies opportunities to reduce unique part numbers by consolidating equivalent components. Goes beyond simple "same value" matching -- it understands that five different 100nF capacitors from three manufacturers with different voltage ratings can potentially be replaced by one part number with the highest voltage rating, saving procurement complexity and unit cost through volume pricing.

### Why No Current EDA Tool Does This
EDA tools treat each component as an independent entity. They have no concept of procurement economics (volume price breaks), no understanding that reducing unique line items reduces procurement overhead ($15-50 per unique MPN in purchasing labor), and no ability to reason about whether a higher-rated substitute is functionally safe in all positions.

### How LLM + Data Integration Enables It
1. The existing `BOMValidator` already groups components by reference prefix and checks voltage ratings. The new `BOMOptimizer` extends this by building a **consolidation graph**: components are nodes, edges represent "can be substituted" relationships with confidence scores.
2. The LLM reasons about substitutability by considering: voltage derating (already in `_VOLTAGE_DERATING_RULES`), dielectric compatibility (already in `_DIELECTRIC_GUIDELINES`), footprint compatibility, tolerance requirements, and thermal considerations.
3. **Supplier API integration** fetches real volume pricing to calculate actual savings. Price break data: qty 1, 10, 100, 1000, 10000 from Digi-Key/Mouser/LCSC APIs.

### Example Scenario
A 200-component design has 23 unique capacitor MPNs:

| Current State | After Consolidation |
|---|---|
| 5x different 100nF 0402 (Samsung, Murata, TDK, Yageo, Kemet) | 1x GRM155R71C104KA88D (Murata, 16V X7R) |
| 3x different 10uF 0603 (6.3V, 10V, 16V rated) | 1x GRM188R61A106KE69D (Murata, 10V X5R) |
| 4x different 1uF 0402 | 1x CL05A105KA5NQNC (Samsung, 25V X5R) |

Savings at 10,000 qty:
- Unit cost reduction: $0.12/board (volume pricing on consolidated MPNs)
- Procurement overhead: 11 fewer line items x $25 = $275/order
- Pick-and-place feeder slots freed: 11 (reduces assembly setup time by ~22 minutes)
- Annual saving at 10K/year: **$1,475**

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    bom_optimizer.py       -- BOMOptimizer class
    supplier_api.py        -- SupplierPricingClient (Digi-Key, Mouser, LCSC)

New agent tool:
  bom_optimize -- accepts BOM list, returns consolidation suggestions with savings

Modify:
  packages/intelligence/src/routeai_intelligence/agent/bom_validator.py
    -- Add consolidation check to validate() pipeline
  packages/cli/src/routeai_cli/analyzer.py
    -- Add bom_optimization field to AnalysisResult
```

---

## Feature 3: Supply Chain Risk Scoring

### What It Does
Every component in the BOM receives a risk score (0-100) based on: number of authorized distributors carrying stock, current lead time vs historical average, lifecycle status (active/NRND/obsolete/EOL), geographic concentration of manufacturing, number of qualified second sources, and historical allocation event frequency. The design gets an aggregate supply chain risk grade (A-F).

### Why No Current EDA Tool Does This
The existing `_check_lifecycle_status` in `bom_validator.py` checks against a static dict of 5 known obsolete parts. Real supply chain risk requires live distributor data, historical lead time trends, and geopolitical risk models that are completely outside the scope of traditional EDA. EDA companies are in the schematic/layout business, not the supply chain intelligence business.

### How LLM + Data Integration Enables It
1. **Live distributor API integration**: Query Octopart/Nexar API for real-time stock levels, lead times, and authorized distributor counts. Cache results with 24h TTL.
2. **Historical trend data**: Store lead time snapshots over time to detect trends (lead time increasing from 8 weeks to 26 weeks = early warning of allocation).
3. **LLM risk reasoning**: The agent interprets raw data and provides actionable context: "U3 (STM32F405RGT6) has dropped from 12 distributors to 3 in the last 6 months, lead time has increased from 12 to 52 weeks. This MCU was on allocation during the 2021 shortage. Recommend qualifying STM32F405RGT7 (temperature variant) as buffer stock or migrating to STM32G4 series."
4. **Geopolitical risk layer**: Flag components manufactured exclusively in single-country supply chains.

### Example Scenario
Design with 45 unique components:

| Component | Risk Score | Lead Time | Distributors | Flag |
|---|---|---|---|---|
| STM32F405RGT6 | 82/100 (HIGH) | 52 weeks | 3 | Allocation history, single-fab |
| ESP32-WROOM-32E | 45/100 (MEDIUM) | 16 weeks | 8 | Single manufacturer |
| GRM155R71C104KA88D | 8/100 (LOW) | 4 weeks | 22 | Commodity, multi-source |
| TPS54331DDAR | 35/100 (MEDIUM) | 12 weeks | 11 | Stable but TI-only |
| Custom connector XYZ | 91/100 (CRITICAL) | 26 weeks | 1 | Single source, custom |

**Design aggregate: Grade C (at risk)**
- 2 components with >40 week lead time
- 1 single-source custom part
- Recommendation: pre-order U3, qualify second-source connector, consider design change for ESP32

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/supply_chain/
    __init__.py
    risk_scorer.py         -- SupplyChainRiskScorer class
    distributor_api.py     -- OctopartClient, NexarClient wrappers
    lead_time_tracker.py   -- Historical lead time storage/trend analysis
    risk_models.py         -- RiskScore, DesignRiskGrade dataclasses

New agent tool:
  supply_chain_risk -- accepts component list, returns risk scores

Modify:
  packages/cli/src/routeai_cli/analyzer.py
    -- Add supply_chain_risk field to AnalysisResult
```

---

## Feature 4: Validated Alternative Component Suggestion

### What It Does
When suggesting an alternative component, the system does not just find a pin-compatible part -- it validates the entire circuit impact. If replacing an LDO, it checks: output capacitor ESR requirements, input capacitor value, enable pin polarity, thermal pad requirements, soft-start behavior, and PSRR differences. It generates a **migration checklist** with specific schematic and layout changes required.

### Why No Current EDA Tool Does This
The existing `suggest_alternatives` in `bom_validator.py` has a hardcoded alternatives database and checks basic compatibility ("drop-in", "footprint_change", "circuit_change"). But it cannot validate that a "footprint_change" alternative actually works in the specific circuit context. Real validation requires understanding the circuit topology around the component, which requires both schematic analysis and datasheet knowledge.

### How LLM + Data Integration Enables It
1. **Circuit context extraction**: From the existing parsed schematic, extract the component's local circuit neighborhood (connected nets, adjacent components, net voltages).
2. **Datasheet RAG retrieval**: Fetch application circuit requirements from both the current and proposed component's datasheets via the existing `datasheet_lookup` tool.
3. **LLM validation reasoning**: The agent compares the two datasheets in the context of the specific circuit: "Replacing AMS1117-3.3 with AP2112K-3.3: AP2112K requires minimum 1uF output capacitor (ESR < 1 ohm) vs AMS1117's 22uF (ESR 0.1-0.5 ohm). Your current C4 is 10uF X5R -- this meets AP2112K requirements but NOT AMS1117 requirements. Migration is favorable."
4. **Automated change list**: Output a structured list of required schematic changes, layout changes, and test procedure updates.

### Example Scenario
Replace obsolete LM7805 (TO-220) with TPS54331 (SOIC-8 buck converter):

**Migration Checklist:**
1. Remove: U1 (LM7805), C1 (100nF input), C2 (100nF output)
2. Add: U1-new (TPS54331 SOIC-8), L1 (4.7uH 1210 inductor), C1-new (10uF 25V input), C2-new (22uF 10V output), C3 (100nF bootstrap), R1 (100k), R2 (20k feedback divider)
3. Schematic changes: 7 net changes, 5 new components, 2 removed
4. Layout changes: Footprint from TO-220 (9x10mm) to SOIC-8 + inductor (12x8mm area), requires ground plane thermal pad
5. Performance change: Efficiency 45% -> 95% at 500mA, saves 1.25W thermal dissipation
6. Cost change: $0.35 -> $2.40 (BOM cost up, but eliminates $0 heatsink requirement)
7. Test procedure: Verify output ripple <50mVpp, load transient response, input voltage range 7-28V

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    component_migration.py  -- ComponentMigrationEngine
    circuit_context.py      -- Extract local circuit neighborhood from schematic

New agent tool:
  validate_alternative -- accepts current MPN, proposed MPN, circuit context

Modify:
  packages/intelligence/src/routeai_intelligence/agent/bom_validator.py
    -- Enhance suggest_alternatives() to call validation engine
```

---

## Feature 5: Real-Time Cost Estimation with Multi-Fab Quoting

### What It Does
Provides a continuously updated cost estimate for the PCB design as the engineer works. The estimate covers fabrication, component procurement, and assembly, broken down by fab house. Updates within seconds of any design change. Shows a running ticker: "Current board cost: $4.32 fab + $12.87 BOM + $1.45 assembly = $18.64/board @ 1000 qty (JLCPCB)".

### Why No Current EDA Tool Does This
Cost estimation requires three completely separate data domains: PCB fabrication pricing (depends on board area, layers, features, finish, quantity), component pricing (depends on MPNs, quantity, distributor), and assembly pricing (depends on component count, package types, technology mix). No EDA vendor maintains all three databases. They would need business relationships with dozens of manufacturers and distributors with frequently changing pricing.

### How LLM + Data Integration Enables It
1. **Fabrication cost model**: Parameterized pricing models for major fab houses. Inputs: board area (from `solver.outline`), layer count (from `solver.layers`), minimum feature sizes (from `solver.design_rules`), via counts/types (from `solver.vias`), surface finish, quantity.
2. **BOM cost aggregation**: Sum component costs from distributor APIs at the target quantity, applying volume price breaks.
3. **Assembly cost model**: Count SMD pads, through-hole components, BGA/QFN packages, unique feeders. Apply fab house assembly pricing formulas.
4. **LLM cost optimization**: The agent suggests design changes to hit a target cost: "To bring board cost under $15, consider: (1) switch from ENIG to HASL-LF saving $1.20, (2) consolidate capacitors saving $0.12, (3) reduce to 2-layer by removing internal ground plane and using stitching vias, saving $3.80 but requiring re-route of 12 differential pairs."

### Example Scenario
50x80mm, 4-layer board, 85 components, 10 unique MPNs after consolidation:

| Cost Category | JLCPCB (1000 qty) | PCBWay (1000 qty) | Eurocircuits (1000 qty) |
|---|---|---|---|
| PCB fabrication | $2.15 | $2.45 | $8.20 |
| Stencil (amortized) | $0.03 | $0.04 | $0.12 |
| Components (LCSC) | $8.42 | $8.42 | $11.30 (Mouser) |
| Assembly (SMT) | $1.85 | $2.10 | $4.50 |
| Assembly (THT, 3 parts) | $0.45 | $0.55 | $1.20 |
| Shipping (DDP, amortized) | $0.35 | $0.40 | $0.15 |
| Import duty (est.) | $0.28 | $0.28 | $0.00 |
| **Total/board** | **$13.53** | **$14.24** | **$25.47** |
| Lead time | 8 days | 10 days | 5 days |
| DFM compatibility | 98% (2 warnings) | 100% | 100% |

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    cost_estimator.py      -- CostEstimator class
    assembly_cost.py       -- AssemblyCostModel
    fab_cost.py            -- FabricationCostModel per fab house
    quote_aggregator.py    -- MultiQuoteAggregator

New agent tool:
  estimate_cost -- accepts board state + BOM + quantity, returns breakdown

Modify:
  packages/cli/src/routeai_cli/analyzer.py
    -- Add cost_estimate field to AnalysisResult
  packages/cli/src/routeai_cli/reporter.py
    -- Render cost comparison table in reports
```

---

## Feature 6: Panelization Optimization with Yield Analysis

### What It Does
Given a board outline, determines the optimal panel layout for manufacturing. Considers: panel size constraints per fab house, routing/V-score/tab routing options, fiducial placement, tooling hole requirements, mouse-bite spacing, and breakaway tab strength. Calculates **material yield** (boards per panel) and **manufacturing yield** (expected good boards per panel accounting for edge effects).

### Why No Current EDA Tool Does This
KiCad has KiKit for panelization but it only handles geometry. It does not consider fab house panel size constraints, yield analysis based on defect density models, or the cost tradeoff between more boards per panel (smaller margins) vs higher yield (larger margins). Altium has panelization but no yield model.

### How LLM + Data Integration Enables It
1. **Panel constraint database**: Each fab profile includes standard panel sizes (e.g., JLCPCB: 408x508mm working area), minimum board spacing, maximum panel thickness, V-score constraints.
2. **Optimization engine**: Brute-force + heuristic search over rotation (0/90), X/Y counts, and margin combinations to maximize boards-per-panel.
3. **Yield model**: Apply Poisson defect density model based on board area and fab house published defect rates. Edge boards have ~2% higher defect rate. Account for V-score breakage rate (~0.5%).
4. **LLM advisory**: "Your board's irregular outline wastes 34% of panel area. Adding a 2mm straight edge on the left side (board outline modification) increases yield from 12 to 16 boards/panel, reducing per-board fab cost from $2.15 to $1.72."

### Example Scenario
Board: 45x32mm rectangle with one corner chamfer

| Panel Config | Boards/Panel | Material Yield | Est. Mfg Yield | Effective Boards | Cost/Board |
|---|---|---|---|---|---|
| 4x10, 0deg, V-score | 40 | 78.2% | 97.8% | 39.1 | $1.54 |
| 5x8, 90deg, V-score | 40 | 76.9% | 97.8% | 39.1 | $1.54 |
| 4x10, 0deg, tab route | 40 | 72.1% | 98.5% | 39.4 | $1.53 |
| **5x9, 90deg, V-score** | **45** | **82.4%** | **97.5%** | **43.9** | **$1.37** |

Recommended: 5x9 at 90 degrees with V-score, saving $0.17/board ($170/1000 qty).

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    panelizer.py           -- PanelOptimizer class
    yield_model.py         -- ManufacturingYieldModel (Poisson defect density)

New agent tool:
  optimize_panel -- accepts board outline + fab profile, returns panel configs
```

---

## Feature 7: Testability Scoring & Test Point Suggestion

### What It Does
Analyzes the design for testability across three test strategies: ICT (in-circuit test), flying probe, and functional test. Assigns a testability score (0-100) and identifies: nets lacking test access, test points that are too close together (ICT probe grid: 100mil/2.54mm minimum), critical nets without test coverage, and power/ground accessibility. Automatically suggests test point locations.

### Why No Current EDA Tool Does This
DFT (design for test) is handled by separate tools (Mentor DFT, XJTAG) that cost $10K-50K and operate post-layout. There is no feedback loop into the design phase. KiCad has zero DFT capability. The reason is that testability analysis requires understanding circuit function (which nets are "critical"), not just geometry.

### How LLM + Data Integration Enables It
1. **Net criticality classification**: The LLM classifies nets based on circuit function: power rails (must test), clock signals (must test), high-speed data (should test), GPIO (optional), ground (reference only). Uses the existing schematic parsed data.
2. **Physical accessibility analysis**: From the board layout, determine which nets have accessible pads (SMD pad exposed, via accessible, dedicated test point present). Calculate ICT fixture grid conflicts.
3. **Test point placement**: Where test points are needed, suggest locations on the PCB that avoid mechanical conflicts, are accessible on the test side (typically bottom), and meet minimum spacing.
4. **Test strategy recommendation**: Based on volume, board complexity, and component types, recommend optimal test strategy with cost per test.

### Example Scenario
85-component mixed-signal board:

| Metric | Score | Detail |
|---|---|---|
| Net coverage (ICT) | 72% | 156/217 nets accessible |
| Probe spacing compliance | 85% | 12 conflicts in BGA area |
| Power rail access | 100% | All 5 rails have test points |
| Clock signal access | 50% | 25MHz XTAL net has no test access |
| Overall testability | 68/100 | |

Suggestions:
1. Add test point on NET-XTAL_OUT (board bottom, near U1 pin 8) -- covers 25MHz clock
2. Move TP4 2.1mm east to resolve ICT grid conflict with TP7
3. Add ground test point near J3 for flying probe reference
4. Estimated test coverage with changes: 89% (ICT), cost $0.12/board at 10K qty

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    testability.py         -- TestabilityAnalyzer class
    test_point_placer.py   -- TestPointSuggestionEngine

New agent tool:
  analyze_testability -- accepts board + schematic, returns score + suggestions

Modify:
  packages/cli/src/routeai_cli/analyzer.py
    -- Add testability_report field to AnalysisResult
```

---

## Feature 8: Assembly Sequence Optimization

### What It Does
Analyzes the component placement and generates an optimized assembly sequence considering: reflow profile compatibility (components sorted by thermal mass), component height (tall components placed after short ones to avoid shadowing), paste-in-hole vs wave solder decisions, double-sided assembly sequencing (which side first), and component orientation for pick-and-place efficiency (minimize head rotation).

### Why No Current EDA Tool Does This
Assembly sequence is the contract manufacturer's problem -- EDA tools stop at generating Gerbers and pick-and-place files. But design decisions directly affect assembly cost and yield: placing a tall electrolytic capacitor next to a fine-pitch QFN creates a reflow shadow that causes solder defects. The EDA tool could catch this during design but currently does not.

### How LLM + Data Integration Enables It
1. **Component height database**: Extract from footprint library or component specs. Classify as low-profile (<2mm), medium (2-5mm), tall (>5mm).
2. **Thermal mass estimation**: Based on package type and pad area, estimate thermal mass affecting reflow profile.
3. **Shadow analysis**: For each component, check if taller neighboring components within 3mm create reflow shadows on any side.
4. **LLM reasoning**: "C14 (10mm tall electrolytic) is 1.5mm from U3 (QFN-48, 0.5mm pitch). During reflow, C14 will shadow U3's south-side pads, likely causing insufficient solder joints on pins 25-36. Recommendation: Move C14 at least 4mm from U3, or switch C14 to a 4mm-tall polymer capacitor (e.g., EEH-ZC1V100P)."

### Example Scenario
Top-side assembly of 65 SMD components:

**Issues Found:**
1. SEVERITY: HIGH -- D3 (5mm tall LED) within 2mm of U2 (QFP-64, 0.5mm pitch). Reflow shadow risk on 8 pins.
2. SEVERITY: MEDIUM -- Mixed reflow profiles: 3 components require 260C peak, 2 components rated max 250C. Consider split reflow or component substitution.
3. SEVERITY: LOW -- 4 SOT-23 components oriented at 45deg. Standardize to 0/90deg for pick-and-place efficiency (saves ~2 seconds/board).

**Optimized Sequence:**
1. First reflow (top): All SMD components < 3mm height (58 components)
2. Second reflow (bottom): Bottom-side SMD (7 components)
3. Wave solder: 3 THT connectors
4. Manual: 2 press-fit components

Estimated cycle time: 4.2 minutes/board (vs 5.1 minutes unoptimized)

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    assembly_optimizer.py  -- AssemblySequenceOptimizer
    shadow_analyzer.py     -- ReflowShadowAnalyzer

New agent tool:
  optimize_assembly -- accepts board + component heights, returns sequence + warnings
```

---

## Feature 9: Solder Paste Stencil Optimization

### What It Does
Analyzes every pad on the board and recommends stencil aperture modifications for optimal solder paste volume. Considers: area ratio rules for fine-pitch components, aperture reduction for thermal pads (to prevent tombstoning and voiding), home plate/inverse home plate aperture shapes for QFN center pads, and paste volume matching for mixed-technology boards.

### Why No Current EDA Tool Does This
KiCad and Altium allow custom solder paste layers but provide zero guidance on aperture design. Stencil optimization is tribal knowledge held by process engineers at contract manufacturers. IPC-7525B provides guidelines but applying them requires understanding each pad's context (is it a thermal pad? a fine-pitch pad? a wave-solder pad?).

### How LLM + Data Integration Enables It
1. **Pad context classification**: Using the existing `SolverPad` data, classify each pad: fine-pitch SMD (<0.5mm pitch), standard SMD, thermal pad, through-hole, BGA.
2. **Area ratio calculation**: For each pad, compute stencil area ratio (aperture area / aperture wall area) and flag pads below 0.66 (IPC-7525B minimum for adequate paste release).
3. **Aperture recommendation engine**: Apply rules from IPC-7525B and component-specific guidelines (BGA: 1:1 aperture, QFN center: segmented with 50-75% coverage, fine-pitch: reduce width by 10%).
4. **LLM interpretation**: "U5 (QFN-48, 0.4mm pitch) center thermal pad is 5.0x5.0mm. Recommended: segment into 3x3 grid of 1.4x1.4mm apertures with 0.3mm gaps (56% area coverage). This prevents center pad voiding while maintaining thermal contact. Current design has 100% coverage which will cause 40-60% void rate per IPC-7093."

### Example Scenario
Board with 1 QFN-48, 2 SOT-23, 45 passives (0402), 1 BGA-256:

| Pad Type | Count | Default Aperture | Optimized Aperture | Impact |
|---|---|---|---|---|
| QFN center pad | 1 | 5x5mm (100%) | 3x3 grid, 1.4x1.4mm (56%) | Void rate: 55% -> 12% |
| BGA 0.5mm pitch | 256 | 0.28mm round (100%) | 0.25mm round (90%) | Bridges: 2.1% -> 0.3% |
| 0402 passives | 90 pads | 0.5x0.6mm (100%) | 0.45x0.55mm (90%) | Tombstone rate: 1.5% -> 0.4% |
| SOT-23 | 6 pads | Standard | No change | -- |

**Predicted first-pass yield improvement: 94.2% -> 98.7%**

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    stencil_optimizer.py   -- StencilApertureOptimizer
    area_ratio.py          -- AreaRatioCalculator (IPC-7525B)

New agent tool:
  optimize_stencil -- accepts pad list, returns aperture recommendations
```

---

## Feature 10: Conformal Coating Analysis

### What It Does
Identifies areas requiring conformal coating keep-outs (connectors, test points, switches, adjustment components, heat sinks), areas requiring enhanced coverage (high-voltage regions, moisture-sensitive traces), and generates a conformal coating map with coverage requirements per IPC-A-610 Class 2/3.

### Why No Current EDA Tool Does This
Conformal coating is considered a manufacturing process decision, not a design decision. But design choices directly affect coatability: component spacing affects spray coverage, tall components create shadow zones, and connector keep-outs must be designed in. No EDA tool maintains a database of which components need keep-outs.

### How LLM + Data Integration Enables It
1. **Component classification**: Automatically classify each component as: must-coat (ICs, passives), keep-out (connectors, buttons, test points, headers), or conditional (LEDs, displays -- coat body, not lens).
2. **Coverage analysis**: Simulate spray/dip/selective coating coverage based on component heights and spacing. Identify shadow zones where spray coating cannot reach.
3. **Keep-out zone generation**: Generate coating keep-out zones for the board with appropriate margins (typically 1mm beyond component body for connectors).
4. **LLM guidance**: "J1 (USB-C connector) requires 2mm keep-out zone for conformal coating. Current design has R12 within 0.8mm of J1 -- either move R12 or mask R12 during coating. Cost impact of selective masking: $0.08/board."

### Example Scenario
IoT sensor board operating in 0-85C, 95% RH environment:

- 12 components identified as keep-out (2 connectors, 1 switch, 3 test points, 6 programming headers)
- 3 shadow zones identified (behind 8mm tall capacitor C4, under J2 overhang, between U1 and U2)
- IPC-A-610 Class 2 minimum coating thickness: 25um (acrylic), 50um (urethane)
- Recommended: selective coating with UV cure acrylic, estimated cost $0.32/board
- Alternative: full dip with masking, estimated cost $0.45/board

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    conformal_coating.py   -- ConformalCoatingAnalyzer

New agent tool:
  analyze_coating -- accepts board + component list, returns coating map + keep-outs
```

---

## Feature 11: End-of-Life Planning & Migration Path

### What It Does
Monitors all components for lifecycle status and proactively generates migration plans before components go EOL. For each at-risk component, provides: timeline (NRND date, last-buy date, last-ship date), drop-in replacements, near-drop-in replacements requiring minor changes, and full redesign alternatives with effort estimates.

### Why No Current EDA Tool Does This
The existing `_check_lifecycle_status` in `bom_validator.py` checks 5 hardcoded parts. Real EOL monitoring requires: continuous lifecycle data feeds (from IHS Markit/SiliconExpert/Z2Data), predictive modeling (components in declining volume are likely to go NRND), and migration planning that considers circuit impact. This is a data business, not a design tool feature.

### How LLM + Data Integration Enables It
1. **Lifecycle data integration**: Periodic sync with SiliconExpert or Z2Data APIs for lifecycle status of all BOM components. Store historical status changes.
2. **Predictive risk model**: Components with declining order volume, fewer distributors over time, or manufacturer consolidation events get flagged as at-risk even before official NRND announcement.
3. **Migration path generation**: The LLM uses the existing `ComponentSelector` and `suggest_alternatives` infrastructure to generate validated migration paths. It adds effort estimation: "Replacing STM32F103 with STM32G0: 2 weeks firmware porting, 1 week PCB respin (different pinout), 1 week test."
4. **Impact analysis**: Cross-reference with test procedures, regulatory certifications, and customer-facing documentation that would need updating.

### Example Scenario
Annual lifecycle review of a 5-year-old product:

| Component | Status | Risk | Last Buy | Migration Path | Effort |
|---|---|---|---|---|---|
| STM32F103C8T6 | NRND | CRITICAL | 2026-12 | STM32G071RBT6 (pin remap needed) | 3 weeks |
| LM2596S-5.0 | Active-declining | HIGH | est. 2027 | TPS54331 (circuit redesign) | 1 week |
| SN74LVC1G08 | Active | LOW | n/a | No action needed | 0 |
| FT232RL | Active-stable | MEDIUM | n/a | CH340G (driver change) or CP2102N | 1 week |
| Custom crystal 25MHz | Active | LOW | n/a | Multiple sources available | 0 |

**Recommended action plan:**
1. Immediate: Place last-time-buy for STM32F103C8T6 (est. 18 months of stock at current consumption)
2. Q2 2026: Begin STM32G071 migration (firmware port + PCB respin)
3. Q4 2026: Qualify TPS54331 as LM2596 replacement (proactive, before EOL announcement)
4. Total redesign budget: $15,000-25,000, 6-8 weeks engineering time

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/supply_chain/
    lifecycle_monitor.py   -- LifecycleMonitor class
    migration_planner.py   -- MigrationPathGenerator
    eol_predictor.py       -- EOLPredictiveModel

New agent tool:
  plan_migration -- accepts component MPN, returns migration paths with effort estimates

Modify:
  packages/intelligence/src/routeai_intelligence/agent/bom_validator.py
    -- Replace _OBSOLETE_PARTS dict with live lifecycle data lookup
```

---

## Feature 12: Manufacturing Yield Prediction

### What It Does
Predicts first-pass yield (FPY) for the board based on: component-level defect rates (per IPC-7912), solder joint count and type distribution, board complexity metrics, process capability indices, and specific design risk factors identified during DFM analysis. Provides both an overall yield number and a per-component breakdown.

### Why No Current EDA Tool Does This
Yield prediction requires statistical process data that EDA tools do not have. IPC-7912 provides defect opportunity models but applying them requires knowing: the specific manufacturing process capability (which varies by fab house), the solder joint distribution by type (which requires BOM + footprint analysis), and design-specific risk factors (which the DFM analysis produces).

### How LLM + Data Integration Enables It
1. **Defect opportunity counting**: For each component, count solder joints by type (gull-wing, J-lead, BGA ball, passive termination, through-hole). Each type has a baseline defect rate per IPC-7912.
2. **Process capability adjustment**: Multiply baseline defect rates by process capability factor for the target fab house (better factories have lower multipliers). JLCPCB typical: 0.8x baseline. Tier-1 CM: 0.5x baseline.
3. **Design risk adjustment**: Multiply by factors from DFM analysis: fine-pitch QFN (+15% defect rate), 0201 passives (+10%), BGA under 0.4mm pitch (+25%), mixed technology (+5%).
4. **LLM interpretation**: "Predicted first-pass yield: 96.8%. Primary yield detractors: U3 (BGA-256, 0.5mm pitch) contributes 1.2% of total defect probability, Q1-Q4 (SOT-323) contribute 0.8% due to tombstone risk on asymmetric pads. Improving Q1-Q4 pad design per IPC-7351B reduces predicted FPY loss by 0.5%."

### Example Scenario
85-component board, 412 solder joints:

| Component Category | Joints | Base DPMO | Adjusted DPMO | Yield Contribution |
|---|---|---|---|---|
| 0402 passives (45) | 90 | 50 | 40 | 99.64% |
| SOT-23 (8) | 24 | 30 | 24 | 99.94% |
| QFP-64 (1) | 64 | 80 | 64 | 99.59% |
| BGA-256 (1) | 256 | 120 | 96 | 97.54% |
| QFN-48 (2) | 98 | 100 | 80 | 99.22% |
| THT connectors (3) | 24 | 20 | 16 | 99.96% |
| **Board total** | **556** | | | **96.0%** |

At 1000 boards: expect ~960 good boards first pass, 40 requiring rework at ~$5/board = $200 rework cost.

With stencil optimization (Feature 9): yield improves to 98.2%, saving $22/1000 boards in rework.

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    yield_predictor.py     -- YieldPredictor class (IPC-7912 model)
    dpmo_database.py       -- DefectOpportunityDatabase (per package type)

New agent tool:
  predict_yield -- accepts board + BOM + fab profile, returns yield prediction

Modify:
  packages/cli/src/routeai_cli/analyzer.py
    -- Add yield_prediction field to AnalysisResult
```

---

## Feature 13: Revision Management with Impact Analysis

### What It Does
When an engineer changes any design element (component value, footprint, net, trace width), the system identifies all downstream impacts: affected test procedures, regulatory documents (FCC/CE test reports that reference specific component values), manufacturing work instructions, programming files, and other designs sharing the same component. Generates a change impact report before the change is committed.

### Why No Current EDA Tool Does This
EDA tools track schematic/layout revisions through version control (Git, SVN, Altium Vault) but have zero visibility into the documents and processes that reference design data. A resistor value change in the schematic is a one-line diff in Git, but it may invalidate an EMC test report that cost $15,000 to produce. This cross-domain traceability requires a document management system integrated with the EDA tool.

### How LLM + Data Integration Enables It
1. **Design artifact registry**: Maintain a registry of all documents and processes that reference design data: test procedures, regulatory filings, manufacturing work instructions, firmware configurations, customer specifications.
2. **Cross-reference indexing**: RAG-index all registered documents. When a design change occurs, query the index for references to the changed element.
3. **LLM impact assessment**: The agent reads the matched document sections and assesses whether the design change actually invalidates them: "Changing R7 from 10k to 12k: This resistor is referenced in EMC test report #FCC-2024-001 Section 4.3 as part of the input filter. The filter corner frequency changes from 15.9kHz to 13.3kHz. This MAY affect conducted emissions results and likely requires re-test (estimated cost: $3,500)."

### Example Scenario
Engineer changes R7 from 10k to 4.7k in an EMC input filter:

**Impact Analysis Report:**

| Affected Artifact | Section | Impact | Severity | Action Required |
|---|---|---|---|---|
| FCC Test Report #2024-001 | 4.3 Input Filter | Filter cutoff changes 15.9kHz -> 33.9kHz | HIGH | Re-test required ($3,500) |
| CE DoC #2024-003 | Annex B | References same filter | HIGH | Resubmit after FCC re-test |
| Test Procedure TP-007 | Step 12 | Verifies filter response | MEDIUM | Update expected values |
| Manufacturing WI MW-042 | Table 3 | BOM reference | LOW | Update BOM table |
| Customer Spec CS-2024-A | Section 5.1 | References EMI performance | MEDIUM | Review with customer |

**Estimated cost of change: $4,200 (re-test) + $800 (documentation) + $500 (customer review) = $5,500**
**Estimated timeline: 4-6 weeks (test lab scheduling)**

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/lifecycle/
    __init__.py
    revision_tracker.py    -- RevisionTracker, DesignChange dataclass
    impact_analyzer.py     -- ImpactAnalyzer (RAG-powered cross-reference)
    artifact_registry.py   -- ArtifactRegistry (document index)

New agent tool:
  analyze_change_impact -- accepts design change description, returns impact report
```

---

## Feature 14: Carbon Footprint Estimation

### What It Does
Estimates the cradle-to-gate carbon footprint of each board in kg CO2-equivalent, broken down by: PCB substrate manufacturing, copper processing, solder paste, component manufacturing, assembly energy, logistics. Provides comparison against industry benchmarks and suggests reduction opportunities.

### Why No Current EDA Tool Does This
Environmental impact assessment is considered outside the scope of EDA. However, increasing regulatory pressure (EU CSRD, SEC climate disclosure rules) and customer requirements (Scope 3 emissions reporting) mean that product-level carbon data is becoming mandatory. Currently this requires expensive lifecycle assessment (LCA) consultants.

### How LLM + Data Integration Enables It
1. **Material carbon factors**: Database of CO2e per unit for PCB materials (FR-4: ~12 kg CO2e/m2 for 4-layer, copper: ~3.8 kg CO2e/kg, ENIG gold: ~12,400 kg CO2e/kg, solder paste: ~3.1 kg CO2e/kg).
2. **Component carbon factors**: Estimate based on package type, die size, and wafer process node (smaller nodes = more process energy). Semiconductor: ~1-20g CO2e per IC depending on complexity.
3. **Assembly energy model**: Energy consumption per reflow cycle, pick-and-place operation, testing step. Typical: 0.05-0.2 kWh per board.
4. **LLM optimization**: "Your ENIG surface finish adds 0.08 kg CO2e/board (34% of total PCB substrate footprint). Switching to OSP saves 0.07 kg CO2e but limits shelf life to 6 months. HASL-LF saves 0.05 kg CO2e with no shelf life limitation."

### Example Scenario
50x80mm, 4-layer board, 85 components:

| Category | kg CO2e/board | % of Total |
|---|---|---|
| FR-4 substrate | 0.048 | 28% |
| Copper (4 layers, 1oz) | 0.022 | 13% |
| ENIG surface finish | 0.031 | 18% |
| Solder paste | 0.008 | 5% |
| Components (total) | 0.042 | 25% |
| Assembly energy | 0.012 | 7% |
| Testing | 0.003 | 2% |
| Packaging | 0.004 | 2% |
| **Total** | **0.170** | **100%** |

At 10,000 units/year: **1,700 kg CO2e** (equivalent to ~1 round-trip flight London-NYC)

Reduction opportunities:
1. Switch ENIG to HASL-LF: -0.020 kg/board (-12%)
2. Reduce board area by 15% (layout optimization): -0.011 kg/board (-6%)
3. Use LCSC assembly (renewable energy grid mix): -0.004 kg/board (-2%)

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/lifecycle/
    carbon_estimator.py    -- CarbonFootprintEstimator
    material_factors.py    -- CO2e emission factors database

New agent tool:
  estimate_carbon -- accepts board + BOM, returns footprint breakdown
```

---

## Feature 15: Thermal-Aware DFM with Reflow Simulation

### What It Does
Simulates the thermal profile during reflow soldering and identifies components that may experience thermal damage, insufficient solder melting, or tombstoning due to thermal imbalance. Considers component thermal mass, pad geometry, copper pour connectivity (heat sinking effect on pads), and proximity to board edges (faster heating).

### Why No Current EDA Tool Does This
Reflow simulation requires finite-element thermal modeling that is computationally expensive and requires detailed material property data. Dedicated tools (e.g., Siemens Valor Process Preparation) cost $50K+ and are used only by large contract manufacturers. No EDA tool includes even simplified reflow models.

### How LLM + Data Integration Enables It
1. **Simplified thermal model**: Rather than full FEA, use a lumped-parameter thermal model. Each component is a thermal mass connected to the board via its pad thermal resistance. Board regions are connected via copper thermal conductance.
2. **Thermal imbalance detection**: For two-terminal passives (resistors, capacitors), calculate thermal imbalance between pads. If one pad is connected to a copper pour (heat sink) and the other is on a narrow trace, the pour side heats more slowly, causing tombstoning. Flag if imbalance exceeds 5C.
3. **BGA/QFN center pad analysis**: Predict thermal via effectiveness for center pads connected to internal ground planes.
4. **LLM advisory**: "R23 (0402, 100nF) has its pad 1 connected to a 15mm2 copper pour (GND) and pad 2 on a 0.2mm trace. Thermal simulation predicts 12C temperature differential during reflow ramp, exceeding the 5C tombstone threshold. Recommendation: Add thermal relief on pad 1 (4 spokes, 0.3mm width) to reduce thermal imbalance to ~4C."

### Example Scenario
Board thermal simulation at 2C/second ramp rate:

| Component | Issue | Temp Delta | Risk Level | Fix |
|---|---|---|---|---|
| R23 (0402) | Pad 1 on GND pour, pad 2 on trace | 12C | HIGH (tombstone) | Add thermal relief |
| C7 (0603) | Near board edge, 8C hotter than center | 8C | MEDIUM (early reflow) | Move 5mm from edge |
| U3 (QFN-48) | Center pad needs 14 thermal vias, has 6 | n/a | LOW (voiding risk) | Add 8 vias, 0.3mm drill |
| J1 (USB-C) | High thermal mass, last to reach reflow temp | 15C below peak | MEDIUM (cold joint) | Extend soak zone 30s |

**Recommended reflow profile adjustment:** Extend soak zone from 60s to 90s to allow J1 thermal equalization.

### Technical Implementation
```
New files:
  packages/intelligence/src/routeai_intelligence/manufacturing/
    thermal_reflow.py      -- ReflowThermalSimulator (lumped parameter)
    tombstone_analyzer.py  -- TombstoneRiskAnalyzer

New agent tool:
  simulate_reflow -- accepts board + component thermal data, returns thermal analysis
```

---

## Integration Architecture

All 15 features integrate into the existing RouteAI architecture through three extension points:

### 1. New Agent Tools (registered in `tools.py`)
```python
# Add to ALL_TOOLS list in tools.py:
DFM_COST_TOOL          # Feature 1
BOM_OPTIMIZE_TOOL      # Feature 2
SUPPLY_CHAIN_RISK_TOOL # Feature 3
VALIDATE_ALT_TOOL      # Feature 4
ESTIMATE_COST_TOOL     # Feature 5
OPTIMIZE_PANEL_TOOL    # Feature 6
TESTABILITY_TOOL       # Feature 7
ASSEMBLY_OPT_TOOL      # Feature 8
STENCIL_OPT_TOOL       # Feature 9
COATING_ANALYSIS_TOOL  # Feature 10
MIGRATION_PLAN_TOOL    # Feature 11
YIELD_PREDICT_TOOL     # Feature 12
IMPACT_ANALYSIS_TOOL   # Feature 13
CARBON_ESTIMATE_TOOL   # Feature 14
REFLOW_SIM_TOOL        # Feature 15
```

### 2. Extended AnalysisResult (in `analyzer.py`)
```python
@dataclass
class AnalysisResult:
    # ... existing fields ...

    # Manufacturing (Features 1, 6, 8, 9, 15)
    dfm_cost_breakdown: DFMCostBreakdown | None = None
    panel_optimization: PanelConfig | None = None
    assembly_sequence: AssemblySequence | None = None
    stencil_recommendations: list[ApertureRecommendation] = field(default_factory=list)
    reflow_analysis: ReflowAnalysis | None = None

    # Supply Chain (Features 3, 11)
    supply_chain_risk: DesignRiskGrade | None = None
    eol_alerts: list[EOLAlert] = field(default_factory=list)

    # Cost (Features 2, 5)
    bom_optimization: BOMOptimizationReport | None = None
    cost_estimate: MultiQuoteResult | None = None

    # Quality (Features 7, 10, 12)
    testability_score: TestabilityReport | None = None
    coating_analysis: CoatingMap | None = None
    yield_prediction: YieldPrediction | None = None

    # Lifecycle (Features 4, 13, 14)
    migration_paths: list[MigrationPath] = field(default_factory=list)
    carbon_footprint: CarbonFootprint | None = None
```

### 3. New Package Structure
```
packages/intelligence/src/routeai_intelligence/
    manufacturing/           # Features 1, 6, 7, 8, 9, 10, 12, 15
        __init__.py
        fab_profiles.py
        dfm_cost_engine.py
        bom_optimizer.py
        panelizer.py
        testability.py
        assembly_optimizer.py
        stencil_optimizer.py
        conformal_coating.py
        yield_predictor.py
        thermal_reflow.py
    supply_chain/            # Features 3, 11
        __init__.py
        risk_scorer.py
        distributor_api.py
        lifecycle_monitor.py
        migration_planner.py
    lifecycle/               # Features 13, 14
        __init__.py
        revision_tracker.py
        impact_analyzer.py
        carbon_estimator.py
    cost/                    # Features 2, 5
        __init__.py
        cost_estimator.py
        supplier_api.py
        quote_aggregator.py
```

### External API Integrations Required
| API | Features | Purpose | Cost |
|---|---|---|---|
| JLCPCB/PCBWay pricing | 1, 5, 6 | Fab pricing, assembly pricing | Free (public pricing) |
| Octopart/Nexar | 3, 11 | Stock levels, lead times, lifecycle | $99/mo (basic) |
| Digi-Key/Mouser | 2, 5 | Component pricing, volume breaks | Free (partner API) |
| LCSC | 2, 5 | Component pricing for China assembly | Free |
| SiliconExpert | 11 | Lifecycle status, cross-references | $500/mo |

---

## Prioritization Matrix

| Feature | User Value | Implementation Effort | Data Dependency | Recommended Phase |
|---|---|---|---|---|
| F5: Real-time cost estimation | Very High | Medium | Medium (pricing APIs) | Phase 1 |
| F3: Supply chain risk scoring | Very High | Medium | High (distributor APIs) | Phase 1 |
| F1: Real-time DFM cost annotation | High | Medium | Medium (fab profiles) | Phase 1 |
| F2: Smart BOM consolidation | High | Low | Low (existing BOM data) | Phase 1 |
| F12: Yield prediction | High | Medium | Low (IPC-7912 tables) | Phase 2 |
| F7: Testability scoring | High | Medium | Low (board geometry) | Phase 2 |
| F4: Validated alternatives | High | Medium | Medium (datasheet RAG) | Phase 2 |
| F11: EOL planning | High | Low-Medium | High (lifecycle APIs) | Phase 2 |
| F9: Stencil optimization | Medium | Low | Low (IPC-7525B rules) | Phase 2 |
| F8: Assembly sequence | Medium | Medium | Low (component data) | Phase 3 |
| F6: Panelization optimization | Medium | Medium | Low (fab profiles) | Phase 3 |
| F15: Thermal reflow simulation | Medium | High | Low (material data) | Phase 3 |
| F13: Revision impact analysis | Medium | High | High (document index) | Phase 3 |
| F10: Conformal coating | Low-Medium | Low | Low (component data) | Phase 3 |
| F14: Carbon footprint | Low-Medium | Low | Medium (emission factors) | Phase 3 |

**Phase 1** (MVP, 8-12 weeks): Features 1, 2, 3, 5 -- delivers immediate, measurable cost savings
**Phase 2** (Quality, 8-12 weeks): Features 4, 7, 9, 11, 12 -- reduces manufacturing defects and supply risk
**Phase 3** (Complete platform, 12-16 weeks): Features 6, 8, 10, 13, 14, 15 -- full lifecycle coverage
