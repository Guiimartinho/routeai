"""LLM provider abstraction and tool-use loop for the RouteAI web server.

Supports Ollama (local), Gemini, and Anthropic. The AI tool loop lets the LLM
call engineering tools (impedance calc, DRC, net/component info, etc.) and
receive results before producing a final answer.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
from typing import Any, Callable

logger = logging.getLogger("routeai.server")


# ---------------------------------------------------------------------------
# LLM provider detection
# ---------------------------------------------------------------------------

def detect_llm_provider() -> str | None:
    """Return 'ollama', 'gemini', 'anthropic', or None."""
    ollama_url = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
    try:
        import urllib.request
        urllib.request.urlopen(f"{ollama_url}/api/tags", timeout=1)
        return "ollama"
    except Exception:
        pass
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return "gemini"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return None


# ---------------------------------------------------------------------------
# Ollama model preference & fallback
# ---------------------------------------------------------------------------

# Best-to-worst model order for PCB design tasks
_OLLAMA_MODEL_PREFERENCE = [
    "qwen2.5-coder:14b",
    "qwen2.5-coder:7b",
    "qwen2.5:14b",
    "qwen2.5:7b",
    "codellama:13b",
    "llama3.2",
]

_resolved_model_cache: dict[str, str] = {}


def _resolve_ollama_model(ollama_url: str, desired_model: str) -> str:
    """Return *desired_model* if available, otherwise the best alternative.

    Results are cached per (url, desired_model) pair so the /api/tags call
    only happens once per server lifetime.
    """
    cache_key = f"{ollama_url}|{desired_model}"
    if cache_key in _resolved_model_cache:
        return _resolved_model_cache[cache_key]

    try:
        import urllib.request
        resp = urllib.request.urlopen(f"{ollama_url}/api/tags", timeout=3)
        data = json.loads(resp.read().decode())
        models: list[str] = [m.get("name", m.get("model", "")) for m in data.get("models", [])]
    except Exception:
        # Can't query -- just use desired model and let caller handle errors
        return desired_model

    # If the desired model is already available, use it
    if any(m == desired_model or m.startswith(f"{desired_model}:") for m in models):
        _resolved_model_cache[cache_key] = desired_model
        return desired_model

    # Walk preference list
    for preferred in _OLLAMA_MODEL_PREFERENCE:
        if any(m == preferred or m.startswith(f"{preferred}:") for m in models):
            logger.info("Model %s unavailable, falling back to %s", desired_model, preferred)
            _resolved_model_cache[cache_key] = preferred
            return preferred

    # Last resort: first available model
    if models:
        fallback = models[0]
        logger.warning("No preferred model found, using first available: %s", fallback)
        _resolved_model_cache[cache_key] = fallback
        return fallback

    return desired_model


def get_available_ollama_models(ollama_url: str | None = None) -> list[dict[str, Any]]:
    """Return list of models from Ollama with name and size info."""
    url = ollama_url or os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
    try:
        import urllib.request
        resp = urllib.request.urlopen(f"{url}/api/tags", timeout=5)
        data = json.loads(resp.read().decode())
        return data.get("models", [])
    except Exception as exc:
        logger.warning("Failed to list Ollama models: %s", exc)
        return []


# ---------------------------------------------------------------------------
# LLM generation
# ---------------------------------------------------------------------------

async def llm_generate(
    prompt: str,
    system: str = "",
    messages: list[dict[str, str]] | None = None,
) -> str:
    """Call whichever LLM is configured and return the text response.

    For chat-style calls, pass ``messages`` (list of {role, content}).
    For single-shot calls, pass ``prompt`` (and optional ``system``).
    """
    provider = detect_llm_provider()
    if provider is None:
        raise RuntimeError(
            "No LLM available. Start Ollama or set GEMINI_API_KEY/ANTHROPIC_API_KEY."
        )

    if provider == "ollama":
        import urllib.request as urlreq

        ollama_url = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
        ollama_model = os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:14b")
        # Auto-fallback: if configured model is unavailable, pick the best one
        ollama_model = _resolve_ollama_model(ollama_url, ollama_model)
        if messages:
            full_prompt = (system + "\n\n" if system else "")
            for m in messages:
                role = "User" if m["role"] == "user" else "Assistant"
                full_prompt += f"{role}: {m['content']}\n\n"
        else:
            full_prompt = (system + "\n\n" + prompt) if system else prompt
        payload = json.dumps(
            {"model": ollama_model, "prompt": full_prompt, "stream": False}
        ).encode()
        req = urlreq.Request(
            f"{ollama_url}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        resp = await asyncio.to_thread(urlreq.urlopen, req, timeout=120)
        data = json.loads(resp.read().decode())
        return data.get("response", "")

    if provider == "gemini":
        from google import genai

        key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        client = genai.Client(api_key=key)
        if messages:
            parts = []
            if system:
                parts.append(system + "\n\n")
            for m in messages:
                role_label = "User" if m["role"] == "user" else "Assistant"
                parts.append(f"{role_label}: {m['content']}\n\n")
            contents = "".join(parts)
        else:
            contents = (system + "\n\n" + prompt) if system else prompt
        for attempt in range(4):
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model="gemini-2.0-flash",
                    contents=contents,
                )
                return response.text
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    wait = (attempt + 1) * 15
                    logger.warning(
                        "Gemini rate limited, waiting %ds (attempt %d/4)...",
                        wait, attempt + 1,
                    )
                    await asyncio.sleep(wait)
                else:
                    raise
        raise RuntimeError(
            "Gemini rate limit exceeded after 4 retries. Wait a minute and try again."
        )

    # Anthropic
    import anthropic

    client = anthropic.AsyncAnthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
    )
    if messages:
        api_messages = [{"role": m["role"], "content": m["content"]} for m in messages]
    else:
        api_messages = [{"role": "user", "content": prompt}]
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8192,
        system=system or "You are RouteAI, an expert PCB co-engineer.",
        messages=api_messages,
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

def _tool_calculate_impedance(
    width_mm: float, height_mm: float, er: float,
    thickness_mm: float = 0.035, topology: str = "microstrip",
    spacing_mm: float | None = None,
) -> dict[str, Any]:
    """Calculate transmission-line impedance using IPC-2141 equations."""
    from routeai_solver.physics.impedance import (
        differential_microstrip_impedance,
        differential_stripline_impedance,
        microstrip_impedance,
        stripline_impedance,
    )

    try:
        if topology == "microstrip":
            if spacing_mm and spacing_mm > 0:
                r = differential_microstrip_impedance(
                    w=width_mm, s=spacing_mm, h=height_mm, er=er, t=thickness_mm,
                )
                return {
                    "z0": round(r.z0, 2), "z_diff": round(r.z_diff, 2),
                    "er_eff": round(r.er_eff, 4),
                    "delay_ps_mm": round(r.delay_per_length, 4),
                    "topology": "differential_microstrip",
                }
            else:
                r = microstrip_impedance(w=width_mm, h=height_mm, er=er, t=thickness_mm)
                return {
                    "z0": round(r.z0, 2), "z_diff": 0,
                    "er_eff": round(r.er_eff, 4),
                    "delay_ps_mm": round(r.delay_per_length, 4),
                    "topology": "microstrip",
                }
        elif topology == "stripline":
            if spacing_mm and spacing_mm > 0:
                r = differential_stripline_impedance(
                    w=width_mm, s=spacing_mm, h=height_mm, er=er, t=thickness_mm,
                )
                return {
                    "z0": round(r.z0, 2), "z_diff": round(r.z_diff, 2),
                    "er_eff": round(r.er_eff, 4),
                    "delay_ps_mm": round(r.delay_per_length, 4),
                    "topology": "differential_stripline",
                }
            else:
                r = stripline_impedance(w=width_mm, h=height_mm, er=er, t=thickness_mm)
                return {
                    "z0": round(r.z0, 2), "z_diff": 0,
                    "er_eff": round(r.er_eff, 4),
                    "delay_ps_mm": round(r.delay_per_length, 4),
                    "topology": "stripline",
                }
        else:
            return {"error": f"Unknown topology: {topology}"}
    except Exception as exc:
        return {"error": str(exc)}


def _tool_calculate_current_capacity(
    width_mm: float, copper_oz: float = 1.0, temp_rise_c: float = 10.0,
) -> dict[str, Any]:
    """Calculate trace current capacity per IPC-2152."""
    from routeai_solver.physics.thermal import trace_current_capacity

    thickness_mm = copper_oz * 0.035
    try:
        i_external = trace_current_capacity(
            width=width_mm, thickness=thickness_mm,
            temp_rise=temp_rise_c, internal=False,
        )
        i_internal = trace_current_capacity(
            width=width_mm, thickness=thickness_mm,
            temp_rise=temp_rise_c, internal=True,
        )
        return {
            "width_mm": width_mm, "copper_oz": copper_oz,
            "temp_rise_c": temp_rise_c,
            "max_current_external_A": round(i_external, 3),
            "max_current_internal_A": round(i_internal, 3),
            "reference": "IPC-2152",
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_run_drc_check(project_id: str) -> dict[str, Any]:
    """Run DRC on a project and return violation summary."""
    from routeai_cli.api.models import PROJECTS

    p = PROJECTS.get(project_id)
    if not p or not p.parsed_board:
        return {"error": "Project or board not found"}
    from routeai_cli.analyzer import AnalysisOptions
    from routeai_cli.analyzer import analyze_project as run_analysis

    try:
        options = AnalysisOptions(
            project_dir=p.upload_dir, use_ai=False, min_severity="info",
        )
        result = run_analysis(options)
        p.drc_result = result
        violations_by_rule: dict[str, int] = {}
        for v in (result.filtered_violations or []):
            violations_by_rule[v.rule] = violations_by_rule.get(v.rule, 0) + 1
        return {
            "design_score": result.design_score,
            "error_count": result.drc_report.error_count if result.drc_report else 0,
            "warning_count": result.drc_report.warning_count if result.drc_report else 0,
            "info_count": result.drc_report.info_count if result.drc_report else 0,
            "total_violations": len(result.filtered_violations or []),
            "violations_by_rule": violations_by_rule,
            "sample_violations": [
                {
                    "rule": v.rule, "severity": v.severity.value,
                    "message": v.message[:200],
                    "location": list(v.location) if v.location else None,
                }
                for v in (result.filtered_violations or [])[:20]
            ],
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_verify_length_matching(
    net_lengths_json: dict[str, float], tolerance_mm: float = 0.5,
) -> dict[str, Any]:
    """Verify length matching using Z3 constraint solver."""
    from routeai_solver.board_model import LengthGroup
    from routeai_solver.constraints.z3_solver import ConstraintSolver

    try:
        nets = list(net_lengths_json.keys())
        group = LengthGroup(name="check_group", nets=nets, tolerance=tolerance_mm)
        solver = ConstraintSolver()
        result = solver.verify_length_matching(net_lengths_json, [group])
        violations = [
            {"name": v.constraint_name, "message": v.message, "details": v.details}
            for v in result.violations
        ]
        return {
            "satisfied": result.satisfied,
            "solver_status": result.solver_status,
            "violations": violations,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_verify_diff_pair_skew(
    pos_length: float, neg_length: float, max_skew_mm: float = 0.1,
    pair_name: str = "check_pair",
) -> dict[str, Any]:
    """Verify differential pair skew using Z3 constraint solver."""
    from routeai_solver.board_model import DiffPair
    from routeai_solver.constraints.z3_solver import ConstraintSolver

    try:
        pair = DiffPair(
            name=pair_name, pos_net=f"{pair_name}_P", neg_net=f"{pair_name}_N",
            max_skew=max_skew_mm,
        )
        solver = ConstraintSolver()
        result = solver.verify_diff_pair_skew(pair, pos_length, neg_length)
        actual_skew = abs(pos_length - neg_length)
        return {
            "satisfied": result.satisfied,
            "actual_skew_mm": round(actual_skew, 4),
            "max_skew_mm": max_skew_mm,
            "pos_length": pos_length,
            "neg_length": neg_length,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_get_net_info(project_id: str, net_name: str) -> dict[str, Any]:
    """Get information about a specific net: trace lengths, layers, connected pads."""
    from routeai_cli.api.models import PROJECTS

    p = PROJECTS.get(project_id)
    if not p or not p.parsed_board:
        return {"error": "Project or board not found"}
    board = p.parsed_board
    net_num = None
    for n in board.nets:
        if n.name == net_name:
            net_num = n.number
            break
    if net_num is None:
        return {"error": f"Net '{net_name}' not found"}

    total_length = 0.0
    layers_used: set[str] = set()
    segment_count = 0
    for seg in board.segments:
        if seg.net == net_num:
            dx = seg.end.x - seg.start.x
            dy = seg.end.y - seg.start.y
            total_length += math.sqrt(dx * dx + dy * dy)
            layers_used.add(seg.layer)
            segment_count += 1

    connected_pads = []
    for fp in board.footprints:
        for pad in fp.pads:
            if pad.net_number == net_num:
                connected_pads.append(f"{fp.reference}.{pad.number}")

    via_count = sum(1 for v in board.vias if v.net == net_num)

    return {
        "net_name": net_name,
        "total_trace_length_mm": round(total_length, 3),
        "segment_count": segment_count,
        "layers": sorted(layers_used),
        "via_count": via_count,
        "connected_pads": connected_pads[:30],
    }


def _tool_get_component_info(project_id: str, ref: str) -> dict[str, Any]:
    """Get component info: position, value, pads, connected nets."""
    from routeai_cli.api.models import PROJECTS

    p = PROJECTS.get(project_id)
    if not p or not p.parsed_board:
        return {"error": "Project or board not found"}
    board = p.parsed_board
    net_names: dict[int, str] = {n.number: n.name for n in board.nets}

    for fp in board.footprints:
        if fp.reference == ref:
            pads_info = []
            connected_nets: set[str] = set()
            for pad in fp.pads:
                nn = net_names.get(pad.net_number, "")
                pads_info.append({"number": pad.number, "net": nn, "type": pad.pad_type})
                if nn:
                    connected_nets.add(nn)
            return {
                "reference": fp.reference,
                "value": fp.value,
                "x": fp.at.x, "y": fp.at.y,
                "rotation": fp.angle,
                "layer": fp.layer,
                "pad_count": len(fp.pads),
                "pads": pads_info[:20],
                "connected_nets": sorted(connected_nets),
            }
    return {"error": f"Component '{ref}' not found"}


# Map tool name -> (function, description for the LLM)
TOOL_REGISTRY: dict[str, tuple[Callable[..., dict[str, Any]], str]] = {
    "calculate_impedance": (
        _tool_calculate_impedance,
        "Calculate transmission line impedance. Args: width_mm, height_mm, er, "
        "thickness_mm=0.035, topology='microstrip'|'stripline', spacing_mm=null (for differential)",
    ),
    "calculate_current_capacity": (
        _tool_calculate_current_capacity,
        "Calculate trace current capacity per IPC-2152. Args: width_mm, copper_oz=1.0, temp_rise_c=10.0",
    ),
    "run_drc_check": (
        _tool_run_drc_check,
        "Run DRC check on a project. Args: project_id",
    ),
    "verify_length_matching": (
        _tool_verify_length_matching,
        "Verify length matching with Z3 solver. Args: net_lengths_json (dict of net_name->length_mm), "
        "tolerance_mm=0.5",
    ),
    "verify_diff_pair_skew": (
        _tool_verify_diff_pair_skew,
        "Verify diff pair skew. Args: pos_length, neg_length, max_skew_mm=0.1, pair_name='check_pair'",
    ),
    "get_net_info": (
        _tool_get_net_info,
        "Get net info: trace lengths, layers, connected pads. Args: project_id, net_name",
    ),
    "get_component_info": (
        _tool_get_component_info,
        "Get component info: position, value, pads, connected nets. Args: project_id, ref",
    ),
}


def execute_tool_call(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a tool by name with the given arguments."""
    entry = TOOL_REGISTRY.get(name)
    if entry is None:
        return {"error": f"Unknown tool: {name}"}
    func, _ = entry
    try:
        return func(**args)
    except Exception as exc:
        return {"error": f"Tool {name} failed: {exc}"}


