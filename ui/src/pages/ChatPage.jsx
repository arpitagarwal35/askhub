import ReactMarkdown from "react-markdown";
import { useState, useEffect, useRef } from "react";
import { apiUrl, apiHeaders } from "../lib/api.js";

const SUGGESTIONS = [
  "What are the main technical challenges the team is facing?",
  "How does the deployment process work?",
  "Summarize the latest architectural decisions.",
  "What does onboarding look like for new team members?",
];

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("normal");
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [conversationId] = useState(() => crypto.randomUUID());

  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const ask = async (question = input.trim()) => {
    if (!question || loading) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "bot", content: "", sources: [], streaming: true },
    ]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);

    const history = messages.slice(-6);

    try {
      const [streamRes, sourcesResult] = await Promise.all([
        fetch(apiUrl("/ask-stream"), {
          method: "POST",
          headers: apiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ question, mode, history, conversationId }),
        }),
        fetch(apiUrl("/ask-sources"), {
          method: "POST",
          headers: apiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ question }),
        })
          .then((r) => r.json())
          .catch(() => ({ sources: [] })),
      ]);

      if (!streamRes.ok) throw new Error(`Server error ${streamRes.status}`);

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
          updated[updated.length - 1] = { role: "bot", content: current, sources: [], streaming: true };
          return updated;
        });
      }

      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "bot",
          content: current,
          sources: sourcesResult.sources ?? [],
          streaming: false,
        };
        return updated;
      });
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "bot",
          content: "Something went wrong — please try again.",
          sources: [],
          streaming: false,
          error: true,
        };
        return updated;
      });
    }

    setLoading(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="px-6 py-2 border-b flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          {mode !== "normal" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize font-medium">
              {mode} mode
            </span>
          )}
        </div>
        <button
          onClick={() => setShowSettings((s) => !s)}
          title="Settings"
          className={`text-sm px-2 py-1 rounded transition-colors ${
            showSettings ? "text-gray-800 bg-gray-100" : "text-gray-400 hover:text-gray-600"
          }`}
        >
          ⚙ Settings
        </button>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <div className="px-6 py-3 border-b bg-gray-50 flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-500 font-medium">Response mode:</span>
          {["normal", "decision", "debug"].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setShowSettings(false); }}
              className={`text-xs px-3 py-1 rounded-full border capitalize transition-colors ${
                mode === m
                  ? "bg-gray-900 text-white border-gray-900"
                  : "text-gray-600 border-gray-300 hover:border-gray-500"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div>
              <p className="text-lg font-semibold text-gray-800">Ask your knowledge base</p>
              <p className="text-sm text-gray-400 mt-1">
                Answers are grounded in your connected docs
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="text-left text-sm px-4 py-3 rounded-xl border bg-white hover:border-gray-400 hover:shadow-sm transition-all text-gray-600"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`p-4 rounded-2xl max-w-[75%] ${
                    msg.role === "user"
                      ? "bg-black text-white rounded-br-sm"
                      : msg.error
                      ? "bg-red-50 border border-red-200 text-red-600 rounded-bl-sm"
                      : "bg-white border shadow-sm rounded-bl-sm"
                  }`}
                >
                  {msg.role === "bot" && msg.streaming && !msg.content ? (
                    <TypingDots />
                  ) : msg.role === "user" ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}

                  {msg.role === "bot" && !msg.streaming && msg.sources?.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600 select-none">
                        {msg.sources.length} source{msg.sources.length !== 1 ? "s" : ""}
                      </summary>
                      <div className="mt-2 space-y-2">
                        {msg.sources.map((s, j) => (
                          <div key={j} className="border rounded-lg p-2 bg-gray-50">
                            <div className="text-xs font-medium">
                              {s.url ? (
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {s.title}
                                </a>
                              ) : (
                                <span className="text-gray-700">{s.title}</span>
                              )}
                            </div>
                            {s.headingPath && (
                              <p className="text-xs text-gray-400 mt-0.5">{s.headingPath}</p>
                            )}
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {s.snippet?.substring(0, 200)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t bg-white shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => { setInput(e.target.value); resizeTextarea(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="Ask something… (Enter to send, Shift+Enter for new line)"
            className="flex-1 border rounded-xl px-4 py-3 text-sm resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow"
          />
          <button
            onClick={() => ask()}
            disabled={loading || !input.trim()}
            className="bg-gray-900 text-white px-5 py-3 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
