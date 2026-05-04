import { config } from "../config.js";

const TARGET_TOKENS = config.chunking.targetTokens;   // 250
const OVERLAP_TOKENS = config.chunking.overlapTokens; // 30

// ── Heading detection ────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,3})\s+(.+)$/m;

function isHeading(line) {
  return HEADING_RE.test(line);
}

function headingLevel(line) {
  const m = line.match(/^(#{1,3})\s/);
  return m ? m[1].length : 0;
}

// ── Token estimation ─────────────────────────────────────────────────────────
// ~4 chars per token (fast, no tokenizer load; accurate enough for splitting)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ── Structure-aware splitter ─────────────────────────────────────────────────
//
// Algorithm (two-pass):
//  Pass 1 — Split at structural boundaries: H1/H2/H3 headings, blank lines
//            after code blocks/tables. Produce "sections".
//  Pass 2 — If a section exceeds TARGET_TOKENS, split it further by sentences
//            with OVERLAP_TOKENS overlap so context is not lost.

function splitIntoSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = [];
  let inCode = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track fenced code blocks — never split inside them
    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      current.push(line);
      continue;
    }

    if (!inCode && isHeading(trimmed) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) sections.push(current.join("\n"));
  return sections.filter((s) => s.trim().length > 0);
}

function splitByTokens(text, targetTokens, overlapTokens) {
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + targetChars, text.length);

    // Snap end forward to a word boundary (don't cut mid-word)
    if (end < text.length) {
      const nextSpace = text.indexOf(" ", end);
      end = nextSpace === -1 ? text.length : nextSpace;
    }

    chunks.push(text.slice(start, end).trim());

    // Next chunk starts at (end - overlap), but must always be ahead of current start
    const nextStart = end - overlapChars;
    if (nextStart <= start) break; // can't advance — text shorter than one chunk
    start = nextStart;
  }

  return chunks.filter((c) => c.length > 0);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Chunk a document into semantically coherent pieces.
 * Each chunk includes a preamble: "Title > Heading Path" for better retrieval.
 *
 * @param {string} text      - Plain text content of the page
 * @param {string} title     - Page title (used in preamble)
 * @returns {{ text: string, title: string, headingPath: string }[]}
 */
export function chunkDocument(text, title) {
  const sections = splitIntoSections(text);
  const chunks = [];
  let currentHeadingPath = "";

  for (const section of sections) {
    const firstLine = section.split("\n")[0].trim();
    if (isHeading(firstLine)) {
      currentHeadingPath = firstLine.replace(/^#{1,3}\s+/, "");
    }

    const tokenCount = estimateTokens(section);

    if (tokenCount <= TARGET_TOKENS) {
      chunks.push(makeChunk(section, title, currentHeadingPath));
    } else {
      // Section too large — split further with overlap
      const subChunks = splitByTokens(section, TARGET_TOKENS, OVERLAP_TOKENS);
      for (const sub of subChunks) {
        if (sub.trim().length > 0) {
          chunks.push(makeChunk(sub, title, currentHeadingPath));
        }
      }
    }
  }

  return chunks;
}

function makeChunk(text, title, headingPath) {
  const preamble = headingPath
    ? `${title} > ${headingPath}\n\n`
    : `${title}\n\n`;
  return {
    text: preamble + text.trim(),
    title,
    headingPath,
  };
}

// Keep the old export for backwards compatibility with any scripts that used it
export function chunkText(text, chunkSize = 800, overlap = 150) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}
