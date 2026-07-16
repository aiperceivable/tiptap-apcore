import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { chatHandler } from "./chatHandler.js";
import type { IncomingMessage, ServerResponse } from "node:http";

const app: ReturnType<typeof express> = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/api/chat", chatHandler);

app.get("/api/health", (_req, res) => {
  const providers = [
    {
      id: "openai",
      name: "OpenAI",
      configured: !!process.env.OPENAI_API_KEY,
      models: [
        { id: "openai:gpt-4o", name: "GPT-4o" },
        { id: "openai:gpt-4.1", name: "GPT-4.1" },
        { id: "openai:gpt-5.1", name: "GPT-5.1" },
      ],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      configured: !!process.env.ANTHROPIC_API_KEY,
      models: [
        { id: "anthropic:claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        { id: "anthropic:claude-haiku-4-5", name: "Claude Haiku 4.5" },
        { id: "anthropic:claude-opus-4-5", name: "Claude Opus 4.5" },
      ],
    },
    {
      id: "google",
      name: "Google Gemini",
      configured: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      models: [
        { id: "google:gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        { id: "google:gemini-2.5-pro", name: "Gemini 2.5 Pro" },
        { id: "google:gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      ],
    },
  ];

  const defaultModel = process.env.LLM_MODEL || "openai:gpt-4o";

  res.json({ status: "ok", defaultModel, providers });
});

// MCP routes — handler is set lazily via initMcp() to avoid importing
// apcore-mcp server modules at module evaluation time (breaks tests).
let mcpHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;
let mcpStatusFn: (() => { initialized: boolean; toolCount: number }) | null = null;

app.get("/api/mcp-status", (_req, res) => {
  res.json(mcpStatusFn ? mcpStatusFn() : { initialized: false, toolCount: 0 });
});

/** Forward a request to the MCP handler with error handling. */
async function forwardToMcp(req: Request, res: Response): Promise<void> {
  if (!mcpHandler) {
    res.status(503).json({ error: "MCP server not initialized" });
    return;
  }
  try {
    await mcpHandler(req, res);
  } catch (err) {
    console.error("MCP handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

app.all("/mcp", forwardToMcp);
app.all("/explorer", forwardToMcp);
app.all("/explorer/*", forwardToMcp);

export async function initMcp(): Promise<void> {
  const { initMcpServer, getMcpStatus } = await import("./mcpServer.js");
  const mcpApp = await initMcpServer();
  mcpHandler = mcpApp.handler;
  mcpStatusFn = getMcpStatus;
}

export async function shutdownMcp(): Promise<void> {
  const { closeMcpServer } = await import("./mcpServer.js");
  await closeMcpServer();
  mcpHandler = null;
  mcpStatusFn = null;
}

export { app };
