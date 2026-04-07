import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";
import { NetworkCollector } from "../collectors/network-collector.js";

// Per-page network collectors
const collectors = new Map<number, NetworkCollector>();

function getCollector(client: ChromeClient): { id: number; collector: NetworkCollector } {
  const { id, page } = client.getPage();
  let collector = collectors.get(id);
  if (!collector) {
    collector = new NetworkCollector(page);
    collectors.set(id, collector);

    // Clean up when page closes
    page.once("close", () => {
      collector?.dispose();
      collectors.delete(id);
    });
  }
  return { id, collector };
}

/**
 * Register network monitoring tools on the MCP server.
 */
export function registerNetworkTools(server: McpServer, client: ChromeClient): void {
  /**
   * list_network_requests — Return summary list of captured network requests.
   */
  server.tool(
    "list_network_requests",
    "List all captured network requests for the current page with optional resource type filter",
    {
      resourceType: z.string().optional().describe("Filter by resource type (e.g. document, script, stylesheet, image, xhr, fetch)"),
    },
    async ({ resourceType }) => {
      await client.ensureBrowser();
      try {
        const { collector } = getCollector(client);
        const requests = collector.getRequests(resourceType);
        return formatResponse({
          count: requests.length,
          requests,
        });
      } catch (err) {
        return formatError(`list_network_requests failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  /**
   * get_network_request — Return full request/response details for a specific request.
   */
  server.tool(
    "get_network_request",
    "Get full details for a specific network request including headers and response body",
    {
      requestId: z.string().describe("The request ID (e.g. req_1)"),
    },
    async ({ requestId }) => {
      await client.ensureBrowser();
      try {
        const { collector } = getCollector(client);
        const request = collector.getRequest(requestId);
        if (!request) {
          return formatError(`Request ${requestId} not found. Use list_network_requests to see available requests.`);
        }
        return formatResponse(request);
      } catch (err) {
        return formatError(`get_network_request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
