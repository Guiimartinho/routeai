# RouteAI Feature Analysis: Documentation, Knowledge Management & Collaboration

**Author:** Hardware Engineering Lead / AI Product Strategy
**Date:** 2026-03-14
**Scope:** 13 feature concepts for eliminating the 40% non-design engineering time tax
**Status:** Architecture analysis complete -- ready for prioritization

---

## Executive Summary

PCB engineers spend roughly 40% of their time on tasks that are NOT designing circuits or laying out boards: reading datasheets, writing documentation, explaining decisions to colleagues, tracking component changes, and preparing regulatory submissions. Every one of these tasks involves understanding natural language technical documents and producing natural language explanations -- precisely the capability that LLMs provide and that traditional EDA rule engines cannot.

This analysis defines 13 concrete features that RouteAI can deliver by extending the existing `routeai-intelligence` agent architecture. Each feature is grounded in the actual codebase: the ReAct-loop agent (`agent/core.py`), the RAG retriever (`rag/retriever.py`), the schematic reviewer (`agent/schematic_reviewer.py`), the BOM validator (`agent/bom_validator.py`), the design intent processor (`agent/design_intent.py`), and the CLI reporter (`cli/reporter.py`).

The features are ordered by implementation feasibility and business impact.

---

## Feature 1: Automatic Design Documentation Generator

### What It Does

Reads a KiCad project (schematic + PCB + BOM) and produces a complete human-readable design document: block diagram description, power tree narrative, signal flow explanation, component selection rationale, and layout strategy summary. Output is a structured document (Markdown/HTML/PDF) that a contract manufacturer, a new team member, or a regulatory reviewer can read without opening the EDA tool.

### Why It Requires an LLM

The existing `analyzer.py` already extracts structural facts (net count, footprint count, layer count). But facts are not documentation. Documentation requires *synthesis*: "This board is a 4-layer USB-C powered IoT sensor node. The power architecture uses a TPS63020 buck-boost converter to accept 3.0-5.5V input and generate a regulated 3.3V rail, which feeds the nRF52840 BLE SoC and the BME280 environmental sensor." No rule engine can produce that narrative. It requires understanding component function from part numbers, inferring topology from connectivity, and composing a coherent explanation.

### User Workflow

```
routeai document ./my-project/ --output design-doc.html --depth detailed
```

The engineer runs one command. RouteAI parses the project, sends the structured data through the agent, and produces a multi-section document. The engineer reviews it, edits where needed, and ships it.

### Technical Implementation

**Extend `AnalysisResult` in `analyzer.py`:**
```python
@dataclass
class AnalysisResult:
    # ... existing fields ...
    documentation: DesignDocumentation | None = None
```

**New module: `routeai_intelligence/agent/doc_generator.py`:**

1. **Block identification phase:** Use the existing `CircuitAnalyzer` (from `circuit_analyzer.py`) to identify functional blocks (power supply, digital core, comm interface, etc.) and classify all nets by signal type.

2. **Narrative generation phase:** Send each functional block to the RouteAI agent with a documentation-specific system prompt. The prompt instructs the LLM to:
   - Name the block and explain its purpose
   - List key components with their roles (not just reference designators, but "U3 (TPS63020) -- buck-boost converter providing 3.3V from USB/battery input")
   - Describe the signal flow between blocks
   - Note any critical design constraints visible in the schematic (impedance-controlled nets, differential pairs, guard traces)

3. **Assembly phase:** Combine block narratives into a coherent document with table of contents, power tree diagram (text-based), BOM summary table, and revision history section.

4. **RAG enrichment:** Use the `KnowledgeRetriever` to pull relevant datasheet excerpts and application note references, embedding them as citations in the generated document.

**Integration with existing reporter pattern:**
```python
class DocumentationReporter(BaseReporter):
    """Generates a full design document from analysis + LLM narrative."""
    def render(self, result: AnalysisResult) -> str:
        # Combines structural data from analysis with LLM-generated narratives
```

**New CLI subcommand in `main.py`:**
```python
@app.command()
@click.argument("project_dir", ...)
@click.option("--depth", type=click.Choice(["summary", "standard", "detailed"]))
@click.option("--output", "-o", ...)
def document(project_dir, depth, output):
    """Generate comprehensive design documentation."""
```

---

## Feature 2: Interactive Datasheet Q&A

### What It Does

The engineer asks a natural-language question about any component in their design -- "What is the maximum input voltage for U3?" or "What is the recommended decoupling capacitor value for U7's AVDD pin?" -- and RouteAI answers by searching indexed datasheets, citing the exact page and section.

### Why It Requires an LLM

