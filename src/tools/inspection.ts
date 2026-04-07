import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";
import { captureSnapshot } from "../browser/snapshot.js";
import { storeSnapshot } from "../browser/page-state.js";

/**
 * Register inspection tools on the MCP server.
 */
export function registerInspectionTools(server: McpServer, client: ChromeClient): void {
  /**
   * take_screenshot — Capture a screenshot of the current page.
   */
  server.tool(
    "take_screenshot",
    "Capture a screenshot of the current page as a PNG image",
    {
      fullPage: z.boolean().default(false).describe("Capture the full scrollable page"),
    },
    async ({ fullPage }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        const buffer = await page.screenshot({
          type: "png",
          fullPage,
          encoding: "base64",
        });
        const base64 = typeof buffer === "string" ? buffer : Buffer.from(buffer).toString("base64");
        return {
          content: [
            {
              type: "image" as const,
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (err) {
        return formatError(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * take_snapshot — Capture the accessibility tree (a11y snapshot) of the current page.
   */
  server.tool(
    "take_snapshot",
    "Capture the accessibility tree of the current page as structured YAML text",
    {
      verbose: z.boolean().default(false).describe("Include additional node details"),
    },
    async ({ verbose: _verbose }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        const snapshot = await captureSnapshot(page);
        storeSnapshot(id, snapshot);
        return formatResponse({ snapshot: snapshot.text, nodeCount: snapshot.uidMap.size });
      } catch (err) {
        return formatError(`Snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * evaluate_script — Evaluate a JavaScript expression in the page context.
   */
  server.tool(
    "evaluate_script",
    "Evaluate a JavaScript expression in the current page context and return the result",
    {
      expression: z.string().describe("JavaScript expression to evaluate"),
    },
    async ({ expression }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = await page.evaluate(expression);
        return formatResponse({ result });
      } catch (err) {
        return formatError(`Evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );
}