def build_tool_descriptions() -> str:
    """Build a text description of available tools for the LLM system prompt."""
    lines = ["Available tools (call by returning JSON tool_calls array):"]
    for name, (_, desc) in TOOL_REGISTRY.items():
        lines.append(f"  - {name}: {desc}")
    return "\n".join(lines)


def extract_tool_calls(text: str) -> list[dict[str, Any]]:
    """Extract tool calls from LLM response text.

    The LLM is instructed to output tool calls as:
    ```tool_calls
    [{"name": "...", "args": {...}}, ...]
    ```
    """
    calls: list[dict[str, Any]] = []
    pattern = r"```tool_calls\s*\n(.*?)```"
    matches = re.findall(pattern, text, re.DOTALL)
    for match in matches:
        try:
            parsed = json.loads(match.strip())
            if isinstance(parsed, list):
                calls.extend(parsed)
            elif isinstance(parsed, dict):
                calls.append(parsed)
        except json.JSONDecodeError:
            pass

    if not calls:
        pattern2 = r'\[\s*\{\s*"name"\s*:'
        for m in re.finditer(pattern2, text):
            start = m.start()
            depth = 0
            end = start
            for i in range(start, len(text)):
                if text[i] == '[':
                    depth += 1
                elif text[i] == ']':
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end > start:
                try:
                    parsed = json.loads(text[start:end])
                    if isinstance(parsed, list):
                        calls.extend(parsed)
                except json.JSONDecodeError:
                    pass

    return calls


