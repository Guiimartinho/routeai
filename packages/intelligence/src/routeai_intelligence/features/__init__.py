"""RouteAI Intelligence Features - S1-S10, R1-R11, V1-V13.

34 LLM-powered features for schematic intelligence, routing/layout intelligence,
and design verification. Each uses the Propose-Verify-Commit pipeline.
"""

# S1-S5: Schematic Intelligence
from routeai_intelligence.features.schematic_intelligence import (
    DatasheetCircuitSynthesizer,    # S1
    CrossDatasheetAnalyzer,         # S2
    IntentPreservingRefactorer,     # S3
    PowerBudgetAnalyzer,            # S4
    SemanticERC,                    # S5
)

# S6-S10: Schematic Advanced
from routeai_intelligence.features.schematic_advanced import (
    ComplianceAdvisor,              # S6
    SystemComponentSelector,        # S7
    PhysicsConstraintPropagator,    # S8
    ContextualDesignReviewer,       # S9
    NaturalLanguageSchematicGenerator,  # S10
)

# R1-R6: Routing Intelligence
from routeai_intelligence.features.routing_intelligence import (
    IntentAwareRouter,              # R1
    DatasheetConstraintExtractor,   # R2
    SignalFlowFloorplanner,         # R3
    ExplainedReturnPathAnalyzer,    # R4
    StackupAdvisor,                 # R5
    BGAFanoutStrategist,            # R6
)

# R7-R11: Routing Advanced
from routeai_intelligence.features.routing_advanced import (
    PDNDesigner,                    # R7
    ThermalAwarePlacementAdvisor,   # R8
    ManufacturingAwareRouter,       # R9
    StyleMatchingRouter,            # R10
    RouteCritique,                  # R11
)

# V1-V7: Verification Intelligence
from routeai_intelligence.features.verification_intelligence import (
    SemanticDRCEngine,              # V1
    DesignChecklist,                # V2
    ApplicationComplianceChecker,   # V3
    CrossDomainVerifier,            # V4
    DatasheetLayoutComplianceChecker,  # V5
    SIPreFlightChecker,             # V6
    PDNReviewer,                    # V7
)

# V8-V13: Verification Advanced (async functions, not classes)
from routeai_intelligence.features.verification_advanced import (
    interpret_thermal,              # V8
    analyze_test_coverage,          # V9
    review_dfm,                     # V10
    review_dfa,                     # V11
    compare_to_reference,           # V12
    review_system,                  # V13
)

__all__ = [
    # S1-S10 Schematic
    "DatasheetCircuitSynthesizer",
    "CrossDatasheetAnalyzer",
    "IntentPreservingRefactorer",
    "PowerBudgetAnalyzer",
    "SemanticERC",
    "ComplianceAdvisor",
    "SystemComponentSelector",
    "PhysicsConstraintPropagator",
    "ContextualDesignReviewer",
    "NaturalLanguageSchematicGenerator",
    # R1-R11 Routing/Layout
    "IntentAwareRouter",
    "DatasheetConstraintExtractor",
    "SignalFlowFloorplanner",
    "ExplainedReturnPathAnalyzer",
    "StackupAdvisor",
    "BGAFanoutStrategist",
    "PDNDesigner",
    "ThermalAwarePlacementAdvisor",
    "ManufacturingAwareRouter",
    "StyleMatchingRouter",
    "RouteCritique",
    # V1-V13 Verification
    "SemanticDRCEngine",
    "DesignChecklist",
    "ApplicationComplianceChecker",
    "CrossDomainVerifier",
    "DatasheetLayoutComplianceChecker",
    "SIPreFlightChecker",
    "PDNReviewer",
    "interpret_thermal",
    "analyze_test_coverage",
    "review_dfm",
    "review_dfa",
    "compare_to_reference",
    "review_system",
]
