"""
RouteAI Design Review - KiCad Action Plugin

Registers the RouteAI plugin with KiCad's pcbnew editor.
This module is loaded by KiCad's plugin system on startup.
"""

try:
    from .plugin import RouteAIPlugin

    # KiCad discovers plugins by calling register() on ActionPlugin subclasses
    # found in __init__.py files under the scripting/plugins directory.
    RouteAIPlugin().register()
except Exception:
    # Silently fail if we're not running inside KiCad (e.g. unit tests,
    # CLI tooling, or missing pcbnew). The individual modules remain
    # importable for testing purposes.
    pass
