import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";
import { NetworkCollector } from "../collectors/network-collector.js";
import { CollectorManager } from "../browser/collector-manager.js";

const managers = new CollectorManager<NetworkCollector>();

export function registerNetworkTools(server: McpServer, client: ChromeClient): void {
  server.tool(
    "list_network_requests",
    "List all captured network requests for the current page with optional resource type filter",
    {
      resourceType: z.string().optional().describe("Filter by resource type (e.g. document, script, stylesheet, image, xhr, fetch)"),
    },
    async ({ resourceType }) => {
      await client.ensureBrowser();
      try {
        const { collector } = managers.get(client, (page) => new NetworkCollector(page));
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

  server.tool(
    "get_network_request",
    "Get full details for a specific network request including headers and response body",
    {
      requestId: z.string().describe("The request ID (e.g. req_1)"),
    },
    async ({ requestId }) => {
      await client.ensureBrowser();
      try {
        const { collector } = managers.get(client, (page) => new NetworkCollector(page));
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
