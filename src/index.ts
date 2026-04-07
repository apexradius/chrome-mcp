#!/usr/bin/env node
/**
 * @apexradius/chrome-mcp
 * Chrome DevTools Protocol MCP server.
 * Apex Radius Labs — Excellence in every detail.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChromeClient } from "./chrome/client.js";

const server = new McpServer({
  name: "@apexradius/chrome-mcp",
  version: "1.0.0",
});

const chrome = new ChromeClient();

// Tool modules will be registered here in Phase 2+
// e.g., registerNavigationTools(server, chrome);
// e.g., registerInspectionTools(server, chrome);
// e.g., registerInteractionTools(server, chrome);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[chrome-mcp] MCP server running on stdio");
}

// Graceful shutdown
async function shutdown() {
  console.error("[chrome-mcp] Shutting down...");
  await chrome.shutdown();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  console.error("[chrome-mcp] Fatal error:", error);
  process.exit(1);
});
