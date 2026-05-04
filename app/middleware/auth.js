// Auth stub — passes all requests through for now.
// To add authentication (Entra ID, API key, etc.), replace this middleware.
export function auth(req, res, next) {
  next();
}
