import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElementHandle, KeyInput, SerializedAXNode } from "puppeteer-core";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError, withPage } from "../utils.js";
import { getSnapshot } from "../browser/page-state.js";

async function resolveRef(pageId: number, ref: string) {
  const snapshot = getSnapshot(pageId);
  if (!snapshot) {
    throw new Error("No snapshot available. Use take_snapshot first.");
  }

  const node = snapshot.uidMap.get(ref);
  if (!node) {
    throw new Error(
      `Element ref "${ref}" not found in snapshot. Use take_snapshot to refresh.`
    );
  }

  const handle = await node.elementHandle();
  if (!handle) {
    throw new Error(
      `Could not get element handle for ref "${ref}". The element may have been removed from the DOM. Use take_snapshot to refresh.`
    );
  }

  return { handle, node };
}

/**
 * Fill a single element, handling both select elements and regular inputs.
 */
async function fillElement(handle: ElementHandle, node: SerializedAXNode, value: string): Promise<void> {
  if (
    node.role === "combobox" ||
    node.role === "listbox" ||
    node.role === "select"
  ) {
    const tagName = await handle.evaluate(
      (el: Element) => el.tagName.toLowerCase()
    );
    if (tagName === "select") {
      await handle.select(value);
      return;
    }
  }

  // For regular inputs/textareas: triple-click to select all, then type
  await handle.click({ count: 3 });
  await handle.type(value, { delay: 10 });
}

