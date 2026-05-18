import { workspacesByKey } from "../config.js";

// No-auth default for local dev (no WORKSPACES_JSON configured)
const DEV_WORKSPACE = { name: "default", collection: "team-default", pageIds: [] };

export function auth(req, res, next) {
  if (workspacesByKey.size === 0) {
    req.workspace = DEV_WORKSPACE;
    return next();
  }

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const workspace = workspacesByKey.get(token);

  if (!workspace) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.workspace = workspace;
  next();
}
