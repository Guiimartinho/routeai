"""RouteAI Web Server - AI-Powered PCB Co-Engineer.

Consolidated entry point.  All routers, middleware, and configuration live
in ``routeai_cli.api.create_app()``.  This file is intentionally thin.

Run with:
    cd packages/cli && poetry run python ../../server.py
"""

from __future__ import annotations

import os

from routeai_cli.api import create_app

app = create_app()


# ---------------------------------------------------------------------------
# HTML template kept here so the UI module can find it via regex extraction.
# This is DATA, not code -- the ~1700 lines below are the single-page web UI.
# ---------------------------------------------------------------------------

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RouteAI - AI PCB Co-Engineer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
    --base: #0a0e1a; --card: #12162a; --card2: #181d35;
    --surface: #1e2340; --surface2: #252b4a;
    --fg: #e2e4ef; --fg2: #8b8fa8; --fg3: #5c6080;
    --accent: #3b82f6; --accent2: #2563eb; --accent-glow: rgba(59,130,246,0.15);
    --emerald: #10b981; --emerald2: #059669; --emerald-glow: rgba(16,185,129,0.15);
    --red: #ef4444; --red-glow: rgba(239,68,68,0.12);
    --orange: #f59e0b; --orange-glow: rgba(245,158,11,0.12);
    --purple: #8b5cf6; --purple-glow: rgba(139,92,246,0.12);
    --yellow: #eab308;
    --border: #1e2340; --border2: #2a3055;
    --font: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    --radius: 8px; --radius-sm: 5px; --radius-lg: 12px;
    --shadow: 0 2px 8px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.2);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.4);
    --transition: 0.2s cubic-bezier(0.4,0,0.2,1);
}
body { background: var(--base); color: var(--fg); font-family: var(--font); min-height: 100vh; overflow: hidden; }
a { color: var(--accent); text-decoration: none; }
button { cursor: pointer; border: none; font-family: var(--font); font-size: 0.85rem; transition: all var(--transition); }
button:active { transform: scale(0.97); }
input, select { font-family: var(--font); font-size: 0.85rem; }
pre { white-space: pre-wrap; word-break: break-word; font-family: var(--mono); }
input[type=file] { display: none; }

/* ===== HEADER ===== */
.header {
    background: linear-gradient(180deg, #101428 0%, var(--card) 100%);
    border-bottom: 1px solid var(--border2);
    padding: 0 16px; height: 44px;
    display: flex; align-items: center; gap: 12px;
    user-select: none; z-index: 100;
}
.header-logo { display: flex; align-items: center; gap: 8px; }
.header-logo svg { width: 26px; height: 26px; flex-shrink: 0; }
.header-logo .logo-text { font-size: 1.05rem; font-weight: 700; color: var(--accent); letter-spacing: -0.3px; }
.header-logo .logo-sub { font-size: 0.72rem; color: var(--fg3); margin-left: 2px; }
.header-sep { width: 1px; height: 22px; background: var(--border2); margin: 0 4px; }
.header-project { font-size: 0.8rem; color: var(--fg2); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-spacer { flex: 1; }
.header-actions { display: flex; align-items: center; gap: 8px; }

/* AI provider badge */
.ai-badge { display: flex; align-items: center; gap: 5px; font-size: 0.73rem; font-weight: 600; padding: 3px 10px; border-radius: 20px; letter-spacing: 0.3px; }
.ai-badge.connected { background: var(--emerald-glow); color: var(--emerald); border: 1px solid rgba(16,185,129,0.25); }
.ai-badge.disconnected { background: var(--red-glow); color: var(--red); border: 1px solid rgba(239,68,68,0.2); }
.ai-badge .dot { width: 6px; height: 6px; border-radius: 50%; }
.ai-badge.connected .dot { background: var(--emerald); box-shadow: 0 0 6px var(--emerald); }
.ai-badge.disconnected .dot { background: var(--red); }

/* Settings gear button */
.gear-btn { background: none; color: var(--fg2); padding: 5px; border-radius: var(--radius-sm); display: flex; align-items: center; }
.gear-btn:hover { background: var(--surface); color: var(--fg); }
.gear-btn svg { width: 18px; height: 18px; }

/* ===== LAYOUT ===== */
.app-layout { display: flex; height: calc(100vh - 44px); }

/* LEFT SIDEBAR */
.left-panel {
    width: 280px; min-width: 240px; max-width: 360px;
    background: var(--card); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; overflow: hidden;
    transition: width var(--transition);
}
.left-panel.collapsed { width: 0; min-width: 0; border-right: none; overflow: hidden; }

/* CENTER */
.center-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 300px; }

/* RIGHT PANEL */
.right-panel {
    width: 380px; min-width: 300px; max-width: 480px;
    background: var(--card); border-left: 1px solid var(--border);
    display: flex; flex-direction: column; overflow: hidden;
    transition: width var(--transition);
}
.right-panel.collapsed { width: 0; min-width: 0; border-left: none; overflow: hidden; }

/* Panel toggle buttons */
.panel-toggle {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 16px; height: 48px; background: var(--surface);
    border: 1px solid var(--border2); display: flex; align-items: center; justify-content: center;
    color: var(--fg3); cursor: pointer; z-index: 20; font-size: 10px;
    transition: all var(--transition);
}
.panel-toggle:hover { background: var(--surface2); color: var(--fg); }
.panel-toggle.left { left: 0; border-radius: 0 4px 4px 0; border-left: none; }
.panel-toggle.right { right: 0; border-radius: 4px 0 0 4px; border-right: none; }

/* ===== SIDEBAR SECTIONS ===== */
.sidebar-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }
.sidebar-section { border-bottom: 1px solid var(--border); }
.sidebar-section-header {
    padding: 8px 12px; font-size: 0.7rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.8px; color: var(--fg3);
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; user-select: none;
}
.sidebar-section-header:hover { color: var(--fg2); }
.sidebar-section-header .chevron { font-size: 0.6rem; transition: transform var(--transition); }
.sidebar-section-header.collapsed .chevron { transform: rotate(-90deg); }
.sidebar-section-body { padding: 6px 12px 10px; }
.sidebar-section-body.collapsed { display: none; }

/* Upload area */
.upload-zone {
    border: 1.5px dashed var(--border2); border-radius: var(--radius);
    padding: 20px 16px; text-align: center; transition: all var(--transition);
    cursor: pointer; margin: 8px 12px;
}
.upload-zone:hover, .upload-zone.drag-over {
    border-color: var(--accent); background: var(--accent-glow);
}
.upload-zone .upload-icon { font-size: 1.8rem; margin-bottom: 6px; opacity: 0.5; }
.upload-zone h3 { font-size: 0.82rem; font-weight: 600; margin-bottom: 4px; color: var(--fg); }
.upload-zone p { font-size: 0.72rem; color: var(--fg3); margin-bottom: 10px; }
.upload-zone .upload-btn {
    display: inline-block; background: var(--accent); color: #fff;
    padding: 6px 20px; border-radius: var(--radius-sm); font-size: 0.78rem;
    font-weight: 600; transition: all var(--transition);
}
.upload-zone .upload-btn:hover { background: var(--accent2); }

/* Info grid */
.info-grid { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; }
.info-grid .label { color: var(--fg3); font-size: 0.75rem; padding: 2px 0; }
.info-grid .value { color: var(--fg); font-size: 0.75rem; font-weight: 600; font-family: var(--mono); text-align: right; padding: 2px 0; }

/* Properties */
.prop-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--border); font-size: 0.75rem; }
.prop-row:last-child { border-bottom: none; }
.prop-key { color: var(--fg3); }
.prop-val { color: var(--fg); font-family: var(--mono); font-weight: 500; }

/* ===== VIEWER TOOLBAR ===== */
.viewer-toolbar {
    height: 36px; min-height: 36px; background: var(--card);
    border-bottom: 1px solid var(--border); display: flex;
    align-items: center; padding: 0 8px; gap: 4px;
}
.toolbar-group { display: flex; align-items: center; gap: 2px; padding: 0 4px; }
.toolbar-group + .toolbar-group { border-left: 1px solid var(--border); padding-left: 8px; }
.tb-btn {
    background: none; color: var(--fg2); border: none;
    padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.75rem;
    display: flex; align-items: center; gap: 4px;
}
.tb-btn:hover { background: var(--surface); color: var(--fg); }
.tb-btn.active { background: var(--accent-glow); color: var(--accent); }
.tb-btn svg { width: 15px; height: 15px; }

/* Layer dots in toolbar */
.layer-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; cursor: pointer; border: 1.5px solid transparent; transition: all var(--transition); }
.layer-dot:hover { transform: scale(1.3); }
.layer-dot.off { opacity: 0.25; }

.toolbar-select {
    background: var(--surface); color: var(--fg); border: 1px solid var(--border2);
    border-radius: var(--radius-sm); padding: 2px 6px; font-size: 0.73rem;
}

/* ===== CANVAS ===== */
.viewer-container {
    flex: 1; position: relative; background: #060a14; overflow: hidden;
    cursor: crosshair;
}
.viewer-container canvas { display: block; width: 100%; height: 100%; }
.viewer-container.grabbing { cursor: grabbing; }

/* Coordinates overlay */
.coord-display {
    position: absolute; bottom: 8px; left: 8px;
    background: rgba(10,14,26,0.85); border: 1px solid var(--border2);
    border-radius: var(--radius-sm); padding: 3px 10px;
    font-family: var(--mono); font-size: 0.7rem; color: var(--fg2);
    backdrop-filter: blur(6px); pointer-events: none;
}

