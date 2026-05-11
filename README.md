# AI Knowledge Assistant

A RAG (Retrieval-Augmented Generation) chatbot that answers questions from internal documentation sources — Confluence, Jira, SharePoint, and uploaded files. Built for a single team first, designed to extend to multiple teams.

## Stack

| Layer | Technology |
| --- | --- |
| LLM + Embeddings | Google Vertex AI — Gemini 2.5 Flash + gemini-embedding-001 |
| Vector store | Qdrant OSS (self-hosted, data stays in GCP) |
| Backend | Node.js + Express 5 |
| Frontend | React + Vite + Tailwind CSS |
| Database | SQLite (conversation history) |

## Prerequisites

- Node.js 20+
- Docker (for Qdrant)
- Google Cloud project with Vertex AI API enabled
- `gcloud` CLI authenticated: `gcloud auth application-default login`

## Local Setup

### 1. Install dependencies

```bash
npm install
cd ui && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```env
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
CONFLUENCE_BASE_URL=https://your-org.atlassian.net
CONFLUENCE_EMAIL=you@your-org.com
CONFLUENCE_API_TOKEN=your-token
```

### 3. Start Qdrant

```bash
docker compose up -d
```

Qdrant dashboard: <http://localhost:6333/dashboard>

### 4. Ingest documents

Open the app and go to **Sources** in the sidebar. Configure your Confluence space (or other sources) and click **Sync**. Ingestion is resumable — if interrupted, it picks up from where it left off using the SQLite checkpoint log.

Alternatively, trigger ingestion via the API:

```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{"sources": [{"type": "confluence"}]}'
```

### 5. Start the app

```bash
# Terminal 1 — backend
npm run dev

# Terminal 2 — frontend
cd ui && npm run dev
```

Open <http://localhost:5173>

## Project Structure

```text
app/
  config.js              # All env vars in one place — fails fast on startup if missing
  server.js              # Express routes: /ask-stream, /ask-sources, /ingest
  llm/
    gemini.js            # Shared @google/genai client (Vertex AI)
    answer.js            # Answer generation helpers (normal / decision / debug modes)
  embeddings/
    embed.js             # Vertex AI embedding via gemini-embedding-001 (concurrency-limited, retry on 429)
    chunk.js             # Structure-aware chunker (heading-boundary splits, ~250 tokens)
  connectors/
    base.js              # BaseConnector interface — implement fetchDocuments()
    confluence.js        # Confluence REST API v2
    jira.js              # Jira REST API v3 (issue descriptions + comments)
    sharepoint.js        # Microsoft Graph API (auto token refresh)
    fileUpload.js        # PDF / Word / Excel / txt via dynamic imports
  ingestion/
    pipeline.js          # Orchestrates: connector → chunk → embed → upsert
  retrieval/
    search.js            # Query expansion → semantic search → score pruning → MMR
  vectorStore/
    qdrant.js            # Qdrant client: upsert, search, deleteByPageId
  db/
    conversations.js     # SQLite: conversations, messages, search_contexts, ingested_pages
  middleware/
    auth.js              # Auth stub — pass-through now, plug Entra ID later
    errorHandler.js      # Catch-all, never leaks stack traces
    validate.js          # Zod schemas for all request bodies
ui/
  src/
    pages/
      ChatPage.jsx       # Streaming chat with mode selector and sources panel
      SourcesPage.jsx    # Source configuration and manual ingestion trigger
    components/
      Layout.jsx         # Nav bar
docker-compose.yml       # Qdrant only — backend runs locally via npm run dev
```

## API Reference

### POST /ask-stream

Streams an answer token-by-token.

```json
{
  "question": "What is the our deployment process?",
  "mode": "normal",
  "history": [],
  "conversationId": "uuid"
}
```

`mode` options: `"normal"` | `"decision"` (explains a technical decision with trade-offs) | `"debug"` (root cause + suggested fix)

### POST /ask-sources

Returns the top retrieved sources without generating an answer.

```json
{ "question": "What is the our deployment process?" }
```

### POST /ingest

Triggers ingestion from configured sources.

```json
{
  "sources": [
    { "type": "confluence" },
    { "type": "jira" },
    { "type": "sharepoint" }
  ]
}
```

### GET /ingest/status

Returns the current ingestion state: vector count from Qdrant and page count from the SQLite checkpoint log.

```json
{
  "collection": "team-default",
  "vectors": 2317,
  "pages": 512,
  "last_synced_at": "2026-05-12T10:00:00Z"
}
```

### POST /ingest/files

Multipart form upload. Field name: `files`. Supports PDF, Word, Excel, txt.

## Adding a New Connector

1. Create `app/connectors/mySource.js` extending `BaseConnector`
2. Implement `fetchDocuments()` — return `[{ id, title, content, url, metadata }]`
3. Register it in `app/ingestion/pipeline.js` under the `type` switch

## Retrieval Pipeline

Each question goes through five stages:

1. **Query expansion** — Gemini expands acronyms and resolves pronouns using conversation history
2. **Semantic search** — Qdrant cosine similarity, retrieves `topK * 1.5` candidates
3. **Score pruning** — drops results below 15% of top score
4. **MMR diversification** — greedy selection balancing relevance (70%) vs. diversity (30%)
5. **LLM reranking** — Gemini picks the final top-K most relevant results

## Deployment Notes

- Qdrant runs on a GCE e2-small VM inside your GCP project (~$12–17/month). Data never leaves GCP.
- Auth middleware stub is at `app/middleware/auth.js`. Wire in Entra ID / API key verification there.
- Set `ALLOWED_ORIGINS` to your production frontend URL before deploying.
- Rate limit defaults: 20 requests/minute per IP on `/ask-stream` and `/ask-sources`.
