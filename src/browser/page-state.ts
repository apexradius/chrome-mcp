import type { SerializedAXNode } from "puppeteer-core";

export interface SnapshotData {
  text: string;
  uidMap: Map<string, SerializedAXNode>;
}

const snapshotStore = new Map<number, SnapshotData>();

export function storeSnapshot(pageId: number, data: SnapshotData): void {
  snapshotStore.set(pageId, data);
}

export function getSnapshot(pageId: number): SnapshotData | undefined {
  return snapshotStore.get(pageId);
}

export function clearSnapshot(pageId: number): void {
  snapshotStore.delete(pageId);
}
