# Plan: @apexradius/chrome-mcp

## Context

The current `chrome-devtools-mcp` v0.21.0 requires 5 workaround flags in `~/.mcp.json` to function properly (extensions, automation detection, keychain, sync, webdriver). It shows an "unsupported command-line flag" warning in Chrome, and crashes when multiple agents use it simultaneously. We're building a clean replacement that handles all of this natively, published as another OSS package under `@apexradius`.

## Architecture

**Stack:**
- `puppeteer-core@^24.40.0` — no bundled Chrome, uses system Chrome
- `@modelcontextprotocol/sdk@^1.10.1` — same as shopify-mcp
- `zod@^4.3.6` — input validation
- Same tool module pattern as `@apexradius/shopify-mcp`

**Location:** `/Users/Ayo/Projects/apex-radius-labs/chrome-mcp/`

**Key design decisions:**
1. **puppeteer-core only** (not + chrome-remote-interface) — proven sufficient for 43 tools in existing MCP, CDP access via `page._client()` when needed
2. **Stealth via JS injection** (not Chrome flags) — `page.evaluateOnNewDocument()` patches `navigator.webdriver`, plugins, languages, chrome.runtime, Permissions — zero Chrome flags = zero warning banners
3. **Per-tab mutexes** (not global mutex) — operations on different tabs run concurrently; only structural ops (new_page, close_page) acquire browser-level lock
4. **Persistent profile** at `~/.config/apexradius/chrome-mcp/profile` — separate from user's Chrome profile, no conflicts
5. **System Chrome discovery** — macOS: `/Applications/Google Chrome.app/...`, Linux: `/usr/bin/google-chrome`, override via `CHROME_EXECUTABLE`

## File Structure

```
chrome-mcp/
  src/
    index.ts                    # Entry point
    utils.ts                    # formatResponse, formatError
    chrome/
      client.ts                 # ChromeClient: launch, connect, page tracking
      stealth.ts                # 5 anti-detection patches (no Chrome flags)
      finder.ts                 # Cross-platform Chrome executable finder
      profile.ts                # Profile dir management
    browser/
      mutex.ts                  # Per-tab + browser-level mutex
      page-state.ts             # Per-page state (snapshot map, network, console)
      snapshot.ts               # A11y tree → uid mapping
    tools/
      navigation.ts             # 6 tools: navigate, new_page, close_page, list_pages, select_page, wait_for
      interaction.ts            # 9 tools: click, fill, type_text, hover, press_key, drag, upload_file, handle_dialog, fill_form
      inspection.ts             # 3 tools: take_screenshot, take_snapshot, evaluate_script
      network.ts                # 2 tools: list_network_requests, get_network_request
      console.ts                # 2 tools: list_console_messages, get_console_message
      emulation.ts              # 2 tools: emulate, resize_page
    collectors/
      network-collector.ts      # Per-page request/response tracking
      console-collector.ts      # Per-page console message tracking
```

## Scope

This is a **multi-session build** (3-4 sessions). Phase 1-2 in session 1, Phase 3-4 in session 2, Phase 5 in session 3. Not comparable to shopify-mcp which was a thin API wrapper — this involves real-time browser state, event handling, concurrency, and accessibility tree parsing.

## Risks & Mitigations

1. **`page._client()` deprecated** — Puppeteer v24 uses `page.createCDPSession()` instead. Must verify correct CDP access pattern before coding.
2. **Snapshot complexity** — a11y tree → uid mapping is the hardest part. Use CDP `Accessibility.getFullAXTree` directly, not Puppeteer's simplified `page.accessibility.snapshot()`.
3. **Browser lifecycle** — on MCP shutdown: leave Chrome running if we connected to existing, kill if we launched it. Track this via `launchedByUs` flag.
4. **Connect-or-launch** — if Chrome is already running with our profile (DevToolsActivePort file exists), connect to it. Otherwise launch new. This preserves state across MCP restarts.
5. **Dialog auto-handling** — set up default `page.on('dialog')` handler in Phase 1 (auto-dismiss with capture), expose explicit `handle_dialog` tool in Phase 3.
6. **Windows support** — not in v1, macOS + Linux only. Acknowledge in README.