/* Layer toggles panel */
.layer-panel {
    position: absolute; top: 8px; right: 8px;
    background: rgba(18,22,42,0.92); border: 1px solid var(--border2);
    border-radius: var(--radius); padding: 8px; font-size: 0.72rem;
    max-height: 260px; overflow-y: auto; backdrop-filter: blur(8px);
    min-width: 140px;
}
.layer-panel label {
    display: flex; align-items: center; gap: 6px;
    padding: 2px 4px; cursor: pointer; border-radius: 3px;
}
.layer-panel label:hover { background: var(--surface); }
.layer-panel .layer-color-swatch {
    width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0;
}

/* Viewer quick-action buttons */
.viewer-actions {
    position: absolute; bottom: 8px; right: 8px;
    display: flex; gap: 3px;
}
.viewer-actions button {
    background: rgba(18,22,42,0.88); color: var(--fg2);
    border: 1px solid var(--border2); padding: 5px 10px;
    border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600;
    backdrop-filter: blur(6px);
}
.viewer-actions button:hover { background: var(--surface); color: var(--fg); }

/* Grid toggle */
.grid-toggle { position: absolute; bottom: 8px; left: 160px; }

/* ===== RIGHT PANEL TABS ===== */
.right-tabs {
    display: flex; background: var(--card2); border-bottom: 1px solid var(--border);
    overflow-x: auto; flex-shrink: 0;
}
.right-tab {
    padding: 8px 12px; font-size: 0.73rem; color: var(--fg3);
    cursor: pointer; border-bottom: 2px solid transparent;
    white-space: nowrap; display: flex; align-items: center; gap: 5px;
    transition: all var(--transition); position: relative;
}
.right-tab:hover { color: var(--fg2); background: var(--surface); }
.right-tab.active { color: var(--accent); border-bottom-color: var(--accent); background: transparent; }
.right-tab .tab-icon { font-size: 0.8rem; }
.tab-badge {
    font-size: 0.6rem; font-weight: 700; padding: 1px 5px;
    border-radius: 10px; background: var(--accent); color: #fff;
    min-width: 16px; text-align: center; line-height: 1.3;
}
.tab-badge.red { background: var(--red); }
.tab-badge.orange { background: var(--orange); color: #000; }

.right-tab-content {
    flex: 1; overflow-y: auto; padding: 10px;
    display: none; flex-direction: column;
}
.right-tab-content.active { display: flex; }

/* ===== DRC ===== */
.drc-summary-bar {
    display: flex; align-items: center; gap: 10px;
    padding: 10px; background: var(--surface); border-radius: var(--radius);
    margin-bottom: 10px;
}
.drc-gauge {
    width: 56px; height: 56px; border-radius: 50%; position: relative;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.drc-gauge .gauge-value { font-size: 1rem; font-weight: 800; font-family: var(--mono); }
.drc-gauge.good { background: conic-gradient(var(--emerald) calc(var(--pct) * 3.6deg), var(--surface2) 0); }
.drc-gauge.ok { background: conic-gradient(var(--yellow) calc(var(--pct) * 3.6deg), var(--surface2) 0); }
.drc-gauge.bad { background: conic-gradient(var(--red) calc(var(--pct) * 3.6deg), var(--surface2) 0); }
.drc-gauge .gauge-inner {
    width: 42px; height: 42px; border-radius: 50%; background: var(--surface);
    display: flex; align-items: center; justify-content: center; position: absolute;
}
.drc-counts { display: flex; flex-direction: column; gap: 3px; }
.drc-count-row { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; }
.drc-count-row .cnt-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.drc-count-row .cnt-dot.error { background: var(--red); }
.drc-count-row .cnt-dot.warning { background: var(--orange); }
.drc-count-row .cnt-dot.info { background: var(--accent); }
.drc-count-row .cnt-num { font-weight: 700; font-family: var(--mono); min-width: 20px; }
.drc-elapsed { margin-left: auto; font-size: 0.68rem; color: var(--fg3); }

/* DRC filter buttons */
.drc-filters { display: flex; gap: 4px; margin-bottom: 8px; }
.drc-filter-btn {
    font-size: 0.7rem; padding: 3px 10px; border-radius: 20px;
    background: var(--surface); color: var(--fg2); border: 1px solid var(--border2);
}
.drc-filter-btn.active { background: var(--accent-glow); color: var(--accent); border-color: var(--accent); }
.drc-filter-btn:hover { background: var(--surface2); }

/* Violations */
.violation-list { flex: 1; overflow-y: auto; }
.violation-group { margin-bottom: 6px; }
.violation-group-header {
    font-size: 0.72rem; font-weight: 700; color: var(--fg2);
    padding: 4px 8px; background: var(--surface); border-radius: var(--radius-sm);
    cursor: pointer; display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 3px;
}
.violation-group-header:hover { background: var(--surface2); }
.violation-group-header .vg-count { font-family: var(--mono); font-size: 0.68rem; color: var(--fg3); }
.violation {
    padding: 6px 8px; border-radius: var(--radius-sm);
    cursor: pointer; font-size: 0.75rem; transition: background var(--transition);
    margin-bottom: 2px;
}
.violation:hover { background: var(--surface); }
.violation .v-rule { font-weight: 600; display: flex; align-items: center; gap: 5px; }
.violation .v-msg { color: var(--fg2); font-size: 0.72rem; margin-top: 2px; }
.violation .v-loc { color: var(--fg3); font-size: 0.68rem; font-family: var(--mono); margin-top: 1px; cursor: pointer; }
.violation .v-loc:hover { color: var(--accent); }
.sev-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sev-dot.error { background: var(--red); box-shadow: 0 0 4px var(--red); }
.sev-dot.warning { background: var(--orange); box-shadow: 0 0 4px var(--orange); }
.sev-dot.info { background: var(--accent); }
.sev-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
.sev-error { background: var(--red-glow); color: var(--red); }
.sev-warning { background: var(--orange-glow); color: var(--orange); }
.sev-info { background: var(--accent-glow); color: var(--accent); }

/* ===== AI ACTIONS ===== */
.ai-action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.ai-action-card {
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: var(--radius); padding: 12px; text-align: center;
    transition: all var(--transition); cursor: pointer;
}
.ai-action-card:hover { border-color: var(--accent); background: var(--accent-glow); transform: translateY(-1px); box-shadow: var(--shadow); }
.ai-action-card:active { transform: translateY(0); }
.ai-action-card.disabled { opacity: 0.4; pointer-events: none; }
.ai-action-card .action-icon { font-size: 1.3rem; margin-bottom: 4px; }
.ai-action-card .action-label { font-size: 0.75rem; font-weight: 600; color: var(--fg); }
.ai-action-card .action-sub { font-size: 0.65rem; color: var(--fg3); margin-top: 2px; }
.ai-action-card.loading { pointer-events: none; }
.ai-action-card.loading .action-icon { display: none; }

/* Analyze button */
.analyze-btn {
    background: linear-gradient(135deg, var(--emerald) 0%, var(--emerald2) 100%);
    color: #fff; padding: 8px 16px; border-radius: var(--radius);
    font-weight: 700; font-size: 0.82rem; width: 100%; margin-bottom: 10px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    box-shadow: 0 2px 8px rgba(16,185,129,0.2);
}
.analyze-btn:hover { filter: brightness(1.1); box-shadow: 0 4px 12px rgba(16,185,129,0.3); }
.analyze-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }

/* AI results area */
.ai-result-container { flex: 1; overflow-y: auto; }
.finding-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 12px; margin-bottom: 6px;
    font-size: 0.78rem; transition: border-color var(--transition);
}
.finding-card:hover { border-color: var(--border2); }
.finding-card .finding-header { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; flex-wrap: wrap; }
.finding-card .finding-category {
    background: var(--card2); color: var(--fg3); padding: 1px 8px;
    border-radius: 3px; font-size: 0.65rem; text-transform: uppercase;
    letter-spacing: 0.5px; font-weight: 600;
}
.finding-card .finding-message { line-height: 1.5; }
.finding-card .finding-suggestion { color: var(--emerald); font-size: 0.73rem; margin-top: 4px; padding: 4px 8px; background: var(--emerald-glow); border-radius: var(--radius-sm); }
.finding-card .finding-location { color: var(--fg3); font-size: 0.7rem; font-family: var(--mono); margin-top: 3px; }
.finding-card .finding-tool { color: var(--purple); font-size: 0.68rem; }
.tool-log { font-size: 0.72rem; color: var(--fg3); padding: 8px; background: var(--surface); border-radius: var(--radius-sm); border: 1px solid var(--border); }
.tool-log-item { padding: 2px 0; border-bottom: 1px solid var(--border); font-family: var(--mono); font-size: 0.68rem; }
.tool-log-item:last-child { border-bottom: none; }
.ai-progress { padding: 2rem; text-align: center; color: var(--fg2); }

/* ===== CHAT ===== */
.chat-area { flex: 1; display: flex; flex-direction: column; }
.chat-messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.chat-bubble {
    max-width: 85%; padding: 8px 12px; border-radius: 12px;
    font-size: 0.8rem; line-height: 1.5; word-break: break-word;
}
.chat-bubble.user {
    align-self: flex-end; background: var(--accent); color: #fff;
    border-bottom-right-radius: 4px;
}
.chat-bubble.assistant {
    align-self: flex-start; background: var(--surface2); color: var(--fg);
    border-bottom-left-radius: 4px;
}
.chat-bubble .tool-badge {
    display: inline-block; background: var(--purple-glow); color: var(--purple);
    font-size: 0.63rem; padding: 1px 6px; border-radius: 10px;
    margin: 2px 2px 2px 0; font-weight: 600;
}
.chat-bubble pre { background: var(--card); padding: 6px 8px; border-radius: 4px; margin: 4px 0; font-size: 0.73rem; overflow-x: auto; }
.chat-thinking {
    align-self: flex-start; display: flex; align-items: center; gap: 6px;
    padding: 8px 12px; background: var(--surface); border-radius: 12px;
    font-size: 0.75rem; color: var(--fg3);
}
.chat-input-row {
    display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--border);
    background: var(--card2);
}
.chat-input-row input {
    flex: 1; background: var(--surface); color: var(--fg);
    border: 1px solid var(--border2); border-radius: 20px; padding: 7px 14px;
    font-size: 0.82rem; outline: none;
}
.chat-input-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
.chat-input-row button {
    background: var(--accent); color: #fff; padding: 7px 16px;
    border-radius: 20px; font-weight: 600; font-size: 0.82rem;
}
.chat-input-row button:hover { background: var(--accent2); }

