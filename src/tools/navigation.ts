import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError, withPage, withBrowser } from "../utils.js";

export function registerNavigationTools(server: McpServer, client: ChromeClient): void {
  server.tool(
    "navigate",
    "Navigate the selected page to a URL",
    { url: z.string().describe("The URL to navigate to") },
    async ({ url }) => {
      return withPage(client, async ({ page }) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        return formatResponse({ url: page.url(), title: await page.title() });
      });
    }
  );

  server.tool(
    "new_page",
    "Create a new browser tab, optionally navigate to a URL",
    { url: z.string().optional().describe("URL to navigate the new tab to") },
    async ({ url }) => {
      return withBrowser(client, async () => {
        const browser = await client.ensureBrowser();
        const page = await browser.newPage();

        // Find the page ID assigned by the targetcreated listener
        let pageId = client.findPageId(page);
        if (pageId === null) {
          // The targetcreated event may not have fired yet
          await new Promise((resolve) => setTimeout(resolve, 100));
          pageId = client.findPageId(page);
        }

        if (pageId === null) {
          return formatError("Failed to track new page.");
        }

        client.setSelectedPageId(pageId);

        if (url) {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        }

        return formatResponse({
          pageId,
          url: page.url(),
          title: await page.title(),
        });
      });
    }
  );

  server.tool(
    "close_page",
    "Close a browser tab by page ID (cannot close the last tab)",
    { pageId: z.number().describe("The page ID to close") },
    async ({ pageId }) => {
      return withBrowser(client, async () => {
        if (client.getPages().size <= 1) {
          return formatError("Cannot close the last remaining tab.");
        }
        const { page } = client.getPage(pageId);
        await page.close();
        return formatResponse({ success: true, message: `Page ${pageId} closed.` });
      });
    }
  );

  server.tool(
    "list_pages",
    "List all open browser tabs with their IDs, URLs, and titles",
    async () => {
      await client.ensureBrowser();
      const selectedId = client.getSelectedPageId();
      const pages: Array<{ pageId: number; url: string; title: string; selected: boolean }> = [];

      for (const [id, tracked] of client.getPages()) {
        let title = "";
        try {
          title = await tracked.page.title();
        } catch {
          title = "(unavailable)";
        }
        pages.push({
          pageId: id,
          url: tracked.page.url(),
          title,
          selected: id === selectedId,
        });
      }

      return formatResponse(pages);
    }
  );

  server.tool(
    "select_page",
    "Set the active/selected browser tab by page ID",
    { pageId: z.number().describe("The page ID to select") },
    async ({ pageId }) => {
      await client.ensureBrowser();
      try {
        client.setSelectedPageId(pageId);
        const { page } = client.getPage(pageId);
        await page.bringToFront();
        return formatResponse({ success: true, message: `Page ${pageId} selected.` });
      } catch (err) {
        return formatError(`select_page failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  server.tool(
    "wait_for",
    "Wait for text to appear or disappear on the page",
    {
      text: z.string().describe("Text to wait for"),
      state: z.enum(["appear", "disappear"]).default("appear").describe("Wait for text to appear or disappear"),
      timeout: z.number().default(30000).describe("Timeout in milliseconds"),
    },
    async ({ text, state, timeout }) => {
      return withPage(client, async ({ page }) => {
        if (state === "appear") {
          await page.waitForFunction(
            (t: string) => document.body?.innerText?.includes(t),
            { timeout },
            text
          );
        } else {
          await page.waitForFunction(
            (t: string) => !document.body?.innerText?.includes(t),
            { timeout },
            text
          );
        }
        return formatResponse({ success: true, text, state });
      });
    }
  );
}
