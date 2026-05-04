import { chunkDocument } from "../embeddings/chunk.js";
import { getEmbedding } from "../embeddings/embed.js";
import { upsertChunks, ensureCollection } from "../vectorStore/qdrant.js";
import { ConfluenceConnector } from "../connectors/confluence.js";
import { JiraConnector } from "../connectors/jira.js";
import { SharePointConnector } from "../connectors/sharepoint.js";
import { FileUploadConnector } from "../connectors/fileUpload.js";
import { config } from "../config.js";
import pino from "pino";

const log = pino({ level: "info" });

function buildConnector(source) {
  switch (source.type) {
    case "confluence":
      return new ConfluenceConnector({
        baseUrl: source.config?.baseUrl ?? config.confluence.baseUrl,
        email: source.config?.email ?? config.confluence.email,
        apiToken: source.config?.apiToken ?? config.confluence.apiToken,
        pageId: source.config?.pageId,
        spaceKey: source.config?.spaceKey,
        maxPages: source.config?.maxPages ? parseInt(source.config.maxPages) : 50,
      });
    case "jira":
      return new JiraConnector({
        baseUrl: source.config?.baseUrl ?? config.jira.baseUrl,
        email: source.config?.email ?? config.jira.email,
        apiToken: source.config?.apiToken ?? config.jira.apiToken,
        projectKey: source.config?.projectKey ?? config.jira.projectKey,
      });
    case "sharepoint":
      return new SharePointConnector({
        tenantId: source.config?.tenantId ?? config.sharepoint.tenantId,
        clientId: source.config?.clientId ?? config.sharepoint.clientId,
        clientSecret: source.config?.clientSecret ?? config.sharepoint.clientSecret,
        siteId: source.config?.siteId ?? config.sharepoint.siteId,
      });
    case "file":
      return new FileUploadConnector({ files: source.files ?? [] });
    default:
      throw new Error(`Unknown source type: ${source.type}`);
  }
}

export async function runIngestionPipeline(sources, collectionName = config.qdrant.collection) {
  await ensureCollection(collectionName);

  const stats = { documentsIngested: 0, chunksCreated: 0, errors: [] };

  for (const source of sources) {
    let connector;
    try {
      connector = buildConnector(source);
    } catch (err) {
      stats.errors.push({ source: source.type, error: err.message });
      continue;
    }

    const health = await connector.healthCheck();
    if (!health.ok) {
      stats.errors.push({ source: source.type, error: health.message });
      log.warn({ source: source.type, reason: health.message }, "Source health check failed");
      continue;
    }

    let documents;
    try {
      documents = await connector.fetchDocuments();
    } catch (err) {
      stats.errors.push({ source: source.type, error: err.message });
      log.error({ source: source.type, err: err.message }, "Failed to fetch documents");
      continue;
    }

    const chunks = [];
    for (const doc of documents) {
      const docChunks = chunkDocument(doc.content, doc.title);
      for (const chunk of docChunks) {
        const embedding = await getEmbedding(chunk.text);
        chunks.push({
          title: chunk.title,
          content: chunk.text,
          headingPath: chunk.headingPath,
          pageId: doc.id,
          url: doc.url,
          sourceType: doc.sourceType,
          embedding,
        });
      }
    }

    if (chunks.length > 0) {
      await upsertChunks(chunks, collectionName);
    }

    stats.documentsIngested += documents.length;
    stats.chunksCreated += chunks.length;

    log.info(
      { source: source.type, docs: documents.length, chunks: chunks.length },
      "Source ingested"
    );
  }

  return stats;
}
