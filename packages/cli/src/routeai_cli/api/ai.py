"""AI co-engineer endpoints: design review, routing strategy, placement, constraints, chat."""

from __future__ import annotations

import json
import logging
import re
import traceback
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from routeai_cli.api.llm import ai_with_tools, detect_llm_provider
from routeai_cli.api.models import get_board_context, get_project_or_404

logger = logging.getLogger("routeai.server")

router = APIRouter(prefix="/api")


def _require_llm() -> None:
    """Raise HTTPException if no LLM provider is configured."""
    if not detect_llm_provider():
        raise HTTPException(400, "No LLM API key set. Configure Gemini or Anthropic key.")


def _extract_json_object(text: str) -> dict[str, Any]:
    """Try to extract a JSON object from LLM response text."""
    json_match = re.search(r"```json\s*\n(\{.*?\})\s*\n```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    return {}


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    """Try to extract a JSON array from LLM response text."""
    json_match = re.search(r"```json\s*\n(\[.*?\])\s*\n```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Fallback: find any JSON array in the text
    for m in re.finditer(r'\[\s*\{', text):
        start = m.start()
        depth = 0
        for i in range(start, len(text)):
            if text[i] == '[':
                depth += 1
            elif text[i] == ']':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        pass
                    break
    return []


def _tool_summary(tool_log: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a brief summary of tool calls (without full results)."""
    return [{"tool": t["tool"], "args": t["args"]} for t in tool_log]


# ---------------------------------------------------------------------------
# AI Design Review
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/ai/review")
async def ai_design_review(project_id: str) -> dict[str, Any]:
    """AI Design Review -- uses tools to analyze the board and produce structured findings."""
    _require_llm()
    p = get_project_or_404(project_id)
    if not p.parsed_board:
        raise HTTPException(400, "No board data to review")

    ctx = get_board_context(p)

    system_prompt = """You are RouteAI, an expert PCB co-engineer. You perform thorough design reviews
by USING YOUR TOOLS to run actual calculations -- not just guessing.

Your review process:
1. First, run DRC if not already done (run_drc_check)
2. For signal nets, calculate impedance (calculate_impedance) using the board stackup
3. For power nets (VCC, VDD, GND, +3V3, +5V, +12V etc.), check current capacity (calculate_current_capacity)
4. Check specific nets for details (get_net_info) when investigating issues
5. Check component placement details (get_component_info) for key components

After running tools, produce your review as a JSON array of findings:
```json
[
  {
    "category": "signal_integrity"|"thermal"|"drc"|"placement"|"manufacturing"|"power_integrity"|"constraints",
    "severity": "critical"|"warning"|"info",
    "message": "Clear description of the finding",
    "location": "Net name, component ref, or board area",
    "tool_used": "name of tool that found this",
    "suggestion": "Specific actionable fix"
  }
]
```

Be thorough. Use real numbers from tool results. Cite IPC standards."""

    prompt = f"""Perform a comprehensive design review of this PCB.

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID for tool calls: {project_id}

Start by running the DRC check, then investigate signal integrity and thermal issues using the tools.
Produce your final review as a JSON array of findings."""

    try:
        response_text, tool_log = await ai_with_tools(
            prompt, system_prompt, project_id=project_id, max_rounds=5,
        )

        findings = _extract_json_array(response_text)

        p.ai_review = {"findings": findings, "raw": response_text, "tool_log": tool_log}

        return {
            "status": "complete",
            "findings": findings,
            "tool_calls": _tool_summary(tool_log),
            "tool_count": len(tool_log),
            "raw_text": response_text[:5000],
            "provider": detect_llm_provider(),
        }
    except Exception as exc:
        logger.error("AI review error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"AI review failed: {exc}")


# ---------------------------------------------------------------------------
# AI Routing Strategy
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/ai/routing-strategy")
async def ai_routing_strategy(project_id: str) -> dict[str, Any]:
    """AI Routing Strategy -- analyzes nets and produces routing order, layer assignments, cost weights."""
    _require_llm()
    p = get_project_or_404(project_id)
    if not p.parsed_board:
        raise HTTPException(404, "Project/board not found")

    ctx = get_board_context(p)

    system_prompt = """You are RouteAI, an expert PCB routing engineer. Analyze the netlist and
produce a structured routing strategy. Use tools to get net details when needed.

Output your strategy as JSON:
```json
{
  "routing_order": [
    {"priority": 1, "nets": ["net1", "net2"], "reason": "why these first"}
  ],
  "layer_assignments": {
    "power": {"layers": ["In1.Cu"], "reason": "..."},
    "high_speed": {"layers": ["F.Cu", "In2.Cu"], "reason": "..."},
    "general": {"layers": ["F.Cu", "B.Cu"], "reason": "..."}
  },
  "cost_weights": {
    "via_cost": 10,
    "layer_change_cost": 5,
    "length_cost": 1,
    "congestion_cost": 3
  },
  "net_classes": [
    {"name": "Power", "nets": [...], "min_width_mm": 0.5, "clearance_mm": 0.3},
    {"name": "HighSpeed", "nets": [...], "min_width_mm": 0.15, "clearance_mm": 0.2}
  ],
  "critical_notes": ["note1", "note2"]
}
```"""

    prompt = f"""Analyze this PCB netlist and generate a routing strategy.

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID: {project_id}

Classify nets (power, high-speed, clock, analog, general), determine routing order,
assign layers, and set cost weights. Use get_net_info to investigate key nets."""

    try:
        response_text, tool_log = await ai_with_tools(
            prompt, system_prompt, project_id=project_id, max_rounds=4,
        )

        strategy = _extract_json_object(response_text)

        return {
            "status": "complete",
            "strategy": strategy,
            "tool_calls": _tool_summary(tool_log),
            "raw_text": response_text[:5000],
            "provider": detect_llm_provider(),
        }
    except Exception as exc:
        logger.error("Routing strategy error: %s", exc)
        raise HTTPException(500, f"Routing strategy failed: {exc}")


# ---------------------------------------------------------------------------
# AI Placement Suggestions
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/ai/placement")
async def ai_placement_suggestions(project_id: str) -> dict[str, Any]:
    """AI Placement Suggestions -- analyzes component positions and suggests improvements."""
    _require_llm()
    p = get_project_or_404(project_id)
    if not p.parsed_board:
        raise HTTPException(404, "Project/board not found")

    ctx = get_board_context(p)

    system_prompt = """You are RouteAI, an expert PCB placement engineer. Analyze component positions
and connectivity to suggest placement improvements. Use tools to get component and net details.

Output your suggestions as JSON:
```json
{
  "suggestions": [
    {
      "component": "C1",
      "current_position": {"x": 10, "y": 20},
      "issue": "Decoupling cap too far from IC",
      "suggestion": "Move closer to U1 pin VCC, within 2mm",
      "priority": "high"|"medium"|"low",
      "category": "decoupling"|"thermal"|"routing"|"emi"|"manufacturing"
    }
  ],
  "group_suggestions": [
    {"components": ["U1", "C1", "C2"], "suggestion": "Group these for power domain isolation"}
  ],
  "overall_score": 75,
  "summary": "Brief overall placement assessment"
}
```"""

    prompt = f"""Analyze component placement for this PCB and suggest improvements.

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID: {project_id}

Check decoupling cap placement, thermal considerations, and routing efficiency.
Use get_component_info and get_net_info tools to investigate."""

    try:
        response_text, tool_log = await ai_with_tools(
            prompt, system_prompt, project_id=project_id, max_rounds=4,
        )

        suggestions = _extract_json_object(response_text)

        return {
            "status": "complete",
            "suggestions": suggestions,
            "tool_calls": _tool_summary(tool_log),
            "raw_text": response_text[:5000],
            "provider": detect_llm_provider(),
        }
    except Exception as exc:
        logger.error("Placement suggestions error: %s", exc)
        raise HTTPException(500, f"Placement analysis failed: {exc}")


# ---------------------------------------------------------------------------
# AI Constraint Generation
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/ai/constraints")
async def ai_constraint_generation(project_id: str) -> dict[str, Any]:
    """AI Constraint Generation -- generates design rules from the board/schematic."""
    _require_llm()
    p = get_project_or_404(project_id)
    if not p.parsed_board:
        raise HTTPException(404, "Project/board not found")

    ctx = get_board_context(p)

    system_prompt = """You are RouteAI, an expert PCB design rule engineer. Analyze the board and
generate appropriate design constraints. Use tools to calculate impedances for the stackup.

Output constraints as JSON:
```json
{
  "net_classes": [
    {"name": "Default", "nets": [...], "trace_width_mm": 0.2, "clearance_mm": 0.15, "via_dia_mm": 0.6},
    {"name": "Power", "nets": [...], "trace_width_mm": 0.5, "clearance_mm": 0.25, "via_dia_mm": 0.8}
  ],
  "diff_pairs": [
    {"name": "USB_D", "pos_net": "USB_D+", "neg_net": "USB_D-", "target_z_diff": 90, "max_skew_mm": 0.15, "spacing_mm": 0.15}
  ],
  "length_groups": [
    {"name": "DDR_DATA", "nets": [...], "tolerance_mm": 2.0, "target_length_mm": null}
  ],
  "special_rules": [
    {"description": "Keep analog ground separate", "type": "keepout"|"spacing"|"routing", "details": "..."}
  ],
  "stackup_recommendations": "Any stackup changes needed"
}
```"""

    prompt = f"""Generate design constraints for this PCB based on the components and nets.

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID: {project_id}

Identify signal types, calculate required impedances using the stackup, define net classes,
diff pairs, and length groups. Use calculate_impedance to verify trace width/stackup combos."""

    try:
        response_text, tool_log = await ai_with_tools(
            prompt, system_prompt, project_id=project_id, max_rounds=4,
        )

        constraints = _extract_json_object(response_text)

        return {
            "status": "complete",
            "constraints": constraints,
            "tool_calls": _tool_summary(tool_log),
            "raw_text": response_text[:5000],
            "provider": detect_llm_provider(),
        }
    except Exception as exc:
        logger.error("Constraint generation error: %s", exc)
        raise HTTPException(500, f"Constraint generation failed: {exc}")


# ---------------------------------------------------------------------------
# AI Chat
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/ai/chat")
async def ai_chat(project_id: str, request: Request) -> dict[str, Any]:
    """AI Chat with tool use -- can answer questions AND execute tool calls."""
    _require_llm()
    p = get_project_or_404(project_id)

    body = await request.json()
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(400, "Empty message")

    ctx = get_board_context(p)

    system_prompt = f"""You are RouteAI, an expert PCB co-engineer assistant. You help engineers
review and improve their PCB designs. You have access to real engineering tools
and should USE THEM when questions involve calculations or specific data.

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID for tool calls: {project_id}

Be specific, cite IPC standards, and give actionable advice. When the user asks
about impedance, current capacity, specific nets, or components -- USE THE TOOLS
to get real data instead of guessing."""

    # Build conversation with history
    history_text = ""
    for msg in p.chat_history[-10:]:
        role = "User" if msg["role"] == "user" else "Assistant"
        history_text += f"{role}: {msg['content']}\n\n"
    history_text += f"User: {message}"

    try:
        response_text, tool_log = await ai_with_tools(
            history_text, system_prompt, project_id=project_id, max_rounds=3,
        )

        # Strip any remaining tool_calls blocks from the response
        clean_response = re.sub(
            r"```tool_calls.*?```", "", response_text, flags=re.DOTALL,
        ).strip()

        p.chat_history.append({"role": "user", "content": message})
        p.chat_history.append({"role": "assistant", "content": clean_response})

        return {
            "message": clean_response,
            "tool_calls": _tool_summary(tool_log),
            "tool_count": len(tool_log),
            "provider": detect_llm_provider(),
        }
    except Exception as exc:
        logger.error("Chat error: %s", exc)
        raise HTTPException(500, f"Chat failed: {exc}")


# ---------------------------------------------------------------------------
# Legacy endpoints
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/review")
async def ai_review_legacy(project_id: str) -> dict[str, Any]:
    """Legacy review endpoint -- redirects to new AI review."""
    return await ai_design_review(project_id)


@router.post("/projects/{project_id}/chat")
async def chat_legacy(project_id: str, request: Request) -> dict[str, Any]:
    """Legacy chat endpoint -- redirects to new AI chat."""
    return await ai_chat(project_id, request)