Datasheets are semi-structured documents: tables, prose, footnotes, conditional specifications ("at Ta=25C, for Vin > 2.5V"). Extracting the correct answer requires understanding the question's intent, locating the right table in the right document, interpreting conditional qualifiers, and composing a precise answer. The existing `datasheet_lookup` tool in `tools.py` performs RAG retrieval but returns raw passages. An LLM is needed to reason over those passages and produce a direct, correct answer with appropriate caveats.

### User Workflow

```
routeai ask "What is the absolute maximum rating for VIN on U3?"
routeai ask "What crystal load capacitance does the STM32F405 expect?"
routeai ask "Is the LM317 in my design rated for my 15V input?"
```

Or integrated into the KiCad plugin: right-click a component, select "Ask about this part," and type a question in the sidebar.

### Technical Implementation

**Extend the existing `chat` method in `RouteAIAgent`:**

The chat method already exists and supports context injection. The implementation adds:

1. **Automatic context extraction:** When the user references a component by reference designator (e.g., "U3"), resolve it to a part number via the parsed schematic, then automatically inject:
   - Component value, footprint, connected nets
   - All power rails connected to it
   - Its functional block context from `CircuitAnalyzer`

2. **Focused RAG retrieval:** Before sending to the LLM, perform a targeted `datasheet_lookup` filtered to the specific component, then inject the top-k passages into the system prompt as grounding context.

3. **Citation enforcement:** The existing `CitationChecker` validates that the answer references specific datasheet sections. If the LLM cannot find the answer in indexed documents, it responds with "I could not find this specification in the indexed datasheets. The datasheet for [part] may need to be indexed, or you can check section [likely section] of the datasheet."

4. **Datasheet ingestion pipeline:** Extend `rag/indexer.py` to accept PDF datasheets, chunk them by section (Absolute Maximum Ratings, Electrical Characteristics, Application Information, Layout Guidelines), and store with metadata tags: `{component: "TPS63020", section: "abs_max_ratings", page: 12}`.

**New CLI subcommand:**
```python
@app.command()
@click.argument("question")
@click.option("--project", type=click.Path(exists=True))
def ask(question, project):
    """Ask a question about components in your design."""
```

---

## Feature 3: Design Decision Recorder

### What It Does

Captures the engineer's design rationale as they work -- why they chose a particular component, topology, or constraint -- and stores it as structured metadata linked to specific schematic elements. When someone later asks "why is there a 100nF cap here?" or "why did you choose the TPS63020 instead of an LDO?", the system retrieves the recorded rationale.

### Why It Requires an LLM

Engineers express rationale in informal, fragmentary natural language: "need buck-boost because battery goes down to 2.5V, LDO dropout too high." The LLM transforms this into a structured, searchable decision record: {decision: "buck-boost topology", alternatives_considered: ["LDO", "charge pump"], rationale: "Input voltage range 2.5-5.5V with 3.3V output requires boost capability below 3.3V; LDO cannot boost; charge pump limited to low current", constraints: ["Vin_min=2.5V", "Vout=3.3V", "Iout_max=800mA"]}. It also generates decision records automatically by analyzing the design and inferring likely rationale from circuit topology and component selection.

### User Workflow

**Explicit recording:**
```
routeai decide U3 "Chose TPS63020 because input range is 2.5-5.5V from battery+USB,
need boost below 3.3V. LDO can't do that. Charge pump can't deliver 800mA."
```

**Automatic inference:**
```
routeai infer-decisions ./my-project/
```
Produces a draft set of decision records by analyzing the design. The engineer reviews and approves.

**Retrieval:**
```
routeai why U3
routeai why "buck-boost topology"
routeai why C15  # "C15 is a 100nF X7R decoupling cap on U3's VDD pin, chosen per datasheet recommendation..."
```

### Technical Implementation

**New module: `routeai_intelligence/agent/decision_recorder.py`:**

```python
class DesignDecision(BaseModel):
    id: str
    component_refs: list[str]
    net_names: list[str]
    decision_type: str  # "component_selection", "topology", "value_choice", "layout_rule"
    description: str
    rationale: str
    alternatives_considered: list[dict[str, str]]
    constraints_driving_decision: list[str]
    citations: list[str]
    confidence: float
    recorded_by: str  # "engineer" or "auto_inferred"
    timestamp: str
```

**Decision inference pipeline:**
1. Run `CircuitAnalyzer` to identify functional blocks
2. For each block, use the agent to reason: "This is a buck-boost power supply using TPS63020. Why would an engineer choose this topology?" The agent uses `datasheet_lookup` to ground its reasoning in component specs.
3. For passive components, infer purpose from circuit context: "C15 (100nF, X7R) connects between U3.VDD and GND -- this is a decoupling capacitor per standard design practice and the TPS63020 datasheet Figure 23."

**Storage:** Decision records stored as JSON sidecar files (`.routeai/decisions.json`) in the project directory, linked to component references and net names. This integrates with version control.

