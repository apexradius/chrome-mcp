import type { Page } from "puppeteer-core";
import type { ChromeClient } from "../chrome/client.js";

export class CollectorManager<T extends { dispose(): void }> {
  private collectors = new Map<number, T>();

  get(client: ChromeClient, factory: (page: Page) => T): { id: number; collector: T } {
    const { id, page } = client.getPage();
    let collector = this.collectors.get(id);
    if (!collector) {
      collector = factory(page);
      this.collectors.set(id, collector);
      page.once("close", () => {
        collector?.dispose();
        this.collectors.delete(id);
      });
    }
    return { id, collector };
  }
}
