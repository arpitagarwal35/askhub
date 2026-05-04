import axios from "axios";
import * as cheerio from "cheerio";
import { BaseConnector } from "./base.js";
import pino from "pino";

const log = pino({ level: "info" });

function cleanHTML(html) {
  const $ = cheerio.load(html);
  return $.text().replace(/\s+/g, " ").trim();
}

function authHeader(email, apiToken) {
  return `Bearer ${apiToken}`;
}

export class ConfluenceConnector extends BaseConnector {
  /**
   * @param {{ baseUrl: string, email: string, apiToken: string, pageId?: string, spaceKey?: string, maxPages?: number, maxDepth?: number }} cfg
   */
  constructor(cfg) {
    super();
    this.baseUrl = cfg.baseUrl;
    this.email = cfg.email;
    this.apiToken = cfg.apiToken;
    this.pageId = cfg.pageId;
    this.spaceKey = cfg.spaceKey;
    this.maxPages = cfg.maxPages ?? 50;
    this.maxDepth = cfg.maxDepth ?? 2;
  }

  get #headers() {
    return {
      Authorization: authHeader(this.email, this.apiToken),
      Accept: "application/json",
    };
  }

  async healthCheck() {
    try {
      await axios.get(`${this.baseUrl}/rest/api/space`, {
        params: { limit: 1 },
        headers: this.#headers,
      });
      return { ok: true, message: "Confluence connection successful" };
    } catch (err) {
      return { ok: false, message: err.response?.data?.message ?? err.message };
    }
  }

  async fetchDocuments() {
    if (this.pageId) {
      return this.#fetchPageTree(this.pageId);
    }
    if (this.spaceKey) {
      return this.#fetchBySpace(this.spaceKey);
    }
    throw new Error("ConfluenceConnector requires either pageId or spaceKey");
  }

  async #fetchPageById(pageId) {
    const response = await axios.get(
      `${this.baseUrl}/rest/api/content/${pageId}`,
      {
        params: { expand: "body.storage" },
        headers: this.#headers,
      }
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
    const response = await axios.get(
      `${this.baseUrl}/rest/api/content/${parentId}/child/page`,
      {
        params: { limit: 25 },
        headers: this.#headers,
      }
    );
    return response.data.results.map((item) => item.id);
  }

  async #fetchPageTree(rootId, depth = 0, counter = { count: 0 }) {
    if (depth > this.maxDepth || counter.count >= this.maxPages) return [];

    const page = await this.#fetchPageById(rootId);
    counter.count++;
    log.info({ count: counter.count, title: page.title }, "Fetched Confluence page");

    const pages = [page];
    if (counter.count >= this.maxPages) return pages;

    const childIds = await this.#fetchChildPages(rootId);
    for (const childId of childIds) {
      if (counter.count >= this.maxPages) break;
      const subTree = await this.#fetchPageTree(childId, depth + 1, counter);
      pages.push(...subTree);
      await new Promise((r) => setTimeout(r, 100));
    }

    return pages;
  }

  async #fetchBySpace(spaceKey) {
    const response = await axios.get(`${this.baseUrl}/rest/api/content`, {
      params: { spaceKey, limit: this.maxPages, expand: "body.storage" },
      headers: this.#headers,
    });
    return response.data.results.map((item) => ({
      id: item.id,
      title: item.title,
      content: cleanHTML(item.body.storage.value),
      url: `${this.baseUrl}/pages/viewpage.action?pageId=${item.id}`,
      sourceType: "confluence",
    }));
  }
}