**Extends the existing `DesignIntentProcessor`:** The `design_intent.py` module already converts natural language to formal constraints. The decision recorder is the inverse: it converts formal design elements back to natural language rationale. These two modules share the same understanding model and can cross-reference each other.

---

## Feature 4: Knowledge Transfer Assistant

### What It Does

A new engineer joins the team and needs to understand an existing design. They ask questions like "why is there a 100nF cap on every power pin?", "what does the ferrite bead between AVDD and DVDD do?", "why are these traces wider than the others?" The system answers by combining: (a) recorded design decisions (Feature 3), (b) datasheet information (Feature 2), (c) general EDA knowledge from the RAG system, and (d) LLM reasoning about circuit topology.

### Why It Requires an LLM

Knowledge transfer is fundamentally about translating between levels of abstraction. The junior engineer asks about a specific capacitor. The answer requires understanding that this capacitor is part of a decoupling strategy, which exists because high-frequency switching noise on power rails causes signal integrity problems, which matters because this particular IC (an ADC) has a specified PSRR that degrades above 100kHz. No lookup table produces this chain of reasoning. Only an LLM can traverse from a component reference, through circuit context, through physics, to an explanation calibrated to the question's implicit knowledge level.

### User Workflow

```
routeai explain C15
# Output:
# C15 is a 100nF X7R ceramic capacitor providing high-frequency decoupling for U3
# (STM32F405RGT6, Arm Cortex-M4 microcontroller).
#
# WHY IT'S THERE: Every digital IC requires local decoupling capacitors on each VDD pin
# to supply instantaneous current during logic transitions. Without C15, the inductance
# of the PCB traces to the power supply would cause voltage droops during fast switching
# events, potentially causing logic errors.
#
# WHY 100nF: This is the standard value for HF decoupling per the STM32F405 datasheet
# (Section 6.1.6, "Power supply decoupling"). The 100nF value provides effective
# bypassing from ~1MHz to ~100MHz with a typical 0402 package.
#
# WHY X7R: X7R dielectric maintains >80% of nominal capacitance across the -55C to +125C
# operating range and under DC bias. Y5V would lose >80% of its capacitance at the 3.3V
# operating voltage, making it ineffective. (See Feature 5: BOM Notes for more detail.)
#
# PLACEMENT: Should be placed as close as possible to U3's VDD pin with the shortest
# possible trace to the ground plane via. The current loop area determines the
# effectiveness of decoupling.
#
# Source: STM32F405 datasheet DS8597 Rev 9, Section 6.1.6; Murata MLCC application note.

routeai explain --level beginner "why are some traces wider?"
routeai explain --level expert "the impedance matching strategy for the USB lines"
```

### Technical Implementation

**New module: `routeai_intelligence/agent/knowledge_transfer.py`:**

1. **Context assembly:** Given a component ref, net, or topic:
   - Retrieve design decisions (Feature 3) if they exist
   - Run `CircuitAnalyzer` block identification
   - Perform RAG retrieval for relevant datasheets and standards
   - Extract the component's connectivity from the parsed schematic

2. **Multi-level explanation generation:** The agent system prompt includes an `explanation_level` parameter:
   - `beginner`: Assumes no domain knowledge, explains from first principles
   - `intermediate`: Assumes basic EE knowledge, focuses on design-specific rationale
   - `expert`: Assumes full domain knowledge, focuses on trade-offs, tolerances, and edge cases

3. **Answer validation:** The `CitationChecker` and `ConfidenceChecker` (already in the validation pipeline) ensure every claim is grounded. If the agent infers something without a citation, it marks it as "[inferred from circuit topology]" rather than stating it as fact.

**Integration:** This feature is essentially the `chat` method enhanced with structured context injection. The key addition is the automatic context assembly pipeline that gathers all relevant information before the LLM sees the question.

---

## Feature 5: Automatic BOM Notes Generator

### What It Does

For every component in the BOM, generates a note explaining critical selection criteria: why this specific part was chosen, what specifications are load-bearing (cannot be substituted without consequence), and what procurement pitfalls to avoid. Example: "C5 (100nF, 0402, X7R, 16V) -- Decoupling for U3 ADC reference. MUST be X7R or C0G. DO NOT substitute Y5V: capacitance drops >80% at 3.3V DC bias, defeating the decoupling purpose. Murata GRM155R71C104KA88D or equivalent."

### Why It Requires an LLM

The existing `BOMValidator` in `bom_validator.py` already checks dielectric types and flags Y5V in decoupling applications. But it produces machine-readable findings (`BOMIssue`), not procurement-ready notes. The LLM transforms a finding like `{category: "dielectric_type", severity: "error", description: "C5: Y5V dielectric not suitable for decoupling"}` into a note that a purchasing agent can act on, including the *reason* (DC bias capacitance loss), the *consequence* (ADC reference noise), and the *acceptable alternatives* (X7R, C0G from specific manufacturers).

