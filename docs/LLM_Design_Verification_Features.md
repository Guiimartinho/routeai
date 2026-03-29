# LLM-Powered Design Verification & Review: Feature Catalog

> RouteAI Intelligence Layer - Features that catch the $50K prototype mistakes
> Architecture: LLM proposes findings, deterministic solvers validate, engineer decides

---

## Executive Summary

Traditional DRC/ERC tools answer: "Does the geometry violate rules?"
Senior engineer design reviews answer: "Does this design make sense?"

The gap between those two questions represents the most expensive category of PCB bugs: designs that pass all automated checks but fail in the lab because something was *forgotten*, *misunderstood*, or *applied from the wrong context*. These are the bugs found at 2 AM during prototype bring-up -- the missing TVS diode that kills the USB port during ESD testing, the bulk cap placed 15mm from the IC because the autoplacer optimized for density, the RESET pin that works on the bench but glitches in the factory because there is no filter cap.

An LLM can catch these because it can *read* -- datasheets, app notes, standards, reference designs -- and *reason* about whether a specific design follows the guidance in those documents. Combined with RouteAI's deterministic solver layer, every LLM finding can be backed by a measurable, verifiable check.

This document specifies 13 features that bridge the gap. Each integrates into RouteAI's existing Propose-Verify-Commit pipeline: the LLM identifies a concern (Gate 1), the solver quantifies it (Gate 2), the engineer reviews it (Gate 3).

---

## Feature 1: Semantic DRC -- Understanding What the Circuit Does

### What It Does
Goes beyond geometric rule checks to verify that the *function* of the circuit matches its *implementation*. The LLM uses the `CircuitAnalyzer` to identify functional blocks (power supply, comm interface, analog frontend, etc.) and then checks whether each block's implementation follows the expected topology for that function.

Example: The LLM identifies a buck converter block (U3 = TPS54331, L1, C5, C6, D2, R7, R8). It verifies:
- Feedback resistor divider ratio matches the target output voltage
- Inductor value is in the recommended range for the switching frequency
- Input/output capacitor values meet the datasheet minimum
- Schottky diode (if used) voltage rating exceeds input voltage
- Compensation network (if external) matches the recommended values

### Why It Requires an LLM
A rule engine can check "is there a capacitor on this net?" but cannot answer "is the capacitor *value* correct for this specific IC's recommended operating conditions?" That requires reading the TPS54331 datasheet, understanding the relationship between switching frequency (set by R_T), inductor value, and capacitor ESR requirements, then comparing against the actual BOM values. This is natural language comprehension applied to technical documents -- the core strength of LLMs.

### LLM + Solver Integration
1. **LLM (CircuitAnalyzer)**: Identifies functional blocks, classifies each component's role within the block, extracts expected values from datasheet RAG retrieval
2. **Solver (Z3 constraint solver)**: Encodes the mathematical relationships (e.g., V_OUT = V_REF * (1 + R_top/R_bottom)), checks BOM values against constraints
3. **Solver (physics/impedance.py)**: Validates loop inductance, ESR requirements numerically
4. **LLM**: Generates human-readable finding with datasheet citation

### Example Scenario
Designer creates a 3.3V buck converter using TPS54331. Feedback resistors are 10k/4.7k, giving V_OUT = 0.8V * (1 + 10k/4.7k) = 2.50V, not 3.3V. Traditional DRC sees nothing wrong -- the resistors are connected correctly, nets are valid, clearances pass. Semantic DRC catches: "CRITICAL: Feedback divider R7/R8 produces 2.50V output, but circuit label says 3V3_RAIL. Expected R_top = 31.25k for 3.3V with R_bottom = 10k. Reference: TPS54331 datasheet Section 9.2.1."

### Technical Implementation
```
Pipeline:
  CircuitAnalyzer.identify_blocks(schematic)
    -> FunctionalBlock(type=POWER_SUPPLY, components=[U3, L1, C5, C6, D2, R7, R8])

  RAGRetriever.query("TPS54331 feedback resistor calculation output voltage")
    -> Datasheet excerpt: "V_OUT = V_REF x (1 + R1/R2), V_REF = 0.8V"

  LLM extracts: {formula: "V_OUT = 0.8 * (1 + R_top/R_bottom)",
                  R_top_ref: "R7", R_bottom_ref: "R8"}

  Z3Solver.check_constraint:
    R7_value = 10000  # from BOM
    R8_value = 4700   # from BOM
    V_OUT_actual = 0.8 * (1 + 10000/4700) = 2.502V
    V_OUT_expected = 3.3  # from net name/label
    assert abs(V_OUT_actual - V_OUT_expected) < 0.1  -> FAIL

  Output: SchematicFinding(severity=CRITICAL, category=SEMANTIC_DRC, ...)
```

Extends: `CircuitAnalyzer` in `/packages/intelligence/src/routeai_intelligence/agent/circuit_analyzer.py`
Validated by: `Z3ConstraintSolver` in `/packages/solver/src/routeai_solver/constraints/z3_solver.py`

---

## Feature 2: "Did You Forget...?" Checklist Engine

### What It Does
Maintains an LLM-generated, context-aware checklist of protection, filtering, and supporting components that should be present based on the interfaces detected in the design. Goes far beyond regex pattern matching (which the existing `SchematicReviewer` already does) by understanding the *application context* to determine what is truly required vs. optional.

Checks include but are not limited to:
- TVS/ESD protection on every externally-accessible interface (USB, Ethernet, RS-485, CAN, GPIO headers)
- Series resistors on RESET lines (not just a cap -- the resistor limits current if reset is actively driven)
- Ferrite beads between analog and digital power domains
- Test points on every power rail, every communication bus, and every clock
- Bulk capacitor at every power entry point
- Boot mode configuration resistors (STM32 BOOT0, ESP32 strapping pins)
- Current sense resistors for power monitoring (if the design appears to be battery-powered)
- Reverse polarity protection on DC input connectors
- Fuse or PTC on USB VBUS output (if board provides power to downstream devices)

### Why It Requires an LLM
The existing `SchematicReviewer._check_esd_protection()` uses regex to find USB nets and check for TVS components. This works for USB but fails for the long tail of interfaces: what about the SPI bus going to an external sensor board through a ribbon cable? What about the I2S audio output on a header? What about the JTAG debug port that is accessible on the production unit? The LLM understands that *any signal leaving the board boundary* needs ESD consideration, and it can determine which signals leave the board by analyzing connector pin assignments, not just net names.

Similarly, "Did you forget a series resistor on RESET?" requires understanding that some MCUs have internal pull-ups making the external resistor optional, while others (particularly older parts or safety-critical designs) explicitly require it per datasheet.

### LLM + Solver Integration
1. **LLM (CircuitAnalyzer)**: Identifies all external interfaces by analyzing connector components and their connected nets
2. **LLM**: For each interface, generates a completeness checklist based on RAG-retrieved datasheet/app note requirements
3. **Solver (DRC electrical)**: Validates that identified protection components are actually connected in the correct topology (TVS between signal and GND, not between two signals)
4. **LLM**: Prioritizes findings based on risk (user-accessible USB port > internal debug header)

### Example Scenario
A designer builds an IoT sensor board with an STM32L4, BME280 sensor on I2C, USB-C for programming, and a 6-pin header for SPI expansion. The `SchematicReviewer` catches the missing USB TVS because it pattern-matches "USB_DP/USB_DM." But it misses:
- The SPI header has no ESD protection (signal names are "SPI1_MOSI", "SPI1_CLK" -- not in the regex pattern)
- The I2C pull-ups are 10k but the BME280 datasheet recommends 4.7k for 400kHz operation
- BOOT0 pin has no pull-down resistor (STM32L4 boots from flash by default, but a floating BOOT0 can cause intermittent boot failures in high-EMI environments)
- No test point on the 1.8V LDO output that powers the sensor

The "Did You Forget" engine catches all four because the LLM understands the board's context.