/* ===== TOOLS ===== */
.tool-form { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; margin-bottom: 10px; }
.tool-form label { font-size: 0.75rem; color: var(--fg3); text-align: right; }
.tool-form input, .tool-form select {
    background: var(--surface); color: var(--fg); border: 1px solid var(--border2);
    border-radius: var(--radius-sm); padding: 5px 8px; width: 100%; outline: none;
    font-family: var(--mono); font-size: 0.78rem;
}
.tool-form input:focus, .tool-form select:focus { border-color: var(--accent); }
.tool-result {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 12px;
    font-family: var(--mono); font-size: 0.78rem; white-space: pre-wrap;
    line-height: 1.6;
}
.calc-btn {
    background: var(--accent); color: #fff; padding: 6px 20px;
    border-radius: var(--radius-sm); font-weight: 600; font-size: 0.8rem;
}
.calc-btn:hover { background: var(--accent2); }

/* ===== SPINNER ===== */
.spinner {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid var(--border2); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.7s linear infinite;
    vertical-align: middle;
}
.spinner.lg { width: 24px; height: 24px; border-width: 3px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== STATUS BAR ===== */
.status-bar {
    height: 24px; min-height: 24px; background: var(--card2);
    border-top: 1px solid var(--border); display: flex;
    align-items: center; padding: 0 12px; font-size: 0.68rem;
    color: var(--fg3); gap: 16px; user-select: none;
}
.status-bar .status-item { display: flex; align-items: center; gap: 4px; }
.status-bar .status-dot { width: 6px; height: 6px; border-radius: 50%; }
.status-bar .status-dot.green { background: var(--emerald); }
.status-bar .status-dot.red { background: var(--red); }
.status-bar .status-dot.yellow { background: var(--yellow); }
.status-spacer { flex: 1; }

/* ===== WELCOME SCREEN ===== */
.welcome-screen {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 2rem; text-align: center;
    background: radial-gradient(ellipse at center, rgba(59,130,246,0.04) 0%, transparent 70%);
}
.welcome-screen .welcome-icon { margin-bottom: 20px; opacity: 0.3; }
.welcome-screen .welcome-icon svg { width: 80px; height: 80px; }
.welcome-screen h2 { font-size: 1.4rem; color: var(--fg); font-weight: 700; margin-bottom: 8px; }
.welcome-screen p { color: var(--fg3); font-size: 0.85rem; max-width: 400px; line-height: 1.5; }
.welcome-screen .welcome-upload-btn {
    margin-top: 20px; background: var(--accent); color: #fff;
    padding: 10px 28px; border-radius: var(--radius); font-weight: 700;
    font-size: 0.9rem; box-shadow: 0 4px 16px rgba(59,130,246,0.3);
    transition: all var(--transition);
}
.welcome-screen .welcome-upload-btn:hover { background: var(--accent2); transform: translateY(-1px); box-shadow: 0 6px 20px rgba(59,130,246,0.4); }
.welcome-screen .welcome-features {
    display: flex; gap: 24px; margin-top: 30px; flex-wrap: wrap; justify-content: center;
}
.welcome-screen .wf-item { font-size: 0.75rem; color: var(--fg3); display: flex; align-items: center; gap: 5px; }
.welcome-screen .wf-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); }

/* ===== SETTINGS MODAL ===== */
.modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px); z-index: 1000;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; transition: opacity 0.25s;
}
.modal-overlay.show { opacity: 1; pointer-events: all; }
.modal {
    background: var(--card); border: 1px solid var(--border2);
    border-radius: var(--radius-lg); padding: 24px;
    width: 420px; max-width: 90vw; box-shadow: var(--shadow-lg);
    transform: scale(0.95); transition: transform 0.25s;
}
.modal-overlay.show .modal { transform: scale(1); }
.modal h3 { font-size: 1rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.modal-close {
    margin-left: auto; background: none; color: var(--fg3);
    font-size: 1.2rem; padding: 4px; border-radius: var(--radius-sm);
}
.modal-close:hover { color: var(--fg); background: var(--surface); }
.modal-field { margin-bottom: 14px; }
.modal-field label { display: block; font-size: 0.75rem; color: var(--fg2); margin-bottom: 4px; font-weight: 600; }
.modal-field input {
    width: 100%; background: var(--surface); color: var(--fg);
    border: 1px solid var(--border2); border-radius: var(--radius-sm);
    padding: 8px 12px; font-family: var(--mono); font-size: 0.82rem; outline: none;
}
.modal-field input:focus { border-color: var(--accent); }
.modal-field .field-status { font-size: 0.7rem; margin-top: 3px; }
.modal-field .field-status.ok { color: var(--emerald); }
.modal-field .field-status.err { color: var(--red); }
.modal-save {
    background: var(--accent); color: #fff; padding: 8px 24px;
    border-radius: var(--radius-sm); font-weight: 700; width: 100%;
    font-size: 0.88rem; margin-top: 4px;
}
.modal-save:hover { background: var(--accent2); }

/* ===== TOAST ===== */
.toast-container { position: fixed; top: 52px; right: 16px; z-index: 2000; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.toast {
    background: var(--card); border: 1px solid var(--border2);
    border-radius: var(--radius); padding: 10px 16px; font-size: 0.8rem;
    box-shadow: var(--shadow-lg); display: flex; align-items: center; gap: 8px;
    animation: toastIn 0.3s ease-out; pointer-events: all; max-width: 360px;
}
.toast.success { border-left: 3px solid var(--emerald); }
.toast.error { border-left: 3px solid var(--red); }
.toast.info { border-left: 3px solid var(--accent); }
@keyframes toastIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toastOut { from { opacity: 1; } to { opacity: 0; transform: translateX(40px); } }

/* ===== SCROLLBAR ===== */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--fg3); }

/* ===== UTILITIES ===== */
.hidden { display: none !important; }
.drc-score { font-size: 1.2rem; font-weight: 700; }
.drc-score.good { color: var(--emerald); }
.drc-score.ok { color: var(--yellow); }
.drc-score.bad { color: var(--red); }

/* ===== RESPONSIVE ===== */
@media (max-width: 1280px) {
    .left-panel { width: 240px; }
    .right-panel { width: 320px; }
}
</style>
</head>
<body>

<!-- Toast container -->
<div class="toast-container" id="toastContainer"></div>

<!-- Settings Modal -->
<div class="modal-overlay" id="settingsModal">
    <div class="modal">
        <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            Settings
            <button class="modal-close" onclick="toggleSettings()">&times;</button>
        </h3>
        <div class="modal-field">
            <label>Google Gemini API Key</label>
            <input type="password" id="geminiKeyInput" placeholder="Enter Gemini API key...">
            <div class="field-status" id="geminiStatus"></div>
        </div>
        <div class="modal-field">
            <label>Anthropic API Key</label>
            <input type="password" id="anthropicKeyInput" placeholder="Enter Anthropic API key...">
            <div class="field-status" id="anthropicStatus"></div>
        </div>
        <button class="modal-save" onclick="setApiKeys()">Save &amp; Connect</button>
    </div>
</div>

<!-- HEADER -->
<div class="header">
    <div class="header-logo">
        <svg viewBox="0 0 32 32" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="4" stroke="#3b82f6" stroke-width="1.5"/>
            <circle cx="9" cy="9" r="2" fill="#3b82f6"/><circle cx="23" cy="9" r="2" fill="#3b82f6"/>
            <circle cx="9" cy="23" r="2" fill="#3b82f6"/><circle cx="23" cy="23" r="2" fill="#3b82f6"/>
            <circle cx="16" cy="16" r="2.5" fill="#10b981"/>
            <line x1="11" y1="9" x2="14" y2="14" stroke="#3b82f6" stroke-width="1"/><line x1="21" y1="9" x2="18" y2="14" stroke="#3b82f6" stroke-width="1"/>
            <line x1="11" y1="23" x2="14" y2="18" stroke="#3b82f6" stroke-width="1"/><line x1="21" y1="23" x2="18" y2="18" stroke="#3b82f6" stroke-width="1"/>
            <line x1="9" y1="11" x2="9" y2="21" stroke="#3b82f6" stroke-width="0.8" stroke-dasharray="2 2"/>
            <line x1="23" y1="11" x2="23" y2="21" stroke="#3b82f6" stroke-width="0.8" stroke-dasharray="2 2"/>
        </svg>
        <span class="logo-text">RouteAI</span>
        <span class="logo-sub">PCB Co-Engineer</span>
    </div>
    <div class="header-sep"></div>
    <span class="header-project" id="headerProject">No project loaded</span>
    <div class="header-spacer"></div>
    <div class="header-actions">
        <div class="ai-badge disconnected" id="aiBadge"><span class="dot"></span><span id="aiBadgeText">No AI</span></div>
        <button class="gear-btn" onclick="toggleSettings()" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
    </div>
</div>

