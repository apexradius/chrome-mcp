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
  {
    name: "webgl",
    script: `
      const getParamProto = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(param) {
        const UNMASKED_VENDOR_WEBGL = 0x9245;
        const UNMASKED_RENDERER_WEBGL = 0x9246;
        if (param === UNMASKED_VENDOR_WEBGL) return 'Google Inc. (Apple)';
        if (param === UNMASKED_RENDERER_WEBGL) return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
        return getParamProto.call(this, param);
      };
    `,
  },
  {
    name: "canvas-fingerprint",
    script: `
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        const ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          try {
            const pixel = ctx.getImageData(0, 0, 1, 1);
            pixel.data[0] = (pixel.data[0] + ((Math.random() * 2) | 0)) & 0xff;
            ctx.putImageData(pixel, 0, 0);
          } catch (e) { /* cross-origin canvas */ }
        }
        return origToDataURL.call(this, type, quality);
      };
    `,
  },
  {
    name: "connection",
    script: `
      if (!navigator.connection) {
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false,
          }),
          configurable: true,
        });
      }
    `,
  },
  {
    name: "hardwareConcurrency",
    script: `
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
      });
    `,
  },
  {
    name: "deviceMemory",
    script: `
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: true,
      });
    `,
  },
  {
    name: "screen",
    script: `
      ['width', 'height', 'availWidth', 'availHeight'].forEach((prop, i) => {
        const vals = [1920, 1080, 1920, 1080];
        Object.defineProperty(screen, prop, {
          get: () => vals[i],
          configurable: true,
        });
      });
    `,
  },
  {
    name: "headless-ua",
    script: `
      if (navigator.userAgent.includes('Headless')) {
        Object.defineProperty(navigator, 'userAgent', {
          get: () => navigator.userAgent.replace(/Headless/g, ''),
          configurable: true,
        });
      }
    `,
  },
  {
    name: "chrome-loadTimes-csi",
    script: `
      if (!window.chrome) {
        Object.defineProperty(window, 'chrome', { value: {}, writable: true, configurable: true });
      }
      if (!window.chrome.loadTimes) {
        window.chrome.loadTimes = function() {
          return {
            commitLoadTime: Date.now() / 1000 - 1.5,
            connectionInfo: 'h2',
            finishDocumentLoadTime: Date.now() / 1000 - 0.5,
            finishLoadTime: Date.now() / 1000 - 0.1,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000 - 0.8,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'h2',
            requestTime: Date.now() / 1000 - 2.0,
            startLoadTime: Date.now() / 1000 - 1.8,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true,
          };
        };
      }
      if (!window.chrome.csi) {
        window.chrome.csi = function() {
          return {
            onloadT: Date.now(),
            pageT: performance.now(),
            startE: Date.now() - performance.now(),
            tran: 15,
          };
        };
      }
    `,
  },
  {
    name: "iframe-contentWindow",
    script: `
      const origGetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')?.get;
      if (origGetter) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            const win = origGetter.call(this);
            if (win) {
              try {
                // Test access — if cross-origin, the proxy won't help
                void win.self;
              } catch {
                return win;
              }
              // Mask the 'chrome' property detection on same-origin iframes
              if (!win.chrome) {
                try {
                  Object.defineProperty(win, 'chrome', { value: window.chrome, writable: true, configurable: true });
                } catch { /* sandboxed */ }
              }
            }
            return win;
          },
          configurable: true,
        });
      }
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