### Technical Implementation
```
Pipeline:
  # Phase 1: Interface Discovery (extends CircuitAnalyzer)
  interfaces = LLM.identify_external_interfaces(schematic, connectors)
  -> [{type: "USB-C", connector: "J1", signals: ["USB_DP", "USB_DM", "CC1", "CC2", "VBUS"]},
      {type: "SPI_header", connector: "J3", signals: ["SPI1_MOSI", "SPI1_MISO", "SPI1_CLK", "SPI1_CS"]},
      {type: "I2C_internal", bus: "I2C1", signals: ["I2C1_SDA", "I2C1_SCL"]}]

  # Phase 2: Checklist Generation (RAG-augmented)
  for interface in interfaces:
    checklist = LLM.generate_protection_checklist(interface, application_context)
    # USB-C: [TVS on DP/DM, TVS on CC lines, VBUS fuse/PTC, CC pull-down resistors (5.1k)]
    # SPI header: [ESD protection (external connector), series resistors (optional)]
    # I2C: [pull-up value check against bus speed, ESD if external]

  # Phase 3: Verification
  for item in checklist:
    present = SchematicReviewer.verify_component_present(item, schematic)
    if not present:
      findings.append(SchematicFinding(...))
```

Extends: `SchematicReviewer` in `/packages/intelligence/src/routeai_intelligence/agent/schematic_reviewer.py`

---

## Feature 3: Application-Specific Compliance Review

### What It Does
Reviews the design against domain-specific standards that go beyond generic PCB design rules. The engineer declares the target application domain (automotive/ASIL, medical/IEC 60601, aerospace/DO-254, industrial/IEC 61131, consumer/IEC 62368), and the LLM applies domain-specific review criteria retrieved from a curated knowledge base.

For **automotive (ISO 26262 / ASIL)**:
- Redundant power supply paths for ASIL-C/D
- Watchdog timer with independent clock source
- Diagnostic coverage analysis: every safety-relevant output must have a feedback path
- Creepage/clearance per AEC-Q100 stress test conditions
- Temperature-rated components (-40 to +125C for Grade 1)

For **medical (IEC 60601-1)**:
- Creepage and clearance for 2xMOPP or 2xMOOP between patient-connected and mains-connected parts
- Isolation barrier verification (transformer, optocoupler, or capacitive isolation)
- Leakage current path analysis
- Single-fault-safe power supply topology
- EMC pre-compliance check per IEC 60601-1-2

For **aerospace (DO-254 / MIL-STD-883)**:
- Derating analysis: every component operating within 50-80% of rated maximum
- Radiation-tolerant component selection verification
- Redundancy architecture review (TMR for critical functions)
- Conformal coating compatibility check
- Thermal cycling margin analysis

### Why It Requires an LLM
These standards are hundreds of pages of natural language requirements with complex conditional logic ("if the equipment is intended for direct cardiac application, then 2xMOPP shall apply between the applied part and..."). No rule engine encodes all of IEC 60601-1. An LLM can read the standard (via RAG), understand the specific clauses that apply to the design's classification, and generate targeted checks. The key insight: the LLM does not need to *memorize* the standard -- it retrieves relevant clauses from the indexed knowledge base and applies them to the specific design.

### LLM + Solver Integration
1. **LLM + RAG**: Retrieves relevant standard clauses based on declared application domain and detected circuit features
2. **LLM**: Maps abstract requirements ("adequate creepage for 2xMOPP at 250V working voltage") to concrete checks ("minimum 8mm creepage between nets MAINS_L and PATIENT_SENSE on all layers")
3. **Solver (DRC geometric)**: Measures actual creepage distances between identified net pairs using Clipper2 polygon operations
4. **Solver (physics/thermal.py)**: Validates derating margins using component ratings vs. operating conditions
5. **LLM**: Generates compliance report with clause-by-clause status

### Example Scenario
An engineer designing a pulse oximeter (IEC 60601-1, applied part type BF) runs the compliance review. The LLM:
1. Identifies the isolation barrier between the sensor frontend (applied part) and the processing/communication section
2. Retrieves IEC 60601-1 Table 6 for BF applied parts: 2xMOPP required, 1500V test voltage
3. Checks that the optocoupler (U5) has CTI >= 600V and package creepage >= 8mm
4. Finds that the I2C isolator (U7) has 3.75kV isolation rating (sufficient) but the PCB layout only has 4.2mm creepage between the isolated and non-isolated sides due to a ground pour that extends too close
5. Reports: "ERROR: Creepage between PATIENT_GND and SYSTEM_GND is 4.2mm at [x=45.2, y=32.1]. IEC 60601-1 Table 11 requires 8.0mm for 2xMOPP at 250Vrms working voltage. Recommendation: Add keepout zone or slot between isolation domains."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/agent/compliance_reviewer.py

class ComplianceReviewer:
    domains = {
        "automotive_asil": ASILProfile,
        "medical_60601": Medical60601Profile,
        "aerospace_do254": AerospaceProfile,
        "industrial": IndustrialProfile,
        "consumer": ConsumerProfile,
    }

    async def review(self, design, domain: str, classification: dict):
        profile = self.domains[domain]

        # Step 1: RAG retrieval of applicable clauses
        clauses = await self.rag.retrieve_clauses(
            standard=profile.primary_standard,
            classification=classification,  # e.g., {applied_part: "BF", mains_voltage: 250}
        )

        # Step 2: LLM maps clauses to concrete checks
        checks = await self.agent.generate_compliance_checks(clauses, design)
        # -> [{type: "creepage", net_pair: ("PATIENT_GND", "SYSTEM_GND"), min_mm: 8.0}, ...]

        # Step 3: Solver executes checks
        results = []
        for check in checks:
            if check.type == "creepage":
                actual = DRCEngine.measure_creepage(board, check.net_pair)
                results.append(ComplianceResult(check, actual, passed=actual >= check.min_mm))
            elif check.type == "derating":
                actual = PhysicsEngine.component_stress(board, check.component)
                results.append(ComplianceResult(check, actual, passed=actual <= check.max_ratio))

        # Step 4: LLM generates compliance report
        return await self.agent.format_compliance_report(results, clauses)
```

Integrates with: `IPCChecker` in `/packages/solver/src/routeai_solver/compliance/ipc_checker.py`

---

## Feature 4: Cross-Domain Verification (Schematic Intent vs. PCB Layout)

### What It Does
Verifies that the PCB layout actually implements the *intent* captured in the schematic, beyond basic netlist matching. Standard ERC checks that net connections match. This feature checks that the *physical implementation* preserves the *electrical intent*.

Specific checks:
- **Star-point grounding**: If the schematic shows separate AGND and DGND symbols connected at a single point, verify the layout implements single-point connection (not merged via a ground pour)
- **Current flow paths**: If a sense resistor is drawn in series with a load, verify the PCB layout routes the full load current *through* the sense resistor pads (not via a parallel copper pour path)
- **Isolation domains**: If the schematic draws an isolation barrier, verify no copper crosses the barrier in the layout (including inner layers)
- **Matched length intent**: If the schematic shows signals as a bus/group, verify they are length-matched in the layout
- **Hierarchical sheet boundaries**: If a schematic block is a "power supply module" on its own sheet, verify the components are grouped together in the layout (not scattered across the board)

### Why It Requires an LLM
These checks require understanding *design intent*, which exists only in the schematic's visual organization, naming conventions, and implicit engineering conventions. The LLM reads the schematic hierarchy, understands that "Sheet 3: Audio Codec" means those components should be co-located, and verifies this in the layout. A rule engine has no concept of "should be co-located based on functional grouping."

### LLM + Solver Integration
1. **LLM (CircuitAnalyzer)**: Extracts design intent from schematic structure -- functional blocks, hierarchy, net naming, component grouping
2. **LLM**: Generates intent assertions: "Components U3, C12-C15, L2 form the audio codec block and should be within a 20mm x 20mm region"
3. **Solver (geometric DRC)**: Measures actual component positions, calculates bounding boxes, traces copper connectivity
4. **Solver (Z3)**: Formally verifies intent assertions against layout data
5. **LLM**: Explains violations in terms of the original design intent

### Example Scenario
An analog designer carefully separates AGND and DGND in the schematic, connecting them at a single 0-ohm resistor (R_AGND). In the PCB layout, both ground nets connect to the same copper pour because the layout engineer added ground vias that bypass the single-point connection. Traditional DRC sees correct connectivity. Cross-domain verification catches: "WARNING: AGND and DGND have 14 parallel copper paths in the layout (ground pour + vias on layers B.Cu, In1.Cu), defeating the single-point ground topology intended by R23 (0 ohm). The schematic intent was a star-ground connection at R23's location [x=34.5, y=21.2]."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/sync/intent_verifier.py

class IntentVerifier:
    async def verify(self, schematic, board, blocks: list[FunctionalBlock]):
        intents = []

        # Extract ground topology intent
        ground_nets = [n for n in schematic.nets if "GND" in n.name.upper()]
        if len(ground_nets) > 1:
            # Multiple ground domains -- check for star-point topology
            connecting_components = self._find_inter_ground_components(schematic, ground_nets)
            intents.append(GroundTopologyIntent(
                ground_nets=ground_nets,
                connection_points=connecting_components,
                topology="star_point"
            ))

        # Extract proximity intent from hierarchy
        for block in blocks:
            component_positions = [board.get_component_position(ref) for ref in block.components]
            bbox = bounding_box(component_positions)
            intents.append(ProximityIntent(
                block=block,
                max_spread_mm=bbox.diagonal * 1.5,  # Allow 50% margin
            ))

        # Verify each intent against layout
        violations = []
        for intent in intents:
            result = await self._verify_intent(intent, board)
            if not result.passed:
                violations.append(result)

        return violations
```

