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

export async function ensureCollection(collectionName) {
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

export async function upsertChunks(chunks, collectionName) {
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

  log.debug({ count: points.length, collectionName }, "Upserted chunks to Qdrant");
}

export async function semanticSearch(queryVector, topK = 10, collectionName) {
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

export async function deleteByPageId(pageId, collectionName) {
  await client.delete(collectionName, {
    filter: {
      must: [{ key: "pageId", match: { value: pageId } }],
    },
  });
}

export async function getCollectionInfo(collectionName) {
  return client.getCollection(collectionName);
}

// Deterministic UUID from pageId + chunkIndex — unique per chunk, stable across re-syncs.
function generateId(chunk) {
  const str = `${chunk.pageId ?? "unknown"}:${chunk.chunkIndex ?? 0}`;
  // Expand to 128 bits with two independent hashes for UUID formatting
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x9e3779b9) >>> 0;
  }
  const toHex = (n, len) => n.toString(16).padStart(len, "0");
  return `${toHex(h1, 8)}-${toHex(h2 >>> 16, 4)}-4${toHex((h2 >>> 8) & 0xfff, 3)}-${toHex(0x8000 | (h1 >>> 18 & 0x3fff), 4)}-${toHex(h1 >>> 4, 8)}${toHex(h2 & 0xffff, 4)}`;
}