### User Workflow

```
routeai bom-notes ./my-project/ --output bom-notes.xlsx
```

Produces a BOM spreadsheet with an added "Engineering Notes" column. Each note is concise but complete enough that procurement can make substitution decisions without calling the engineer.

### Technical Implementation

**Extend `BOMValidator` with notes generation:**

```python
class BOMNote(BaseModel):
    component_ref: str
    critical_specs: list[str]       # ["X7R dielectric", "16V min rating", "0402 footprint"]
    substitution_guidance: str       # "X7R or C0G from Murata, TDK, or Samsung. NO Y5V."
    application_context: str         # "HF decoupling for ADC reference input"
    procurement_warning: str | None  # "Verify DC bias derating; 0402 X7R at 3.3V retains ~85%"
    rationale: str                   # Human-readable explanation
```

**Pipeline:**
1. Run `BOMValidator.validate()` to get issues and suggestions
2. Run `CircuitAnalyzer` to classify each component's application context
3. For each BOM line, send to the agent with context: component specs, application context, BOM issues, and connected net information
4. Agent produces a `BOMNote` with the procurement-ready text
5. Export to spreadsheet with the note column

**The RAG system provides:** Manufacturer cross-reference data, DC bias curves for specific MLCC part numbers, and standard substitution rules from distributor databases.

---

## Feature 6: Application Note & Reference Design Finder

### What It Does

Given a design challenge ("USB 3.0 to HDMI conversion") or a specific component ("TPS63020 battery-powered application"), finds and ranks relevant application notes, reference designs, evaluation board schematics, and design guides. Returns not just links but summaries of what each resource covers and how it relates to the engineer's specific design.

### Why It Requires an LLM

A keyword search for "USB3.0 HDMI" returns hundreds of results. The LLM's value is in understanding the engineer's actual need (a level-shifting bridge IC reference design, not a USB host controller), ranking results by relevance to the specific design context (4-layer board, no FPGA, cost-optimized), and summarizing each result so the engineer can decide which to read without opening every PDF.

### User Workflow

```
routeai find-reference "USB Type-C PD sink with battery charging"
routeai find-reference --component U3 "layout guidelines"
routeai find-reference --for-block "power_supply" --in ./my-project/
```

### Technical Implementation

**Extend the RAG pipeline:**

1. **Indexing phase:** Ingest application notes, reference designs, and eval board documentation into the `document_embeddings` table with rich metadata: `{domain: "reference_design", interface: "USB3.0", topology: "bridge", manufacturer: "TI", part_family: "HD3SS3220"}`.

2. **Search phase:** The `KnowledgeRetriever.search()` already supports metadata filtering. Add a multi-stage retrieval:
   - Stage 1: Broad semantic search (top 50)
   - Stage 2: LLM re-ranking based on user's specific context (board constraints, existing components, cost targets)
   - Stage 3: Summary generation for top 5-10 results

3. **Context-aware search:** When `--in ./my-project/` is specified, the system extracts the existing design's characteristics (layer count, components used, interfaces present) and uses them to filter and rank results. "You already use the TUSB320LAI for USB Type-C -- here are TI's reference designs that use the same IC."

**New tool for the agent:**
```python
REFERENCE_DESIGN_SEARCH_TOOL = ToolDefinition(
    name="reference_design_search",
    description="Search indexed application notes and reference designs...",
    input_schema={...},
    handler=_handle_reference_design_search,
)
```

---

## Feature 7: Semantic Design Changelog

### What It Does

When the engineer commits a new version of their KiCad project, RouteAI compares it against the previous version and generates a semantic changelog: not "modified segment at (45.2, 32.1)" but "Changed power supply from linear regulator (LM7805) to switching regulator (TPS54331) to improve efficiency from ~40% to ~90% at 12V input. Added L1 (10uH inductor), D1 (Schottky diode), and adjusted input/output capacitor values. Power dissipation reduced from 4.8W to 0.6W."

### Why It Requires an LLM

The existing `netlist_diff.py` in `sync/` can detect structural changes (component added, net renamed, value changed). But a diff that says "added U5, L1, D1, C12, C13; removed U2; changed C3 from 10uF to 22uF" is useless without interpretation. The LLM understands that these changes together represent a topology switch from linear to switching regulation, can explain the motivation (thermal or efficiency), and can describe the impact on the rest of the design.

### User Workflow

```
routeai changelog --from v1.0 --to v1.1 ./my-project/
# or git-integrated:
routeai changelog --commits HEAD~3..HEAD ./my-project/
```

