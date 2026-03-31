"""ReAct State Management for tool call deduplication and progress tracking.

Provides a ReActState dataclass that tracks:
- Tool call deduplication via content hashing (avoids redundant LLM tool calls)
- Progress tracking with stale-iteration detection (breaks loops that make no progress)
- Per-iteration state prompt injection (gives the LLM awareness of its own progress)

Used by _execute_react_loop() in core.py to improve ReAct loop efficiency.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field


@dataclass
class ReActState:
    """State tracker for the ReAct loop with deduplication and progress awareness.

    Attributes:
        iteration: Current iteration number (0-indexed, incremented externally).
        max_iterations: Hard ceiling on loop iterations.
        tool_call_log: Ordered list of (tool, params_dict, result_str) tuples.
        tool_result_cache: Maps call_hash -> result string for deduplication.
        findings_count: Cumulative count of findings produced so far.
        consecutive_no_progress: How many iterations in a row had zero new findings.
        MAX_NO_PROGRESS: After this many stale iterations, signal a stop.
    """

    iteration: int = 0
    max_iterations: int = 15

    # Tool call deduplication
    tool_call_log: list[tuple[str, dict, str]] = field(default_factory=list)
    tool_result_cache: dict[str, str] = field(default_factory=dict)

    # Progress tracking
    findings_count: int = 0
    consecutive_no_progress: int = 0
    MAX_NO_PROGRESS: int = 3

    # ---------------------------------------------------------------
    # Deduplication helpers
    # ---------------------------------------------------------------

    def call_hash(self, tool: str, params: dict) -> str:
        """Return a stable MD5 hex digest for a (tool, params) pair."""
        key = f"{tool}:{json.dumps(params, sort_keys=True, default=str)}"
        return hashlib.md5(key.encode()).hexdigest()

    def is_duplicate(self, tool: str, params: dict) -> bool:
        """Return True if this exact (tool, params) combination was already executed."""
        return self.call_hash(tool, params) in self.tool_result_cache

    def register_call(self, tool: str, params: dict, result: str) -> str | None:
        """Register a tool call and its result.

        If the call was already cached, returns a short message with the cached
        result (truncated to 300 chars) so the caller can inject it instead of
        re-executing the tool.  Otherwise stores the result and returns None.
        """
        h = self.call_hash(tool, params)
        if h in self.tool_result_cache:
            cached = self.tool_result_cache[h]
            return (
                f"CACHED: You already called {tool} with these params. "
                f"Result: {cached[:300]}"
            )

        # New call — store it
        self.tool_result_cache[h] = result
        self.tool_call_log.append((tool, params, result))
        return None

    # ---------------------------------------------------------------
    # Progress tracking
    # ---------------------------------------------------------------

    def update_progress(self, new_findings: int) -> str | None:
        """Update progress counters after an iteration.

        Args:
            new_findings: Number of *new* findings produced in this iteration.

        Returns:
            A stop-reason string if the loop should terminate due to stale
            progress, or None if the loop should continue.
        """
        self.findings_count += new_findings

        if new_findings > 0:
            self.consecutive_no_progress = 0
        else:
            self.consecutive_no_progress += 1

        if self.consecutive_no_progress >= self.MAX_NO_PROGRESS:
            return (
                f"Stopping: {self.MAX_NO_PROGRESS} consecutive iterations with "
                f"no new findings. Total findings so far: {self.findings_count}. "
                f"Produce your FINAL_ANSWER now."
            )
        return None

    # ---------------------------------------------------------------
    # LLM context injection
    # ---------------------------------------------------------------

    def build_state_prompt(self) -> str:
        """Build a context block to append to the system prompt each iteration.

        Gives the LLM awareness of how far along it is, what tools it has
        already called, and the rule about finishing with FINAL_ANSWER.
        """
        lines = [
            "",
            "--- ReAct State ---",
            f"Iteration: {self.iteration}/{self.max_iterations}",
            f"Findings so far: {self.findings_count}",
            f"Tool calls made: {len(self.tool_call_log)}",
        ]

        # Show cached tool call summaries (max 10 most recent)
        if self.tool_call_log:
            lines.append("Recent tool calls (do NOT repeat these):")
            for tool, params, _result in self.tool_call_log[-10:]:
                params_short = json.dumps(params, default=str)
                if len(params_short) > 120:
                    params_short = params_short[:117] + "..."
                lines.append(f"  - {tool}({params_short})")

        remaining = self.max_iterations - self.iteration
        if remaining <= 3:
            lines.append(
                f"WARNING: Only {remaining} iteration(s) remaining. "
                f"Wrap up and produce your FINAL_ANSWER."
            )

        lines.append(
            "Rule: When you have enough information, stop calling tools and "
            "produce your FINAL_ANSWER immediately."
        )
        lines.append("--- End ReAct State ---")

        return "\n".join(lines)
