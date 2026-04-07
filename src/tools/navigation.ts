import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";

/**
 * Register navigation tools on the MCP server.
 */
export function registerNavigationTools(server: McpServer, client: ChromeClient): void {
  /**
   * navigate — Navigate the selected page to a URL.
   */
  server.tool(
    "navigate",
    "Navigate the selected page to a URL",
    { url: z.string().describe("The URL to navigate to") },
    async ({ url }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        return formatResponse({ url: page.url(), title: await page.title() });
      } catch (err) {
        return formatError(`Navigation failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * new_page — Create a new tab, optionally navigate to a URL.
   */
  server.tool(
    "new_page",
    "Create a new browser tab, optionally navigate to a URL",
    { url: z.string().optional().describe("URL to navigate the new tab to") },
    async ({ url }) => {
      const browser = await client.ensureBrowser();
      const guard = await client.getBrowserMutex().acquire();
      try {
        const page = await browser.newPage();

        // Wait for the page to be tracked (the targetcreated listener handles it)
        // Find the page ID that was just assigned
        let pageId: number | null = null;
        for (const [id, tracked] of client.getPages()) {
          if (tracked.page === page) {
            pageId = id;
            break;
          }
        }

        if (pageId === null) {
          // The page may not have been tracked yet via the event; give it a moment
          await new Promise((resolve) => setTimeout(resolve, 100));
          for (const [id, tracked] of client.getPages()) {
            if (tracked.page === page) {
              pageId = id;
              break;
            }
          }
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
      } catch (err) {
        return formatError(`new_page failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * close_page — Close a tab by page ID. Cannot close the last remaining tab.
   */
  server.tool(
    "close_page",
    "Close a browser tab by page ID (cannot close the last tab)",
    { pageId: z.number().describe("The page ID to close") },
    async ({ pageId }) => {
      await client.ensureBrowser();
      const guard = await client.getBrowserMutex().acquire();
      try {
        if (client.getPages().size <= 1) {
          return formatError("Cannot close the last remaining tab.");
        }
        const { page } = client.getPage(pageId);
        await page.close();
        return formatResponse({ success: true, message: `Page ${pageId} closed.` });
      } catch (err) {
        return formatError(`close_page failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * list_pages — List all open tabs.
   */
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

  /**
   * select_page — Set the active tab by page ID.
   */
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

  /**
   * wait_for — Wait for text to appear or disappear on the page.
   */
  server.tool(
    "wait_for",
    "Wait for text to appear or disappear on the page",
    {
      text: z.string().describe("Text to wait for"),
      state: z.enum(["appear", "disappear"]).default("appear").describe("Wait for text to appear or disappear"),
      timeout: z.number().default(30000).describe("Timeout in milliseconds"),
    },
    async ({ text, state, timeout }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
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
      } catch (err) {
        return formatError(`wait_for timed out: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );
}
