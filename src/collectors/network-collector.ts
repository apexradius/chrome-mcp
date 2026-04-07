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

/**
 * Per-page network request tracking.
 * Attach to a page to capture all network requests and responses.
 */
export class NetworkCollector {
  private requests = new Map<string, RequestData>();
  private nextId = 1;
  private page: Page;
  private requestIdMap = new WeakMap<HTTPRequest, string>();

  // Bound handlers for cleanup
  private onRequest: (req: HTTPRequest) => void;
  private onResponse: (res: HTTPResponse) => void;
  private onRequestFailed: (req: HTTPRequest) => void;

  constructor(page: Page) {
    this.page = page;

    this.onRequest = (req: HTTPRequest) => {
      const id = `req_${this.nextId++}`;
      this.requestIdMap.set(req, id);

      const headers: Record<string, string> = {};
      const rawHeaders = req.headers();
      for (const key of Object.keys(rawHeaders)) {
        headers[key] = rawHeaders[key]!;
      }

      this.requests.set(id, {
        id,
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        status: null,
        statusText: null,
        requestHeaders: headers,
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

      const headers: Record<string, string> = {};
      const rawHeaders = res.headers();
      for (const key of Object.keys(rawHeaders)) {
        headers[key] = rawHeaders[key]!;
      }

      data.status = res.status();
      data.statusText = res.statusText();
      data.responseHeaders = headers;
      data.endTime = Date.now();
      data.duration = data.endTime - data.startTime;

      // Try to capture response body for text-based resources
      res.text().then((body) => {
        data.responseBody = body;
      }).catch(() => {
        // Body not available (e.g. redirects, binary)
      });
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

  /**
   * Return all captured requests (summary without response body).
   */
  getRequests(resourceType?: string): Array<Omit<RequestData, "responseBody" | "requestHeaders" | "responseHeaders">> {
    const results: Array<Omit<RequestData, "responseBody" | "requestHeaders" | "responseHeaders">> = [];
    for (const data of this.requests.values()) {
      if (resourceType && data.resourceType !== resourceType) continue;
      const { responseBody: _rb, requestHeaders: _rh, responseHeaders: _resH, ...summary } = data;
      results.push(summary);
    }
    return results;
  }

  /**
   * Return full details for one request including response body if available.
   */
  getRequest(id: string): RequestData | null {
    return this.requests.get(id) ?? null;
  }

  /**
   * Reset for new navigation.
   */
  clear(): void {
    this.requests.clear();
  }

  /**
   * Remove event listeners.
   */
  dispose(): void {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
    this.page.off("requestfailed", this.onRequestFailed);
    this.requests.clear();
  }
}