<!-- MAIN LAYOUT -->
<div class="app-layout">
    <!-- LEFT SIDEBAR -->
    <div class="left-panel" id="leftPanel">
        <div class="sidebar-scroll">
            <!-- Upload -->
            <div id="uploadSection">
                <div class="upload-zone" id="uploadArea">
                    <div class="upload-icon">&#9783;</div>
                    <h3>Upload PCB Design</h3>
                    <p>Drag &amp; drop .kicad_pcb, .kicad_sch, or .zip</p>
                    <span class="upload-btn" onclick="document.getElementById('fileInput').click()">Choose File</span>
                    <input type="file" id="fileInput" accept=".kicad_pcb,.kicad_sch,.zip">
                </div>
            </div>

            <!-- Project panels (hidden until loaded) -->
            <div id="projectPanels" class="hidden">
                <!-- Board Info -->
                <div class="sidebar-section">
                    <div class="sidebar-section-header" onclick="toggleSection(this)">
                        Board Info <span class="chevron">&#9660;</span>
                    </div>
                    <div class="sidebar-section-body">
                        <div class="info-grid" id="boardInfo"></div>
                    </div>
                </div>

                <!-- Layers -->
                <div class="sidebar-section">
                    <div class="sidebar-section-header" onclick="toggleSection(this)">
                        Layers <span class="chevron">&#9660;</span>
                    </div>
                    <div class="sidebar-section-body" id="sidebarLayers">
                        <div style="color:var(--fg3);font-size:0.73rem;">Load a board to see layers</div>
                    </div>
                </div>

                <!-- Properties -->
                <div class="sidebar-section">
                    <div class="sidebar-section-header" onclick="toggleSection(this)">
                        Properties <span class="chevron">&#9660;</span>
                    </div>
                    <div class="sidebar-section-body" id="propertiesPanel">
                        <div style="color:var(--fg3);font-size:0.73rem;">Select an element on the board</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- CENTER PANEL -->
    <div class="center-panel">
        <!-- Welcome screen -->
        <div class="welcome-screen" id="welcomeView">
            <div class="welcome-icon">
                <svg viewBox="0 0 80 80" fill="none">
                    <rect x="4" y="4" width="72" height="72" rx="8" stroke="#3b82f6" stroke-width="1.5" opacity="0.5"/>
                    <circle cx="20" cy="20" r="4" fill="#3b82f6" opacity="0.6"/><circle cx="60" cy="20" r="4" fill="#3b82f6" opacity="0.6"/>
                    <circle cx="20" cy="60" r="4" fill="#3b82f6" opacity="0.6"/><circle cx="60" cy="60" r="4" fill="#3b82f6" opacity="0.6"/>
                    <circle cx="40" cy="40" r="6" fill="#10b981" opacity="0.5"/>
                    <line x1="24" y1="20" x2="34" y2="36" stroke="#3b82f6" stroke-width="1" opacity="0.4"/>
                    <line x1="56" y1="20" x2="46" y2="36" stroke="#3b82f6" stroke-width="1" opacity="0.4"/>
                    <line x1="24" y1="60" x2="34" y2="44" stroke="#3b82f6" stroke-width="1" opacity="0.4"/>
                    <line x1="56" y1="60" x2="46" y2="44" stroke="#3b82f6" stroke-width="1" opacity="0.4"/>
                </svg>
            </div>
            <h2>Open a KiCad project to get started</h2>
            <p>Upload a .kicad_pcb, .kicad_sch, or .zip file to analyze your PCB design with AI-powered tools</p>
            <button class="welcome-upload-btn" onclick="document.getElementById('fileInput').click()">Open Project</button>
            <div class="welcome-features">
                <span class="wf-item"><span class="wf-dot"></span> DRC Analysis</span>
                <span class="wf-item"><span class="wf-dot"></span> Impedance Calculator</span>
                <span class="wf-item"><span class="wf-dot"></span> AI Design Review</span>
                <span class="wf-item"><span class="wf-dot"></span> Z3 Constraint Solver</span>
            </div>
        </div>

        <!-- Viewer toolbar (hidden until loaded) -->
        <div class="viewer-toolbar hidden" id="viewerToolbar">
            <div class="toolbar-group">
                <button class="tb-btn" onclick="viewer.zoomIn()" title="Zoom In">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                </button>
                <button class="tb-btn" onclick="viewer.zoomOut()" title="Zoom Out">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                </button>
                <button class="tb-btn" onclick="viewer.fitToView()" title="Fit to View">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                    Fit
                </button>
            </div>
            <div class="toolbar-group" id="toolbarLayers"></div>
            <div class="toolbar-group">
                <button class="tb-btn" id="gridToggle" onclick="toggleGrid()" title="Toggle Grid">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                    Grid
                </button>
            </div>
            <div style="flex:1"></div>
            <div class="toolbar-group">
                <span style="font-size:0.7rem;color:var(--fg3);font-family:var(--mono);" id="zoomLevel">100%</span>
            </div>
        </div>

        <!-- PCB Viewer -->
        <div class="viewer-container hidden" id="viewerContainer">
            <canvas id="pcbCanvas"></canvas>
            <div class="layer-panel hidden" id="layerToggles"></div>
            <div class="coord-display" id="coordDisplay">X: 0.00mm  Y: 0.00mm</div>
            <div class="viewer-actions">
                <button onclick="viewer.resetView()">Reset</button>
            </div>
        </div>
    </div>

    <!-- RIGHT PANEL -->
    <div class="right-panel" id="rightPanel">
        <div class="right-tabs">
            <div class="right-tab active" data-tab="drc" onclick="switchTab(this)">
                <span class="tab-icon">&#9744;</span> DRC <span class="tab-badge hidden" id="drcBadge">0</span>
            </div>
            <div class="right-tab" data-tab="ai-results" onclick="switchTab(this)">
                <span class="tab-icon">&#9881;</span> AI Actions
            </div>
            <div class="right-tab" data-tab="tools" onclick="switchTab(this)">
                <span class="tab-icon">&#9874;</span> Tools
            </div>
            <div class="right-tab" data-tab="chat" onclick="switchTab(this)">
                <span class="tab-icon">&#9993;</span> Chat
            </div>
        </div>

        <!-- DRC Tab -->
        <div class="right-tab-content active" id="tab-drc">
            <button class="analyze-btn" id="analyzeBtn" onclick="runAnalysis()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Run DRC Analysis
            </button>
            <div id="drcPanel" style="display:none;">
                <div class="drc-summary-bar" id="drcSummaryBar">
                    <div class="drc-gauge good" id="drcGauge" style="--pct:0">
                        <div class="gauge-inner"><span class="gauge-value" id="drcScoreVal">--</span></div>
                    </div>
                    <div class="drc-counts" id="drcCounts"></div>
                    <span class="drc-elapsed" id="drcElapsed"></span>
                </div>
                <div class="drc-filters" id="drcFilters">
                    <button class="drc-filter-btn active" data-filter="all" onclick="filterDrc('all',this)">All</button>
                    <button class="drc-filter-btn" data-filter="error" onclick="filterDrc('error',this)">Errors</button>
                    <button class="drc-filter-btn" data-filter="warning" onclick="filterDrc('warning',this)">Warnings</button>
                    <button class="drc-filter-btn" data-filter="info" onclick="filterDrc('info',this)">Info</button>
                </div>
                <div class="violation-list" id="violationList"></div>
            </div>
            <span class="drc-score hidden" id="drcScore"></span>
            <div class="hidden" id="drcSummary"></div>
        </div>

        <!-- AI Actions Tab -->
        <div class="right-tab-content" id="tab-ai-results">
            <div class="ai-action-grid" id="aiActions">
                <div class="ai-action-card" id="reviewBtn" onclick="runAiAction('review')">
                    <div class="action-icon">&#128269;</div>
                    <div class="action-label">Full Design Review</div>
                    <div class="action-sub">AI-powered analysis</div>
                </div>
                <div class="ai-action-card" id="strategyBtn" onclick="runAiAction('routing-strategy')">
                    <div class="action-icon">&#128740;</div>
                    <div class="action-label">Routing Strategy</div>
                    <div class="action-sub">Layer &amp; order planning</div>
                </div>
                <div class="ai-action-card" id="constraintsBtn" onclick="runAiAction('constraints')">
                    <div class="action-icon">&#128208;</div>
                    <div class="action-label">Generate Constraints</div>
                    <div class="action-sub">Net classes &amp; rules</div>
                </div>
                <div class="ai-action-card" id="placementBtn" onclick="runAiAction('placement')">
                    <div class="action-icon">&#128230;</div>
                    <div class="action-label">Optimize Placement</div>
                    <div class="action-sub">Component positioning</div>
                </div>
            </div>
            <div class="ai-result-container" id="aiResultContainer">
                <div style="color:var(--fg3);text-align:center;padding:2rem;font-size:0.82rem;">
                    Run an AI action above to see results.<br>
                    <span style="font-size:0.73rem;">The AI uses real engineering tools during analysis.</span>
                </div>
            </div>
        </div>

        <!-- Tools Tab -->
        <div class="right-tab-content" id="tab-tools">
            <div style="margin-bottom:16px;">
                <div style="font-size:0.78rem;font-weight:700;margin-bottom:8px;color:var(--fg2);">Impedance Calculator</div>
                <div class="tool-form">
                    <label>Width (mm):</label><input type="number" id="impW" value="0.15" step="0.01" min="0.01">
                    <label>Height (mm):</label><input type="number" id="impH" value="0.2" step="0.01" min="0.01">
                    <label>Er:</label><input type="number" id="impEr" value="4.2" step="0.1" min="1">
                    <label>Cu (mm):</label><input type="number" id="impT" value="0.035" step="0.001" min="0.005">
                    <label>Topology:</label>
                    <select id="impType"><option value="microstrip">Microstrip</option><option value="stripline">Stripline</option></select>
                    <label>Spacing:</label><input type="number" id="impSpacing" value="" step="0.01" min="0" placeholder="differential">
                </div>
                <button class="calc-btn" onclick="calcImpedance()">Calculate Z0</button>
                <div class="tool-result" id="impResult" style="margin-top:8px;">Z0 = --</div>
            </div>
            <div>
                <div style="font-size:0.78rem;font-weight:700;margin-bottom:8px;color:var(--fg2);">Current Capacity (IPC-2152)</div>
                <div class="tool-form">
                    <label>Width (mm):</label><input type="number" id="curW" value="0.25" step="0.01" min="0.01">
                    <label>Cu (oz):</label><input type="number" id="curOz" value="1" step="0.5" min="0.5">
                    <label>Temp Rise:</label><input type="number" id="curTR" value="10" step="1" min="1">
                </div>
                <button class="calc-btn" onclick="calcCurrent()">Calculate</button>
                <div class="tool-result" id="curResult" style="margin-top:8px;">Max Current = --</div>
            </div>
        </div>

        <!-- Chat Tab -->
        <div class="right-tab-content" id="tab-chat">
            <div class="chat-area">
                <div class="chat-messages" id="chatMessages">
                    <div style="text-align:center;color:var(--fg3);font-size:0.78rem;padding:2rem;">
                        Ask questions about your PCB design.<br>The AI can use engineering tools to answer.
                    </div>
                </div>
                <div class="chat-input-row">
                    <input type="text" id="chatInput" placeholder="Ask about your design..." onkeydown="if(event.key==='Enter')sendChat()">
                    <button onclick="sendChat()">Send</button>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- STATUS BAR -->
