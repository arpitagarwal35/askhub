import { useState } from "react";

const API = "http://localhost:3000";

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
        <label className="block text-sm font-medium mb-1">Source Type</label>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); setFields({}); }}
          className="border rounded px-3 py-2 text-sm w-full max-w-xs"
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {(SOURCE_FIELDS[type] ?? []).map((f) => (
        <div key={f.key}>
          <label className="block text-sm font-medium mb-1">{f.label}</label>
          <input
            type={f.type ?? "text"}
            placeholder={f.placeholder ?? ""}
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className="border rounded px-3 py-2 text-sm w-full max-w-sm"
          />
        </div>
      ))}

      <button
        type="submit"
        className="bg-gray-900 text-white text-sm px-4 py-2 rounded hover:bg-gray-700"
      >
        Add Source
      </button>
    </form>
  );
}

function FileUploadForm({ onIngest }) {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState(null);

  const handleUpload = async () => {
    if (files.length === 0) return;
    const form = new FormData();
    for (const f of files) form.append("files", f);

    setStatus("Uploading...");
    try {
      const res = await fetch(`${API}/ingest/files`, { method: "POST", body: form });
      const data = await res.json();
      setStatus(`Done — ${data.chunksCreated} chunks ingested from ${data.documentsIngested} documents.`);
      setFiles([]);
    } catch {
      setStatus("Upload failed. Check the server.");
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">Upload Files (PDF, Word, Excel, txt, md)</label>
      <input
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv"
        onChange={(e) => setFiles(Array.from(e.target.files))}
        className="text-sm"
      />
      {files.length > 0 && (
        <ul className="text-xs text-gray-600 list-disc list-inside">
          {files.map((f) => <li key={f.name}>{f.name}</li>)}
        </ul>
      )}
      <button
        onClick={handleUpload}
        disabled={files.length === 0}
        className="bg-gray-900 text-white text-sm px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-40"
      >
        Upload &amp; Ingest
      </button>
      {status && <p className="text-sm text-gray-600">{status}</p>}
    </div>
  );
}

export default function SourcesPage() {
  const [sources, setSources] = useState([]);
  const [ingestStatus, setIngestStatus] = useState(null);
  const [ingesting, setIngesting] = useState(false);

  const addSource = (source) => setSources((prev) => [...prev, source]);
  const removeSource = (i) => setSources((prev) => prev.filter((_, idx) => idx !== i));

  const runIngest = async () => {
    if (sources.length === 0) return;
    setIngesting(true);
    setIngestStatus("Ingesting...");
    try {
      const res = await fetch(`${API}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources }),
      });
      const data = await res.json();
      if (data.ok) {
        setIngestStatus(
          `Done — ${data.chunksCreated} chunks from ${data.documentsIngested} documents.${
            data.errors?.length > 0 ? ` (${data.errors.length} source(s) had errors)` : ""
          }`
        );
      } else {
        setIngestStatus("Ingestion failed. Check credentials.");
      }
    } catch {
      setIngestStatus("Request failed. Is the server running?");
    }
    setIngesting(false);
  };

  return (
    <div className="p-6 overflow-y-auto h-full max-w-2xl">
      <h2 className="text-xl font-semibold mb-6">Configure Sources</h2>

      {/* Configured sources list */}
      {sources.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-2 text-gray-700">Queued Sources</h3>
          <ul className="space-y-2">
            {sources.map((s, i) => (
              <li key={i} className="flex items-center justify-between border rounded px-3 py-2 bg-gray-50 text-sm">
                <span className="font-medium capitalize">{s.type}</span>
                <button onClick={() => removeSource(i)} className="text-red-500 text-xs hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center gap-4">
            <button
              onClick={runIngest}
              disabled={ingesting}
              className="bg-black text-white px-5 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {ingesting ? "Syncing..." : "Sync Now"}
            </button>
            {ingestStatus && <p className="text-sm text-gray-600">{ingestStatus}</p>}
          </div>
        </div>
      )}

      {/* Add source form */}
      <div className="mb-8">
        <h3 className="text-sm font-medium mb-4 text-gray-700">Add API Source</h3>
        <SourceForm onAdd={addSource} />
      </div>

      <hr className="my-6" />

      {/* File upload */}
      <div>
        <h3 className="text-sm font-medium mb-4 text-gray-700">Upload Documents</h3>
        <FileUploadForm />
      </div>
    </div>
  );
}
