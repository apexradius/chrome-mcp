import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KeyInput } from "puppeteer-core";
import type { ChromeClient } from "../chrome/client.js";
import { formatResponse, formatError } from "../utils.js";
import { getSnapshot } from "../browser/page-state.js";

/**
 * Resolve a UID ref to an ElementHandle from the stored snapshot.
 * Caller MUST dispose the returned handle in a finally block.
 */
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

  return handle;
}

/**
 * Register interaction tools on the MCP server.
 */
export function registerInteractionTools(
  server: McpServer,
  client: ChromeClient
): void {
  /**
   * click — Click an element by ref UID from the last snapshot.
   */
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
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      let handle;
      try {
        handle = await resolveRef(id, ref);
        await handle.click({ count: dblClick ? 2 : 1 });
        // Brief wait for navigation / DOM updates
        await new Promise((resolve) => setTimeout(resolve, 100));
        return formatResponse({
          success: true,
          url: page.url(),
          title: await page.title(),
        });
      } catch (err) {
        return formatError(
          `click failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        await handle?.dispose();
        guard.dispose();
      }
    }
  );

  /**
   * fill — Fill an input, textarea, or select element.
   */
  server.tool(
    "fill",
    "Fill an input, textarea, or select element identified by ref UID",
    {
      ref: z.string().describe("The element UID from the snapshot"),
      value: z.string().describe("The value to fill"),
    },
    async ({ ref, value }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      let handle;
      try {
        handle = await resolveRef(id, ref);
        const snapshot = getSnapshot(id)!;
        const node = snapshot.uidMap.get(ref)!;

        // Check if this is a select / combobox with options
        if (
          node.role === "combobox" ||
          node.role === "listbox" ||
          node.role === "select"
        ) {
          // Try to select the matching option via page.select()
          const tagName = await handle.evaluate(
            (el: Element) => el.tagName.toLowerCase()
          );
          if (tagName === "select") {
            await handle.select(value);
            return formatResponse({ success: true, ref, value });
          }
        }

        // For regular inputs/textareas: triple-click to select all, then type
        await handle.click({ count: 3 });
        const timeout = 5000 + value.length * 10;
        await handle.type(value, { delay: 10 });

        // Wait for value to settle
        await page.waitForFunction(
          (expectedLen: number) => true,
          { timeout },
          value.length
        );

        return formatResponse({ success: true, ref, value });
      } catch (err) {
        return formatError(
          `fill failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        await handle?.dispose();
        guard.dispose();
      }
    }
  );

  /**
   * type_text — Type text character-by-character into the currently focused element.
   */
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
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        await page.keyboard.type(text, { delay });
        return formatResponse({ success: true, typed: text.length });
      } catch (err) {
        return formatError(
          `type_text failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * hover — Hover over an element by ref UID.
   */
  server.tool(
    "hover",
    "Hover over an element identified by its ref UID from the last snapshot",
    {
      ref: z.string().describe("The element UID from the snapshot"),
    },
    async ({ ref }) => {
      await client.ensureBrowser();
      const { id } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      let handle;
      try {
        handle = await resolveRef(id, ref);
        await handle.hover();
        return formatResponse({ success: true, ref });
      } catch (err) {
        return formatError(
          `hover failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        await handle?.dispose();
        guard.dispose();
      }
    }
  );

  /**
   * press_key — Press a keyboard key or key combination.
   */
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
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        await page.keyboard.press(key as KeyInput);
        return formatResponse({ success: true, key });
      } catch (err) {
        return formatError(
          `press_key failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * drag — Drag from one element to another.
   */
  server.tool(
    "drag",
    "Drag from a source element to a target element using mouse down/move/up",
    {
      sourceRef: z.string().describe("The source element UID from the snapshot"),
      targetRef: z.string().describe("The target element UID from the snapshot"),
    },
    async ({ sourceRef, targetRef }) => {
      await client.ensureBrowser();
      const { id, page } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      let sourceHandle;
      let targetHandle;
      try {
        sourceHandle = await resolveRef(id, sourceRef);
        targetHandle = await resolveRef(id, targetRef);

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

        // Mouse down on source, move to target, mouse up
        await page.mouse.move(sourceCenter.x, sourceCenter.y);
        await page.mouse.down();
        await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 10 });
        await page.mouse.up();

        return formatResponse({
          success: true,
          sourceRef,
          targetRef,
        });
      } catch (err) {
        return formatError(
          `drag failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        await sourceHandle?.dispose();
        await targetHandle?.dispose();
        guard.dispose();
      }
    }
  );

  /**
   * upload_file — Upload files through a file input element.
   */
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
      await client.ensureBrowser();
      const { id } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      let handle;
      try {
        handle = await resolveRef(id, ref);
        // uploadFile expects an HTMLInputElement handle
        await (handle as import("puppeteer-core").ElementHandle<HTMLInputElement>).uploadFile(
          ...files
        );
        return formatResponse({
          success: true,
          ref,
          filesUploaded: files.length,
        });
      } catch (err) {
        return formatError(
          `upload_file failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        await handle?.dispose();
        guard.dispose();
      }
    }
  );

  /**
   * handle_dialog — Handle the last captured dialog (alert, confirm, prompt).
   */
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
      await client.ensureBrowser();
      const { id, lastDialog } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      try {
        if (!lastDialog) {
          return formatError(
            "No dialog has been captured on this page. Dialogs are auto-dismissed — call handle_dialog immediately after the action that triggers the dialog."
          );
        }

        // If the dialog was already auto-dismissed, report that
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

        // Try to handle it manually
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
      } catch (err) {
        return formatError(
          `handle_dialog failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        guard.dispose();
      }
    }
  );

  /**
   * fill_form — Fill multiple form fields at once.
   */
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
      await client.ensureBrowser();
      const { id } = client.getPage();
      const guard = await client.getTabMutex(id).acquire();
      let filledCount = 0;
      const errors: string[] = [];

      try {
        for (const field of fields) {
          let handle;
          try {
            handle = await resolveRef(id, field.ref);
            const snapshot = getSnapshot(id)!;
            const node = snapshot.uidMap.get(field.ref)!;

            // Handle select elements
            if (
              node.role === "combobox" ||
              node.role === "listbox" ||
              node.role === "select"
            ) {
              const tagName = await handle.evaluate(
                (el: Element) => el.tagName.toLowerCase()
              );
              if (tagName === "select") {
                await handle.select(field.value);
                filledCount++;
                continue;
              }
            }

            // Regular input: triple-click to select, then type
            await handle.click({ count: 3 });
            await handle.type(field.value, { delay: 10 });
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
      } catch (err) {
        return formatError(
          `fill_form failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        guard.dispose();
      }
    }
  );
}
