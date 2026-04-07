import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";
import { ConsoleCollector } from "../collectors/console-collector.js";
import { CollectorManager } from "../browser/collector-manager.js";

const managers = new CollectorManager<ConsoleCollector>();

export function registerConsoleTools(server: McpServer, client: ChromeClient): void {
  server.tool(
    "list_console_messages",
    "List all captured console messages for the current page with optional type filter",
    {
      type: z.enum(["log", "error", "warn", "info"]).optional().describe("Filter by message type"),
    },
    async ({ type }) => {
      await client.ensureBrowser();
      try {
        const { collector } = managers.get(client, (page) => new ConsoleCollector(page));
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

  server.tool(
    "get_console_message",
    "Get full details for a specific console message by ID",
    {
      messageId: z.string().describe("The message ID (e.g. msg_1)"),
    },
    async ({ messageId }) => {
      await client.ensureBrowser();
      try {
        const { collector } = managers.get(client, (page) => new ConsoleCollector(page));
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
