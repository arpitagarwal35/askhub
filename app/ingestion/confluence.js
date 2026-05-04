import axios from "axios";
import dotenv from "dotenv";
import * as cheerio from "cheerio";

dotenv.config();

const BASE_URL = process.env.CONFLUENCE_BASE_URL;
const EMAIL = process.env.CONFLUENCE_EMAIL;
const API_TOKEN = process.env.CONFLUENCE_API_TOKEN;

function cleanHTML(html) {
  const $ = cheerio.load(html);
  return $.text().replace(/\s+/g, " ").trim();
}

export async function fetchConfluencePages(limit = 5) {
  try {
    const response = await axios.get(`${BASE_URL}/rest/api/content`, {
      params: {
        limit,
        expand: "body.storage",
      },
      headers: {
        Authorization: `Bearer ${process.env.CONFLUENCE_API_TOKEN}`,
      }
    });

    return response.data.results.map((item) => ({
      title: item.title,
      content: cleanHTML(item.body.storage.value),
    }));
  } catch (error) {
    console.error(
      "Error fetching Confluence:",
      error.response?.data || error.message,
    );
    return [];
  }
}

export async function fetchPageById(pageId) {
  const response = await axios.get(
    `${BASE_URL}/rest/api/content/${pageId}`,
    {
      params: {
        expand: "body.storage"
      },
      headers: {
        Authorization: `Bearer ${process.env.CONFLUENCE_API_TOKEN}`,
        Accept: "application/json"
      }
    }
  );

  const item = response.data;

  return {
    id: item.id,
    title: item.title,
    content: cleanHTML(item.body.storage.value)
  };
}

export async function fetchChildPages(parentId) {
  const response = await axios.get(
    `${BASE_URL}/rest/api/content/${parentId}/child/page`,
    {
      params: {
        limit: 25,
        expand: "body.storage"
      },
      headers: {
        Authorization: `Bearer ${process.env.CONFLUENCE_API_TOKEN}`,
        Accept: "application/json"
      }
    }
  );

  return response.data.results.map(item => ({
    id: item.id,
    title: item.title,
    content: cleanHTML(item.body.storage.value),
    parentId: parentId
  }));
}

export async function fetchPageTreeLimited(
  pageId,
  depth = 0,
  maxDepth = 2,
  pageCounter = { count: 0 },
  maxPages = 50
) {
  // Stop conditions
  if (depth > maxDepth || pageCounter.count >= maxPages) {
    return [];
  }

  const root = await fetchPageById(pageId);
  pageCounter.count++;

  console.log(`Fetched [${pageCounter.count}] Depth ${depth}: ${root.title}`);

  const allPages = [root];

  // Stop if limit reached
  if (pageCounter.count >= maxPages) {
    return allPages;
  }

  const children = await fetchChildPages(pageId);

  for (const child of children) {
    if (pageCounter.count >= maxPages) break;

    const subTree = await fetchPageTreeLimited(
      child.id,
      depth + 1,
      maxDepth,
      pageCounter,
      maxPages
    );

    allPages.push(...subTree);

    // small delay to avoid overload
    await new Promise(r => setTimeout(r, 100));
  }

  return allPages;
}