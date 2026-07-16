# tiptap-apcore Demo

A full-stack demo showcasing AI-powered TipTap editor control via APCore modules. The demo has two tabs:

**AI Editor Demo** — Interactive rich-text editing via AI chat
- **Left panel**: ACL role switcher + module browser (click any module to execute it)
- **Center**: TipTap rich-text editor
- **Right**: AI Chat panel (talk to AI, it edits the document via tools) + preset demo scenarios + output log

**MCP Server** — Persistent headless editor exposed as an MCP endpoint
- **Status**: Live server status, tool count, endpoint URL
- **Tool Explorer**: Embedded `/explorer` UI for browsing and executing all 69+ tools
- **Connect**: Copy-paste config snippets for Claude Desktop, Cursor, and generic MCP clients

## Architecture

```
examples/demo/
├── frontend/    Vite + React (:5173)
│   └── src/     AclSwitcher | ToolPanel | Editor | ChatPanel | MCPDemo
├── server/      Express (:8000)
│   └── src/     chatHandler | toolLoop | mcpServer
├── .env         API keys (shared)
└── docker-compose.yml

┌─ Frontend (Vite + React, :5173) ──────────────────────────────┐
│  [Tab: AI Editor Demo]                                         │
│    AclSwitcher | ToolPanel | Editor | ChatPanel                │
│    ChatPanel sends POST /api/chat:                             │
│      { messages[], editorHtml, model, role }                   │
│                                                                │
│  [Tab: MCP Server]                                             │
│    MCPDemo: status + iframe /explorer + connect snippets       │
└──────────────┬────────────────────────────────────────────────┘
               │ Vite dev proxy: /api, /mcp, /explorer → :8000
┌──────────────▼────────────────────────────────────────────────┐
│  Backend (Express, :8000)                                      │
│                                                                │
│  POST /api/chat  — per-request headless editor + AI SDK        │
│    1. Create headless TipTap editor (JSDOM)                    │
│    2. withApcore(editor, { acl: { role } })                    │
│    3. generateText() with maxSteps (auto tool loop)            │
│    4. Return { reply, updatedHtml, toolCalls[] }               │
│                                                                │
│  ALL /mcp        — MCP streamable-http endpoint (persistent)   │
│  GET /explorer   — MCP Tool Explorer UI                        │
│  GET /api/mcp-status — { initialized, toolCount }              │
│                                                                │
│  MCP uses a persistent headless editor created at startup      │
│  via asyncServe(executor, { explorer: true })                  │
└────────────────────────────────────────────────────────────────┘
```

## AI SDK

