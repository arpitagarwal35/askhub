import ReactMarkdown from "react-markdown";
import { useState, useEffect, useRef } from "react";

const API = "http://localhost:3000";

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("normal");
  const [loading, setLoading] = useState(false);
  const [conversationId] = useState(() => crypto.randomUUID());

  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const ask = async () => {
    if (!input.trim()) return;

    const question = input.trim();
    const userMessage = { role: "user", content: question };
    const botMessage = { role: "bot", content: "", sources: [] };

    setMessages((prev) => [...prev, userMessage, botMessage]);
    setInput("");
    setLoading(true);

    const history = messages.slice(-6);

    const [streamRes, sourcesPromise] = await Promise.all([
      fetch(`${API}/ask-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode, history, conversationId }),
      }),
      fetch(`${API}/ask-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      }).then((r) => r.json()).catch(() => ({ sources: [] })),
    ]);

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let current = "";

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      current += decoder.decode(value);

      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "bot", content: current, sources: [] };
        return updated;
      });
    }

    setMessages((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = {
        role: "bot",
        content: current,
        sources: sourcesPromise.sources ?? [],
      };
      return updated;
    });

    setLoading(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Mode selector */}
      <div className="px-6 py-2 border-b flex items-center gap-3 bg-white">
        <span className="text-sm text-gray-500">Mode:</span>
        {["normal", "decision", "debug"].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-sm px-3 py-1 rounded capitalize ${
              mode === m ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20 text-sm">
            Ask anything about your knowledge base.
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`p-4 rounded-lg max-w-[70%] ${
                msg.role === "user"
                  ? "bg-black text-white"
                  : "bg-white border shadow-sm"
              }`}
            >
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>

              {msg.role === "bot" && msg.sources?.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                    Sources ({msg.sources.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {msg.sources.map((s, j) => (
                      <div key={j} className="border p-2 rounded bg-gray-50">
                        <div className="font-medium text-xs">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline text-blue-600">
                              {s.title}
                            </a>
                          ) : (
                            s.title
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {s.content.substring(0, 200)}…
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border px-4 py-2 rounded-lg shadow-sm text-sm text-gray-400">
              Thinking…
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t flex gap-2 bg-white">
        <input
          className="flex-1 border p-3 rounded text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) ask(); }}
          placeholder="Ask something about your knowledge base…"
        />
        <button
          onClick={ask}
          disabled={loading || !input.trim()}
          className="bg-black text-white px-6 rounded text-sm disabled:opacity-40 hover:bg-gray-800"
        >
          Send
        </button>
      </div>
    </div>
  );
}
