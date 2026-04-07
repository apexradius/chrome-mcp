import type { Page, SerializedAXNode } from "puppeteer-core";

export interface SnapshotResult {
  text: string;
  uidMap: Map<string, SerializedAXNode>;
}

/**
 * Capture an accessibility snapshot of the page, assign UIDs to each node,
 * and format as Playwright-style YAML text.
 */
export async function captureSnapshot(page: Page): Promise<SnapshotResult> {
  const tree = await page.accessibility.snapshot({
    includeIframes: true,
    interestingOnly: true,
  });

  const uidMap = new Map<string, SerializedAXNode>();
  let counter = 0;

  function nextUid(): string {
    counter++;
    return `e${counter}`;
  }

  function formatNode(node: SerializedAXNode, indent: number): string {
    const uid = nextUid();
    uidMap.set(uid, node);

    const pad = "  ".repeat(indent);
    const role = node.role;
    const name = node.name ? ` "${node.name}"` : "";
    const ref = ` [ref=${uid}]`;

    // Collect optional attributes
    const attrs: string[] = [];
    if (node.focused) attrs.push("[focused]");
    if (node.disabled) attrs.push("[disabled]");
    if (node.required) attrs.push("[required]");
    if (node.checked !== undefined) attrs.push(`[checked=${node.checked}]`);
    if (node.expanded !== undefined) attrs.push(`[expanded=${node.expanded}]`);
    if (node.selected) attrs.push("[selected]");
    if (node.level !== undefined) attrs.push(`[level=${node.level}]`);
    if (node.url) attrs.push(`[url=${node.url}]`);

    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";

    let line = `${pad}- ${role}${name}${ref}${attrStr}`;

    // Add value as child text
    const childLines: string[] = [];
    if (node.value !== undefined && node.value !== "") {
      childLines.push(`${pad}  - /value: "${node.value}"`);
    }
    if (node.description) {
      childLines.push(`${pad}  - /description: "${node.description}"`);
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        childLines.push(formatNode(child, indent + 1));
      }
    }

    if (childLines.length > 0) {
      line += ":\n" + childLines.join("\n");
    }

    return line;
  }

  if (!tree) {
    return { text: "- (empty page)", uidMap };
  }

  // If the root has children, format them at top level; otherwise format root itself
  const lines: string[] = [];
  if (tree.children && tree.children.length > 0) {
    for (const child of tree.children) {
      lines.push(formatNode(child, 0));
    }
  } else {
    lines.push(formatNode(tree, 0));
  }

  return { text: lines.join("\n"), uidMap };
}
