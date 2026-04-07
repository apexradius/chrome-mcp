# Changelog

## [1.0.0] — 2026-04-07

### Added
- Initial release of Chrome MCP server
- **24 tools** across 6 categories: navigation, interaction, inspection, network, console, emulation
- **14 stealth patches** for anti-detection (WebGL, canvas, plugins, languages, connection, hardware, screen, UA, chrome.runtime, permissions, loadTimes/csi, iframe)
- Persistent Chrome profile at `~/.config/apexradius/chrome-mcp/profile`
- Connect-or-launch strategy via DevToolsActivePort
- Per-tab mutex concurrency (operations on different tabs run in parallel)
- Accessibility tree snapshot with UID mapping (Playwright-style YAML output)
- Network request collector (capped at 500 requests, 512KB body limit)
- Console message collector (capped at 1000 messages)
- Graceful shutdown (close if launched, disconnect if connected)
- `withPage()` / `withBrowser()` helpers for consistent tool patterns
- `CollectorManager<T>` for generic per-page collector lifecycle