Extends: `netlist_diff.py` and `cross_probe.py` in `/packages/intelligence/src/routeai_intelligence/sync/`

---

## Feature 5: Datasheet Compliance Checker

### What It Does
The LLM reads component datasheets (via RAG-indexed PDF corpus) and verifies that the PCB layout follows the manufacturer's recommended layout. This goes beyond "read the datasheet yourself" by automating the tedious, error-prone process of cross-referencing dozens of layout recommendations across every IC on the board.

Specific checks per component:
- **Recommended PCB layout** (often a specific figure in the datasheet): Pad dimensions, thermal via pattern, copper pour extent
- **Decoupling capacitor placement and values**: "Place a 4.7uF capacitor within 2mm of pin 3" -- verify both value and distance
- **Exposed pad / thermal pad**: Verify via count, via size, and solder paste coverage match recommendations
- **Antenna/RF layout**: Keep-out zones, ground plane requirements, trace impedance matching
- **Crystal layout**: Guard ring, trace length limits, no routing under crystal
- **Power supply layout**: Input/output capacitor loop area, inductor placement, feedback trace routing

### Why It Requires an LLM
Datasheet layout recommendations are written in natural language, often embedded in figures with callouts. "Route the feedback trace away from the switching node" cannot be expressed as a DRC rule without first understanding *which* trace is the feedback trace and *where* the switching node is. The LLM reads the datasheet, extracts quantitative recommendations ("cap within 2mm"), identifies which schematic components and nets correspond to each recommendation, and generates verifiable constraints.

### LLM + Solver Integration
1. **RAG retriever**: Retrieves relevant datasheet sections (layout guidelines, recommended PCB, application circuit) for each IC in the BOM
2. **LLM**: Extracts structured layout rules from natural-language recommendations
3. **Solver (geometric DRC)**: Measures actual distances, areas, via counts
4. **Solver (physics/impedance.py)**: Verifies impedance targets for RF/high-speed layout recommendations
5. **LLM**: Generates finding with exact datasheet page citation

### Example Scenario
A design uses a TPS65217C PMIC (common on BeagleBone-like designs). The TI datasheet has a full page of layout recommendations including:
- "Place all input capacitors within 5mm of the respective VINx pin"
- "Use a Kelvin connection for the current sense resistor"
- "Route VBUS trace with minimum 40mil width"
- "Place a 10uF capacitor on each LDO output within 3mm"

The LLM reads these, identifies the corresponding components in the schematic (C14 = VIN cap, R3 = sense resistor, etc.), and generates spatial constraints. The solver measures: C14 is 12mm from the VIN pin due to the autoplacer putting it on the other side of the IC. Finding: "ERROR: Input capacitor C14 (10uF) is 12.3mm from U1.VIN (pin 24). TPS65217C datasheet SLVSB64 recommends maximum 5mm. High input loop inductance may cause voltage spikes during load transients. Move C14 to within 5mm of pin 24."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/agent/datasheet_checker.py

class DatasheetComplianceChecker:
    async def check_component(self, component_ref: str, schematic, board):
        # Get component info
        comp = schematic.get_component(component_ref)
        part_number = comp.value  # e.g., "TPS65217C"

        # Retrieve layout guidelines from indexed datasheets
        guidelines = await self.rag.retrieve(
            query=f"{part_number} recommended PCB layout guidelines",
            filter={"doc_type": "datasheet", "section": "layout"},
            top_k=10,
        )

        # LLM extracts structured rules
        rules = await self.agent.extract_layout_rules(guidelines, comp, schematic)
        # -> [DistanceRule(from="C14", to="U1.pin24", max_mm=5.0, citation="SLVSB64 p.32"),
        #     WidthRule(net="VBUS", min_mm=1.016, citation="SLVSB64 p.33"),
        #     ViaCountRule(pad="U1.thermal", min_vias=9, citation="SLVSB64 p.34")]

        # Solver verifies each rule
        findings = []
        for rule in rules:
            if isinstance(rule, DistanceRule):
                actual = board.measure_distance(rule.from_pad, rule.to_pad)
                if actual > rule.max_mm:
                    findings.append(...)
            elif isinstance(rule, WidthRule):
                actual = board.get_min_trace_width(rule.net)
                if actual < rule.min_mm:
                    findings.append(...)

        return findings
```

New RAG index: Datasheet PDF corpus per component, chunked by section, embedded with layout-specific metadata.

---

## Feature 6: Signal Integrity Pre-Flight Check with Reasoning

### What It Does
Before the engineer runs a full SI simulation (which can take hours for complex designs), the LLM performs a rapid pre-flight assessment of every high-speed net. It combines analytical models from the solver layer with contextual reasoning to predict where signal integrity problems will occur and *explain why in plain language*.

For each high-speed net, the report includes:
- **Estimated loss**: "USB3_TX_P: 2.1 inches on outer layer FR4, estimated 2.3 dB insertion loss at 5 GHz fundamental. Budget is typically 4 dB at Nyquist, so this is within margin."
- **Impedance discontinuities**: "DDR_DQ0 transitions from 48.2 ohm microstrip (L1) to 42.1 ohm stripline (L3) at via V23. The 12.7% impedance mismatch will cause a reflection coefficient of 0.067 (-23.5 dB). For DDR3-1600, this is acceptable (threshold: -20 dB)."
- **Crosstalk risk**: "CLK_100MHz runs parallel to AUDIO_OUT for 18mm with 0.15mm spacing on layer 1. Estimated FEXT: -22 dB. This will couple ~80mV of clock noise into the audio path."
- **Return path analysis**: "SGMII_RX_P changes reference from GND (L2) to VCC (L3) at via V45. No stitching via within 2mm. The return current will detour around the nearest plane connection, creating a ~6mm slot antenna at 1.25 GHz."

### Why It Requires an LLM
The solver can compute impedance, loss, and crosstalk numerically. But interpreting whether the *numbers matter* for this specific interface requires understanding the signal standard. Is -22 dB crosstalk acceptable? For DDR3-1600 DQ signals, probably yes. For a 24-bit audio DAC output, absolutely not. The LLM knows the interface specification, understands the noise margin, and provides the judgment call with reasoning that a junior engineer can learn from.

### LLM + Solver Integration
1. **LLM (CircuitAnalyzer)**: Classifies nets by signal type and speed (USB3 = 5 Gbps, DDR3-1600 = 800 MHz, etc.)
2. **Solver (si/impedance_engine.py)**: Calculates impedance for every trace segment using Hammerstad-Jensen
3. **Solver (si/crosstalk_engine.py)**: Computes FEXT/NEXT for parallel trace segments
4. **Solver (si/return_path.py)**: Analyzes reference plane continuity at every via transition
5. **LLM**: Interprets all numerical results against interface-specific budgets, ranks by severity, explains in natural language

### Example Scenario
A DDR3 memory interface on a 4-layer board. The solver computes raw numbers for all 40+ signals. The LLM synthesizes: "WARNING: DDR3 address bus signals ADDR[0:15] are routed on layer 1 (microstrip) with 5.0 mil trace width, giving 62 ohm impedance. DDR3 targets 40 ohm +/- 10%. The 55% mismatch will cause significant signal integrity degradation. Recommendation: Increase trace width to 8.5 mil for 40 ohm target on your stackup (FR4, 4 mil dielectric to L2 ground plane), or move to layer 3 (stripline) where 4.5 mil achieves 40 ohm. Reference: JEDEC JESD79-3F Section 6."

Without the LLM, the solver would output 40 rows of "impedance = 62.1 ohm" without context on whether that matters.

### Technical Implementation
```
Extends: /packages/solver/src/routeai_solver/si/impedance_engine.py
New module: /packages/intelligence/src/routeai_intelligence/agent/si_preflight.py

