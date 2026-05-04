import { ai } from "./gemini.js";
import { config } from "../config.js";

async function generate(prompt) {
  const response = await ai.models.generateContent({
    model: config.gcp.llmModel,
    contents: prompt,
    config: { temperature: 0.2 },
  });
  return response.text;
}

function buildContext(contextChunks) {
  return contextChunks
    .map((c, i) => `Source ${i + 1}:\n${c.content}`)
    .join("\n\n");
}

export async function generateAnswer(question, contextChunks) {
  const context = buildContext(contextChunks);
  return generate(`Answer using clean Markdown.

- Use bullet points where helpful
- Keep it concise
- Avoid long paragraphs

Context:
${context}

Question:
${question}`);
}

export async function generateDecisionAnswer(question, contextChunks) {
  const context = buildContext(contextChunks);
  return generate(`You are a senior engineering assistant.

Format your answer in clean Markdown.

Rules:
- Use headings (##)
- Use bullet points
- Keep sentences short
- Make it easy to scan

Explain:
1. What decision was made
2. Why it was made
3. Trade-offs

Context:
${context}

Question:
${question}

Answer:`);
}

export async function generateDebugAnswer(question, contextChunks) {
  const context = buildContext(contextChunks);
  return generate(`You are a senior backend engineer.

A user is facing an issue. Based on context:

1. Possible root cause
2. Similar past issues (if any)
3. Suggested fix

If unsure, say "I don't know".

Context:
${context}

Issue:
${question}

Answer clearly.`);
}
