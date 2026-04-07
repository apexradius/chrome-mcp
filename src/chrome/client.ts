import puppeteer, { type Browser, type Page, type Dialog } from "puppeteer-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findChrome } from "./finder.js";
import { ensureProfileDir, getProfileDir } from "./profile.js";
import { applyStealth } from "./stealth.js";
import { Mutex } from "../browser/mutex.js";
import { clearSnapshot } from "../browser/page-state.js";

interface DialogInfo {
  type: string;
  message: string;
  defaultValue: string;
  handled: boolean;
  dialog: Dialog;
}

interface TrackedPage {
  page: Page;
  lastDialog: DialogInfo | null;
}

/**
 * ChromeClient manages the browser lifecycle, page tracking, and concurrency.
 *
 * Key behaviors:
 * - Connect-or-launch: reuses an existing Chrome if DevToolsActivePort exists
 * - Stealth: injects anti-detection patches on every new page
 * - Per-tab mutexes: concurrent ops on different tabs, serialized on same tab
 * - Browser mutex: serialized structural ops (new_page, close_page)
 * - Dialog capture: auto-dismisses dialogs while storing them for retrieval
 */
export class ChromeClient {
  private browser: Browser | null = null;
  private launchedByUs = false;
  private pages: Map<number, TrackedPage> = new Map();
  private pageIdByRef = new WeakMap<Page, number>();
  private selectedPageId: number | null = null;
  private nextPageId = 1;
  private tabMutexes: Map<number, Mutex> = new Map();
  private browserMutex = new Mutex();

  async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    const profileDir = ensureProfileDir();

    // Try to connect to existing Chrome via DevToolsActivePort
    try {
      const portFile = join(profileDir, "DevToolsActivePort");
      const content = readFileSync(portFile, "utf8");
      const lines = content.split("\n");
      const port = lines[0]?.trim();
      const wsPath = lines[1]?.trim();

      if (port && wsPath) {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
          defaultViewport: null,
        });

        this.browser = browser;
        this.launchedByUs = false;
        this.setupBrowserListeners(browser);
        await this.trackExistingPages(browser);

        console.error("[chrome-mcp] Connected to existing Chrome instance");
        return browser;
      }
    } catch {
      // DevToolsActivePort not found or connection failed -- launch new
    }

    const headless = process.env.CHROME_HEADLESS === "true";
    const executablePath = findChrome();

    const browser = await puppeteer.launch({
      executablePath,
      userDataDir: profileDir,
      defaultViewport: null,
      pipe: true,
      headless,
      args: ["--hide-crash-restore-bubble"],
      ignoreDefaultArgs: [
        "--enable-automation",
        "--disable-extensions",
        "--use-mock-keychain",
        "--disable-sync",
      ],
    });

    this.browser = browser;
    this.launchedByUs = true;
    this.setupBrowserListeners(browser);
    await this.trackExistingPages(browser);

    console.error("[chrome-mcp] Launched new Chrome instance");
    return browser;
  }

  private setupBrowserListeners(browser: Browser): void {
    browser.on("targetcreated", async (target) => {
      if (target.type() === "page") {
        const page = await target.page();
        if (page) {
          await this.trackPage(page);
        }
      }
    });

    browser.on("disconnected", () => {
      console.error("[chrome-mcp] Browser disconnected");
      this.browser = null;
      this.pages.clear();
      this.tabMutexes.clear();
      this.selectedPageId = null;
    });
  }

  private async trackExistingPages(browser: Browser): Promise<void> {
    const existingPages = await browser.pages();
    for (const page of existingPages) {
      await this.trackPage(page);
    }
  }

  private async trackPage(page: Page): Promise<number> {
    // O(1) lookup via WeakMap instead of linear scan
    const existingId = this.pageIdByRef.get(page);
    if (existingId !== undefined) {
      return existingId;
    }

    const pageId = this.nextPageId++;

    await applyStealth(page);

    const trackedPage: TrackedPage = { page, lastDialog: null };

    page.on("dialog", async (dialog: Dialog) => {
      trackedPage.lastDialog = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        handled: false,
        dialog,
      };
      try {
        await dialog.dismiss();
        trackedPage.lastDialog.handled = true;
      } catch {
        // Dialog may already be handled
      }
    });

    page.on("close", () => {
      this.pages.delete(pageId);
      this.tabMutexes.delete(pageId);
      clearSnapshot(pageId);
      if (this.selectedPageId === pageId) {
        const ids = Array.from(this.pages.keys());
        this.selectedPageId = ids.length > 0 ? ids[ids.length - 1]! : null;
      }
    });

    this.pages.set(pageId, trackedPage);
    this.pageIdByRef.set(page, pageId);
    this.tabMutexes.set(pageId, new Mutex());

    if (this.selectedPageId === null) {
      this.selectedPageId = pageId;
    }

    return pageId;
  }

  getPage(pageId?: number): { id: number; page: Page; lastDialog: DialogInfo | null } {
    if (pageId !== undefined) {
      const tracked = this.pages.get(pageId);
      if (!tracked) {
        throw new Error(`Page ${pageId} not found. Use list_pages to see available pages.`);
      }
      return { id: pageId, page: tracked.page, lastDialog: tracked.lastDialog };
    }

    if (this.selectedPageId === null) {
      throw new Error("No pages open. Use new_page to create one.");
    }

    const tracked = this.pages.get(this.selectedPageId);
    if (!tracked) {
      throw new Error("Selected page no longer exists. Use list_pages to see available pages.");
    }

    return { id: this.selectedPageId, page: tracked.page, lastDialog: tracked.lastDialog };
  }

  /**
   * O(1) lookup of page ID by Page reference, using a WeakMap.
   * Returns null if the page is not tracked.
   */
  findPageId(page: Page): number | null {
    return this.pageIdByRef.get(page) ?? null;
  }

  getTabMutex(pageId: number): Mutex {
    let mutex = this.tabMutexes.get(pageId);
    if (!mutex) {
      mutex = new Mutex();
      this.tabMutexes.set(pageId, mutex);
    }
    return mutex;
  }

  getBrowserMutex(): Mutex {
    return this.browserMutex;
  }

  getPages(): Map<number, TrackedPage> {
    return this.pages;
  }

  getSelectedPageId(): number | null {
    return this.selectedPageId;
  }

  setSelectedPageId(pageId: number): void {
    if (!this.pages.has(pageId)) {
      throw new Error(`Page ${pageId} not found.`);
    }
    this.selectedPageId = pageId;
  }

  getProfileDir(): string {
    return getProfileDir();
  }

  /**
   * If we launched Chrome, close it. If we connected, just disconnect.
   */
  async shutdown(): Promise<void> {
    if (!this.browser) return;

    try {
      if (this.launchedByUs) {
        console.error("[chrome-mcp] Closing Chrome (launched by us)");
        await this.browser.close();
      } else {
        console.error("[chrome-mcp] Disconnecting from Chrome (not launched by us)");
        this.browser.disconnect();
      }
    } catch {
      // Browser may already be closed
    }

    this.browser = null;
    this.pages.clear();
    this.tabMutexes.clear();
    this.selectedPageId = null;
  }
}