## Implementation Phases

### Phase 1: Foundation
- `package.json`, `tsconfig.json`, `.gitignore`
- `src/chrome/finder.ts` — find system Chrome
- `src/chrome/profile.ts` — ensure profile dir exists
- `src/chrome/stealth.ts` — 5 JS patches (webdriver, plugins, languages, chrome.runtime, permissions)
- `src/chrome/client.ts` — ChromeClient class (connect-or-launch strategy, stealth, page tracking, tab mutexes, `launchedByUs` flag for shutdown behavior)
- `src/browser/mutex.ts` — Mutex with disposable guard
- `src/utils.ts` — formatResponse, formatError
- `src/index.ts` — wire everything up, graceful shutdown handler (kill Chrome only if we launched it)
- Default dialog handler on every new page (auto-dismiss + capture for later retrieval)
- Use `page.createCDPSession()` for raw CDP access (not deprecated `page._client()`)
- **Verify:** builds, launches Chrome with no flags, no warning banner, `navigator.webdriver === false`

### Phase 2: Navigation + Inspection
- `src/browser/page-state.ts` — per-page state wrapper
- `src/browser/snapshot.ts` — a11y tree to uid map
- `src/tools/navigation.ts` — navigate, new_page, close_page, list_pages, select_page, wait_for
- `src/tools/inspection.ts` — take_screenshot, take_snapshot, evaluate_script
- **Verify:** can navigate, manage tabs, take screenshots, read a11y tree

### Phase 3: Interaction
- `src/tools/interaction.ts` — click, fill, type_text, hover, press_key, drag, upload_file, handle_dialog, fill_form
- All reference uids from snapshot
- **Verify:** fill out a form, click buttons, handle dialogs

### Phase 4: Network + Console + Emulation
- `src/collectors/network-collector.ts` + `src/collectors/console-collector.ts`
- `src/tools/network.ts` — list/get network requests
- `src/tools/console.ts` — list/get console messages
- `src/tools/emulation.ts` — device emulation, resize
- **Verify:** network capture works, console messages captured, device emulation changes viewport

### Phase 5: Ship
- README.md, CHANGELOG.md
- `/quality` standard tier
- `/release` — GitHub repo, npm publish, v1.0.0 tag
- Update `~/.mcp.json` to use `@apexradius/chrome-mcp` instead of `chrome-devtools-mcp`

## End Result: ~/.mcp.json

**Before (current):**
```json
"chrome-devtools": {
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
"chrome": {
  "command": "npx",
  "args": ["-y", "@apexradius/chrome-mcp"]
}
```

Zero flags. Zero warnings.

## v1 Tool Count: 24

| Category | Count | Tools |
|----------|-------|-------|
| Navigation | 6 | navigate, new_page, close_page, list_pages, select_page, wait_for |
| Interaction | 9 | click, fill, type_text, hover, press_key, drag, upload_file, handle_dialog, fill_form |
| Inspection | 3 | take_screenshot, take_snapshot, evaluate_script |
| Network | 2 | list_network_requests, get_network_request |
| Console | 2 | list_console_messages, get_console_message |
| Emulation | 2 | emulate, resize_page |

## Env Vars

| Variable | Required | Default |
|----------|----------|---------|
| `CHROME_EXECUTABLE` | No | Auto-detect system Chrome |
| `CHROME_PROFILE_DIR` | No | `~/.config/apexradius/chrome-mcp/profile` |
| `CHROME_HEADLESS` | No | `false` (headed mode) |

## Verification

After each phase:
1. `npm run build` — clean TypeScript build
2. Manual smoke test: launch server, verify Chrome opens with no warnings
3. Stealth check: open DevTools console, confirm `navigator.webdriver === false`
4. Tool test: connect via Claude Code and exercise each new tool
5. Concurrency test (Phase 2+): run two operations on different tabs simultaneously
6. Reconnect test (Phase 1+): kill MCP server, restart, verify it reconnects to existing Chrome
7. After Phase 5: run `/quality` standard tier + `/release` pipeline
