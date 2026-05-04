import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config.js";
import pino from "pino";

const log = pino({ level: "info" });

const client = new QdrantClient({
  url: config.qdrant.url,
  ...(config.qdrant.apiKey ? { apiKey: config.qdrant.apiKey } : {}),
});

// gemini-embedding-001 produces 3072-dimensional vectors
const VECTOR_SIZE = 3072;

export async function ensureCollection(collectionName = config.qdrant.collection) {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === collectionName);

  if (!exists) {
    await client.createCollection(collectionName, {
      vectors: {
        size: VECTOR_SIZE,
        distance: "Cosine",
      },
    });
    log.info({ collectionName }, "Created Qdrant collection");
  }
}

export async function upsertChunks(chunks, collectionName = config.qdrant.collection) {
  await ensureCollection(collectionName);

  const points = chunks.map((chunk, i) => ({
    id: chunk.id ?? generateId(chunk),
    vector: chunk.embedding,
    payload: {
      title: chunk.title,
      content: chunk.content,
      url: chunk.url ?? null,
      sourceType: chunk.sourceType ?? "confluence",
      pageId: chunk.pageId ?? null,
      headingPath: chunk.headingPath ?? null,
    },
  }));

  // Qdrant upsert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < points.length; i += batchSize) {
    await client.upsert(collectionName, {
      wait: true,
      points: points.slice(i, i + batchSize),
    });
  }

  log.info({ count: points.length, collectionName }, "Upserted chunks to Qdrant");
}

export async function semanticSearch(queryVector, topK = 10, collectionName = config.qdrant.collection) {
  const results = await client.search(collectionName, {
    vector: queryVector,
    limit: topK,
    with_payload: true,
  });

  return results.map((r) => ({
    id: r.id,
    score: r.score,
    title: r.payload.title,
    content: r.payload.content,
    url: r.payload.url,
    sourceType: r.payload.sourceType,
    pageId: r.payload.pageId,
    headingPath: r.payload.headingPath,
  }));
}

export async function deleteByPageId(pageId, collectionName = config.qdrant.collection) {
  await client.delete(collectionName, {
    filter: {
      must: [{ key: "pageId", match: { value: pageId } }],
    },
  });
}

export async function getCollectionInfo(collectionName = config.qdrant.collection) {
  return client.getCollection(collectionName);
}

// Deterministic integer ID from a string (Qdrant requires integer or UUID point IDs)
function generateId(chunk) {
  const str = `${chunk.pageId ?? ""}:${chunk.title}:${chunk.content.slice(0, 50)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
