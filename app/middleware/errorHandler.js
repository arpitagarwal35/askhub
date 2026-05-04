import pino from "pino";

const log = pino({ level: "error" });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  log.error({ err, path: req.path }, "Unhandled error");
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({ error: "Something went wrong. Please try again." });
}
