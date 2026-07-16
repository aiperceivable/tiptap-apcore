import { useState, useEffect } from "react";

interface McpStatus {
  initialized: boolean;
  toolCount: number;
}

export default function MCPDemo() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch("/api/mcp-status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (active) {
          setStatus(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="mcp-demo">
      {/* Status Card */}
      <div className="card mcp-status-card">
        <h2>MCP Server Status</h2>
        <div className="mcp-status-row">
          <span
            className={`mcp-status-dot ${status?.initialized ? "online" : "offline"}`}
          />
          <span className="mcp-status-label">
            {error
              ? "Error"
              : status?.initialized
                ? "Online"
                : "Initializing..."}
          </span>
        </div>
        {error && <div className="mcp-error">{error}</div>}
        {status?.initialized && (
          <div className="mcp-status-details">
            <div className="mcp-detail">
              <span className="mcp-detail-label">Tools</span>
              <span className="mcp-detail-value">{status.toolCount}</span>
            </div>
            <div className="mcp-detail">
              <span className="mcp-detail-label">Endpoint</span>
              <code className="mcp-detail-value">/mcp</code>
            </div>
            <div className="mcp-detail">
              <span className="mcp-detail-label">Transport</span>
              <span className="mcp-detail-value">Streamable HTTP</span>
            </div>
          </div>
        )}
      </div>

      {/* Explorer Card */}
      <div className="card mcp-explorer-card">
        <h2>Tool Explorer</h2>
        <p className="mcp-explorer-desc">
          Interactive UI for browsing and executing tiptap-apcore tools via MCP.
        </p>
        <div className="mcp-iframe-wrapper">
          <iframe
            src="/explorer"
            title="MCP Tool Explorer"
            className="mcp-iframe"
          />
        </div>
      </div>

      {/* Connect Card */}
      <div className="card mcp-connect-card">
        <h2>Connect an MCP Client</h2>
        <div className="mcp-snippets">
          <div className="mcp-snippet">
            <h3>Claude Desktop</h3>
            <pre>
              <code>{`{
  "mcpServers": {
    "tiptap-apcore": {
      "url": "http://localhost:8000/mcp"
    }
  }
}`}</code>
            </pre>
          </div>

          <div className="mcp-snippet">
            <h3>Cursor / VS Code</h3>
            <pre>
              <code>{`{
  "mcpServers": {
    "tiptap-apcore": {
      "url": "http://localhost:8000/mcp"
    }
  }
}`}</code>
            </pre>
          </div>

          <div className="mcp-snippet">
            <h3>Generic MCP Client</h3>
            <pre>
              <code>{`Endpoint: http://localhost:8000/mcp
Transport: Streamable HTTP
Explorer: http://localhost:8000/explorer`}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
