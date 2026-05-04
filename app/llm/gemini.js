import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

export const ai = new GoogleGenAI({
  vertexai: true,
  project: config.gcp.project,
  location: config.gcp.location,
});
