# @apexradius/chrome-mcp

> **Excellence in every detail.**

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for Chrome — giving Claude direct control of your browser with stealth anti-detection, persistent profiles, and per-tab concurrency. Zero flags. Zero warnings.

## Why This Exists

The existing `chrome-devtools-mcp` requires 5 workaround flags, shows Chrome warning banners, and crashes when multiple agents use it. This is a clean replacement.

**Before:**
```json
{
  "command": "chrome-devtools-mcp",
  "args": [
    "--ignoreDefaultChromeArg=--disable-extensions",
    "--ignoreDefaultChromeArg=--enable-automation",
    "--ignoreDefaultChromeArg=--use-mock-keychain",
    "--ignoreDefaultChromeArg=--disable-sync",
    "--chromeArg=--disable-blink-features=AutomationControlled"
  ]
}
```

**After:**
```json
{
  "command": "npx",
  "args": ["-y", "@apexradius/chrome-mcp"]
}
```

## Features

- **14 stealth patches** — WebGL, canvas fingerprint, navigator properties, plugins, languages, connection, hardware, screen dimensions, headless UA cleanup, Chrome runtime stubs. Websites can't detect automation.
- **Persistent profile** — cookies, extensions, saved passwords, Chrome sync all persist across sessions. Not incognito.
- **Per-tab concurrency** — operations on different tabs run in parallel. No single global mutex bottleneck.
- **Connect-or-launch** — reconnects to existing Chrome if running, launches new if not. State survives MCP restarts.
- **Zero config** — uses your system Chrome, no bundled browser, no flags needed.

## Requirements

- Node.js 18+
- Google Chrome installed

## Installation

```bash
npm install -g @apexradius/chrome-mcp
```

Or run directly:

```bash
npx @apexradius/chrome-mcp
```

## Setup

Add to `~/.mcp.json` or Claude Desktop config:

```json
{
  "mcpServers": {
    "chrome": {
      "command": "npx",
      "args": ["-y", "@apexradius/chrome-mcp"]
    }
  }
}
```

## 24 Tools

| Category | Count | Tools |
|----------|-------|-------|
| **Navigation** | 6 | `navigate`, `new_page`, `close_page`, `list_pages`, `select_page`, `wait_for` |
| **Interaction** | 9 | `click`, `fill`, `type_text`, `hover`, `press_key`, `drag`, `upload_file`, `handle_dialog`, `fill_form` |
| **Inspection** | 3 | `take_screenshot`, `take_snapshot`, `evaluate_script` |
| **Network** | 2 | `list_network_requests`, `get_network_request` |
| **Console** | 2 | `list_console_messages`, `get_console_message` |
| **Emulation** | 2 | `emulate`, `resize_page` |

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `CHROME_EXECUTABLE` | No | Auto-detect system Chrome |
| `CHROME_PROFILE_DIR` | No | `~/.config/apexradius/chrome-mcp/profile` |
| `CHROME_HEADLESS` | No | `false` |

## Stealth

14 anti-detection patches run via `page.evaluateOnNewDocument()` before any page script:

1. `navigator.webdriver` → `false`
2. Realistic `window.chrome.runtime`
3. Realistic `navigator.plugins`
4. `navigator.languages` → `['en-US', 'en']`
5. `Permissions.prototype.query` override
6. WebGL vendor/renderer spoofing
7. Canvas fingerprint noise
8. `navigator.connection` → realistic 4g values
9. `navigator.hardwareConcurrency` → 8
10. `navigator.deviceMemory` → 8
11. Screen dimensions → 1920x1080
12. Headless user agent cleanup
13. `chrome.loadTimes()` / `chrome.csi()` stubs
14. iframe contentWindow cross-origin patch

No Chrome flags used. No warning banners.

## License

MIT © [Apex Radius Labs](https://apexradiuslabs.com)