class SIPreflightAnalyzer:
    async def analyze(self, board, schematic, blocks: list[FunctionalBlock]):
        # Classify all nets
        net_classes = await self.circuit_analyzer.classify_nets(schematic)

        # Filter to high-speed nets
        hs_nets = [n for n in net_classes if n.signal_type in (
            SignalType.HIGH_SPEED, SignalType.DIFFERENTIAL, SignalType.CLOCK,
            SignalType.USB, SignalType.DDR
        )]

        # Run solver analysis on each net
        si_results = {}
        for net in hs_nets:
            si_results[net.net_name] = {
                "impedance_profile": self.impedance_engine.profile(board, net.net_name),
                "insertion_loss": self.loss_calculator.estimate(board, net.net_name, net.frequency),
                "crosstalk": self.crosstalk_engine.analyze_neighbors(board, net.net_name),
                "return_path": self.return_path_analyzer.check(board, net.net_name),
            }

        # LLM interprets results with interface-specific context
        report = await self.agent.interpret_si_results(
            si_results, net_classes,
            interface_specs=await self.rag.retrieve_interface_specs(net_classes),
        )

        return report  # Findings with reasoning, ranked by severity
```

---

## Feature 7: Power Integrity Review with Contextual Suggestions

### What It Does
Analyzes the power distribution network (PDN) not just for impedance compliance but for *practical effectiveness* -- whether the decoupling strategy actually works given real-world component placement and routing.

Specific analysis:
- **Decoupling effectiveness**: "C15 (100nF) is placed 8mm from U2 pin 14 (VDD_CORE). At this distance, the trace inductance (~1nH/mm) adds 8nH in series, making the capacitor ineffective above 56 MHz. For DDR3 operation at 800 MHz, this cap provides no benefit. Move within 2mm or add a 1nF cap at the pin."
- **Bulk cap analysis**: "Your 47uF bulk cap (C1) is on the opposite side of the board from the main power entry. The 35mm trace path adds ~35nH, shifting the anti-resonance to 130 kHz. Place near power connector or add a second bulk cap near the load cluster."
- **Power plane analysis**: "3V3 plane on layer 3 has a 2mm gap at [x=42, y=15] due to a routing channel. This gap is directly between U1 (main processor, 800mA peak) and its bulk decoupling. The gap forces current through a 4mm detour, adding ~4nH to the PDN."
- **Voltage regulator feedback**: "The output voltage sense trace for U4 (LDO) routes through a via and 15mm of trace before reaching the feedback divider. This adds IR drop under load, causing the regulated output to be higher than intended at the load. Use Kelvin sensing."

### Why It Requires an LLM
The solver computes PDN impedance, loop inductance, and plane continuity. But making the connection between "C15 is 8mm from the pin" and "this makes it useless above 56 MHz because the series inductance dominates" requires understanding the physics in context. More importantly, the *suggestion* ("move within 2mm or add a 1nF cap") requires understanding the tradeoff space and common engineering solutions. The LLM also reads TI/ADI/Murata app notes on PDN design and cites specific recommendations.

### LLM + Solver Integration
1. **Solver (si/pdn_analyzer.py)**: Computes PDN impedance vs. frequency, identifies anti-resonances
2. **Solver (pi/ir_drop.py)**: Calculates DC IR drop across power plane and traces
3. **Solver (geometric DRC)**: Measures cap-to-pin distances, identifies plane gaps
4. **LLM**: Interprets results, computes effective frequency ranges for each cap, identifies which caps are "wasted" due to placement, suggests specific improvements with app note citations

### Example Scenario
Board has 12 decoupling capacitors for a Xilinx Zynq FPGA. The solver measures all distances and computes inductances. The LLM reports: "INFO: Your decoupling strategy is front-loaded at low frequency but has a gap between 100 MHz and 500 MHz. Six of your twelve 100nF caps (C22, C24, C27, C29, C31, C34) are placed >5mm from the nearest BGA power pad and are effectively redundant above 80 MHz. Recommendation per Xilinx UG583: Replace four of the distant 100nF caps with 1nF (X7R, 0402) placed directly on the BGA escape routing layer, targeting the 200-500 MHz range. Estimated PDN impedance improvement: 8 dB at 300 MHz."

### Technical Implementation
```
Extends: /packages/solver/src/routeai_solver/si/pdn_analyzer.py
New module: /packages/intelligence/src/routeai_intelligence/agent/pdn_reviewer.py

class PDNReviewer:
    async def review(self, board, schematic, blocks):
        # Identify all power domains
        power_blocks = [b for b in blocks if b.type == BlockType.POWER_SUPPLY]

        # For each IC, analyze its decoupling
        for ic_block in [b for b in blocks if b.type in (BlockType.DIGITAL_CORE, BlockType.MEMORY)]:
            ic_ref = ic_block.primary_component

            # Find all decoupling caps (from schematic review)
            caps = self._find_decoupling_caps(ic_ref, schematic, board)

            # Measure placement quality
            for cap in caps:
                cap.distance_mm = board.measure_distance(cap.ref, ic_ref, pin=cap.power_pin)
                cap.loop_inductance_nH = self.pdn_analyzer.estimate_loop_inductance(
                    board, cap.ref, ic_ref, cap.power_pin
                )
                cap.effective_frequency_range = self._compute_effective_range(cap)

            # LLM analysis with app note context
            analysis = await self.agent.analyze_decoupling_strategy(
                ic_ref=ic_ref,
                ic_type=ic_block.name,
                caps=caps,
                target_impedance=self.pdn_analyzer.target_impedance(ic_ref),
                app_notes=await self.rag.retrieve(f"{ic_block.name} decoupling PDN design guide"),
            )

            findings.extend(analysis.findings)
