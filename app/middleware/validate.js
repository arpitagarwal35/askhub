import { z } from "zod";

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const historyMessage = z.object({
  role: z.enum(["user", "bot", "assistant"]),
  content: z.string().max(4000),
});

export const askStreamSchema = z.object({
  question: z.string().min(1).max(2000),
  mode: z.enum(["normal", "decision", "debug"]).default("normal"),
  history: z.array(historyMessage).max(20).default([]),
  conversationId: z.string().uuid().optional(),
});

export const askSourcesSchema = z.object({
  question: z.string().min(1).max(2000),
});

export const ingestSchema = z.object({
  sources: z.array(
    z.object({
      type: z.enum(["confluence", "jira", "sharepoint", "file"]),
      config: z.record(z.string()).optional(),
    })
  ).min(1),
});
