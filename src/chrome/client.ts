import puppeteer, { type Browser, type Page, type Dialog } from "puppeteer-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findChrome } from "./finder.js";
import { ensureProfileDir, getProfileDir } from "./profile.js";
import { applyStealth } from "./stealth.js";
import { Mutex } from "../browser/mutex.js";

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
  private selectedPageId: number | null = null;
  private nextPageId = 1;
  private tabMutexes: Map<number, Mutex> = new Map();
  private browserMutex = new Mutex();

  /**
   * Ensure the browser is running. Connect to existing or launch new.
   */
  async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    const profileDir = ensureProfileDir();

    // Strategy 1: Try to connect to existing Chrome via DevToolsActivePort
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
      // DevToolsActivePort not found or connection failed — launch new
    }

    // Strategy 2: Launch new Chrome
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

  /**
   * Set up browser-level event listeners.
   */
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

  /**
   * Track all pages that already exist when we connect/launch.
   */
  private async trackExistingPages(browser: Browser): Promise<void> {
    const existingPages = await browser.pages();
    for (const page of existingPages) {
      await this.trackPage(page);
    }
  }

  /**
   * Track a page: assign an ID, set up stealth, dialog handler, and cleanup.
   */
  private async trackPage(page: Page): Promise<number> {
    // Check if this page is already tracked
    for (const [id, tracked] of this.pages) {
      if (tracked.page === page) {
        return id;
      }
    }

    const pageId = this.nextPageId++;

    // Apply stealth patches
    await applyStealth(page);

    // Set up dialog handler
    const trackedPage: TrackedPage = { page, lastDialog: null };

    page.on("dialog", async (dialog: Dialog) => {
      trackedPage.lastDialog = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        handled: false,
        dialog,
      };
      // Auto-dismiss to unblock the page
      try {
        await dialog.dismiss();
        trackedPage.lastDialog.handled = true;
      } catch {
        // Dialog may already be handled
      }
    });

    // Clean up on page close
    page.on("close", () => {
      this.pages.delete(pageId);
      this.tabMutexes.delete(pageId);
      if (this.selectedPageId === pageId) {
        // Select the most recent remaining page
        const ids = Array.from(this.pages.keys());
        this.selectedPageId = ids.length > 0 ? ids[ids.length - 1]! : null;
      }
    });

    this.pages.set(pageId, trackedPage);
    this.tabMutexes.set(pageId, new Mutex());

    // Auto-select if this is the first page
    if (this.selectedPageId === null) {
      this.selectedPageId = pageId;
    }

    return pageId;
  }

  /**
   * Get a specific page by ID, or the currently selected page.
   */
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
   * Get the tab mutex for a specific page.
   */
  getTabMutex(pageId: number): Mutex {
    let mutex = this.tabMutexes.get(pageId);
    if (!mutex) {
      mutex = new Mutex();
      this.tabMutexes.set(pageId, mutex);
    }
    return mutex;
  }

  /**
   * Get the browser-level mutex for structural operations.
   */
  getBrowserMutex(): Mutex {
    return this.browserMutex;
  }

  /**
   * Get all tracked pages.
   */
  getPages(): Map<number, TrackedPage> {
    return this.pages;
  }

  /**
   * Get the selected page ID.
   */
  getSelectedPageId(): number | null {
    return this.selectedPageId;
  }

  /**
   * Set the selected page ID.
   */
  setSelectedPageId(pageId: number): void {
    if (!this.pages.has(pageId)) {
      throw new Error(`Page ${pageId} not found.`);
    }
    this.selectedPageId = pageId;
  }

  /**
   * Get the profile directory path.
   */
  getProfileDir(): string {
    return getProfileDir();
  }

  /**
   * Shut down the browser.
   * If we launched it, close it. If we connected, just disconnect.
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