The backend uses the [Vercel AI SDK](https://ai-sdk.dev/) (`ai`) with provider plugins:

| Package | Purpose |
|---------|---------|
| [`ai`](https://www.npmjs.com/package/ai) | Core — `generateText`, `tool`, `jsonSchema`, provider registry |
| [`@ai-sdk/openai`](https://www.npmjs.com/package/@ai-sdk/openai) | OpenAI provider |
| [`@ai-sdk/anthropic`](https://www.npmjs.com/package/@ai-sdk/anthropic) | Anthropic provider |

The model is selected **per-request** from the Chat panel input (e.g. `openai:gpt-4o`) and defaults to the `LLM_MODEL` env var.

## Quick Start (Manual)

You need **two terminals** — one for the backend, one for the frontend.

### Prerequisites

- Node.js >= 18
- An API key from [OpenAI](https://platform.openai.com/api-keys), [Anthropic](https://console.anthropic.com/settings/keys), and/or [Google AI](https://aistudio.google.com/apikey)

### Step 1: Build the root package

```bash
# From the project root (tiptap-apcore/)
npm install
npm run build
```

### Step 2: Configure environment variables

```bash
# Still in the project root
cp examples/demo/.env.example examples/demo/.env
```

Edit `examples/demo/.env` and fill in your API key(s):

```env
LLM_MODEL=openai:gpt-4o          # provider:model format
OPENAI_API_KEY=sk-proj-...        # set for OpenAI models
# ANTHROPIC_API_KEY=sk-ant-api03-... # set for Anthropic models
# GOOGLE_GENERATIVE_AI_API_KEY=... # set for Google Gemini models
```

### Step 3: Start the backend (Terminal 1)

```bash
cd examples/demo/server
npm install
npm run dev
```

You should see:
```
MCP server initialized: 69 tools
tiptap-apcore demo server running on http://localhost:8000
```

### Step 4: Start the frontend (Terminal 2)

```bash
cd examples/demo/frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Step 5: Try it out

1. Type a message in the **AI Chat** panel on the right (e.g. "Add a heading that says Hello World")
2. Optionally change the model in the **Model** input (e.g. `anthropic:claude-sonnet-4-5`)
3. Click **Send** — the AI will call TipTap tools and update the editor
4. Try switching the ACL role to **readonly** and ask the AI to delete content — it will be blocked

## Quick Start (Docker)

```bash
cd examples/demo

# 1. Configure API keys
cp .env.example .env
# Edit .env with your API key(s)

# 2. Start both services
docker compose up
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- MCP endpoint: http://localhost:8000/mcp
- Tool Explorer: http://localhost:8000/explorer

## Environment Variables

All env vars are read from `examples/demo/.env`.

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `LLM_MODEL` | Default model in `provider:model` format | `openai:gpt-4o` | No |
| `OPENAI_API_KEY` | OpenAI API key | — | Yes, if using OpenAI models |
| `ANTHROPIC_API_KEY` | Anthropic API key | — | Yes, if using Anthropic models |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key | — | Yes, if using Gemini models |
| `PORT` | Backend server port | `8000` | No |

### Supported models

Set `LLM_MODEL` to any model that supports tool use, or override per-request from the Chat panel:

**OpenAI**: `openai:gpt-4o` (default), `openai:gpt-4.1`, `openai:gpt-5.1`
**Anthropic**: `anthropic:claude-sonnet-4-5`, `anthropic:claude-haiku-4-5`, `anthropic:claude-opus-4-5`
**Google Gemini**: `google:gemini-2.5-flash`, `google:gemini-2.5-pro`, `google:gemini-2.0-flash`

## Features

### Client-side Demo Scenarios (no backend needed)
- **AI Insert Title** — toggleHeading + insertContent
- **AI Write a Paragraph** — insertContent with HTML
- **AI Formatting** — selectAll + bold + italic + bulletList
- **AI Clear Document** — clearContent with confirmation dialog

### AI Chat (requires backend)
- Send natural language requests to modify the document
- AI uses TipTap tools via APCore executor
- Switch models via text input (e.g. `openai:gpt-4o`, `anthropic:claude-sonnet-4-5`)
- Tool call logs displayed inline in the chat and output log

### MCP Server (no LLM key needed)
- Persistent headless TipTap editor with all commands exposed via MCP `streamable-http`
- **Tool Explorer** at `/explorer` — browse schemas, execute tools interactively
- Connect Claude Desktop, Cursor, or any MCP client:
  ```json
  {
    "mcpServers": {
      "tiptap-apcore": {
        "url": "http://localhost:8000/mcp"
      }
    }
  }
  ```
- Status endpoint at `/api/mcp-status` returns `{ initialized, toolCount }`

### ACL Roles
- **readonly** — Only query modules (getHTML, getText, etc.)
- **editor** — Query + format + content + history + selection
- **admin** — Full access including destructive operations (clearContent, setContent)

ACL is enforced **server-side** — even if the AI tries to call a blocked tool, the executor rejects it.

## Troubleshooting

**"API key is missing"** — Make sure `examples/demo/.env` exists and has the key for your chosen provider. The backend reads from `examples/demo/.env`, not `examples/demo/server/.env`.

**"429 quota exceeded"** — Your OpenAI account has insufficient credits. Check [billing](https://platform.openai.com/settings/organization/billing).

**Browser console error about `global` or `buffer`** — Run `npm run dev` from `examples/demo/frontend/` (not the project root). The Vite config includes necessary browser shims.

**Tool calls return errors but AI still responds** — This is expected. The AI receives the error message and tries to explain what happened or suggest alternatives.
