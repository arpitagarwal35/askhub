import { search } from "./retrieval/search.js";
import {
  generateAnswer,
  generateDecisionAnswer,
  generateDebugAnswer
} from "./llm/answer.js";

async function main() {
  const question = "What does the onboarding process look like for new engineers?";

  const results = await search(question, 5);

  // Change mode here:
  const mode = "debug"; // "normal" | "decision" | "debug"

  let answer;

  if (mode === "decision") {
    answer = await generateDecisionAnswer(question, results);
  } else if (mode === "debug") {
    answer = await generateDebugAnswer(question, results);
  } else {
    answer = await generateAnswer(question, results);
  }

  console.log("\nMODE:", mode);
  console.log("\nQUESTION:", question);
  console.log("\nANSWER:\n", answer);
}

main();