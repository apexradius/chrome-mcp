import type { Page, HTTPRequest, HTTPResponse } from "puppeteer-core";

export interface RequestData {
  id: string;
  method: string;
  url: string;
  resourceType: string;
  status: number | null;
  statusText: string | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string> | null;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  responseBody: string | null;
  failure: string | null;
}

const MAX_REQUESTS = 500;
const MAX_BODY_SIZE = 512 * 1024; // 512KB

function normalizeHeaders(raw: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    headers[key] = raw[key]!;
  }
  return headers;
}

export class NetworkCollector {
  private requests = new Map<string, RequestData>();
  private nextId = 1;
  private page: Page;
  private requestIdMap = new WeakMap<HTTPRequest, string>();

  private onRequest: (req: HTTPRequest) => void;
  private onResponse: (res: HTTPResponse) => void;
  private onRequestFailed: (req: HTTPRequest) => void;

  constructor(page: Page) {
    this.page = page;

    this.onRequest = (req: HTTPRequest) => {
      const id = `req_${this.nextId++}`;
      this.requestIdMap.set(req, id);

      if (this.requests.size >= MAX_REQUESTS) {
        const oldest = this.requests.keys().next().value;
        if (oldest) this.requests.delete(oldest);
      }

      this.requests.set(id, {
        id,
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        status: null,
        statusText: null,
        requestHeaders: normalizeHeaders(req.headers()),
        responseHeaders: null,
        startTime: Date.now(),
        endTime: null,
        duration: null,
        responseBody: null,
        failure: null,
      });
    };

    this.onResponse = (res: HTTPResponse) => {
      const req = res.request();
      const id = this.requestIdMap.get(req);
      if (!id) return;

      const data = this.requests.get(id);
      if (!data) return;

      data.status = res.status();
      data.statusText = res.statusText();
      data.responseHeaders = normalizeHeaders(res.headers());
      data.endTime = Date.now();
      data.duration = data.endTime - data.startTime;

      const contentType = data.responseHeaders["content-type"] ?? "";
      const isText = contentType.includes("text") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("javascript");
      if (isText) {
        res.text().then((body) => {
          data.responseBody = body.length > MAX_BODY_SIZE ? body.slice(0, MAX_BODY_SIZE) + "\n[truncated]" : body;
        }).catch(() => {});
      }
    };

    this.onRequestFailed = (req: HTTPRequest) => {
      const id = this.requestIdMap.get(req);
      if (!id) return;

      const data = this.requests.get(id);
      if (!data) return;

      data.endTime = Date.now();
      data.duration = data.endTime - data.startTime;
      data.failure = req.failure()?.errorText ?? "Unknown error";
    };

    this.page.on("request", this.onRequest);
    this.page.on("response", this.onResponse);
    this.page.on("requestfailed", this.onRequestFailed);
  }

  getRequests(resourceType?: string): Array<Omit<RequestData, "responseBody" | "requestHeaders" | "responseHeaders">> {
    const results: Array<Omit<RequestData, "responseBody" | "requestHeaders" | "responseHeaders">> = [];
    for (const data of this.requests.values()) {
      if (resourceType && data.resourceType !== resourceType) continue;
      const { responseBody: _rb, requestHeaders: _rh, responseHeaders: _resH, ...summary } = data;
      results.push(summary);
    }
    return results;
  }

  getRequest(id: string): RequestData | null {
    return this.requests.get(id) ?? null;
  }

  clear(): void {
    this.requests.clear();
  }

  dispose(): void {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
    this.page.off("requestfailed", this.onRequestFailed);
    this.requests.clear();
  }
}
