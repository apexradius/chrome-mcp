import type { SerializedAXNode } from "puppeteer-core";
import type { ChromeClient } from "../chrome/client.js";

/**
 * Snapshot data stored per page.
 */
export interface SnapshotData {
  text: string;
  uidMap: Map<string, SerializedAXNode>;
}

// Per-page snapshot storage keyed by page ID
const snapshotStore = new Map<number, SnapshotData>();

/**
 * Store a snapshot for a tracked page.
 */
export function storeSnapshot(pageId: number, data: SnapshotData): void {
  snapshotStore.set(pageId, data);
}

/**
 * Retrieve the stored snapshot for a tracked page.
 */
export function getSnapshot(pageId: number): SnapshotData | undefined {
  return snapshotStore.get(pageId);
}

/**
 * Clear stored snapshot for a page (e.g., on close).
 */
export function clearSnapshot(pageId: number): void {
  snapshotStore.delete(pageId);
}
