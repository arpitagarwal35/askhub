import axios from "axios";
import { BaseConnector } from "./base.js";
import pino from "pino";

const log = pino({ level: "info" });

export class JiraConnector extends BaseConnector {
  /**
   * @param {{ baseUrl: string, email: string, apiToken: string, projectKey: string, maxIssues?: number }} cfg
   */
  constructor(cfg) {
    super();
    this.baseUrl = cfg.baseUrl;
    this.email = cfg.email;
    this.apiToken = cfg.apiToken;
    this.projectKey = cfg.projectKey;
    this.maxIssues = cfg.maxIssues ?? 200;
  }

  get #auth() {
    return {
      username: this.email,
      password: this.apiToken,
    };
  }

  get #headers() {
    return { Accept: "application/json" };
  }

  async healthCheck() {
    try {
      await axios.get(`${this.baseUrl}/rest/api/3/myself`, {
        auth: this.#auth,
        headers: this.#headers,
      });
      return { ok: true, message: "Jira connection successful" };
    } catch (err) {
      return { ok: false, message: err.response?.data?.message ?? err.message };
    }
  }

  async fetchDocuments() {
    const issues = await this.#fetchIssues();
    log.info({ count: issues.length, project: this.projectKey }, "Fetched Jira issues");
    return issues;
  }

  async #fetchIssues() {
    const documents = [];
    let startAt = 0;
    const maxResults = 50;

    while (documents.length < this.maxIssues) {
      const response = await axios.get(`${this.baseUrl}/rest/api/3/search`, {
        auth: this.#auth,
        headers: this.#headers,
        params: {
          jql: `project = ${this.projectKey} ORDER BY updated DESC`,
          startAt,
          maxResults,
          fields: "summary,description,issuetype,status,priority,comment,labels",
        },
      });

      const { issues, total } = response.data;
      if (issues.length === 0) break;

      for (const issue of issues) {
        const content = this.#formatIssue(issue);
        if (content.trim().length > 0) {
          documents.push({
            id: issue.id,
            title: `[${issue.key}] ${issue.fields.summary}`,
            content,
            url: `${this.baseUrl}/browse/${issue.key}`,
            sourceType: "jira",
            metadata: {
              issueKey: issue.key,
              issueType: issue.fields.issuetype?.name,
              status: issue.fields.status?.name,
              priority: issue.fields.priority?.name,
              labels: issue.fields.labels ?? [],
            },
          });
        }
      }

      startAt += issues.length;
      if (startAt >= total || startAt >= this.maxIssues) break;
    }

    return documents;
  }

  #formatIssue(issue) {
    const f = issue.fields;
    const parts = [];

    if (f.description) {
      parts.push(this.#extractAdfText(f.description));
    }

    if (f.comment?.comments?.length > 0) {
      const commentTexts = f.comment.comments
        .slice(0, 10)
        .map((c) => this.#extractAdfText(c.body))
        .filter(Boolean);
      if (commentTexts.length > 0) {
        parts.push("Comments:\n" + commentTexts.join("\n---\n"));
      }
    }

    return parts.join("\n\n");
  }

  // Extract plain text from Atlassian Document Format (ADF) JSON
  #extractAdfText(node) {
    if (!node) return "";
    if (typeof node === "string") return node;

    if (node.type === "text") return node.text ?? "";

    if (node.content && Array.isArray(node.content)) {
      return node.content.map((n) => this.#extractAdfText(n)).join(" ");
    }

    return "";
  }
}