<div class="status-bar">
    <div class="status-item"><span class="status-dot green" id="statusDot"></span><span id="statusText">Ready</span></div>
    <div class="status-item" id="statusProject">No project</div>
    <div class="status-spacer"></div>
    <div class="status-item" id="statusCoords">X: 0.00  Y: 0.00</div>
    <div class="status-item" id="statusZoom">Zoom: 100%</div>
    <div class="status-item">RouteAI v0.2</div>
</div>

<script>
// ===== STATE =====
let currentProject = null;
let AI_ENABLED = false;
let AI_PROVIDER = null;
let showGrid = false;

// ===== TOAST =====
function showToast(msg, type='info') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.animation = 'toastOut 0.3s forwards'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ===== SETTINGS MODAL =====
function toggleSettings() {
    const m = document.getElementById('settingsModal');
    m.classList.toggle('show');
}
document.getElementById('settingsModal').addEventListener('click', function(e) {
    if (e.target === this) toggleSettings();
});

// ===== AI STATUS =====
function updateAiStatus() {
    const badge = document.getElementById('aiBadge');
    const text = document.getElementById('aiBadgeText');
    const dot = document.getElementById('statusDot');
    if (AI_ENABLED) {
        badge.className = 'ai-badge connected';
        text.textContent = (AI_PROVIDER || 'AI').charAt(0).toUpperCase() + (AI_PROVIDER || 'ai').slice(1);
    } else {
        badge.className = 'ai-badge disconnected';
        text.textContent = 'No AI';
    }
}
updateAiStatus();

// ===== SET API KEYS =====
async function setApiKeys() {
    const geminiKey = document.getElementById('geminiKeyInput').value.trim();
    const anthropicKey = document.getElementById('anthropicKeyInput').value.trim();
    if (!geminiKey && !anthropicKey) { showToast('Enter at least one API key', 'error'); return; }
    try {
        const r = await fetch('/api/set-key', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({gemini_key: geminiKey, anthropic_key: anthropicKey})
        });
        const j = await r.json();
        if (j.ai_enabled) {
            AI_ENABLED = true;
            AI_PROVIDER = j.provider;
            updateAiStatus();
            if (geminiKey) document.getElementById('geminiStatus').innerHTML = '<span class="ok">Connected</span>';
            if (anthropicKey) document.getElementById('anthropicStatus').innerHTML = '<span class="ok">Connected</span>';
            showToast('AI connected: ' + j.provider, 'success');
            toggleSettings();
        }
    } catch(e) { showToast('Failed to set key: ' + e.message, 'error'); }
}

// Check initial AI status
fetch('/api/projects').then(() => {}).catch(() => {});

// ===== SIDEBAR SECTION TOGGLE =====
function toggleSection(header) {
    header.classList.toggle('collapsed');
    const body = header.nextElementSibling;
    body.classList.toggle('collapsed');
}

// ===== UPLOAD =====
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');

uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) uploadFile(fileInput.files[0]); });

async function uploadFile(file) {
    uploadArea.innerHTML = '<div class="spinner"></div><div style="font-size:0.78rem;color:var(--fg2);margin-top:8px;">Uploading &amp; parsing...</div>';
    document.getElementById('statusText').textContent = 'Uploading...';
    const fd = new FormData();
    fd.append('file', file);
    try {
        const resp = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || 'Upload failed'); }
        const data = await resp.json();
        currentProject = data;
        showProject(data);
        showToast('Project loaded: ' + data.name, 'success');
        // Check AI status
        const pResp = await fetch('/api/projects/' + data.id);
        const pData = await pResp.json();
        if (pData.ai_enabled) {
            AI_ENABLED = true;
            AI_PROVIDER = pData.ai_provider;
            updateAiStatus();
        }
    } catch (err) {
        uploadArea.innerHTML = '<div style="color:var(--red);font-size:0.82rem;margin-bottom:8px;">Error: ' + escapeHtml(err.message) + '</div>' +
            '<span class="upload-btn" onclick="location.reload()">Try Again</span>';
        showToast('Upload failed: ' + err.message, 'error');
    }
    document.getElementById('statusText').textContent = 'Ready';
}

function showProject(data) {
    // Update upload area
    uploadArea.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:var(--emerald);"></div>' +
        '<span style="font-size:0.8rem;font-weight:600;color:var(--fg);">' + escapeHtml(data.name) + '</span></div>' +
        '<div style="margin-top:6px;"><span class="upload-btn" style="font-size:0.72rem;padding:3px 12px;" ' +
        'onclick="document.getElementById(\'fileInput2\').click()">Change</span>' +
        '<input type="file" id="fileInput2" accept=".kicad_pcb,.kicad_sch,.zip" style="display:none" ' +
        'onchange="if(this.files.length)uploadFile(this.files[0])"></div>';

    // Update header
    document.getElementById('headerProject').textContent = data.name;
    document.getElementById('statusProject').textContent = data.name;

    // Show panels
    document.getElementById('projectPanels').classList.remove('hidden');
    document.getElementById('welcomeView').classList.add('hidden');
    document.getElementById('viewerContainer').classList.remove('hidden');
    document.getElementById('viewerToolbar').classList.remove('hidden');

    // Board info
    const bi = document.getElementById('boardInfo');
    const bs = data.board_summary || {};
    bi.innerHTML = Object.entries({
        'Layers': bs.layer_count || '-', 'Copper': bs.copper_layer_count || '-',
        'Nets': bs.net_count || '-', 'Components': bs.footprint_count || '-',
        'Traces': bs.segment_count || '-', 'Vias': bs.via_count || '-',
        'Zones': bs.zone_count || '-', 'Thickness': (bs.thickness_mm || '-') + ' mm',
    }).map(function(kv) { return '<span class="label">' + kv[0] + '</span><span class="value">' + kv[1] + '</span>'; }).join('');

    if (data.has_board) loadBoardViewer(data.id);
}

