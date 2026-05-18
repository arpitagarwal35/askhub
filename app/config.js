import dotenv from "dotenv";
import { readFileSync } from "fs";
dotenv.config();

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const isProd = (process.env.NODE_ENV ?? "development") === "production";

// Workspace registry — keyed by API key.
// Load order: WORKSPACES_JSON env var → workspaces.json file → fail (prod) / warn (dev).
export const workspacesByKey = new Map();

function loadWorkspaces(list) {
  for (const ws of list) workspacesByKey.set(ws.apiKey, ws);
}

if (process.env.WORKSPACES_JSON) {
  try {
    loadWorkspaces(JSON.parse(process.env.WORKSPACES_JSON));
  } catch (e) {
    throw new Error(`Invalid WORKSPACES_JSON: ${e.message}`);
  }
} else {
  try {
    loadWorkspaces(JSON.parse(readFileSync("workspaces.json", "utf8")));
  } catch {
    if (isProd) {
      throw new Error("No workspaces configured. Set WORKSPACES_JSON or provide workspaces.json.");
    } else {
      console.warn("[AskHub] No workspaces configured — running in no-auth dev mode.");
    }
  }
}

export const config = {
  // Google Cloud / Vertex AI
  gcp: {
    project: required("GOOGLE_CLOUD_PROJECT"),
    location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
    llmModel: process.env.VERTEX_LLM_MODEL ?? "gemini-2.5-flash",
    embeddingModel: process.env.VERTEX_EMBEDDING_MODEL ?? "gemini-embedding-001",
  },

  // Qdrant vector store (collection is workspace-scoped, not global)
  qdrant: {
    url: process.env.QDRANT_URL ?? "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY,
  },

  // Chunking
  chunking: {
    targetTokens: parseInt(process.env.CHUNK_TARGET_TOKENS ?? "250"),
    overlapTokens: parseInt(process.env.CHUNK_OVERLAP_TOKENS ?? "30"),
  },

  // Retrieval
  retrieval: {
    topK: parseInt(process.env.RETRIEVAL_TOP_K ?? "10"),
    finalK: parseInt(process.env.RETRIEVAL_FINAL_K ?? "5"),
    scoreThresholdFraction: parseFloat(process.env.SCORE_THRESHOLD_FRACTION ?? "0.15"),
    mmrLambda: parseFloat(process.env.MMR_LAMBDA ?? "0.7"),
  },

  // Server
  server: {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: parseInt(process.env.PORT ?? "3000"),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(","),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000"),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? "20"),
  },

  // Confluence
  confluence: {
    baseUrl: process.env.CONFLUENCE_BASE_URL,
    email: process.env.CONFLUENCE_EMAIL,
    apiToken: process.env.CONFLUENCE_API_TOKEN,
    excludePageIds: (process.env.CONFLUENCE_EXCLUDE_PAGE_IDS ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean),
  },

  // Jira
  jira: {
    baseUrl: process.env.JIRA_BASE_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    projectKey: process.env.JIRA_PROJECT_KEY,
  },

  // SharePoint / Microsoft Graph
  sharepoint: {
    tenantId: process.env.SHAREPOINT_TENANT_ID,
    clientId: process.env.SHAREPOINT_CLIENT_ID,
    clientSecret: process.env.SHAREPOINT_CLIENT_SECRET,
    siteId: process.env.SHAREPOINT_SITE_ID,
  },
};
