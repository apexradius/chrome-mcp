import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, withPage } from "../utils.js";
import { captureSnapshot } from "../browser/snapshot.js";
import { storeSnapshot } from "../browser/page-state.js";

export function registerInspectionTools(server: McpServer, client: ChromeClient): void {
  server.tool(
    "take_screenshot",
    "Capture a screenshot of the current page as a PNG image",
    {
      fullPage: z.boolean().default(false).describe("Capture the full scrollable page"),
    },
    async ({ fullPage }) => {
      return withPage(client, async ({ page }) => {
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
      });
    }
  );

  server.tool(
    "take_snapshot",
    "Capture the accessibility tree of the current page as structured YAML text",
    {
      verbose: z.boolean().default(false).describe("Include all nodes, not just interactive/interesting ones"),
    },
    async ({ verbose }) => {
      return withPage(client, async ({ id, page }) => {
        const snapshot = await captureSnapshot(page, { interestingOnly: !verbose });
        storeSnapshot(id, snapshot);
        return formatResponse({ snapshot: snapshot.text, nodeCount: snapshot.uidMap.size });
      });
    }
  );

  server.tool(
    "evaluate_script",
    "Evaluate a JavaScript expression in the current page context and return the result",
    {
      expression: z.string().describe("JavaScript expression to evaluate"),
    },
    async ({ expression }) => {
      return withPage(client, async ({ page }) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = await page.evaluate(expression);
        return formatResponse({ result });
      });
    }
  );
}
