/**
 * Base interface for all source connectors.
 *
 * Every connector must implement:
 *   fetchDocuments() → Promise<Document[]>
 *   healthCheck()    → Promise<{ ok: boolean, message: string }>
 *
 * Document shape:
 *   { id, title, content, url, sourceType, metadata? }
 */
export class BaseConnector {
  /** @returns {Promise<import('./types.js').Document[]>} */
  async fetchDocuments() {
    throw new Error(`${this.constructor.name} must implement fetchDocuments()`);
  }

  /** @returns {Promise<{ ok: boolean, message: string }>} */
  async healthCheck() {
    throw new Error(`${this.constructor.name} must implement healthCheck()`);
  }
}
