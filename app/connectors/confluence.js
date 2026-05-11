import axios from "axios";
import * as cheerio from "cheerio";
import { BaseConnector } from "./base.js";
import pino from "pino";

const log = pino({ level: "info", base: null });

function cleanHTML(html) {
  const $ = cheerio.load(html);
  return $.text().replace(/\s+/g, " ").trim();
}

export class ConfluenceConnector extends BaseConnector {
  constructor(cfg) {
    super();
    this.baseUrl = cfg.baseUrl;
    this.email = cfg.email;
    this.apiToken = cfg.apiToken;
    this.pageId = cfg.pageId;
    this.spaceKey = cfg.spaceKey;
    this.maxPages = cfg.maxPages ?? Infinity;
    this.maxDepth = cfg.maxDepth ?? 5;
    this.skipPageIds = cfg.skipPageIds ?? new Set();
    this.excludePageIds = new Set(cfg.excludePageIds ?? []);
  }

  get #headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: "application/json",
    };
  }

  // Retry wrapper: handles 429 (with Retry-After) and 5xx with exponential backoff.
  async #request(axiosFn, retries = 4) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await axiosFn();
      } catch (err) {
        const status = err.response?.status;
        const isRetryable = status === 429 || (status >= 500 && status < 600);

        if (!isRetryable || attempt === retries - 1) throw err;

        let waitMs;
        if (status === 429) {
          const retryAfter = err.response?.headers?.["retry-after"];
          waitMs = retryAfter ? parseFloat(retryAfter) * 1000 : 1000 * 2 ** attempt;
          log.warn({ attempt, waitMs }, "Confluence 429 — backing off");
        } else {
          waitMs = 1000 * 2 ** attempt;
          log.warn({ attempt, waitMs, status }, "Confluence server error — backing off");
        }

        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  async healthCheck() {
    try {
      await this.#request(() =>
        axios.get(`${this.baseUrl}/rest/api/space`, {
          params: { limit: 1 },
          headers: this.#headers,
        })
      );
      return { ok: true, message: "Confluence connection successful" };
    } catch (err) {
      return { ok: false, message: err.response?.data?.message ?? err.message };
    }
  }

  async fetchDocuments() {
    const docs = [];
    for await (const doc of this.streamDocuments()) docs.push(doc);
    return docs;
  }

  async *streamDocuments() {
    if (this.pageId) yield* this.#streamPageTree(this.pageId);
    else if (this.spaceKey) yield* this.#streamBySpace(this.spaceKey);
    else throw new Error("ConfluenceConnector requires either pageId or spaceKey");
  }

  async #fetchPageById(pageId) {
    const response = await this.#request(() =>
      axios.get(`${this.baseUrl}/rest/api/content/${pageId}`, {
        params: { expand: "body.storage" },
        headers: this.#headers,
      })
    );
    const item = response.data;
    return {
      id: item.id,
      title: item.title,
      content: cleanHTML(item.body.storage.value),
      url: `${this.baseUrl}/pages/viewpage.action?pageId=${item.id}`,
      sourceType: "confluence",
    };
  }

  async #fetchChildPages(parentId) {
    const ids = [];
    let start = 0;
    const limit = 50;
    while (true) {
      const response = await this.#request(() =>
        axios.get(`${this.baseUrl}/rest/api/content/${parentId}/child/page`, {
          params: { limit, start },
          headers: this.#headers,
        })
      );
      const { results } = response.data;
      ids.push(...results.map((item) => item.id));
      if (results.length < limit) break;
      start += results.length;
    }
    return ids;
  }

  async *#streamPageTree(rootId, depth = 0, counter = { count: 0 }) {
    if (depth > this.maxDepth || counter.count >= this.maxPages) return;
    if (this.excludePageIds.has(rootId)) return;

    if (this.skipPageIds.has(rootId)) {
      log.info({ id: rootId }, "Skipping already-ingested page");
      // Still recurse — children may have been added since last sync
      const childIds = await this.#fetchChildPages(rootId);
      for (const childId of childIds) {
        if (counter.count >= this.maxPages) break;
        yield* this.#streamPageTree(childId, depth + 1, counter);
        await new Promise((r) => setTimeout(r, 200));
      }
      return;
    }

    const page = await this.#fetchPageById(rootId);
    counter.count++;
    yield page;

    if (counter.count >= this.maxPages) return;

    const childIds = await this.#fetchChildPages(rootId);
    for (const childId of childIds) {
      if (counter.count >= this.maxPages) break;
      yield* this.#streamPageTree(childId, depth + 1, counter);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async *#streamBySpace(spaceKey) {
    let start = 0;
    let count = 0;
    const limit = 100;

    while (count < this.maxPages) {
      const response = await this.#request(() =>
        axios.get(`${this.baseUrl}/rest/api/content`, {
          params: { spaceKey, limit, start, expand: "body.storage" },
          headers: this.#headers,
        })
      );
      const { results } = response.data;
      for (const item of results) {
        yield {
          id: item.id,
          title: item.title,
          content: cleanHTML(item.body.storage.value),
          url: `${this.baseUrl}/pages/viewpage.action?pageId=${item.id}`,
          sourceType: "confluence",
        };
        count++;
        if (count >= this.maxPages) return;
      }
      if (results.length < limit) break;
      start += results.length;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