```

---

## Feature 8: Thermal Simulation Interpretation

### What It Does
Takes raw thermal analysis results (temperature maps, hotspot locations, thermal resistance values) from the solver layer and translates them into actionable engineering guidance. Instead of "max temperature = 112C at [x=34, y=28]", the engineer gets: "CRITICAL: U3 (TPS54331 buck converter) junction temperature estimated at 112C, which is 37C above the 75C recommended maximum for reliable operation with derating. The primary heat path is through the exposed pad, which has only 4 thermal vias (minimum 9 recommended per TI SLMA002). Adding 5 more thermal vias and expanding the bottom-side ground pour by 3mm in each direction would reduce Rth_ja by approximately 15C/W, bringing the junction temperature to ~89C."

### Why It Requires an LLM
Thermal simulation produces numbers (temperatures, heat fluxes, thermal resistances). Turning those into *actionable design changes* requires understanding:
- Which component has the problem (mapping coordinates to reference designators)
- What the safe operating limits are (reading the datasheet's thermal characteristics)
- What the heat path looks like (understanding the PCB's thermal stackup)
- What specific changes would help (more vias? bigger copper? different component? heatsink?)
- How much improvement each change would provide (quantitative estimation)

This is expert interpretation that currently requires a thermal engineer reviewing simulation results.

### LLM + Solver Integration
1. **Solver (physics/thermal.py)**: Computes thermal resistance network, steady-state temperatures, hotspot map
2. **LLM**: Maps hotspot coordinates to components, retrieves thermal specs from datasheets
3. **LLM + Solver**: Runs "what-if" scenarios (add vias, increase copper, add heatsink) using solver for each scenario
4. **LLM**: Ranks mitigation options by effectiveness and cost, generates report

### Example Scenario
A motor driver board with three DRV8301 gate drivers. Thermal analysis shows all three exceeding 95C junction temperature. The LLM report explains: "The thermal via array under each DRV8301 has 4 vias (0.3mm drill), providing approximately 45 C/W pad-to-board resistance. The DRV8301 dissipates 2.1W at your operating point (48V bus, 10A phase current, 20kHz PWM). With theta_ja = 28 C/W (datasheet) + 45 C/W (pad-to-board) and 25C ambient, T_j = 25 + 2.1*(28+45) = 178C -- exceeding the 150C absolute maximum. Recommendations in priority order: (1) Increase thermal via count to 16 (4x4 array, 0.3mm drill) reducing Rth by ~60%, (2) Add 2oz copper on inner layers under the IC, (3) Add forced airflow (2 m/s reduces Rth by ~30%)."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/agent/thermal_interpreter.py

class ThermalInterpreter:
    async def interpret(self, thermal_results, board, schematic, blocks):
        findings = []

        for hotspot in thermal_results.hotspots:
            # Map to component
            comp_ref = board.component_at(hotspot.x, hotspot.y)
            comp_info = schematic.get_component(comp_ref)

            # Get thermal specs from datasheet
            thermal_specs = await self.rag.retrieve(
                f"{comp_info.value} thermal resistance absolute maximum temperature"
            )
            specs = await self.agent.extract_thermal_specs(thermal_specs)
            # -> {theta_ja: 28, theta_jc: 3.5, T_j_max: 150, T_j_recommended: 125}

            # Analyze current thermal path
            via_count = board.count_thermal_vias(comp_ref)
            copper_area = board.copper_area_under(comp_ref, margin_mm=5)

            # Run what-if scenarios via solver
            scenarios = [
                {"vias": via_count * 2, "copper_oz": 2},
                {"vias": via_count * 4, "copper_oz": 2},
                {"vias": via_count * 4, "copper_oz": 2, "heatsink_rth": 10},
            ]
            scenario_results = [
                self.thermal_solver.estimate(board, comp_ref, **s) for s in scenarios
            ]

            # LLM generates actionable recommendation
            finding = await self.agent.generate_thermal_recommendation(
                component=comp_info, current_temp=hotspot.temperature,
                specs=specs, via_count=via_count, copper_area=copper_area,
                scenarios=list(zip(scenarios, scenario_results)),
            )
            findings.append(finding)

        return findings
```

---

## Feature 9: Test Coverage Analysis

### What It Does
Analyzes the board for production testability, identifying critical nets that lack test points and suggesting test strategies. This is the analysis that experienced test engineers do during design review -- checking that every power rail, every communication interface, and every critical signal has an accessible test point for in-circuit test (ICT), flying probe, or manual debug.

Specific analysis:
- **Power rail test points**: Every regulated voltage output must have a test point
- **Communication bus test points**: I2C, SPI, UART, CAN buses need accessible points for logic analyzer probes
- **Clock test points**: System clocks, crystal outputs, PLL outputs
- **GPIO test points**: Key control signals (chip selects, enables, resets)
- **Analog test points**: ADC inputs, DAC outputs, reference voltages
- **ICT coverage calculation**: Percentage of nets accessible by ICT fixture (considering component side, probe clearance, grid alignment)
- **Boundary scan coverage**: For BGA/fine-pitch ICs, verify JTAG chain completeness as an alternative to ICT

### Why It Requires an LLM
Knowing *which* nets need test points requires understanding the design. A generic rule ("put test points on all power nets") over-specifies (not every internal power net needs a test point) and under-specifies (the critical debug UART does not have "power" in its name). The LLM understands that the 1.0V core voltage on an FPGA is a critical test point (you need to verify it during bring-up), while the 3.3V_PULLUP net powering a bank of pull-up resistors is less critical. It also understands that the JTAG signals on an ARM MCU are essential for production programming and debug, even though they are "just GPIO" from a netlist perspective.

### LLM + Solver Integration
1. **LLM (CircuitAnalyzer)**: Identifies critical nets based on functional importance
2. **LLM**: Prioritizes test points by debug value and production test necessity
3. **Solver (geometric DRC)**: Checks existing test point placement for probe accessibility (minimum pad size, clearance, grid alignment)
4. **Solver (manufacturing/pick_and_place.py)**: Verifies test points do not conflict with component placement or assembly fixtures
5. **LLM**: Generates prioritized test point addition list with suggested locations

### Example Scenario
A BLE sensor module with nRF52832, BME280, and a LiPo charging circuit. The board has zero test points (common in compact designs). The LLM generates a prioritized list:
1. "CRITICAL: No test point on VBAT_REGULATED (3.0V LDO output). This is the main system power rail. Add TP on this net for bring-up voltage verification. Suggested location: near C8, bottom side."
2. "ERROR: No test point on SWD_CLK or SWD_DIO. These are required for production programming of the nRF52832. Without test points, programming requires a pogo-pin fixture aligned to the nRF52832's 0.4mm-pitch pads. Add TP pads for both signals."
3. "WARNING: I2C bus (SDA, SCL) has no test points. The BME280 communication cannot be verified during ICT without these. Add TPs near the BME280."
4. "INFO: Battery voltage sense (VBAT_SENSE) has no test point. Useful for calibrating the ADC battery measurement."
5. "INFO: ICT coverage estimate: 34% of nets accessible. Adding the recommended test points increases coverage to 78%."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/agent/test_coverage.py

class TestCoverageAnalyzer:
    async def analyze(self, board, schematic, blocks):
        # Identify existing test points
        test_points = [fp for fp in board.footprints if fp.reference.startswith("TP")]
        tp_nets = {tp.pads[0].net for tp in test_points}

        # LLM determines which nets need test points
        critical_nets = await self.agent.identify_testable_nets(
            schematic=schematic,
            blocks=blocks,
            context={
                "production_volume": "medium",  # from user config
                "test_method": "flying_probe",  # from user config
                "has_jtag": any(b.type == BlockType.DEBUG for b in blocks),
            }
        )
        # -> [{net: "VBAT_REG", priority: "critical", reason: "main power rail"},
        #     {net: "SWD_CLK", priority: "critical", reason: "programming interface"}, ...]

        # Check which critical nets lack test points
        missing = [n for n in critical_nets if n["net"] not in tp_nets]

        # For each missing TP, suggest placement
        for m in missing:
            location = self._suggest_tp_location(board, m["net"])
            # Verify accessibility via DRC
            accessible = self.drc_engine.check_probe_access(
                board, location, min_pad_mm=1.0, min_clearance_mm=0.5
            )
            findings.append(TestCoverageFinding(
                net=m["net"], priority=m["priority"],
                reason=m["reason"], suggested_location=location,
                accessible=accessible,
            ))

        # Calculate overall coverage
        total_nets = len(schematic.nets)
        covered = len(tp_nets) + len([m for m in missing if m["priority"] == "info"])
        coverage_pct = (len(tp_nets) / total_nets) * 100

        return TestCoverageReport(findings=findings, coverage_pct=coverage_pct)
