import axios from "axios";
import { BaseConnector } from "./base.js";
import pino from "pino";

const log = pino({ level: "info" });

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class SharePointConnector extends BaseConnector {
  /**
   * @param {{ tenantId: string, clientId: string, clientSecret: string, siteId: string }} cfg
   */
  constructor(cfg) {
    super();
    this.tenantId = cfg.tenantId;
    this.clientId = cfg.clientId;
    this.clientSecret = cfg.clientSecret;
    this.siteId = cfg.siteId;
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  async #getAccessToken() {
    if (this._accessToken && Date.now() < this._tokenExpiry) {
      return this._accessToken;
    }

    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: "https://graph.microsoft.com/.default",
    });

    const response = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    this._accessToken = response.data.access_token;
    this._tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
    return this._accessToken;
  }

  async #graphGet(path) {
    const token = await this.#getAccessToken();
    const response = await axios.get(`${GRAPH_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  async healthCheck() {
    try {
      await this.#graphGet(`/sites/${this.siteId}`);
      return { ok: true, message: "SharePoint connection successful" };
    } catch (err) {
      return { ok: false, message: err.response?.data?.error?.message ?? err.message };
    }
  }

  async fetchDocuments() {
    const documents = [];

    // Fetch site pages (wiki-style pages)
    const pages = await this.#fetchSitePages();
    documents.push(...pages);

    // Fetch document library files (Word, PDF, etc.)
    const files = await this.#fetchDriveFiles();
    documents.push(...files);

    log.info({ count: documents.length, siteId: this.siteId }, "Fetched SharePoint documents");
    return documents;
  }

  async #fetchSitePages() {
    try {
      const data = await this.#graphGet(
        `/sites/${this.siteId}/pages?$select=id,title,webUrl,description`
      );
      return (data.value ?? []).map((page) => ({
        id: `sp-page-${page.id}`,
        title: page.title ?? "Untitled Page",
        content: page.description ?? "",
        url: page.webUrl,
        sourceType: "sharepoint",
        metadata: { type: "page" },
      }));
    } catch {
      log.warn("Could not fetch SharePoint site pages");
      return [];
    }
  }

  async #fetchDriveFiles() {
    try {
      const drive = await this.#graphGet(`/sites/${this.siteId}/drive/root/children`);
      const documents = [];

      for (const item of drive.value ?? []) {
        if (item.file && this.#isSupportedFile(item.name)) {
          // Get the file content as text via download URL
          const content = await this.#downloadFileText(item["@microsoft.graph.downloadUrl"]);
          if (content) {
            documents.push({
              id: `sp-file-${item.id}`,
              title: item.name,
              content,
              url: item.webUrl,
              sourceType: "sharepoint",
              metadata: { type: "file", mimeType: item.file?.mimeType },
            });
          }
        }
      }

      return documents;
    } catch {
      log.warn("Could not fetch SharePoint drive files");
      return [];
    }
  }

  #isSupportedFile(name) {
    return /\.(txt|md|html)$/i.test(name);
  }

  async #downloadFileText(downloadUrl) {
    try {
      const response = await axios.get(downloadUrl, { responseType: "text" });
      return response.data;
    } catch {
      return null;
    }
  }
}