// ===== BOARD VIEWER =====
const viewer = {
    canvas: null, ctx: null, boardData: null,
    offsetX: 0, offsetY: 0, scale: 1,
    dragging: false, lastX: 0, lastY: 0,
    layerVisible: {}, highlightLoc: null,

    LAYER_COLORS: {
        'F.Cu': '#ff3333', 'B.Cu': '#3333ff', 'In1.Cu': '#cccc00', 'In2.Cu': '#cc00cc',
        'In3.Cu': '#00cccc', 'In4.Cu': '#cc6600', 'F.SilkS': '#ffff88', 'B.SilkS': '#8888ff',
        'F.Mask': '#880088', 'B.Mask': '#008888', 'Edge.Cuts': '#cccc44',
        'F.Fab': '#666688', 'B.Fab': '#886666',
    },

    init() {
        this.canvas = document.getElementById('pcbCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.canvas.addEventListener('mousedown', e => {
            this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
            this.canvas.parentElement.classList.add('grabbing');
        });
        this.canvas.addEventListener('mousemove', e => {
            // Update coords
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const bx = (mx - this.offsetX) / this.scale;
            const by = (my - this.offsetY) / this.scale;
            document.getElementById('coordDisplay').textContent = 'X: ' + bx.toFixed(2) + 'mm  Y: ' + by.toFixed(2) + 'mm';
            document.getElementById('statusCoords').textContent = 'X: ' + bx.toFixed(2) + '  Y: ' + by.toFixed(2);

            if (!this.dragging) return;
            this.offsetX += e.clientX - this.lastX;
            this.offsetY += e.clientY - this.lastY;
            this.lastX = e.clientX; this.lastY = e.clientY;
            this.render();
        });
        this.canvas.addEventListener('mouseup', () => { this.dragging = false; this.canvas.parentElement.classList.remove('grabbing'); });
        this.canvas.addEventListener('mouseleave', () => { this.dragging = false; this.canvas.parentElement.classList.remove('grabbing'); });
        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const zoom = e.deltaY < 0 ? 1.15 : 1/1.15;
            this.offsetX = mx - (mx - this.offsetX) * zoom;
            this.offsetY = my - (my - this.offsetY) * zoom;
            this.scale *= zoom;
            this.updateZoomDisplay();
            this.render();
        }, { passive: false });
    },

    updateZoomDisplay() {
        const pct = Math.round(this.scale * 100);
        const el = document.getElementById('zoomLevel');
        if (el) el.textContent = pct + '%';
        const sb = document.getElementById('statusZoom');
        if (sb) sb.textContent = 'Zoom: ' + pct + '%';
    },

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.render();
    },

    setData(data) {
        this.boardData = data;
        const layers = new Set();
        data.traces.forEach(t => layers.add(t.layer));
        data.pads.forEach(p => layers.add(p.layer));
        data.zones.forEach(z => layers.add(z.layer));
        layers.add('Edge.Cuts');
        layers.add('Vias');

        // Layer toggles panel
        const toggleDiv = document.getElementById('layerToggles');
        toggleDiv.classList.remove('hidden');
        toggleDiv.innerHTML = '';

        // Sidebar layers and toolbar dots
        const sidebarLayers = document.getElementById('sidebarLayers');
        sidebarLayers.innerHTML = '';
        const toolbarLayers = document.getElementById('toolbarLayers');
        toolbarLayers.innerHTML = '';

        layers.forEach(l => {
            this.layerVisible[l] = true;
            const color = this.LAYER_COLORS[l] || '#888888';

            // Sidebar layer entry
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;font-size:0.73rem;';
            row.innerHTML = '<input type="checkbox" checked data-layer="' + l + '" style="margin:0;">' +
                '<span style="display:inline-block;width:10px;height:10px;background:' + color + ';border-radius:2px;"></span> ' + l;
            row.querySelector('input').addEventListener('change', e => {
                this.layerVisible[e.target.dataset.layer] = e.target.checked;
                this.render();
            });
            sidebarLayers.appendChild(row);

            // Layer panel (overlay)
            const lbl = document.createElement('label');
            lbl.innerHTML = '<input type="checkbox" checked data-layer="' + l + '" style="margin:0;">' +
                '<span class="layer-color-swatch" style="background:' + color + ';"></span> ' + l;
            lbl.querySelector('input').addEventListener('change', e => {
                this.layerVisible[e.target.dataset.layer] = e.target.checked;
                this.render();
            });
            toggleDiv.appendChild(lbl);

            // Toolbar dot (only for copper layers)
            if (l.endsWith('.Cu') || l === 'Edge.Cuts' || l === 'Vias') {
                const dot = document.createElement('span');
                dot.className = 'layer-dot';
                dot.style.background = color;
                dot.title = l;
                dot.dataset.layer = l;
                dot.addEventListener('click', () => {
                    this.layerVisible[l] = !this.layerVisible[l];
                    dot.classList.toggle('off', !this.layerVisible[l]);
                    this.render();
                });
                toolbarLayers.appendChild(dot);
            }
        });
        this.fitToView();
    },

    getBounds() {
        if (!this.boardData) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const extend = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
        this.boardData.outline.forEach(l => { extend(l.x1, l.y1); extend(l.x2, l.y2); });
        this.boardData.traces.forEach(t => { extend(t.x1, t.y1); extend(t.x2, t.y2); });
        this.boardData.pads.forEach(p => { extend(p.x - p.width/2, p.y - p.height/2); extend(p.x + p.width/2, p.y + p.height/2); });
        this.boardData.vias.forEach(v => { extend(v.x - v.size/2, v.y - v.size/2); extend(v.x + v.size/2, v.y + v.size/2); });
        this.boardData.components.forEach(c => { extend(c.x, c.y); });
        if (minX === Infinity) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const pad = 2;
        return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    },

    fitToView() {
        const b = this.getBounds();
        const cw = this.canvas.width / window.devicePixelRatio;
        const ch = this.canvas.height / window.devicePixelRatio;
        const bw = b.maxX - b.minX;
        const bh = b.maxY - b.minY;
        if (bw === 0 || bh === 0) return;
        this.scale = Math.min(cw / bw, ch / bh) * 0.9;
        this.offsetX = (cw - bw * this.scale) / 2 - b.minX * this.scale;
        this.offsetY = (ch - bh * this.scale) / 2 - b.minY * this.scale;
        this.updateZoomDisplay();
        this.render();
    },

    resetView() { this.scale = 1; this.offsetX = 0; this.offsetY = 0; this.updateZoomDisplay(); this.render(); },
    zoomIn() { this.scale *= 1.3; this.updateZoomDisplay(); this.render(); },
    zoomOut() { this.scale /= 1.3; this.updateZoomDisplay(); this.render(); },
    toScreen(x, y) { return [x * this.scale + this.offsetX, y * this.scale + this.offsetY]; },

    render() {
        const ctx = this.ctx;
        const cw = this.canvas.width / window.devicePixelRatio;
        const ch = this.canvas.height / window.devicePixelRatio;
        ctx.clearRect(0, 0, cw, ch);

        // Grid
        if (showGrid) {
            ctx.strokeStyle = '#ffffff08';
            ctx.lineWidth = 0.5;
            const gridSize = 1; // 1mm
            const b = this.getBounds();
            for (let x = Math.floor(b.minX); x <= Math.ceil(b.maxX); x += gridSize) {
                const [sx] = this.toScreen(x, 0);
                if (sx >= 0 && sx <= cw) { ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, ch); ctx.stroke(); }
            }
            for (let y = Math.floor(b.minY); y <= Math.ceil(b.maxY); y += gridSize) {
                const [, sy] = this.toScreen(0, y);
                if (sy >= 0 && sy <= ch) { ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(cw, sy); ctx.stroke(); }
            }
        }

        if (!this.boardData) return;
        const d = this.boardData;
        const s = this.scale;

        // Zones
        d.zones.forEach(z => {
            if (!this.layerVisible[z.layer]) return;
            const color = this.LAYER_COLORS[z.layer] || '#888888';
            ctx.fillStyle = color + '18';
            ctx.strokeStyle = color + '40';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            z.points.forEach((p, i) => {
                const [sx, sy] = this.toScreen(p.x, p.y);
                if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            });
            ctx.closePath(); ctx.fill(); ctx.stroke();
        });

        // Outline
        if (this.layerVisible['Edge.Cuts'] !== false) {
            ctx.strokeStyle = this.LAYER_COLORS['Edge.Cuts'];
            ctx.lineWidth = Math.max(1, 0.15 * s);
            d.outline.forEach(l => {
                const [x1, y1] = this.toScreen(l.x1, l.y1);
                const [x2, y2] = this.toScreen(l.x2, l.y2);
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            });
        }

        // Traces
        d.traces.forEach(t => {
            if (!this.layerVisible[t.layer]) return;
            const color = this.LAYER_COLORS[t.layer] || '#888888';
            ctx.strokeStyle = color + 'cc';
            ctx.lineWidth = Math.max(0.5, t.width * s);
            ctx.lineCap = 'round';
            const [x1, y1] = this.toScreen(t.x1, t.y1);
            const [x2, y2] = this.toScreen(t.x2, t.y2);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        });

        // Pads
        d.pads.forEach(p => {
            if (!this.layerVisible[p.layer]) return;
            const color = this.LAYER_COLORS[p.layer] || '#888888';
            const [sx, sy] = this.toScreen(p.x, p.y);
            const pw = Math.max(1, p.width * s);
            const ph = Math.max(1, p.height * s);
            if (p.shape === 'circle') {
                ctx.fillStyle = color + 'bb';
                ctx.beginPath(); ctx.arc(sx, sy, pw / 2, 0, Math.PI * 2); ctx.fill();
            } else if (p.shape === 'oval') {
                ctx.fillStyle = color + 'bb';
                ctx.beginPath(); ctx.ellipse(sx, sy, pw / 2, ph / 2, 0, 0, Math.PI * 2); ctx.fill();
            } else {
                ctx.fillStyle = color + 'bb';
                ctx.fillRect(sx - pw/2, sy - ph/2, pw, ph);
            }
            if (p.drill > 0) {
                const dr = Math.max(1, p.drill * s / 2);
                ctx.fillStyle = '#060a14';
                ctx.beginPath(); ctx.arc(sx, sy, dr, 0, Math.PI * 2); ctx.fill();
            }
        });

        // Vias
        if (this.layerVisible['Vias'] !== false) {
            d.vias.forEach(v => {
                const [sx, sy] = this.toScreen(v.x, v.y);
                const r = Math.max(1.5, v.size * s / 2);
                const dr = Math.max(0.8, v.drill * s / 2);
                ctx.fillStyle = '#88cc88bb';
                ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#060a14';
                ctx.beginPath(); ctx.arc(sx, sy, dr, 0, Math.PI * 2); ctx.fill();
            });
        }

        // Highlight
        if (this.highlightLoc) {
            const [hx, hy] = this.toScreen(this.highlightLoc[0], this.highlightLoc[1]);
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(hx, hy, 15, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(hx - 20, hy); ctx.lineTo(hx + 20, hy);
            ctx.moveTo(hx, hy - 20); ctx.lineTo(hx, hy + 20);
            ctx.stroke();
        }

        // Component refs when zoomed
        if (s > 3) {
            ctx.fillStyle = '#ffffff88';
            ctx.font = Math.max(8, Math.min(12, 1.5 * s)) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            d.components.forEach(c => {
                const [sx, sy] = this.toScreen(c.x, c.y);
                ctx.fillText(c.ref, sx, sy);
            });
        }
    },

    highlightLocation(x, y) {
        this.highlightLoc = [x, y];
        const cw = this.canvas.width / window.devicePixelRatio;
        const ch = this.canvas.height / window.devicePixelRatio;
        this.offsetX = cw / 2 - x * this.scale;
        this.offsetY = ch / 2 - y * this.scale;
        this.render();
        setTimeout(() => { this.highlightLoc = null; this.render(); }, 3000);
    }
};

function toggleGrid() {
    showGrid = !showGrid;
    document.getElementById('gridToggle').classList.toggle('active', showGrid);
    viewer.render();
}