```

---

## Feature 10: Design for Manufacturing Review with Fab Feedback

### What It Does
Simulates the review that a PCB fabrication house performs when they receive Gerber files, catching issues that cause yield loss, price increases, or outright rejection. The LLM knows which design choices affect cost and yield because it has been trained on fab house design guides (e.g., PCBWay, JLCPCB, Eurocircuits, TTM Technologies design rules).

Specific checks:
- **Acid traps**: Acute angles (<90 degrees) in copper that trap etchant and cause over-etching
- **Copper slivers**: Narrow copper features that may detach during etching
- **Starved thermals**: Thermal relief spokes too narrow for reliable connection
- **Aspect ratio**: Drill depth-to-diameter ratio exceeding fab capability (typically 8:1 for standard, 12:1 for HDI)
- **Annular ring adequacy**: Accounting for drill registration tolerance (not just minimum rule)
- **Solder mask slivers**: Narrow solder mask dams between pads that may flake off
- **Impedance-affecting features**: Copper features near controlled-impedance traces that shift the impedance
- **Panel efficiency**: Board outline shape compatibility with panelization
- **Via-in-pad**: If used, verify specification calls out filled-and-capped (VIPPO) or if standard vias will cause solder wicking
- **Copper balance**: Uneven copper distribution causing bow and twist

### Why It Requires an LLM
Many of these checks exist in rule form (acid trap detection, sliver detection). The LLM adds value in three ways: (1) understanding *which fab capabilities to check against* based on the target manufacturer, (2) estimating *cost impact* of design choices ("your 0.2mm vias require laser drilling, adding $3/board; 0.3mm vias would be mechanically drilled at no extra cost"), and (3) providing *specific, actionable fixes* rather than just flagging violations. The LLM also reads the specific fab house's capability documents (via RAG) and knows that JLCPCB's minimum trace/space is different from Eurocircuits'.

### LLM + Solver Integration
1. **Solver (manufacturing/dfm.py)**: Runs geometric DFM checks (acid traps, slivers, annular rings)
2. **Solver (manufacturing/drill.py)**: Validates drill aspect ratios, drill-to-copper clearances
3. **LLM + RAG**: Retrieves target fab house capabilities, maps violations to cost impact
4. **LLM**: Suggests specific design changes to reduce cost or improve yield, estimates per-board cost impact

### Example Scenario
A 6-layer HDI board designed for advanced manufacturing. The designer targets JLCPCB for prototyping. The LLM catches: "WARNING: Your design uses 0.15mm laser-drilled microvias with 0.25mm capture pads. JLCPCB's HDI capability supports 0.1mm microvias but requires 0.35mm capture pads (minimum 0.1mm annular ring after laser registration). Your 0.05mm annular ring will likely be rejected. Fix: Increase microvia pads from 0.25mm to 0.35mm. Cost note: This design requires HDI processing ($45/5pcs at JLCPCB vs. $8/5pcs for standard). If you can redesign the BGA fanout to use 0.3mm through-hole vias, you could use standard processing."

### Technical Implementation
```
Extends: /packages/solver/src/routeai_solver/manufacturing/dfm.py

class DFMReviewer:
    async def review(self, board, target_fab: str = "generic"):
        # Load fab capabilities
        fab_caps = await self.rag.retrieve(f"{target_fab} PCB manufacturing capabilities design rules")
        capabilities = await self.agent.extract_fab_capabilities(fab_caps)
        # -> {min_trace: 0.1, min_space: 0.1, min_drill: 0.2, min_annular: 0.1, ...}

        # Run solver DFM checks against fab capabilities
        dfm_results = self.dfm_engine.check(board, capabilities)

        # LLM enrichment: cost impact, specific fixes, yield risk
        enriched = await self.agent.enrich_dfm_findings(
            dfm_results, capabilities, board_summary={
                "layer_count": board.layer_count,
                "min_drill": board.min_drill,
                "has_microvias": board.has_microvias,
                "has_blind_vias": board.has_blind_vias,
                "board_area_cm2": board.area_cm2,
            }
        )

        # Cost estimation
        cost_estimate = await self.agent.estimate_fabrication_cost(
            board_summary, capabilities, target_fab,
            alternatives=self._generate_cost_reduction_alternatives(board)
        )

        return DFMReport(findings=enriched, cost_estimate=cost_estimate)
```

---

## Feature 11: Design for Assembly Review

### What It Does
Catches assembly-related issues that cause yield loss during SMT reflow, wave soldering, or manual assembly. These are the problems discovered during the first production run -- tombstoned capacitors, solder bridges on fine-pitch parts, and components that cannot be placed by the pick-and-place machine.

Specific checks:
- **Tombstoning risk**: Asymmetric pad/trace connections on small passives (0402, 0201) that create unbalanced thermal mass during reflow, causing one end to solder before the other and the component to stand up
- **Solder bridging risk**: Insufficient solder mask dam between fine-pitch pads (<0.2mm dam at 0.5mm pitch)
- **Component orientation consistency**: All polarized components should follow a convention (anode left/up) for visual inspection
- **Reflow profile compatibility**: Mixed component thermal mass (large ground-plane-connected components next to small passives) causing cold joints or overheating
- **Pick-and-place feasibility**: Component body size vs. courtyard clearance, tape-and-reel availability
- **Wave solder shadowing**: If mixed technology, verify tall components do not shadow SMD parts during wave
- **Stencil aperture design**: Paste volume calculations for BGA, QFN, and fine-pitch components
- **Component-to-edge clearance**: For V-score or tab-route panelization

### Why It Requires an LLM
Tombstoning risk assessment requires understanding the thermal connection of each pad -- a 0402 cap with one pad connected to a large ground pour and the other to a thin trace has high tombstone risk. The solver can compute the copper area connected to each pad, but *knowing* that asymmetric thermal mass at reflow causes tombstoning, and suggesting specific mitigations (thermal relief on the ground pad, equalizing trace widths), requires the kind of manufacturing knowledge that exists in IPC-A-610 and assembly house design guides.

### LLM + Solver Integration
1. **Solver (geometric DRC + manufacturing/pick_and_place.py)**: Computes pad thermal connections, courtyard overlaps, component clearances
2. **LLM**: Interprets thermal asymmetry as tombstone risk, evaluates reflow compatibility
3. **Solver**: Calculates solder paste volume from aperture geometry
4. **LLM**: Cross-references paste volume against IPC-7525 recommendations for each component type

### Example Scenario
A dense IoT board with 120 components, mostly 0402 passives. The DFA review finds:
1. "WARNING: 23 of 45 0402 capacitors have asymmetric pad connections (one pad to ground pour, one pad to thin trace). Tombstoning risk is HIGH for: C12, C15, C17, C22, C24 (thermal ratio > 3:1). Recommendation: Add thermal relief (4 spokes, 0.25mm gap) on the ground-pour-connected pads of these components, or equalize copper connection by widening the signal-side trace to match the pour connection width near the pad."
2. "ERROR: U5 (QFN-48, 0.5mm pitch) solder mask between pads 12 and 13 is 0.08mm. Minimum for reliable dam is 0.15mm. Solder bridges are likely during reflow. Recommendation: Reduce pad length by 0.05mm (from 0.8mm to 0.75mm) to increase mask dam to 0.13mm, or switch to solder-mask-defined pads."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/agent/dfa_reviewer.py

class DFAReviewer:
    async def review(self, board, schematic):
        findings = []

        # Tombstone risk analysis
        for fp in board.footprints:
            if not self._is_small_passive(fp):  # 0402, 0201, 0603
                continue

            pad_thermal = []
            for pad in fp.pads:
                # Solver computes copper area connected to each pad within 2mm
                thermal_mass = self.solver.copper_thermal_mass(board, pad, radius_mm=2.0)
                pad_thermal.append(thermal_mass)

            if len(pad_thermal) == 2:
                ratio = max(pad_thermal) / max(min(pad_thermal), 0.001)
                if ratio > 2.5:
                    findings.append(DFAFinding(
                        type="tombstone_risk",
                        severity="warning" if ratio < 5 else "error",
                        component=fp.reference,
                        thermal_ratio=ratio,
                    ))

        # LLM enrichment with specific mitigations
        enriched = await self.agent.enrich_dfa_findings(findings, board)
        return DFAReport(findings=enriched)
```

