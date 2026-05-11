import { getEmbedding } from "../embeddings/embed.js";
import { semanticSearch } from "../vectorStore/qdrant.js";
import { config } from "../config.js";
import { ai } from "../llm/gemini.js";
import pino from "pino";

const log = pino({ level: "info" });

// ── Query expansion ───────────────────────────────────────────────────────────
// Expands acronyms, adds synonyms, resolves pronouns using recent history.
// Returns an expanded query string.

async function expandQuery(query, history = []) {
  const historySnippet = history
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const prompt = `You are a search query optimizer for an internal engineering knowledge base.

Given the user query below, return an improved search query that:
- Expands acronyms where possible
- Adds relevant synonyms
- Resolves any pronouns using the conversation history

Conversation history (for pronoun context):
${historySnippet || "(none)"}

User query: ${query}

Return ONLY the improved query — no explanation, no quotes.`;

  try {
    const result = await ai.models.generateContent({
      model: config.gcp.llmModel,
      contents: prompt,
      config: { temperature: 0 },
    });
    const expanded = result.text.trim();
    log.info({ original: query, expanded }, "Query expanded");
    return expanded || query;
  } catch {
    return query;
  }
}

// ── Score pruning ─────────────────────────────────────────────────────────────
// Drop results with score < threshold * topScore (removes noisy long-tail)

function pruneByScore(results, thresholdFraction = config.retrieval.scoreThresholdFraction) {
  if (results.length === 0) return results;
  const topScore = results[0].score;
  return results.filter((r) => r.score >= topScore * thresholdFraction);
}

// ── MMR (Maximal Marginal Relevance) ──────────────────────────────────────────
// Greedy selection: λ * relevance - (1-λ) * max_similarity_to_selected
// Reduces near-duplicate results while keeping distinct content.

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function applyMMR(results, k, lambda = config.retrieval.mmrLambda) {
  if (results.length <= k) return results;

  const selected = [];
  const candidates = [...results];

  while (selected.length < k && candidates.length > 0) {
    let bestScore = -Infinity;
    let bestIdx = 0;

    for (let i = 0; i < candidates.length; i++) {
      const relevance = candidates[i].score;
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((s) =>
            s._vector && candidates[i]._vector
              ? cosineSimilarity(s._vector, candidates[i]._vector)
              : 0
          ));

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(candidates[bestIdx]);
    candidates.splice(bestIdx, 1);
  }

  return selected.map(({ _vector, ...rest }) => rest);
}

// ── Public search function ────────────────────────────────────────────────────

export async function search(query, topK = config.retrieval.topK, history = []) {
  const expandedQuery = await expandQuery(query, history);

  const queryVector = await getEmbedding(expandedQuery);
  // Over-retrieve to give MMR more candidates to diversify from
  const rawResults = await semanticSearch(queryVector, Math.ceil(topK * 1.5));

  const pruned = pruneByScore(rawResults);
  log.info({ raw: rawResults.length, afterPrune: pruned.length }, "Search results");

  // Attach vectors for MMR similarity (would require Qdrant to return vectors;
  // for now we skip cross-result similarity and just use score-based MMR)
  const final = applyMMR(pruned, topK);

  return final;
}
