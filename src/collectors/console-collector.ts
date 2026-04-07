import type { Page, ConsoleMessage } from "puppeteer-core";

export interface ConsoleMessageData {
  id: string;
  type: string;
  text: string;
  timestamp: number;
  location: {
    url: string;
    line: number;
    column: number;
  } | null;
}

const MAX_MESSAGES = 1000;

export class ConsoleCollector {
  private messages: ConsoleMessageData[] = [];
  private nextId = 1;
  private page: Page;
  private onConsole: (msg: ConsoleMessage) => void;

  constructor(page: Page) {
    this.page = page;

    this.onConsole = (msg: ConsoleMessage) => {
      if (this.messages.length >= MAX_MESSAGES) {
        this.messages.shift();
      }
      const loc = msg.location();
      this.messages.push({
        id: `msg_${this.nextId++}`,
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
        location: loc.url
          ? {
              url: loc.url,
              line: loc.lineNumber ?? 0,
              column: loc.columnNumber ?? 0,
            }
          : null,
      });
    };

    this.page.on("console", this.onConsole);
  }

  getMessages(type?: string): ConsoleMessageData[] {
    if (type) {
      return this.messages.filter((m) => m.type === type);
    }
    return [...this.messages];
  }

  getMessage(id: string): ConsoleMessageData | null {
    return this.messages.find((m) => m.id === id) ?? null;
  }

  clear(): void {
    this.messages = [];
  }

  dispose(): void {
    this.page.off("console", this.onConsole);
    this.messages = [];
  }
}
