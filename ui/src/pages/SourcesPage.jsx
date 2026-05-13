import { useState, useEffect, useRef } from "react";
import { apiUrl, apiHeaders } from "../lib/api.js";

const SOURCE_TYPES = [
  { value: "confluence", label: "Confluence" },
  { value: "jira", label: "Jira" },
  { value: "sharepoint", label: "SharePoint" },
];

const SOURCE_FIELDS = {
  confluence: [
    { key: "baseUrl", label: "Base URL", placeholder: "https://your-org.atlassian.net" },
    { key: "email", label: "Email", placeholder: "you@org.com" },
    { key: "apiToken", label: "API Token", type: "password" },
    { key: "spaceKey", label: "Space Key", placeholder: "MYSPACE (or leave blank to use page ID)" },
    { key: "pageId", label: "Root Page ID", placeholder: "123456 (optional)" },
    { key: "excludePageIds", label: "Exclude Page IDs", placeholder: "123456,789012 (comma-separated, skips page and all children)" },
  ],
  jira: [
    { key: "baseUrl", label: "Base URL", placeholder: "https://your-org.atlassian.net" },
    { key: "email", label: "Email", placeholder: "you@org.com" },
    { key: "apiToken", label: "API Token", type: "password" },
    { key: "projectKey", label: "Project Key", placeholder: "MYPROJECT" },
  ],
  sharepoint: [
    { key: "tenantId", label: "Tenant ID" },
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret", type: "password" },
    { key: "siteId", label: "Site ID" },
  ],
};

function SourceForm({ onAdd }) {
  const [type, setType] = useState("confluence");
  const [fields, setFields] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    onAdd({ type, config: fields });
    setFields({});
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Source type</label>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); setFields({}); }}
          className="border rounded-lg px-3 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-gray-200"
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {(SOURCE_FIELDS[type] ?? []).map((f) => (
        <div key={f.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
          <input
            type={f.type ?? "text"}
            placeholder={f.placeholder ?? ""}
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className="border rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </div>
      ))}

      <button
        type="submit"
        className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
      >
        Add source
      </button>
    </form>
  );
}

function FileUploadSection() {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (files.length === 0) return;
    const form = new FormData();
    for (const f of files) form.append("files", f);

    setUploading(true);
    setStatus(null);
    try {
      const res = await fetch(apiUrl("/ingest/files"), { method: "POST", headers: apiHeaders(), body: form });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus({ type: "success", text: `Done — ${data.chunksCreated} chunks ingested from ${data.documentsIngested} document(s).` });
        setFiles([]);
      } else {
        setStatus({ type: "error", text: data.error ?? "Upload failed. Check the server." });
      }
    } catch {
      setStatus({ type: "error", text: "Request failed. Is the server running?" });
    }
    setUploading(false);
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Upload documents <span className="text-gray-400 font-normal">(PDF, Word, Excel, txt, md)</span>
      </label>
      <input
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv"
        onChange={(e) => { setFiles(Array.from(e.target.files)); setStatus(null); }}
        className="text-sm text-gray-600"
      />
      {files.length > 0 && (
        <ul className="text-xs text-gray-500 space-y-0.5 pl-1">
          {files.map((f) => <li key={f.name} className="flex items-center gap-1">📄 {f.name}</li>)}
        </ul>
      )}
      <button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-40"
      >
        {uploading ? "Uploading…" : "Upload & ingest"}
      </button>
      {status && (
        <p className={`text-sm ${status.type === "error" ? "text-red-600" : "text-green-700"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}

function useElapsedSeconds(running) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);
  useEffect(() => {
    if (running) {
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);
  return elapsed;
}

export default function SourcesPage() {
  const [sources, setSources] = useState([]);
  const [ingestStatus, setIngestStatus] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const elapsed = useElapsedSeconds(ingesting);

  const addSource = (source) => setSources((prev) => [...prev, source]);
  const removeSource = (i) => setSources((prev) => prev.filter((_, idx) => idx !== i));

  const runIngest = async () => {
    if (sources.length === 0) return;
    setIngesting(true);
    setIngestStatus(null);
    try {
      const res = await fetch(apiUrl("/ingest"), {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ sources }),
      });
      const data = await res.json();
      if (data.ok) {
        setIngestStatus({
          type: "success",
          text: `Done — ${data.chunksCreated} chunks from ${data.documentsIngested} document(s).${
            data.errors?.length > 0 ? ` (${data.errors.length} source(s) had errors)` : ""
          }`,
        });
        setSources([]);
      } else {
        setIngestStatus({ type: "error", text: "Ingestion failed. Check your source credentials." });
      }
    } catch {
      setIngestStatus({ type: "error", text: "Request failed. Is the server running?" });
    }
    setIngesting(false);
  };

  return (
    <div className="p-6 overflow-y-auto h-full max-w-2xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Sources</h2>
        <p className="text-sm text-gray-400 mt-1">Connect knowledge sources and sync them into AskHub.</p>
      </div>

      {/* Add API source */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Add API source</h3>
        <SourceForm onAdd={addSource} />
      </section>

      {/* Queued sources */}
      {sources.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Queued ({sources.length})
          </h3>
          <ul className="space-y-2 mb-4">
            {sources.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between border rounded-lg px-4 py-3 bg-white text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="font-medium capitalize text-gray-700">{s.type}</span>
                  {s.config?.spaceKey && (
                    <span className="text-gray-400 text-xs">{s.config.spaceKey}</span>
                  )}
                  {s.config?.projectKey && (
                    <span className="text-gray-400 text-xs">{s.config.projectKey}</span>
                  )}
                </div>
                <button
                  onClick={() => removeSource(i)}
                  className="text-gray-400 hover:text-red-500 text-xs transition-colors"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-4">
            <button
              onClick={runIngest}
              disabled={ingesting}
              className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {ingesting ? `Syncing… ${elapsed}s` : "Sync now"}
            </button>
            {ingestStatus && (
              <p className={`text-sm ${ingestStatus.type === "error" ? "text-red-600" : "text-green-700"}`}>
                {ingestStatus.text}
              </p>
            )}
          </div>
        </section>
      )}

      <hr className="border-gray-100" />

      {/* File upload */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Upload documents</h3>
        <FileUploadSection />
      </section>
    </div>
  );
}
