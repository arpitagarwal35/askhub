import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import { config } from "./config.js";
import { ai } from "./llm/gemini.js";
import { search } from "./retrieval/search.js";
import { auth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { validate, askStreamSchema, askSourcesSchema, ingestSchema } from "./middleware/validate.js";
import { addMessage, saveSearchContext } from "./db/conversations.js";
import { runIngestionPipeline } from "./ingestion/pipeline.js";
import multer from "multer";

const upload = multer({ dest: "data/uploads/" });
const log = pino({ level: "info" });

const app = express();

// ── Global middleware ─────────────────────────────────────────────────────────
const corsOptions = { origin: config.server.allowedOrigins, credentials: true };
app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({
  windowMs: config.server.rateLimitWindowMs,
  max: config.server.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});
app.use("/ask-stream", limiter);
app.use("/ask-sources", limiter);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function rerankResults(question, results) {
  const prompt = `Select the ${config.retrieval.finalK} most relevant results for answering the question.

Question:
${question}

Results:
${results.map((r, i) => `${i + 1}. ${r.title}`).join("\n")}

Return ONLY numbers like: 1,3,5`;

  const response = await ai.models.generateContent({
    model: config.gcp.llmModel,
    contents: prompt,
    config: { temperature: 0 },
  });

  const text = response.text;
  const indices = text
    .split(",")
    .map((n) => parseInt(n.trim()) - 1)
    .filter((n) => !isNaN(n) && n >= 0 && n < results.length);

  return indices.length > 0
    ? indices.map((i) => results[i]).filter(Boolean)
    : results.slice(0, config.retrieval.finalK);
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.post("/ask-stream", auth, validate(askStreamSchema), async (req, res, next) => {
  try {
    const { question, mode, history, conversationId } = req.body;
    const convId = conversationId ?? crypto.randomUUID();

    log.info({ question, mode, convId }, "ask-stream");

    const results = await search(question, config.retrieval.topK, history);
    const reranked = await rerankResults(question, results);

    const context = reranked
      .map((r, i) => `Source ${i + 1}:\nTitle: ${r.title}\n\n${r.content}`)
      .join("\n\n");

    const conversation = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const prompt = `You are a senior engineering assistant.

Use BOTH:
1. Conversation history
2. Retrieved context

Rules:
- Use history to understand follow-up questions
- Use context to answer accurately
- Do NOT guess. If not found, say "I don't know"
- Do not repeat previous answers

Format:
- Use headings
- Use bullet points
- Keep it readable

Conversation:
${conversation}

Context:
${context}

User Question:
${question}

Answer:`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const stream = await ai.models.generateContentStream({
      model: config.gcp.llmModel,
      contents: prompt,
      config: { temperature: 0.2 },
    });

    let fullResponse = "";
    for await (const chunk of stream) {
      const token = chunk.text ?? "";
      if (token) {
        res.write(token);
        fullResponse += token;
      }
    }

    res.end();

    // Persist conversation (fire-and-forget, non-blocking)
    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();
    addMessage(convId, userMsgId, "user", question);
    addMessage(convId, assistantMsgId, "assistant", fullResponse);
    saveSearchContext(assistantMsgId, question, results.map((r) => ({ title: r.title, score: r.score })));
  } catch (err) {
    next(err);
  }
});

app.post("/ask-sources", auth, validate(askSourcesSchema), async (req, res, next) => {
  try {
    const { question } = req.body;
    const results = await search(question, config.retrieval.topK);

    res.json({
      sources: results.map((r) => ({
        title: r.title,
        content: r.content,
        url: r.url ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── Ingest route ──────────────────────────────────────────────────────────────
app.post("/ingest", auth, validate(ingestSchema), async (req, res, next) => {
  try {
    const { sources } = req.body;
    log.info({ sources: sources.map((s) => s.type) }, "Ingestion started");
    const stats = await runIngestionPipeline(sources);
    res.json({ ok: true, ...stats });
  } catch (err) {
    next(err);
  }
});

app.post("/ingest/files", auth, upload.array("files"), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const files = req.files.map((f) => ({
      path: f.path,
      originalName: f.originalname,
    }));

    const stats = await runIngestionPipeline([{ type: "file", files }]);
    res.json({ ok: true, ...stats });
  } catch (err) {
    next(err);
  }
});

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

app.listen(config.server.port, () => {
  log.info({ port: config.server.port }, "Server running");
});
