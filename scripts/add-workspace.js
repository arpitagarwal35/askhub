#!/usr/bin/env node
/**
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=my-project \
 *     node scripts/add-workspace.js --name=platform-team --pages=123456,789012
 *
 * Generates an API key, registers the workspace in Secret Manager under the
 * existing test-service-config secret (workspaces key), then redeploys Cloud Run
 * with the updated WORKSPACES_JSON env var.
 */

import { spawnSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import crypto from "crypto";

// ── Parse args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const eq = a.indexOf("=");
      return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
    })
);

const name = args.name;
const pages = args.pages
  ? args.pages.split(",").map((s) => s.trim()).filter(Boolean)
  : [];
const excludePages = args.exclude
  ? args.exclude.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

if (!name) {
  console.error("Usage: node scripts/add-workspace.js --name=<name> [--pages=<id1,id2>] [--exclude=<id1,id2>]");
  process.exit(1);
}

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const REGION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
if (!PROJECT) {
  console.error("GOOGLE_CLOUD_PROJECT is required");
  process.exit(1);
}

const SECRET = "test-service-config";
const SERVICE = "test-service";

// ── Helpers ───────────────────────────────────────────────────────────────────
function gcloud(...gArgs) {
  const result = spawnSync("gcloud", gArgs, { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
  return result.stdout.trim();
}

// ── Read current secret ───────────────────────────────────────────────────────
console.log("Reading current config from Secret Manager...");
const configRaw = gcloud(
  "secrets", "versions", "access", "latest",
  `--secret=${SECRET}`, `--project=${PROJECT}`
);

const config = JSON.parse(configRaw);

// workspaces is stored as a JSON string inside the secret object
const workspaces = config.workspaces ? JSON.parse(config.workspaces) : [];

if (workspaces.some((ws) => ws.name === name)) {
  console.error(`Workspace "${name}" already exists`);
  process.exit(1);
}

// ── Register workspace ────────────────────────────────────────────────────────
const apiKey = crypto.randomBytes(32).toString("hex");
const collection = name.toLowerCase();

workspaces.push({ name, apiKey, collection, pageIds: pages, excludePageIds: excludePages });
config.workspaces = JSON.stringify(workspaces);

const updatedConfigJson = JSON.stringify(config);
const tmpSecret = `/tmp/askhub-secret-${Date.now()}.json`;
writeFileSync(tmpSecret, updatedConfigJson);

console.log("Updating Secret Manager...");
gcloud(
  "secrets", "versions", "add", SECRET,
  `--project=${PROJECT}`, `--data-file=${tmpSecret}`
);
unlinkSync(tmpSecret);

// ── Redeploy Cloud Run with updated WORKSPACES_JSON ───────────────────────────
// Use spawnSync with an args array to safely pass JSON without shell-quoting issues.
// The ^|^ prefix tells gcloud to use | as the key=value pair delimiter,
// so commas inside the JSON value are not misinterpreted.
const workspacesJson = JSON.stringify(workspaces);
console.log("Redeploying Cloud Run with updated WORKSPACES_JSON...");
const deploy = spawnSync(
  "gcloud",
  [
    "run", "services", "update", SERVICE,
    `--region=${REGION}`,
    `--project=${PROJECT}`,
    `--update-env-vars=^|^WORKSPACES_JSON=${workspacesJson}`,
    "--quiet",
  ],
  { stdio: "inherit", encoding: "utf8" }
);

if (deploy.status !== 0) {
  console.error("Cloud Run update failed");
  process.exit(1);
}

// ── Done ──────────────────────────────────────────────────────────────────────
console.log(`
Workspace registered:
  Name       : ${name}
  Collection : ${collection}
  Page IDs   : ${pages.length > 0 ? pages.join(", ") : "(none — add via --pages)"}
  API Key    : ${apiKey}

This is the only time the API key is shown — save it now.
`);