async function loadBoardViewer(projectId) {
    viewer.init();
    try {
        const resp = await fetch('/api/projects/' + projectId + '/board');
        const data = await resp.json();
        viewer.setData(data);
    } catch (err) { console.error('Failed to load board:', err); }
}

// ===== DRC ANALYSIS =====
let _drcData = null;
async function runAnalysis() {
    if (!currentProject) return;
    const btn = document.getElementById('analyzeBtn');
    btn.innerHTML = '<span class="spinner"></span> Analyzing...';
    btn.disabled = true;
    document.getElementById('statusText').textContent = 'Running DRC...';
    try {
        const resp = await fetch('/api/projects/' + currentProject.id + '/analyze', { method: 'POST' });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || 'Analysis failed'); }
        const data = await resp.json();
        showDrcResults(data);
        showToast('DRC complete: ' + (data.violation_count || 0) + ' violations', data.error_count > 0 ? 'error' : 'success');
    } catch (err) {
        showToast('Analysis failed: ' + err.message, 'error');
    }
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Run DRC Analysis';
    btn.disabled = false;
    document.getElementById('statusText').textContent = 'Ready';
}

function showDrcResults(data) {
    _drcData = data;
    const panel = document.getElementById('drcPanel');
    panel.style.display = '';

    const score = data.design_score || 0;
    const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'ok' : 'bad';

    // Gauge
    const gauge = document.getElementById('drcGauge');
    gauge.className = 'drc-gauge ' + scoreClass;
    gauge.style.setProperty('--pct', score);
    document.getElementById('drcScoreVal').textContent = score;

    // Counts
    document.getElementById('drcCounts').innerHTML =
        '<div class="drc-count-row"><span class="cnt-dot error"></span><span class="cnt-num">' + (data.error_count||0) + '</span> Errors</div>' +
        '<div class="drc-count-row"><span class="cnt-dot warning"></span><span class="cnt-num">' + (data.warning_count||0) + '</span> Warnings</div>' +
        '<div class="drc-count-row"><span class="cnt-dot info"></span><span class="cnt-num">' + (data.info_count||0) + '</span> Info</div>';
    document.getElementById('drcElapsed').textContent = (data.elapsed_seconds||0).toFixed(2) + 's';

    // Badge
    const badge = document.getElementById('drcBadge');
    const total = (data.error_count||0) + (data.warning_count||0);
    if (total > 0) {
        badge.textContent = total;
        badge.className = 'tab-badge' + (data.error_count > 0 ? ' red' : ' orange');
        badge.classList.remove('hidden');
    }

    // Also set old compat elements
    const scoreEl = document.getElementById('drcScore');
    scoreEl.textContent = score + '/100';
    scoreEl.className = 'drc-score hidden ' + scoreClass;

    renderViolations(data.violations || [], 'all');
    window._violations = data.violations || [];
}

function renderViolations(violations, filter) {
    const list = document.getElementById('violationList');
    if (!violations.length) {
        list.innerHTML = '<p style="color:var(--emerald);padding:10px;font-size:0.82rem;">No violations found!</p>';
        return;
    }

    const filtered = filter === 'all' ? violations : violations.filter(v => v.severity === filter);

    // Group by rule
    const groups = {};
    filtered.forEach((v, i) => {
        if (!groups[v.rule]) groups[v.rule] = [];
        groups[v.rule].push({...v, _idx: violations.indexOf(v)});
    });

    let html = '';
    Object.entries(groups).forEach(function(entry) {
        const rule = entry[0];
        const items = entry[1];
        html += '<div class="violation-group">';
        html += '<div class="violation-group-header" onclick="this.nextElementSibling.classList.toggle(\'collapsed\')">';
        html += '<span>' + escapeHtml(rule) + '</span><span class="vg-count">' + items.length + '</span></div>';
        html += '<div>';
        items.forEach(function(v) {
            const sevClass = v.severity === 'error' ? 'error' : v.severity === 'warning' ? 'warning' : 'info';
            const loc = v.location ? '(' + v.location[0].toFixed(2) + ', ' + v.location[1].toFixed(2) + ')' : '';
            html += '<div class="violation" onclick="highlightViolation(' + v._idx + ')">';
            html += '<div class="v-rule"><span class="sev-dot ' + sevClass + '"></span>' + escapeHtml(v.rule) + '</div>';
            html += '<div class="v-msg">' + escapeHtml(v.message) + '</div>';
            if (loc) html += '<div class="v-loc">' + loc + '</div>';
            html += '</div>';
        });
        html += '</div></div>';
    });
    list.innerHTML = html;
}

function filterDrc(filter, btn) {
    document.querySelectorAll('.drc-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (_drcData) renderViolations(_drcData.violations || [], filter);
}

function highlightViolation(idx) {
    const v = window._violations[idx];
    if (v && v.location) viewer.highlightLocation(v.location[0], v.location[1]);
}

// ===== AI ACTIONS =====
const AI_ACTION_LABELS = {
    'review': {btn: 'reviewBtn', label: 'Full Design Review', loading: 'Running AI Review...'},
    'routing-strategy': {btn: 'strategyBtn', label: 'Routing Strategy', loading: 'Generating Strategy...'},
    'constraints': {btn: 'constraintsBtn', label: 'Generate Constraints', loading: 'Generating Constraints...'},
    'placement': {btn: 'placementBtn', label: 'Optimize Placement', loading: 'Analyzing Placement...'},
};

async function runAiAction(action) {
    if (!currentProject) return;
    if (!AI_ENABLED) { showToast('Configure an API key first (Settings)', 'error'); return; }

    const info = AI_ACTION_LABELS[action];
    const btn = document.getElementById(info.btn);
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner"></span><div class="action-label">' + info.loading + '</div>';

    // Show progress in AI results tab
    const container = document.getElementById('aiResultContainer');
    container.innerHTML = '<div class="ai-progress"><span class="spinner lg"></span><div style="margin-top:10px;">' + info.loading + '</div><div style="font-size:0.72rem;color:var(--fg3);margin-top:4px;">AI is calling engineering tools...</div></div>';

    // Switch to AI tab
    document.querySelector('[data-tab="ai-results"]').click();
    document.getElementById('statusText').textContent = info.loading;

    try {
        const resp = await fetch('/api/projects/' + currentProject.id + '/ai/' + action, { method: 'POST' });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || 'AI action failed'); }
        const data = await resp.json();
        displayAiResult(action, data);
        showToast(info.label + ' complete', 'success');
    } catch (err) {
        container.innerHTML = '<div style="color:var(--red);padding:1rem;">Error: ' + escapeHtml(err.message) + '</div>';
        showToast('AI action failed: ' + err.message, 'error');
    }

    // Restore button
    const icons = {'review':'&#128269;','routing-strategy':'&#128740;','constraints':'&#128208;','placement':'&#128230;'};
    btn.classList.remove('loading');
    btn.innerHTML = '<div class="action-icon">' + (icons[action]||'') + '</div><div class="action-label">' + info.label + '</div><div class="action-sub">Click to re-run</div>';
    document.getElementById('statusText').textContent = 'Ready';
}

