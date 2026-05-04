import { ai } from "../llm/gemini.js";
import { config } from "../config.js";

export async function getEmbedding(text) {
  const response = await ai.models.embedContent({
    model: config.gcp.embeddingModel,
    contents: text,
  });
  return response.embeddings[0].values;
}