async def ai_with_tools(
    prompt: str,
    system: str,
    project_id: str | None = None,
    max_rounds: int = 5,
) -> tuple[str, list[dict[str, Any]]]:
    """Run an LLM call with tool-use loop.

    Returns (final_text, tool_log) where tool_log records each tool call and result.
    """
    tool_log: list[dict[str, Any]] = []

    tool_instructions = (
        "\nIMPORTANT: You have access to PCB engineering tools. When you need to calculate\n"
        "or verify something, output a tool call block like this:\n\n"
        "```tool_calls\n"
        '[{"name": "tool_name", "args": {"arg1": value1, "arg2": value2}}]\n'
        "```\n\n"
        "You can call multiple tools at once. After I execute them, I will give you the\n"
        "results and you can continue your analysis.\n\n"
        "When you are done with all tool calls and have your final answer, do NOT include\n"
        "any tool_calls block -- just output your final analysis.\n\n"
        + build_tool_descriptions()
    )

    full_system = system + "\n\n" + tool_instructions
    conversation = prompt
    response_text = ""

    for _round_num in range(max_rounds):
        response_text = await llm_generate(conversation, system=full_system)

        calls = extract_tool_calls(response_text)
        if not calls:
            return response_text, tool_log

        results = []
        for call in calls:
            name = call.get("name", "")
            args = call.get("args", {})
            if project_id and "project_id" in str(TOOL_REGISTRY.get(name, ("", ""))[1]):
                if "project_id" not in args:
                    args["project_id"] = project_id
            result = execute_tool_call(name, args)
            tool_log.append({"tool": name, "args": args, "result": result})
            results.append({"tool": name, "result": result})

        results_text = (
            "\n\nTool results:\n```json\n"
            + json.dumps(results, indent=2)
            + "\n```\n\nContinue your analysis using these results. "
            "If you need more tool calls, output another tool_calls block. "
            "Otherwise, give your final answer (no tool_calls block)."
        )
        conversation = (
            conversation + "\n\nAssistant: " + response_text
            + "\n\nUser: " + results_text
        )

    # Exhausted rounds -- return last response
    return response_text, tool_log