export function registerInteractionTools(
  server: McpServer,
  client: ChromeClient
): void {
  server.tool(
    "click",
    "Click an element identified by its ref UID from the last snapshot",
    {
      ref: z.string().describe("The element UID (e.g. e5) from the snapshot"),
      dblClick: z
        .boolean()
        .default(false)
        .describe("Double-click instead of single click"),
    },
    async ({ ref, dblClick }) => {
      return withPage(client, async ({ id, page }) => {
        const { handle } = await resolveRef(id, ref);
        try {
          await handle.click({ count: dblClick ? 2 : 1 });
          await new Promise((resolve) => setTimeout(resolve, 100));
          return formatResponse({
            success: true,
            url: page.url(),
            title: await page.title(),
          });
        } finally {
          await handle.dispose();
        }
      });
    }
  );

  server.tool(
    "fill",
    "Fill an input, textarea, or select element identified by ref UID",
    {
      ref: z.string().describe("The element UID from the snapshot"),
      value: z.string().describe("The value to fill"),
    },
    async ({ ref, value }) => {
      return withPage(client, async ({ id }) => {
        const { handle, node } = await resolveRef(id, ref);
        try {
          await fillElement(handle, node, value);
          return formatResponse({ success: true, ref, value });
        } finally {
          await handle.dispose();
        }
      });
    }
  );

  server.tool(
    "type_text",
    "Type text character-by-character into the currently focused element (no ref needed)",
    {
      text: z.string().describe("The text to type"),
      delay: z
        .number()
        .default(50)
        .describe("Delay between keystrokes in milliseconds"),
    },
    async ({ text, delay }) => {
      return withPage(client, async ({ page }) => {
        await page.keyboard.type(text, { delay });
        return formatResponse({ success: true, typed: text.length });
      });
    }
  );

  server.tool(
    "hover",
    "Hover over an element identified by its ref UID from the last snapshot",
    {
      ref: z.string().describe("The element UID from the snapshot"),
    },
    async ({ ref }) => {
      return withPage(client, async ({ id }) => {
        const { handle } = await resolveRef(id, ref);
        try {
          await handle.hover();
          return formatResponse({ success: true, ref });
        } finally {
          await handle.dispose();
        }
      });
    }
  );

  server.tool(
    "press_key",
    "Press a keyboard key or combination (e.g. Enter, Control+A, Backspace)",
    {
      key: z
        .string()
        .describe(
          'Key or key combo to press (e.g. "Enter", "Control+A", "Backspace")'
        ),
    },
    async ({ key }) => {
      return withPage(client, async ({ page }) => {
        await page.keyboard.press(key as KeyInput);
        return formatResponse({ success: true, key });
      });
    }
  );

  server.tool(
    "drag",
    "Drag from a source element to a target element using mouse down/move/up",
    {
      sourceRef: z.string().describe("The source element UID from the snapshot"),
      targetRef: z.string().describe("The target element UID from the snapshot"),
    },
    async ({ sourceRef, targetRef }) => {
      return withPage(client, async ({ id, page }) => {
        const { handle: sourceHandle } = await resolveRef(id, sourceRef);
        const { handle: targetHandle } = await resolveRef(id, targetRef);
        try {
          const sourceBox = await sourceHandle.boundingBox();
          const targetBox = await targetHandle.boundingBox();

          if (!sourceBox || !targetBox) {
            return formatError(
              "Could not determine bounding box for source or target element."
            );
          }

          const sourceCenter = {
            x: sourceBox.x + sourceBox.width / 2,
            y: sourceBox.y + sourceBox.height / 2,
          };
          const targetCenter = {
            x: targetBox.x + targetBox.width / 2,
            y: targetBox.y + targetBox.height / 2,
          };

          await page.mouse.move(sourceCenter.x, sourceCenter.y);
          await page.mouse.down();
          await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 10 });
          await page.mouse.up();

          return formatResponse({
            success: true,
            sourceRef,
            targetRef,
          });
        } finally {
          await sourceHandle.dispose();
          await targetHandle.dispose();
        }
      });
    }
  );

  server.tool(
    "upload_file",
    "Upload files through a file input element identified by ref UID",
    {
      ref: z.string().describe("The file input element UID from the snapshot"),
      files: z
        .array(z.string())
        .describe("Array of absolute file paths to upload"),
    },
    async ({ ref, files }) => {
      return withPage(client, async ({ id }) => {
        const { handle } = await resolveRef(id, ref);
        try {
          await (handle as import("puppeteer-core").ElementHandle<HTMLInputElement>).uploadFile(
            ...files
          );
          return formatResponse({
            success: true,
            ref,
            filesUploaded: files.length,
          });
        } finally {
          await handle.dispose();
        }
      });
    }
  );

  server.tool(
    "handle_dialog",
    "Handle the last captured dialog (alert, confirm, prompt) on the current page",
    {
      action: z
        .enum(["accept", "dismiss"])
        .describe("Accept or dismiss the dialog"),
      promptText: z
        .string()
        .optional()
        .describe("Text to enter into a prompt dialog before accepting"),
    },
    async ({ action, promptText }) => {
      return withPage(client, async ({ lastDialog }) => {
        if (!lastDialog) {
          return formatError(
            "No dialog has been captured on this page. Dialogs are auto-dismissed — call handle_dialog immediately after the action that triggers the dialog."
          );
        }

        if (lastDialog.handled) {
          return formatResponse({
            success: true,
            dialogType: lastDialog.type,
            message: lastDialog.message,
            defaultValue: lastDialog.defaultValue,
            action: "auto-dismissed",
            note: "Dialog was auto-dismissed. To handle dialogs before auto-dismiss, use handle_dialog immediately after the triggering action.",
          });
        }

        try {
          if (action === "accept") {
            await lastDialog.dialog.accept(promptText);
          } else {
            await lastDialog.dialog.dismiss();
          }
          lastDialog.handled = true;
        } catch {
          // Dialog may already be handled
        }

        return formatResponse({
          success: true,
          dialogType: lastDialog.type,
          message: lastDialog.message,
          defaultValue: lastDialog.defaultValue,
          action,
        });
      });
    }
  );

  server.tool(
    "fill_form",
    "Fill multiple form fields at once using ref UIDs from the last snapshot",
    {
      fields: z
        .array(
          z.object({
            ref: z.string().describe("The element UID from the snapshot"),
            value: z.string().describe("The value to fill"),
          })
        )
        .describe("Array of { ref, value } pairs to fill"),
    },
    async ({ fields }) => {
      return withPage(client, async ({ id }) => {
        let filledCount = 0;
        const errors: string[] = [];

        for (const field of fields) {
          let handle;
          try {
            const resolved = await resolveRef(id, field.ref);
            handle = resolved.handle;
            await fillElement(handle, resolved.node, field.value);
            filledCount++;
          } catch (err) {
            errors.push(
              `ref ${field.ref}: ${err instanceof Error ? err.message : String(err)}`
            );
          } finally {
            await handle?.dispose();
          }
        }

        if (errors.length > 0) {
          return formatResponse({
            success: filledCount > 0,
            filled: filledCount,
            total: fields.length,
            errors,
          });
        }

        return formatResponse({
          success: true,
          filled: filledCount,
          total: fields.length,
        });
      });
    }
  );
}
