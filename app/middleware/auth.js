import { config } from "../config.js";

export function auth(req, res, next) {
  const { apiKey } = config.server;
  if (!apiKey) return next();

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (token !== apiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
