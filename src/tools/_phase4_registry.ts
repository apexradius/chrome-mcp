import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { registerNetworkTools } from "./network.js";
import { registerConsoleTools } from "./console.js";
import { registerEmulationTools } from "./emulation.js";

/**
 * Register all Phase 4 tools: network monitoring, console capture, and emulation.
 */
export function registerPhase4Tools(server: McpServer, client: ChromeClient): void {
  registerNetworkTools(server, client);
  registerConsoleTools(server, client);
  registerEmulationTools(server, client);
}
