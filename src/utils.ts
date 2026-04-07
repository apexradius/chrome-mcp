import type { Page } from "puppeteer-core";
import type { ChromeClient } from "./chrome/client.js";

export type CallToolResult = { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean };

export function formatResponse(data: unknown): CallToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function formatError(message: string): CallToolResult {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export async function withPage(
  client: ChromeClient,
  fn: (context: ReturnType<ChromeClient["getPage"]>) => Promise<CallToolResult>
): Promise<CallToolResult> {
  await client.ensureBrowser();
  const pageInfo = client.getPage();
  const guard = await client.getTabMutex(pageInfo.id).acquire();
  try {
    return await fn(pageInfo);
  } catch (err) {
    return formatError(err instanceof Error ? err.message : String(err));
  } finally {
    guard.dispose();
  }
}

export async function withBrowser(
  client: ChromeClient,
  fn: (context: { client: ChromeClient }) => Promise<CallToolResult>
): Promise<CallToolResult> {
  await client.ensureBrowser();
  const guard = await client.getBrowserMutex().acquire();
  try {
    return await fn({ client });
  } catch (err) {
    return formatError(err instanceof Error ? err.message : String(err));
  } finally {
    guard.dispose();
  }
}