Output:
```
## Version 1.1 Changelog (2026-03-14)

### Power Supply: Linear to Switching Conversion
- Replaced U2 (LM7805, linear regulator) with U5 (TPS54331, 3A buck converter)
- Added L1 (10uH, Bourns SRN6045TA-100M) as buck inductor
- Added D1 (SS34, Schottky diode) for asynchronous rectification
- Changed C3 from 10uF/25V to 22uF/25V (increased output capacitance for switching stability)
- Added C12 (100nF) and C13 (10uF) for input decoupling
- **Motivation:** Reduce power dissipation from ~4.8W to ~0.6W at 12V/0.5A load
- **Impact:** Board now requires careful layout of the switching loop (L1-D1-C13)

### USB Interface: Added ESD Protection
- Added U6 (USBLC6-2SC6) on USB D+/D- lines
- **Motivation:** IEC 61000-4-2 compliance for CE marking
```

### Technical Implementation

**New module: `routeai_intelligence/agent/changelog_generator.py`:**

1. **Structural diff:** Use `sync/netlist_diff.py` to compute component-level and net-level diffs between two versions.

2. **Change clustering:** Group related changes using the `CircuitAnalyzer` block classification. Changes to components in the same functional block are likely related.

3. **Semantic interpretation:** For each change cluster, send to the agent with:
   - The list of structural changes
   - Component datasheets for old and new parts
   - The functional block context

   The agent produces: category (e.g., "Power Supply Redesign"), motivation (inferred from the change pattern), and impact assessment.

4. **Changelog assembly:** Combine interpreted clusters into a formatted changelog document.

**Extends `sync/netlist_diff.py`:** The existing `NetlistDiff` class provides the raw `SyncChange` objects. The changelog generator wraps these with LLM interpretation.

---

## Feature 8: Component Obsolescence Impact Analysis

### What It Does

When a component is discontinued or goes NRND (Not Recommended for New Designs), RouteAI identifies every design in the project library that uses it, assesses the impact (pin-compatible replacement available? circuit redesign needed? board respin required?), and suggests specific alternatives with trade-off analysis.

### Why It Requires an LLM

The `BOMValidator` already has an `_OBSOLETE_PARTS` database and a `suggest_alternatives()` method. But real obsolescence analysis requires understanding *impact*: replacing an LDO with a different pinout means a board respin; replacing it with a pin-compatible part is a BOM-only change. The LLM can reason about pin compatibility, package compatibility, electrical parameter compatibility (dropout voltage, PSRR, noise), and identify secondary effects ("the new LDO has lower PSRR at 100kHz, which may affect your ADC performance").

### User Workflow

```
routeai obsolescence-check ./my-project/
# Checks all components against lifecycle databases

routeai impact-analysis --component LM317 ./project-library/
# "LM317 is used in 3 designs: ProjectA (voltage regulator), ProjectB (current source),
#  ProjectC (battery charger). Pin-compatible replacements: LM317A (tighter tolerance),
#  AP7365 (modern LDO, different pinout -- requires board change). ..."
```

### Technical Implementation

**Extend `BOMValidator` with impact analysis:**

```python
class ObsolescenceImpact(BaseModel):
    component_mpn: str
    affected_projects: list[str]
    usage_contexts: list[dict[str, Any]]  # How the part is used in each project
    replacement_options: list[Alternative]
    impact_level: str  # "bom_only", "layout_change", "circuit_redesign"
    estimated_effort: str  # "1 hour", "1 day", "1 week"
    risk_assessment: str
```

**Pipeline:**
1. Query component lifecycle database (initially the built-in `_OBSOLETE_PARTS`, later integrated with distributor APIs via `WebFetch`)
2. Scan all projects for usage of the affected component
3. For each usage, use `CircuitAnalyzer` to determine the circuit function
4. Use the agent with `component_search` and `datasheet_lookup` tools to find alternatives
5. For each alternative, the LLM assesses: pin compatibility, electrical compatibility, and secondary effects

**Extends `suggest_alternatives()` in `bom_validator.py`** with deeper compatibility analysis powered by the ReAct loop.

---

## Feature 9: Supplier Risk Analysis

### What It Does

Analyzes the BOM for supply chain vulnerabilities: single-source components, geographic concentration (multiple parts from one factory or region), long lead-time items, components with limited distributor stock, and end-of-life risk. Produces a risk report with mitigation recommendations.

### Why It Requires an LLM

Supplier risk analysis involves reasoning about soft factors that cannot be captured in rules: "3 of your ICs are made by one manufacturer in one fab. If that fab has a fire (as happened at Renesas Naka in 2021 and AKM in 2020), your entire product line stops." The LLM connects BOM data to supply chain knowledge, identifies concentration risks, and generates actionable mitigation strategies ("qualify Samsung CL series as second source for all Murata GRM capacitors").

### User Workflow

```
routeai supply-risk ./my-project/ --output risk-report.html
```

