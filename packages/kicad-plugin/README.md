# RouteAI Design Review - KiCad Plugin

AI-powered PCB design review and analysis for KiCad 8.

## Features

- One-click design review from inside the KiCad PCB editor
- Colour-coded board annotations (critical / warning / info)
- Scrollable results dialog with navigate-to-location support
- Persistent login with token storage
- Configurable API endpoint

## Requirements

- KiCad 8.0 or later
- A RouteAI account (sign up at https://routeai.com)

## Installation

### Via KiCad Plugin and Content Manager (PCM)

1. Open KiCad and go to **Plugin and Content Manager**.
2. Search for **RouteAI Design Review**.
3. Click **Install**.

### Manual installation

Copy this directory into your KiCad scripting plugins folder:

| OS      | Path                                                              |
| ------- | ----------------------------------------------------------------- |
| Linux   | `~/.local/share/kicad/8.0/scripting/plugins/routeai/`            |
| macOS   | `~/Library/Preferences/kicad/8.0/scripting/plugins/routeai/`     |
| Windows | `%APPDATA%\kicad\8.0\scripting\plugins\routeai\`                 |

Make sure the directory contains at least these files:

```
routeai/
  __init__.py
  plugin.py
  api_client.py
  dialogs.py
  annotations.py
```

Restart KiCad after copying the files.

## Usage

1. Open a PCB file in the KiCad PCB Editor (pcbnew).
2. Click **Tools > External Plugins > RouteAI Design Review** (or use the toolbar button).
3. Log in with your RouteAI credentials on first use.
4. The plugin packages your project, uploads it for review, and displays results as board annotations.
5. Double-click a finding in the results dialog to navigate to the location on the board.

## Settings

Open **Tools > External Plugins > RouteAI Design Review** and access settings to configure:

- **API URL** - Override the default RouteAI endpoint (useful for self-hosted installations).
- **Auto-review on save** - Automatically trigger a review each time you save the board.

## Development

To run the modules outside KiCad (for unit testing):

```python
from packages.kicad_plugin.api_client import RouteAIClient

client = RouteAIClient(base_url="http://localhost:8000")
client.login("test@example.com", "password")
```

The `pcbnew` and `wx` imports are guarded so the API client and data models work without KiCad installed.

## License

MIT
