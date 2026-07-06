import { useState, useRef, useEffect } from "react";
import type { LogEntry } from "./ToolPanel";
import type { AuditEntry } from "tiptap-apcore";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { moduleId: string; inputs: Record<string, unknown>; result: Record<string, unknown> }[];
}

interface ProviderModel {
  id: string;
  name: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  models: ProviderModel[];
}

interface ChatPanelProps {
  getEditorHtml: () => string;
  role: "readonly" | "editor" | "admin";
  onEditorUpdate: (html: string) => void;
  onLog: (entry: LogEntry) => void;
  onAudit: (entries: AuditEntry[]) => void;
  onUndo: () => void;
  onClearHistory: () => void;
  historyCount: number;
  maxHistory: number;
}

const UNDO_PATTERNS = /^(undo|cancel|revert)$/i;
const REDO_PATTERNS = /^(redo)$/i;

export default function ChatPanel({
  getEditorHtml,
  role,
  onEditorUpdate,
  onLog,
  onAudit,
  onUndo,
  onClearHistory,
  historyCount,
  maxHistory,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        if (data.defaultModel) setModel(data.defaultModel);
        if (data.providers) setProviders(data.providers);
      })
      .catch(() => setModel("openai:gpt-4o"));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");

    // Fast path: handle undo/cancel/redo locally without API call
    if (UNDO_PATTERNS.test(text)) {
      onUndo();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Done — reverted to the previous version." },
      ]);
      return;
    }
    if (REDO_PATTERNS.test(text)) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Redo is not supported via chat. Use Ctrl+Y / Cmd+Shift+Z in the editor." },
      ]);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          editorHtml: getEditorHtml(),
          model,
          role,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // Log tool calls
      if (data.toolCalls && data.toolCalls.length > 0) {
        for (const tc of data.toolCalls) {
          onLog({
            type: "success",
            message: `AI: ${tc.moduleId}(${JSON.stringify(tc.inputs)}) -> ${JSON.stringify(tc.result)}`,
            timestamp: Date.now(),
          });
        }
      }

      // Update editor with new HTML
      if (data.updatedHtml) {
        onEditorUpdate(data.updatedHtml);
      }

      // Surface the server-side ACL audit trail (the AI's tool calls) in the panel.
      if (Array.isArray(data.audit)) {
        onAudit(data.audit as AuditEntry[]);
      }

      // Add assistant response
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.reply,
        toolCalls: data.toolCalls,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog({
        type: "error",
        message: `Chat error: ${msg}`,
        timestamp: Date.now(),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="card chat-panel">
      <h2>AI Chat</h2>

      <div className="chat-model-selector">
        <label htmlFor="model-select">Model:</label>
        {providers.length > 0 ? (
          <select
            id="model-select"
            className="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {providers.map((provider) => (
              <optgroup
                key={provider.id}
                label={`${provider.name}${provider.configured ? "" : " (no key)"}`}
              >
                {provider.models.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={!provider.configured}
                  >
                    {m.name}{!provider.configured ? " — key not set" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <input
            id="model-select"
            type="text"
            className="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="provider:model"
          />
        )}
      </div>

      <div className="chat-history-controls">
        <button
          className="chat-undo-btn"
          onClick={onUndo}
          disabled={historyCount === 0}
          title="Undo last AI edit"
        >
          Undo
        </button>
        <span className="chat-history-count">
          {historyCount}/{maxHistory}
        </span>
        {historyCount > 0 && (
          <button
            className="chat-clear-history-btn"
            onClick={onClearHistory}
            title="Clear edit history"
          >
            Clear
          </button>
        )}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask AI to edit your document. It will use TipTap tools with ACL role: <strong>{role}</strong>.
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="chat-message-label">
              {msg.role === "user" ? "You" : "AI"}
            </div>
            <div className="chat-message-content">{msg.content}</div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <details className="chat-tool-calls">
                <summary>{msg.toolCalls.length} tool call{msg.toolCalls.length > 1 ? "s" : ""}</summary>
                <div className="tool-call-list">
                  {msg.toolCalls.map((tc, j) => (
                    <div key={j} className="tool-call-item">
                      <span className="tool-call-name">{tc.moduleId}</span>
                      <span className="tool-call-args">{JSON.stringify(tc.inputs)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-message assistant">
            <div className="chat-message-label">AI</div>
            <div className="chat-message-content chat-loading">
              <span className="dot-pulse"></span>
              Thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI to edit the document..."
          rows={2}
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