---

## Feature 12: Reference Design Comparison

### What It Does
Compares the user's design against known-good reference designs (evaluation boards, manufacturer demo boards) for the same key ICs. The LLM identifies which reference design to compare against, maps corresponding components and nets between the two designs, and highlights significant deviations.

This catches the most common source of design bugs: copying a reference design but making "small" modifications that break critical layout assumptions.

Specific comparisons:
- **Component values**: "Your USB termination resistors are 22 ohm but the STM32F4-Discovery uses 27 ohm (USB-IF compliant value per USB 2.0 spec Table 7-7)"
- **Topology differences**: "The reference design routes the crystal traces as a guarded pair with ground ring. Your design routes them as single-ended traces near the SPI bus."
- **Missing components**: "The evaluation board has a 1uF + 100nF decoupling on VDDA. Your design only has 100nF."
- **Layout differences**: "The reference design places the DDR3 VTT termination regulator within 10mm of the memory ICs. Your placement is 35mm away."
- **Stackup comparison**: "The evaluation board uses a 6-layer stackup with dedicated ground planes on L2 and L5. Your 4-layer design routes signals adjacent to the power plane, which increases EMI."

### Why It Requires an LLM
Mapping between a user's design and a reference design is a semantic problem, not a geometric one. Component references are different (U1 in the reference might be U3 in the user's design). Net names are different. The physical layout is entirely different. The LLM matches components by function (both are the STM32F407VGT6, both have the same crystal frequency), maps nets by their functional role (both have a net connecting the MCU's USB_DP pin to the USB connector), and compares the topology and values. No rule engine can do this cross-design semantic matching.

### LLM + Solver Integration
1. **LLM**: Identifies the "anchor" IC (the main component shared between reference and user design)
2. **LLM**: Maps components and nets between designs using functional analysis
3. **Solver (geometric)**: Computes quantitative differences (distances, areas, trace widths)
4. **LLM**: Classifies each deviation as intentional (different use case) vs. potentially problematic
5. **LLM**: Generates comparison report with severity ranking

### Example Scenario
Designer creates a board around the ESP32-WROOM-32E, loosely based on the ESP32-DevKitC reference. The comparison reveals:
1. "WARNING: Reference design has a pi-filter (L3, C22, C23) on the 3.3V supply to the ESP32's VDD3P3_RTC pin. Your design connects VDD3P3_RTC directly to the 3.3V rail. This filter is recommended by Espressif for WiFi sensitivity. Reference: ESP32 Hardware Design Guidelines v3.5, Section 2.1.1."
2. "INFO: Reference design uses a 40MHz crystal. Your design uses 26MHz. Both are supported by ESP32 but require different PLL configuration in firmware."
3. "ERROR: Reference design has a 10uF capacitor on EN (enable) pin with a 10k pull-up. Your design has only the 10k pull-up, no capacitor. The capacitor provides a power-on-reset delay that ensures stable power before the ESP32 starts. Without it, the ESP32 may boot unreliably with slow-ramping power supplies."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/agent/reference_comparator.py

class ReferenceDesignComparator:
    async def compare(self, user_design, user_schematic):
        # Identify key ICs
        key_ics = await self.circuit_analyzer.identify_key_ics(user_schematic)
        # -> [("U1", "ESP32-WROOM-32E"), ("U2", "CP2102N")]

        # Find matching reference designs in database
        for ic_ref, ic_part in key_ics:
            ref_designs = await self.rag.find_reference_designs(ic_part)
            if not ref_designs:
                continue

            ref_design = ref_designs[0]  # Best match

            # LLM maps components between designs
            mapping = await self.agent.map_designs(
                user_schematic=user_schematic,
                reference_schematic=ref_design.schematic,
                anchor_component=(ic_ref, ic_part),
            )
            # -> {user_C5: ref_C12, user_R3: ref_R7, user_L1: ref_L3, ...}

            # Compare values, topology, connectivity
            deviations = []
            for user_comp, ref_comp in mapping.items():
                if user_comp.value != ref_comp.value:
                    deviations.append(ValueDeviation(user_comp, ref_comp))

            # Check for missing components (in reference but not in user)
            ref_components = set(mapping.values())
            missing = [c for c in ref_design.components_near(ic_part) if c not in ref_components]

            # LLM classifies and prioritizes deviations
            findings = await self.agent.classify_deviations(
                deviations, missing, ic_part,
                reference_doc=ref_design.citation,
            )

            yield ReferenceComparisonReport(
                ic=ic_part, reference=ref_design.name,
                findings=findings,
            )
```

Reference design database: `/data/reference_designs/` indexed by key IC part numbers.

---

## Feature 13: Multi-Board System Review

### What It Does
For systems with multiple PCBs connected via cables, backplanes, or board-to-board connectors, verifies system-level correctness that no single-board review can catch.

Specific checks:
- **Connector pinout matching**: Pin 1 on Board A's output connector maps to Pin 1 on Board B's input connector -- accounting for cable crossovers, gender changes, and keying
- **Power budget**: Total power consumption across all boards vs. power supply capacity, including cable losses
- **Signal integrity across connectors**: Impedance discontinuities at board-to-board interfaces, connector bandwidth limits
- **Ground topology**: How ground connects across boards (single point, multi-point, isolated) and whether it is consistent with the EMC strategy
- **Voltage compatibility**: 3.3V output on Board A connected to 5V-tolerant input on Board B? What about the reverse?
- **Protocol compatibility**: SPI on Board A configured for Mode 0, Board B expects Mode 3 (this is firmware, but the schematic might have hardware mode selection pins)
- **Cable current rating**: Verify cable gauge supports the current flowing between boards

### Why It Requires an LLM
Multi-board review requires understanding the *system* -- how the boards connect, what signals and power flow between them, and what the system-level requirements are. A rule engine checks one board at a time. The LLM reads both designs, understands the connector pinout (including the labeling convention: "TX on Board A connects to RX on Board B"), and reasons about cross-board compatibility. It also handles the inherently ambiguous naming: Board A's "J1" might connect to Board B's "J3" via a cable assembly, and understanding this mapping requires reading the system documentation or inferring it from signal names.

### LLM + Solver Integration
1. **LLM**: Identifies inter-board connections by matching connector types, pin counts, and signal names
2. **LLM**: Resolves naming ambiguities (TX<->RX, MOSI<->SDI, etc.)
3. **Solver (electrical)**: Validates voltage levels, power budgets, cable IR drop
4. **Solver (SI)**: Checks impedance matching at board-to-board interfaces
5. **LLM**: Generates system-level findings with cross-board references

### Example Scenario
A motor controller system with a main processor board and a power stage board connected via a 20-pin ribbon cable. The LLM identifies:
1. "CRITICAL: Board A pin 12 (3V3_AUX) connects to Board B pin 12 (5V_LOGIC) via ribbon cable. Board A provides 3.3V on this pin; Board B expects 5V input to its gate driver supply. The gate drivers will be under-supplied and may not fully enhance the MOSFETs, causing excessive Rds_on and thermal runaway."
2. "ERROR: PWM_A, PWM_B, PWM_C signals cross 30cm of ribbon cable. At 20kHz PWM fundamental with 100ns edges, the cable is electrically short, but the ribbon cable crosstalk between adjacent conductors (estimated -20 dB coupling) will inject switching noise into the ADC_ISENSE_A/B/C signals on adjacent pins. Recommendation: Rearrange pinout to separate PWM and sense signals with ground pins between them."
3. "WARNING: Total system power budget: Board A = 2.1W, Board B = 48W (motor drive, 10A at 48V). The 48V supply trace through the ribbon cable (28AWG, 30cm) has 0.65 ohm round-trip resistance, causing 6.5V drop at 10A. Board B's bulk capacitors must supply the peak motor current. Verify the 48V connector on Board A can handle the current (max 3A per contact on standard 2.54mm headers)."

### Technical Implementation
```
New module: /packages/intelligence/src/routeai_intelligence/agent/system_reviewer.py

class MultiboardSystemReviewer:
    async def review(self, boards: list[tuple[BoardDesign, SchematicDesign]]):
        # Step 1: Identify inter-board connections
        connectors = []
        for i, (board, schem) in enumerate(boards):
            for comp in schem.components:
                if comp.reference.startswith("J"):
                    connectors.append(ConnectorInfo(
                        board_index=i, ref=comp.reference,
                        pins=comp.pins, nets=comp.connected_nets
                    ))

        # LLM matches connectors across boards
        connections = await self.agent.match_inter_board_connectors(connectors)
        # -> [(board_a.J1, board_b.J3, cable_type="ribbon_20pin"), ...]

        # Step 2: Pin-by-pin compatibility check
        findings = []
        for conn_a, conn_b, cable in connections:
            pin_map = await self.agent.resolve_pin_mapping(conn_a, conn_b, cable)

            for pin_a, pin_b in pin_map.items():
                net_a = conn_a.get_net(pin_a)
                net_b = conn_b.get_net(pin_b)

                # Voltage compatibility
                v_a = self._get_voltage_level(boards[conn_a.board_index], net_a)
                v_b = self._get_voltage_level(boards[conn_b.board_index], net_b)
                if abs(v_a - v_b) > 0.5:
                    findings.append(VoltageIncompatibility(pin_a, pin_b, v_a, v_b))

                # Signal direction compatibility
                dir_a = self._get_signal_direction(boards[conn_a.board_index], net_a)
                dir_b = self._get_signal_direction(boards[conn_b.board_index], net_b)
                if dir_a == dir_b == "output":
                    findings.append(BusConflict(pin_a, pin_b))

        # Step 3: Power budget
        total_power = sum(self._estimate_power(b, s) for b, s in boards)
        supply_capacity = self._get_supply_capacity(boards)
        if total_power > supply_capacity * 0.85:
            findings.append(PowerBudgetWarning(total_power, supply_capacity))

        return SystemReviewReport(connections=connections, findings=findings)
```

---

## Integration Architecture

All 13 features integrate into the existing RouteAI pipeline through the same three-gate architecture:

```
┌──────────────────────────────────────────────────────────────┐
│  GATE 1: LLM Analysis (Intelligence Layer)                   │
│                                                              │
│  CircuitAnalyzer ──► Feature-specific Reviewer ──► Findings  │
│       │                      │                               │
│       └── RAG Retrieval ─────┘                               │
│           (datasheets, standards, app notes, ref designs)    │
│                                                              │
│  Output: Structured findings with confidence scores          │
│  Validation: JSON Schema (existing schema_validator.py)      │
│  Citation: Required (existing citation_checker.py)           │
├──────────────────────────────────────────────────────────────┤
│  GATE 2: Deterministic Verification (Solver Layer)           │
│                                                              │
│  For each LLM finding, the solver layer provides:            │
│  - Geometric measurement (distance, area, clearance)         │
│  - Electrical calculation (impedance, loss, IR drop)         │
│  - Physics simulation (thermal, crosstalk, PDN)              │
│  - Formal constraint check (Z3 solver)                       │
│                                                              │
│  Output: Quantitative validation of each finding             │
│  Rule: Finding only survives if solver confirms it           │
├──────────────────────────────────────────────────────────────┤
│  GATE 3: Engineer Review (Presentation Layer)                │
│                                                              │
│  Each finding presented with:                                │
│  - Severity and category                                     │
│  - Natural language explanation with reasoning               │
│  - Exact location (component ref, coordinates, net)          │
│  - Specific, actionable fix recommendation                   │
│  - Citation (datasheet page, IPC clause, app note)           │
│  - Auto-fix option where applicable                          │
│                                                              │
│  Engineer: Approve / Dismiss / Defer for each finding        │
└──────────────────────────────────────────────────────────────┘
```

### CLI Integration

All features are accessible through the existing CLI:

```bash
# Run full AI-powered design review
routeai analyze ./my_project --ai

# Run specific review domains
routeai review --semantic-drc ./my_project
routeai review --checklist ./my_project
routeai review --compliance medical-bf ./my_project
routeai review --cross-domain ./my_project
routeai review --datasheet ./my_project
routeai review --si-preflight ./my_project
routeai review --pdn ./my_project
routeai review --thermal ./my_project
routeai review --test-coverage ./my_project
routeai review --dfm --fab jlcpcb ./my_project
routeai review --dfa ./my_project
routeai review --reference-compare ./my_project
routeai review --multi-board ./board_a ./board_b
```

### Priority Order for Implementation

| Priority | Feature | Reason | Existing Code to Extend |
|----------|---------|--------|------------------------|
| P0 | F2: "Did You Forget" | Highest customer value, extends existing SchematicReviewer | `schematic_reviewer.py` |
| P0 | F5: Datasheet Compliance | Unique LLM capability, no competitor does this | New + `circuit_analyzer.py` |
| P1 | F1: Semantic DRC | Deep differentiator, requires solid CircuitAnalyzer | `circuit_analyzer.py` + `z3_solver.py` |
| P1 | F6: SI Pre-Flight | Leverages existing solver SI engines | `si/impedance_engine.py` |
| P1 | F7: PDN Review | Leverages existing PDN analyzer | `si/pdn_analyzer.py` |
| P1 | F10: DFM Review | Extends existing DFM engine | `manufacturing/dfm.py` |
| P2 | F4: Cross-Domain | Requires mature CircuitAnalyzer | `sync/netlist_diff.py` |
| P2 | F9: Test Coverage | High value for production designs | New |
| P2 | F11: DFA Review | Extends existing manufacturing checks | `manufacturing/pick_and_place.py` |
| P2 | F12: Reference Compare | Requires reference design database | New + `data/reference_designs/` |
| P3 | F3: Compliance Review | Requires large RAG corpus of standards | New |
| P3 | F8: Thermal Interpretation | Requires thermal solver maturity | `physics/thermal.py` |
| P3 | F13: Multi-Board | Niche but high value for target customers | New |

---

## The $50K Mistakes These Features Catch

| Mistake | Feature | Cost if Missed |
|---------|---------|----------------|
| Wrong feedback resistor = wrong voltage = fried IC | F1: Semantic DRC | $15-30K (board respin + delayed schedule) |
| Missing USB ESD protection = fails compliance test | F2: Checklist | $20-50K (redesign + re-certification) |
| Medical creepage violation = fails safety test | F3: Compliance | $50-200K (full redesign + re-certification) |
| Ground pour defeats star-ground = noise on ADC | F4: Cross-Domain | $10-25K (debug time + board respin) |
| Decoupling cap too far from BGA = intermittent crashes | F5: Datasheet + F7: PDN | $15-40K (months of debug) |
| DDR3 impedance wrong = memory errors at temperature | F6: SI Pre-Flight | $20-50K (board respin, SI simulation) |
| Insufficient thermal vias = regulator overheats | F8: Thermal | $10-20K (board respin) |
| No test points = cannot program in production | F9: Test Coverage | $5-15K (ECO + fixture redesign) |
| Via-in-pad without VIPPO = solder voids | F10: DFM | $5-10K per production run (yield loss) |
| Tombstoning on 0402 caps = 5% yield loss | F11: DFA | $2-10K per production run |
| Missing bootstrap cap from reference design | F12: Reference Compare | $10-25K (debug + respin) |
| Wrong voltage across board connector = magic smoke | F13: Multi-Board | $5-50K (damaged boards + delay) |
