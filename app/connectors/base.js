export class BaseConnector {
  async fetchDocuments() {
    throw new Error(`${this.constructor.name} must implement fetchDocuments()`);
  }

  // Default streaming implementation — subclasses can override for true streaming.
  async *streamDocuments() {
    const docs = await this.fetchDocuments();
    for (const doc of docs) yield doc;
  }

  async healthCheck() {
    throw new Error(`${this.constructor.name} must implement healthCheck()`);
  }
}
