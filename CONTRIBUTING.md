# Contributing

## Stack Constraints

| Component | Choice | Reason |
| --- | --- | --- |
| LLM + Embeddings | `@google/genai` — Gemini 2.5 Flash + gemini-embedding-001 | Vertex AI; data stays in GCP; ADC auth |
| Vector store | Qdrant OSS (self-hosted on GCE inside org GCP) | Data sovereignty — internal data cannot leave org GCP |
| Backend | Node.js + Express 5 | ESM modules throughout |
| Frontend | React + Vite + Tailwind | |
| DB | SQLite via `better-sqlite3` | Zero ops; single-team scale |

Do not switch LLM providers or vector stores without a discussion — both are driven by data sovereignty constraints, not just preference.

## Google AI SDK

Always use `@google/genai`. The older `@google-cloud/vertexai` is deprecated and has known silent hangs on `embedContent`.

```js
import { ai } from "./llm/gemini.js"; // shared client — do not create new instances
```

## Conventions

- **ESM only** — `import`/`export` everywhere. No `require()`.
- **Config in one place** — all env vars live in `app/config.js`. Never read `process.env` directly elsewhere.
- **Zod for validation** — add a schema to `app/middleware/validate.js` for any new route.
- **Pino for logging** — no `console.log` in production paths.
- **No speculative code** — implement what is needed now. Phase 2 (multi-team) is tracked in `ARCHITECTURE.md`.

## File Responsibilities

```
app/config.js              — env vars only, no logic
app/llm/gemini.js          — shared AI client, nothing else
app/embeddings/chunk.js    — chunking only, no I/O
app/embeddings/embed.js    — embedding only
app/vectorStore/qdrant.js  — Qdrant client wrapper only
app/retrieval/search.js    — full retrieval pipeline
app/ingestion/pipeline.js  — orchestration only, delegates to connectors
app/server.js              — routes + middleware wiring only
```

## Adding a New Connector

1. Create `app/connectors/mySource.js` extending `BaseConnector`
2. Implement `async *streamDocuments()` — `yield` one document at a time with shape `{ id, title, content, url, sourceType, metadata }`. The pipeline marks each page in SQLite after yielding, so progress is saved incrementally.
3. For simple sources without pagination or rate-limit concerns, implement `fetchDocuments()` instead — `BaseConnector` wraps it in a default `streamDocuments()` automatically.
4. Register in `app/ingestion/pipeline.js` under the `type` switch

## Known Gotchas

- **Qdrant vector size is 3072** — `gemini-embedding-001` outputs 3072 dimensions. If you recreate the collection, use `VECTOR_SIZE = 3072`.
- **Express 5 wildcards** — `app.options('*', ...)` is invalid in Express 5 / path-to-regexp v8. Use `app.use(cors())` before `helmet()` instead.
- **Chunker overlap** — in `splitByTokens`, `start` must always move forward. Never let `nextStart <= start` or you get an infinite loop.
- **Chunk IDs are deterministic** — `qdrant.js` derives the Qdrant point UUID from `pageId:chunkIndex`. Re-ingesting the same page with the same chunk count is idempotent (upsert). If a page shrinks and loses chunks, the old tail chunk IDs remain in Qdrant — call `deleteByPageId` before re-ingesting if you need a clean slate.
- **Gemini embedding 429** — the SDK surfaces rate limits as `RESOURCE_EXHAUSTED` in the error message, not as `err.status === 429`. The retry logic in `embed.js` handles both. Backoff starts at 60 s per Google's recommendation.
