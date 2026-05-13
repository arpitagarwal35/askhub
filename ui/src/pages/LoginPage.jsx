import { useState } from "react";
import { apiUrl } from "../lib/api.js";

export default function LoginPage({ onLogin }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(apiUrl("/ingest/status"), {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (res.ok) {
        onLogin(trimmed);
      } else if (res.status === 401) {
        setError("Invalid API key.");
      } else {
        setError(`Server error (${res.status}). Try again.`);
      }
    } catch {
      setError("Could not reach the server. Is it running?");
    }

    setLoading(false);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white border rounded-2xl p-8 w-full max-w-sm shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <span className="text-2xl">🔍</span>
          <span className="font-bold text-gray-900 text-xl tracking-tight">AskHub</span>
        </div>
        <p className="text-sm text-gray-500 mb-5">Enter the API key to access your knowledge base.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(null); }}
            placeholder="API key"
            autoFocus
            className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 transition-colors ${
              error ? "border-red-300 focus:ring-red-100" : "focus:ring-gray-200"
            }`}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={!key.trim() || loading}
            className="w-full bg-gray-900 text-white py-3 rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40"
          >
            {loading ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
