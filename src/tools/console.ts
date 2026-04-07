import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";
import { ConsoleCollector } from "../collectors/console-collector.js";

// Per-page console collectors
const collectors = new Map<number, ConsoleCollector>();

function getCollector(client: ChromeClient): { id: number; collector: ConsoleCollector } {
  const { id, page } = client.getPage();
  let collector = collectors.get(id);
  if (!collector) {
    collector = new ConsoleCollector(page);
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
 * Register console monitoring tools on the MCP server.
 */
export function registerConsoleTools(server: McpServer, client: ChromeClient): void {
  /**
   * list_console_messages — Return all captured console messages.
   */
  server.tool(
    "list_console_messages",
    "List all captured console messages for the current page with optional type filter",
    {
      type: z.enum(["log", "error", "warn", "info"]).optional().describe("Filter by message type"),
    },
    async ({ type }) => {
      await client.ensureBrowser();
      try {
        const { collector } = getCollector(client);
        const messages = collector.getMessages(type);
        return formatResponse({
          count: messages.length,
          messages,
        });
      } catch (err) {
        return formatError(`list_console_messages failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  /**
   * get_console_message — Return full details for a specific console message.
   */
  server.tool(
    "get_console_message",
    "Get full details for a specific console message by ID",
    {
      messageId: z.string().describe("The message ID (e.g. msg_1)"),
    },
    async ({ messageId }) => {
      await client.ensureBrowser();
      try {
        const { collector } = getCollector(client);
        const message = collector.getMessage(messageId);
        if (!message) {
          return formatError(`Message ${messageId} not found. Use list_console_messages to see available messages.`);
        }
        return formatResponse(message);
      } catch (err) {
        return formatError(`get_console_message failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
