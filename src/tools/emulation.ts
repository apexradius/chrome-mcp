import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";
import { KnownDevices } from "puppeteer-core";

/**
 * Register emulation tools on the MCP server.
 */
export function registerEmulationTools(server: McpServer, client: ChromeClient): void {
  /**
   * emulate — Apply device emulation, user agent, color scheme, or geolocation.
   */
  server.tool(
    "emulate",
    "Apply emulation settings: device preset, user agent, color scheme, or geolocation",
    {
      device: z.string().optional().describe("Device name to emulate (e.g. 'iPhone 14', 'Pixel 5')"),
      userAgent: z.string().optional().describe("Custom user agent string"),
      colorScheme: z.enum(["light", "dark", "no-preference"]).optional().describe("Preferred color scheme"),
      geolocation: z
        .object({
          latitude: z.number().describe("Latitude"),
          longitude: z.number().describe("Longitude"),
        })
        .optional()
        .describe("Geolocation coordinates to emulate"),
    },
    async ({ device, userAgent, colorScheme, geolocation }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        const applied: string[] = [];

        // Apply device emulation
        if (device) {
          const deviceDescriptor = KnownDevices[device as keyof typeof KnownDevices];
          if (!deviceDescriptor) {
            const available = Object.keys(KnownDevices).slice(0, 20).join(", ");
            return formatError(
              `Unknown device "${device}". Some available devices: ${available}...`
            );
          }
          await page.emulate(deviceDescriptor);
          applied.push(`device: ${device}`);
        }

        // Apply custom user agent
        if (userAgent) {
          await page.setUserAgent(userAgent);
          applied.push(`userAgent: ${userAgent}`);
        }

        // Apply color scheme
        if (colorScheme) {
          await page.emulateMediaFeatures([
            { name: "prefers-color-scheme", value: colorScheme },
          ]);
          applied.push(`colorScheme: ${colorScheme}`);
        }

        // Apply geolocation
        if (geolocation) {
          const context = page.browserContext();
          await context.overridePermissions(page.url() || "https://example.com", [
            "geolocation",
          ]);
          await page.setGeolocation({
            latitude: geolocation.latitude,
            longitude: geolocation.longitude,
          });
          applied.push(`geolocation: ${geolocation.latitude}, ${geolocation.longitude}`);
        }

        if (applied.length === 0) {
          return formatError("No emulation settings provided. Specify at least one of: device, userAgent, colorScheme, geolocation.");
        }

        return formatResponse({
          success: true,
          applied,
        });
      } catch (err) {
        return formatError(`emulate failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * resize_page — Resize the viewport of the current page.
   */
  server.tool(
    "resize_page",
    "Resize the viewport of the current page to a specific width and height",
    {
      width: z.number().describe("Viewport width in pixels"),
      height: z.number().describe("Viewport height in pixels"),
    },
    async ({ width, height }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        await page.setViewport({ width, height });
        return formatResponse({
          success: true,
          viewport: { width, height },
        });
      } catch (err) {
        return formatError(`resize_page failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        guard.dispose();
      }
    }
  );
}
