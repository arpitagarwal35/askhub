import fs from "fs";
import { chunkDocument } from "./chunk.js";
import { getEmbedding } from "./embed.js";
import { upsertChunks, ensureCollection } from "../vectorStore/qdrant.js";
import pino from "pino";

const log = pino({ level: "info" });

async function processData() {
  console.time("Total Time");

  const rawData = JSON.parse(
    fs.readFileSync("data/confluence_limited.json", "utf-8"),
  );

  log.info({ pages: rawData.length }, "Starting ingestion");
  await ensureCollection();

  const allChunks = [];

  for (const page of rawData) {
    const chunks = chunkDocument(page.content, page.title);

    for (const chunk of chunks) {
      const embedding = await getEmbedding(chunk.text);
      allChunks.push({
        title: chunk.title,
        content: chunk.text,
        headingPath: chunk.headingPath,
        pageId: page.id ?? null,
        url: page.url ?? null,
        sourceType: "confluence",
        embedding,
      });
      log.info({ chunk: allChunks.length, title: page.title }, "Embedded chunk");
    }
  }

  await upsertChunks(allChunks);

  log.info({ total: allChunks.length }, "Ingestion complete");
  console.timeEnd("Total Time");
}

processData().catch((err) => {
  console.error(err);
  process.exit(1);
});
