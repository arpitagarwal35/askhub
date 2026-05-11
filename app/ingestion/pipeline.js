import { chunkDocument } from "../embeddings/chunk.js";
import { getEmbedding } from "../embeddings/embed.js";
import { upsertChunks, ensureCollection } from "../vectorStore/qdrant.js";
import { markPageIngested, getIngestedPageIds } from "../db/conversations.js";
import { ConfluenceConnector } from "../connectors/confluence.js";
import { JiraConnector } from "../connectors/jira.js";
import { SharePointConnector } from "../connectors/sharepoint.js";
import { FileUploadConnector } from "../connectors/fileUpload.js";
import { config } from "../config.js";
import pino from "pino";

const log = pino({ level: "info", base: null });

function buildConnector(source, { skipPageIds = new Set() } = {}) {
  switch (source.type) {
    case "confluence":
      return new ConfluenceConnector({
        baseUrl: source.config?.baseUrl ?? config.confluence.baseUrl,
        email: source.config?.email ?? config.confluence.email,
        apiToken: source.config?.apiToken ?? config.confluence.apiToken,
        pageId: source.config?.pageId,
        spaceKey: source.config?.spaceKey,
        ...(source.config?.maxPages && { maxPages: parseInt(source.config.maxPages) }),
        skipPageIds,
        excludePageIds: [
          ...config.confluence.excludePageIds,
          ...(source.config?.excludePageIds ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        ],
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
    const skipPageIds = getIngestedPageIds(collectionName);
    let connector;
    try {
      connector = buildConnector(source, { skipPageIds });
    } catch (err) {
      stats.errors.push({ source: source.type, error: err.message });
      continue;
    }

    const health = await connector.healthCheck();
    if (!health.ok) {
      stats.errors.push({ source: source.type, error: health.message });
      log.warn(`[${source.type}] health check failed: ${health.message}`);
      continue;
    }

    let totalChunks = 0;
    let totalDocs = 0;
    try {
      for await (const doc of connector.streamDocuments()) {
        totalDocs++;

        const docChunks = chunkDocument(doc.content, doc.title);
        if (doc.id) markPageIngested(doc.id, doc.sourceType, collectionName);
        if (docChunks.length === 0) continue;

        const chunks = await Promise.all(
          docChunks.map(async (chunk, chunkIndex) => ({
            title: chunk.title,
            content: chunk.text,
            headingPath: chunk.headingPath,
            pageId: doc.id,
            chunkIndex,
            url: doc.url,
            sourceType: doc.sourceType,
            embedding: await getEmbedding(chunk.text),
          }))
        );

        await upsertChunks(chunks, collectionName);
        totalChunks += chunks.length;

        log.info(`[${source.type}] page ${totalDocs} | ${doc.title} | +${chunks.length} chunks (${totalChunks} total)`);
      }
    } catch (err) {
      stats.errors.push({ source: source.type, error: err.message });
      log.error(`[${source.type}] ingestion interrupted: ${err.message}`);
    }

    stats.documentsIngested += totalDocs;
    stats.chunksCreated += totalChunks;

    log.info(`[${source.type}] done — ${totalDocs} pages, ${totalChunks} chunks`);
  }

  return stats;
}