Output:
```
## Supply Chain Risk Assessment

### HIGH RISK: Single-Source ICs
- U3 (nRF52840) -- sole source: Nordic Semiconductor (Trondheim, Norway)
  No pin-compatible alternative exists. Consider design-in of ESP32-C6 as fallback.

### MEDIUM RISK: Geographic Concentration
- 7 of 12 passive components sourced from Murata (Japan)
  Mitigation: Qualify Samsung or TDK equivalents for all passives.

### LOW RISK: Long Lead Time
- U5 (TPS54331) -- current lead time 16 weeks at TI
  Mitigation: Maintain 6-month safety stock or qualify MPS MP2359 as alternate.
```

### Technical Implementation

**New module: `routeai_intelligence/agent/supply_chain_analyzer.py`:**

1. **BOM enrichment:** For each component, gather manufacturer, country of origin, number of authorized distributors, current lead time, and stock levels. Initially from metadata in the BOM; later from distributor API integration.

2. **Risk scoring:** Rule-based pre-processing identifies obvious risks (single source, all passives from one manufacturer). LLM then contextualizes: "Murata dominance in your passives is actually low risk because Samsung and TDK make pin-compatible equivalents for all your MLCC values."

3. **Mitigation generation:** For each risk, the agent suggests specific mitigations grounded in the actual BOM -- not generic advice, but "replace C3 (GRM155R71C104KA88D) with Samsung CL05B104KA5NNNC -- same 100nF/0402/X7R/16V specs."

**Leverages:** `BOMValidator._check_single_source()` (already exists), `suggest_alternatives()`, and the `component_search` RAG tool.

---

## Feature 10: Automatic Test Procedure Generator

### What It Does

Reads the schematic and generates a board-level test procedure: power-up sequence, voltage rail verification points (with expected values and tolerances), functional test steps for each interface (USB enumeration, I2C scan, SPI communication), and boundary condition tests. The output is a structured test document that a test technician can follow.

### Why It Requires an LLM

Test procedure generation requires understanding the *intent* of each circuit block, not just its structure. The LLM reasons: "This is a 3.3V rail from a TPS63020 with 1% feedback resistors, so expect 3.3V +/-1% = 3.267-3.333V. Test with Vin at minimum (2.5V), nominal (3.7V battery), and maximum (5.5V USB). Verify output ripple <30mV pp per datasheet spec." No rule engine spans from schematic parsing through datasheet specs to test engineering judgement.

### User Workflow

```
routeai generate-test-plan ./my-project/ --output test-procedure.html
routeai generate-test-plan ./my-project/ --format checklist --output test-checklist.xlsx
```

### Technical Implementation

**New module: `routeai_intelligence/agent/test_generator.py`:**

```python
class TestStep(BaseModel):
    id: str
    category: str  # "power_verification", "functional_test", "boundary_test"
    description: str
    equipment_needed: list[str]
    setup: str
    measurement_point: str  # Component ref + pin, or test pad name
    expected_result: str
    tolerance: str
    pass_criteria: str
    fail_action: str
    notes: str
```

**Pipeline:**
1. **Power tree analysis:** Trace power nets from input connectors through regulators to loads. For each rail, generate voltage verification steps with expected values extracted from component specs.

2. **Interface test generation:** Identify communication interfaces (USB, I2C, SPI, UART, Ethernet) using `CircuitAnalyzer`. For each, generate a protocol-appropriate test (e.g., I2C address scan, USB enumeration check).

3. **Boundary condition identification:** Use datasheet abs-max ratings to define boundary test conditions. The LLM reasons about which boundaries are meaningful to test.

4. **Test sequencing:** The LLM orders test steps logically: power first, then clocks, then digital interfaces, then analog.

---

## Feature 11: Assembly Instruction Generator

### What It Does

From the PCB layout and BOM, generates assembly instructions for manual assembly or as supplementary documentation for CM (contract manufacturer) packages: component placement order, soldering notes for difficult components (fine-pitch QFN, BGA, thermal pads), special handling requirements, and post-assembly inspection checkpoints.

### Why It Requires an LLM

Assembly instructions require domain knowledge that is not encoded in EDA data: "U3 (QFN-48) requires solder paste stencil with home-plate apertures for the thermal pad, reflow at peak 245C per JEDEC J-STD-020. Inspect for solder bridging on 0.4mm pitch pins with X-ray or optical microscope." This knowledge exists in datasheets, IPC standards, and manufacturing best practices -- exactly the content in the RAG system. The LLM synthesizes it into a coherent procedure specific to this board's components.

### User Workflow

```
routeai assembly-guide ./my-project/ --output assembly-instructions.pdf
```

### Technical Implementation

**New module: `routeai_intelligence/agent/assembly_generator.py`:**

1. **Component categorization:** Sort BOM by assembly difficulty: SMD passives (0402, 0603), SMD ICs (QFP, QFN, BGA), through-hole, connectors, special (heatsinks, RF shields).

