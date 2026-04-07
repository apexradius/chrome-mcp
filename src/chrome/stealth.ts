import type { Page } from "puppeteer-core";

/**
 * Stealth patches injected via page.evaluateOnNewDocument().
 * These run before any page script, making the browser appear non-automated.
 * No Chrome flags needed = no warning banners.
 */
export const stealthScripts: Array<{ name: string; script: string }> = [
  {
    name: "webdriver",
    script: `
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      });
    `,
  },
  {
    name: "chrome.runtime",
    script: `
      if (!window.chrome) {
        Object.defineProperty(window, 'chrome', { value: {}, writable: true, configurable: true });
      }
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          connect: function() { return { onMessage: { addListener: function() {} }, postMessage: function() {} }; },
          sendMessage: function(_msg, _opts, cb) { if (cb) cb(); },
          onMessage: { addListener: function() {}, removeListener: function() {} },
          id: undefined,
        };
      }
    `,
  },
  {
    name: "plugins",
    script: `
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
          ];
          plugins.refresh = function() {};
          plugins.item = function(i) { return this[i] || null; };
          plugins.namedItem = function(name) { return this.find(p => p.name === name) || null; };
          Object.setPrototypeOf(plugins, PluginArray.prototype);
          return plugins;
        },
        configurable: true,
      });
    `,
  },
  {
    name: "languages",
    script: `
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });
    `,
  },
  {
    name: "permissions",
    script: `
      const originalQuery = Permissions.prototype.query;
      Permissions.prototype.query = function(parameters) {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery.call(this, parameters);
      };
    `,
  },
];

/**
 * Apply all stealth patches to a page.
 * Must be called before any navigation so scripts run via evaluateOnNewDocument.
 */
export async function applyStealth(page: Page): Promise<void> {
  for (const { script } of stealthScripts) {
    await page.evaluateOnNewDocument(script);
  }
}
