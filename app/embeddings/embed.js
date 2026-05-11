import { ai } from "../llm/gemini.js";
import { config } from "../config.js";
import pino from "pino";

const log = pino({ level: "info", base: null });

const CONCURRENCY = 3;
let active = 0;
const queue = [];

function acquireSlot() {
  if (active < CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot() {
  if (queue.length > 0) {
    queue.shift()();
  } else {
    active--;
  }
}

function isRateLimited(err) {
  const msg = err?.message ?? "";
  return (
    err?.status === 429 ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("Resource exhausted")
  );
}

export async function getEmbedding(text, retries = 5) {
  await acquireSlot();
  try {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await ai.models.embedContent({
          model: config.gcp.embeddingModel,
          contents: text,
        });
        return response.embeddings[0].values;
      } catch (err) {
        if (isRateLimited(err) && attempt < retries - 1) {
          // Start at 60s for resource exhausted — Google recommends at least that long
          const waitMs = 60_000 * (attempt + 1);
          log.warn(`Embedding rate limited — waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${retries})`);
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          throw err;
        }
      }
    }
  } finally {
    releaseSlot();
  }
}
