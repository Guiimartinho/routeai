"""RouteAI Intelligence Features - S1-S10, R1-R11, V1-V13.

34 LLM-powered features for schematic intelligence, routing/layout intelligence,
and design verification. Each uses the Propose-Verify-Commit pipeline.
"""

# S1-S5: Schematic Intelligence
# R7-R11: Routing Advanced
from routeai_intelligence.features.routing_advanced import (
    ManufacturingAwareRouter,  # R9
    PDNDesigner,  # R7
    RouteCritique,  # R11
    StyleMatchingRouter,  # R10
    ThermalAwarePlacementAdvisor,  # R8
)

# R1-R6: Routing Intelligence
from routeai_intelligence.features.routing_intelligence import (
    BGAFanoutStrategist,  # R6
    DatasheetConstraintExtractor,  # R2
    ExplainedReturnPathAnalyzer,  # R4
    IntentAwareRouter,  # R1
    SignalFlowFloorplanner,  # R3
    StackupAdvisor,  # R5
)

# S6-S10: Schematic Advanced
from routeai_intelligence.features.schematic_advanced import (
    ComplianceAdvisor,  # S6
    ContextualDesignReviewer,  # S9
    NaturalLanguageSchematicGenerator,  # S10
    PhysicsConstraintPropagator,  # S8
    SystemComponentSelector,  # S7
)
from routeai_intelligence.features.schematic_intelligence import (
    CrossDatasheetAnalyzer,  # S2
    DatasheetCircuitSynthesizer,  # S1
    IntentPreservingRefactorer,  # S3
    PowerBudgetAnalyzer,  # S4
    SemanticERC,  # S5
)

# V8-V13: Verification Advanced (async functions, not classes)
from routeai_intelligence.features.verification_advanced import (
    analyze_test_coverage,  # V9
    compare_to_reference,  # V12
    interpret_thermal,  # V8
    review_dfa,  # V11
    review_dfm,  # V10
    review_system,  # V13
)

# V1-V7: Verification Intelligence
from routeai_intelligence.features.verification_intelligence import (
    ApplicationComplianceChecker,  # V3
    CrossDomainVerifier,  # V4
    DatasheetLayoutComplianceChecker,  # V5
    DesignChecklist,  # V2
    PDNReviewer,  # V7
    SemanticDRCEngine,  # V1
    SIPreFlightChecker,  # V6
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