2. **Assembly sequence generation:** LLM determines optimal placement and soldering order based on component types and reflow profiles.

3. **Per-component instructions:** For complex components (QFN thermal pad, BGA, fine-pitch connectors), the agent queries datasheets and IPC-7351/IPC-A-610 standards via RAG to generate specific instructions.

4. **Inspection checkpoints:** After each assembly phase, generate inspection criteria with IPC-A-610 acceptance levels.

---

## Feature 12: Regulatory Documentation Assistant

### What It Does

For a given product and target markets, identifies required regulatory certifications (FCC Part 15, CE/RED, UL/IEC 62368-1), lists specific tests needed, identifies design features that affect compliance (unintentional radiator shielding, ESD protection, creepage distances), and generates pre-compliance documentation templates.

### Why It Requires an LLM

Regulatory requirements are expressed in legal/technical prose across hundreds of pages of standards. The mapping from "IoT sensor node with BLE and USB" to "FCC Part 15 Subpart B (unintentional radiator) + Part 15.247 (intentional radiator for BLE), CE RED Article 3.2 (radio), EN 55032 (emissions), EN 55035 (immunity), EN 62368-1 (safety)" requires reasoning over product characteristics, applicable standards, and their interrelationships. This is precisely what LLMs excel at.

### User Workflow

```
routeai regulatory ./my-project/ --markets US,EU,UK --product-type "IoT sensor"
```

Output:
```
## Regulatory Compliance Roadmap

### United States (FCC)
- FCC Part 15 Subpart B (unintentional radiator, Class B)
  - Required test: Radiated emissions, 30MHz-1GHz (ANSI C63.4)
  - Required test: Conducted emissions, 150kHz-30MHz
  - Design check: Verify switching regulator EMI filter (L1, C12, C13)

- FCC Part 15.247 (intentional radiator -- BLE 2.4GHz)
  - Required test: Conducted output power, spurious emissions
  - Required: Antenna gain documentation, MPE assessment
  - Note: If using nRF52840 with Nordic's pre-certified module, modular approval
    may apply (FCC KDB 996369)

### European Union (CE)
- Radio Equipment Directive 2014/53/EU
  - EN 300 328 (BLE radio parameters)
  - EN 301 489-17 (EMC for radio equipment)
  - EN 55032 (conducted and radiated emissions)
  - EN 55035 (immunity)
  - EN 62368-1 (safety -- relevant if powered by mains adapter)
  - Design check: USB ESD protection (IEC 61000-4-2 Level 4)
  - Design check: Creepage distance for any mains-connected section
```

### Technical Implementation

**New module: `routeai_intelligence/agent/regulatory_assistant.py`:**

1. **Product classification:** From the schematic, identify: radio transceivers (intentional radiator), switching regulators (EMI sources), external interfaces (ESD/immunity test surfaces), power input method (battery, USB, mains).

2. **Standards mapping:** The RAG system is pre-loaded with regulatory standard summaries (FCC Part 15, EN 55032, EN 62368-1, etc.) and the mapping rules that determine which standards apply to which product types.

3. **Design-specific checks:** For each applicable standard, the LLM identifies design features that affect compliance:
   - Switching frequency vs. emission limits
   - ESD protection presence on external interfaces
   - Creepage/clearance distances (using the existing `clearance_lookup` tool)
   - Shielding and grounding adequacy

4. **Documentation template generation:** Produce pre-filled templates for test reports, technical construction files, and declarations of conformity.

---

## Feature 13: Patent Landscape Analysis

### What It Does

Analyzes the design's topology, component architecture, and novel features, then searches a patent database to identify potentially relevant patents. This is a "freedom to operate" screening tool, not a legal opinion -- it flags areas where the engineer should consult with IP counsel.

### Why It Requires an LLM

Patent claims are written in deliberately broad, abstract legal language. Matching a specific circuit topology (e.g., "a buck converter with adaptive dead-time control using a comparator on the switch node") to patent claims (e.g., "an apparatus for power conversion comprising a first switch element, a second switch element, and a control circuit configured to determine a delay period based on a voltage at a node between said first and second switch elements") requires semantic understanding that no keyword search can achieve.

### User Workflow

```
routeai patent-scan ./my-project/ --focus "power supply topology"
```

Output:
```
## Patent Landscape Screening (NOT legal advice)

### Potentially Relevant Patents

1. US10,xxx,xxx - "Adaptive Dead-Time Control for Power Converters"
   Assignee: Texas Instruments
   Relevance: Your TPS54331 buck converter uses adaptive dead-time control.
   NOTE: This patent may be licensed through TI's component purchase. Verify with counsel.

2. US9,xxx,xxx - "USB Power Delivery Negotiation with Battery Charging"
   Assignee: Qualcomm
   Relevance: Your USB-PD sink implementation (U8, STUSB4500) negotiates power levels.
   NOTE: STUSB4500 implementation likely covered by ST's license. Verify with counsel.

DISCLAIMER: This is an automated screening tool, not a legal opinion.
Consult qualified IP counsel for freedom-to-operate analysis.
```