function displayAiResult(action, data) {
    const container = document.getElementById('aiResultContainer');
    let html = '';

    // Tool usage summary
    const toolCalls = data.tool_calls || [];
    if (toolCalls.length > 0) {
        html += '<div style="margin-bottom:8px;padding:6px 10px;background:var(--purple-glow);border-radius:var(--radius-sm);font-size:0.73rem;color:var(--purple);display:flex;align-items:center;gap:6px;">';
        html += '<span style="font-weight:700;">' + toolCalls.length + ' tool calls</span>';
        html += '<span style="color:var(--fg3);">|</span> Provider: ' + (data.provider || '?');
        html += '</div>';
    }

    if (action === 'review') {
        const findings = data.findings || [];
        if (findings.length) {
            const critical = findings.filter(f => f.severity === 'critical');
            const warnings = findings.filter(f => f.severity === 'warning');
            const infos = findings.filter(f => f.severity === 'info');

            html += '<div style="margin-bottom:8px;font-size:0.82rem;font-weight:700;display:flex;gap:10px;align-items:center;">';
            html += 'Design Review ';
            if (critical.length) html += '<span class="sev-badge sev-error">' + critical.length + ' Critical</span>';
            if (warnings.length) html += '<span class="sev-badge sev-warning">' + warnings.length + ' Warning</span>';
            if (infos.length) html += '<span class="sev-badge sev-info">' + infos.length + ' Info</span>';
            html += '</div>';

            findings.forEach(f => {
                const sevColor = f.severity === 'critical' ? 'var(--red)' : f.severity === 'warning' ? 'var(--orange)' : 'var(--accent)';
                html += '<div class="finding-card">';
                html += '<div class="finding-header">';
                html += '<span class="sev-badge" style="background:' + sevColor + '22;color:' + sevColor + ';">' + (f.severity||'info').toUpperCase() + '</span>';
                html += '<span class="finding-category">' + (f.category || 'general') + '</span>';
                if (f.tool_used) html += '<span class="finding-tool">via ' + f.tool_used + '</span>';
                html += '</div>';
                html += '<div class="finding-message">' + (f.message || '') + '</div>';
                if (f.location) html += '<div class="finding-location">Location: ' + f.location + '</div>';
                if (f.suggestion) html += '<div class="finding-suggestion">Fix: ' + f.suggestion + '</div>';
                html += '</div>';
            });
        } else {
            html += '<div class="tool-result"><pre>' + escapeHtml(data.raw_text || 'No structured findings returned.') + '</pre></div>';
        }

    } else if (action === 'routing-strategy') {
        const s = data.strategy || {};
        if (Object.keys(s).length) {
            html += '<div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;">Routing Strategy</div>';
            if (s.routing_order) {
                html += '<div class="finding-card"><b>Routing Order:</b><br>';
                s.routing_order.forEach(r => {
                    html += '<div style="margin:3px 0;">P' + r.priority + ': ' + (r.nets||[]).join(', ') + ' - <i>' + (r.reason||'') + '</i></div>';
                });
                html += '</div>';
            }
            if (s.layer_assignments) {
                html += '<div class="finding-card"><b>Layer Assignments:</b><br>';
                Object.entries(s.layer_assignments).forEach(function(entry) {
                    html += '<div style="margin:3px 0;">' + entry[0] + ': ' + (entry[1].layers||[]).join(', ') + ' - <i>' + (entry[1].reason||'') + '</i></div>';
                });
                html += '</div>';
            }
            if (s.cost_weights) {
                html += '<div class="finding-card"><b>Cost Weights:</b> ' + JSON.stringify(s.cost_weights) + '</div>';
            }
            if (s.net_classes) {
                html += '<div class="finding-card"><b>Net Classes:</b><br>';
                s.net_classes.forEach(nc => {
                    html += '<div style="margin:3px 0;">' + nc.name + ': width=' + nc.min_width_mm + 'mm, clearance=' + nc.clearance_mm + 'mm, ' + (nc.nets||[]).length + ' nets</div>';
                });
                html += '</div>';
            }
            if (s.critical_notes) {
                html += '<div class="finding-card"><b>Notes:</b><ul style="margin:3px 0 0 1rem;">';
                s.critical_notes.forEach(n => { html += '<li>' + n + '</li>'; });
                html += '</ul></div>';
            }
        } else {
            html += '<div class="tool-result"><pre>' + escapeHtml(data.raw_text || 'No structured strategy returned.') + '</pre></div>';
        }

    } else if (action === 'constraints') {
        const c = data.constraints || {};
        if (Object.keys(c).length) {
            html += '<div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;">Generated Constraints</div>';
            if (c.net_classes) {
                html += '<div class="finding-card"><b>Net Classes:</b><br>';
                c.net_classes.forEach(nc => {
                    html += '<div style="margin:3px 0;">' + nc.name + ': width=' + nc.trace_width_mm + 'mm, clearance=' + nc.clearance_mm + 'mm</div>';
                });
                html += '</div>';
            }
            if (c.diff_pairs && c.diff_pairs.length) {
                html += '<div class="finding-card"><b>Differential Pairs:</b><br>';
                c.diff_pairs.forEach(dp => {
                    html += '<div style="margin:3px 0;">' + dp.name + ': ' + dp.pos_net + '/' + dp.neg_net + ', Zdiff=' + dp.target_z_diff + 'ohm, skew=' + dp.max_skew_mm + 'mm</div>';
                });
                html += '</div>';
            }
            if (c.length_groups && c.length_groups.length) {
                html += '<div class="finding-card"><b>Length Groups:</b><br>';
                c.length_groups.forEach(lg => {
                    html += '<div style="margin:3px 0;">' + lg.name + ': ' + (lg.nets||[]).length + ' nets, tol=' + lg.tolerance_mm + 'mm</div>';
                });
                html += '</div>';
            }
            if (c.special_rules && c.special_rules.length) {
                html += '<div class="finding-card"><b>Special Rules:</b><ul style="margin:3px 0 0 1rem;">';
                c.special_rules.forEach(r => { html += '<li>' + (r.description || JSON.stringify(r)) + '</li>'; });
                html += '</ul></div>';
            }
        } else {
            html += '<div class="tool-result"><pre>' + escapeHtml(data.raw_text || 'No structured constraints returned.') + '</pre></div>';
        }

    } else if (action === 'placement') {
        const s = data.suggestions || {};
        if (Object.keys(s).length) {
            html += '<div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;">Placement Analysis';
            if (s.overall_score != null) html += ' (Score: ' + s.overall_score + '/100)';
            html += '</div>';
            if (s.summary) html += '<div style="margin-bottom:8px;color:var(--fg2);font-size:0.78rem;">' + s.summary + '</div>';
            if (s.suggestions) {
                s.suggestions.forEach(sg => {
                    const prioColor = sg.priority === 'high' ? 'var(--red)' : sg.priority === 'medium' ? 'var(--orange)' : 'var(--fg2)';
                    html += '<div class="finding-card">';
                    html += '<div class="finding-header">';
                    html += '<span class="sev-badge" style="background:' + prioColor + '22;color:' + prioColor + ';">' + (sg.priority||'?').toUpperCase() + '</span>';
                    html += '<span class="finding-category">' + (sg.category || '') + '</span>';
                    html += '<b>' + (sg.component || '') + '</b>';
                    html += '</div>';
                    html += '<div class="finding-message">' + (sg.issue || '') + '</div>';
                    html += '<div class="finding-suggestion">' + (sg.suggestion || '') + '</div>';
                    html += '</div>';
                });
            }
        } else {
            html += '<div class="tool-result"><pre>' + escapeHtml(data.raw_text || 'No structured suggestions returned.') + '</pre></div>';
        }
    }

    // Tool call log
    if (toolCalls.length) {
        html += '<details style="margin-top:10px;"><summary style="cursor:pointer;color:var(--fg3);font-size:0.72rem;">Tool Call Log (' + toolCalls.length + ' calls)</summary><div class="tool-log">';
        toolCalls.forEach(tc => {
            html += '<div class="tool-log-item"><b>' + tc.tool + '</b>(' + JSON.stringify(tc.args).substring(0, 100) + ')</div>';
        });
        html += '</div></details>';
    }

    container.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== CHAT =====
async function sendChat() {
    if (!currentProject) return;
    if (!AI_ENABLED) { showToast('Configure an API key first', 'error'); return; }
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    const msgs = document.getElementById('chatMessages');
    // Clear placeholder if first message
    if (msgs.querySelector('[style*="text-align:center"]')) msgs.innerHTML = '';

    msgs.innerHTML += '<div class="chat-bubble user">' + escapeHtml(msg) + '</div>';
    msgs.innerHTML += '<div class="chat-thinking" id="chatPending"><span class="spinner"></span>Thinking (may use tools)...</div>';
    msgs.scrollTop = msgs.scrollHeight;

    try {
        const resp = await fetch('/api/projects/' + currentProject.id + '/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg }),
        });
        const pending = document.getElementById('chatPending');
        if (!resp.ok) {
            const e = await resp.json();
            pending.outerHTML = '<div class="chat-bubble assistant" style="border-left:2px solid var(--red);">Error: ' + (e.detail || 'Chat failed') + '</div>';
            return;
        }
        const data = await resp.json();
        let toolBadges = '';
        if (data.tool_count > 0) {
            toolBadges = '<span class="tool-badge">' + data.tool_count + ' tool(s)</span> ';
        }
        pending.outerHTML = '<div class="chat-bubble assistant">' + toolBadges + '<pre style="margin:0;background:transparent;padding:0;">' + escapeHtml(data.message) + '</pre></div>';
    } catch (err) {
        const pending = document.getElementById('chatPending');
        if (pending) pending.outerHTML = '<div class="chat-bubble assistant" style="border-left:2px solid var(--red);">Error: ' + err.message + '</div>';
    }
    msgs.scrollTop = msgs.scrollHeight;
}

// ===== TOOL CALCULATORS =====
async function calcImpedance() {
    const body = {
        w: parseFloat(document.getElementById('impW').value),
        h: parseFloat(document.getElementById('impH').value),
        er: parseFloat(document.getElementById('impEr').value),
        t: parseFloat(document.getElementById('impT').value),
        type: document.getElementById('impType').value,
        spacing: document.getElementById('impSpacing').value || null,
    };
    try {
        const resp = await fetch('/api/tools/impedance', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail); }
        const d = await resp.json();
        let text = 'Topology: ' + d.topology + '\nZ0 = ' + d.z0 + ' \u03A9';
        if (d.z_diff) text += '\nZdiff = ' + d.z_diff + ' \u03A9';
        text += '\nEr_eff = ' + d.er_eff;
        text += '\nDelay = ' + d.delay_ps_mm + ' ps/mm';
        document.getElementById('impResult').textContent = text;
    } catch (err) { document.getElementById('impResult').textContent = 'Error: ' + err.message; }
}

async function calcCurrent() {
    const body = {
        width: parseFloat(document.getElementById('curW').value),
        thickness: parseFloat(document.getElementById('curOz').value),
        temp_rise: parseFloat(document.getElementById('curTR').value),
    };
    try {
        const resp = await fetch('/api/tools/current', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail); }
        const d = await resp.json();
        let text = 'Width: ' + d.width_mm + ' mm  |  Cu: ' + d.thickness_oz + ' oz\n';
        text += 'Temp Rise: ' + d.temp_rise_c + ' \u00B0C\n';
        text += 'Cross-section: ' + d.area_mil2 + ' mil\u00B2\n\n';
        text += 'Max Current (external): ' + d.max_current_external_A + ' A\n';
        text += 'Max Current (internal): ' + d.max_current_internal_A + ' A\n\n';
        text += 'Ref: ' + d.reference;
        document.getElementById('curResult').textContent = text;
    } catch (err) { document.getElementById('curResult').textContent = 'Error: ' + err.message; }
}

// ===== TABS =====
function switchTab(el) {
    const parent = el.closest('.right-tabs');
    if (!parent) return;
    parent.querySelectorAll('.right-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    // Hide all tab contents in right panel
    document.querySelectorAll('.right-tab-content').forEach(t => t.classList.remove('active'));
    const tabId = 'tab-' + el.dataset.tab;
    document.getElementById(tabId).classList.add('active');
}

</script>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("ROUTEAI_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