### Technical Implementation

**New module: `routeai_intelligence/agent/patent_analyzer.py`:**

1. **Design feature extraction:** From `CircuitAnalyzer`, identify novel or non-obvious design features: unusual topologies, specific control methods, interface implementations.

2. **Patent search:** Use the RAG system (with a patent claim index) or external patent API to find patents with similar technical concepts.

3. **Relevance assessment:** The LLM compares the design's specific implementation against patent claims, scoring relevance and noting potential defenses (prior art, licensed through component purchase, different technical approach).

4. **Mandatory disclaimer:** Every output includes a disclaimer that this is not legal advice.

**Note:** This is the highest-risk feature from a liability perspective and should be the last one implemented. It should be positioned as a "screening tool to identify areas for counsel review," never as a legal opinion.

---

## Implementation Priority Matrix

| Priority | Feature | Effort | Impact | Dependencies |
|----------|---------|--------|--------|--------------|
| P0 | 2. Datasheet Q&A | 2 weeks | Very High | RAG indexer for datasheets |
| P0 | 5. BOM Notes Generator | 2 weeks | Very High | Extends existing BOMValidator |
| P1 | 1. Design Documentation | 3 weeks | Very High | CircuitAnalyzer, doc templates |
| P1 | 4. Knowledge Transfer | 2 weeks | High | Features 2 + 3 |
| P1 | 3. Decision Recorder | 3 weeks | High | New storage layer |
| P2 | 7. Semantic Changelog | 2 weeks | High | Extends netlist_diff |
| P2 | 6. Reference Design Finder | 2 weeks | Medium | RAG content acquisition |
| P2 | 8. Obsolescence Impact | 2 weeks | High | Extends BOMValidator |
| P2 | 10. Test Procedure Generator | 3 weeks | Medium | Power tree analysis |
| P3 | 9. Supplier Risk Analysis | 2 weeks | Medium | Distributor API integration |
| P3 | 11. Assembly Instructions | 2 weeks | Medium | IPC standards in RAG |
| P3 | 12. Regulatory Assistant | 4 weeks | High | Regulatory standards in RAG |
| P4 | 13. Patent Landscape | 4 weeks | Medium | Patent DB, legal review of feature |

---

## Architecture Integration

All 13 features share a common architecture pattern already established in the codebase:

```
User Request
    |
    v
CLI Command (main.py) or KiCad Plugin or Web API
    |
    v
Context Assembly
    |-- Parse project files (routeai_parsers)
    |-- Run CircuitAnalyzer (block identification)
    |-- Retrieve design decisions (Feature 3)
    |-- Perform RAG retrieval (rag/retriever.py)
    |
    v
RouteAIAgent.chat() or specialized method
    |-- System prompt (task-specific)
    |-- ReAct loop with tools
    |   |-- datasheet_lookup
    |   |-- impedance_calc
    |   |-- clearance_lookup
    |   |-- component_search
    |   |-- NEW: reference_design_search
    |   |-- NEW: patent_search
    |   |-- NEW: regulatory_lookup
    |
    v
Validation Pipeline
    |-- SchemaValidator (structure)
    |-- ConfidenceChecker (calibration)
    |-- CitationChecker (grounding)
    |
    v
Output Formatting (reporter.py pattern)
    |-- Markdown / HTML / JSON / PDF / XLSX
```

Every new feature follows this pattern. The primary engineering work is in:
1. **Context assembly** -- gathering the right information before the LLM sees it
2. **System prompts** -- instructing the LLM for the specific task
3. **Output parsing** -- structuring the LLM's output for the target format
4. **RAG content** -- indexing the domain knowledge that grounds the LLM's responses

The ReAct loop, validation pipeline, tool infrastructure, and reporting framework are already built and shared across all features.

---

## Key Insight: The Documentation Layer Is the Moat

Traditional EDA tools compete on routing algorithms, DRC rule coverage, and UI polish. These are well-understood engineering problems with diminishing returns on improvement.

The documentation / knowledge / collaboration layer is where LLMs create an entirely new category of capability. No amount of rule-engine development can produce "explain this design to a junior engineer" or "write a test procedure" or "tell me which patents to worry about." These tasks require the integration of domain knowledge, contextual reasoning, and natural language generation that only LLMs provide.

By building this layer, RouteAI becomes not just a better EDA tool but the *institutional memory* of the engineering team -- the system that knows why every decision was made, can explain any aspect of any design, and generates all the documentation that engineers hate writing but that organizations desperately need.
