# tiptap-apcore

> Let AI safely control your TipTap editor via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and OpenAI Function Calling.

**tiptap-apcore** wraps every TipTap editor command as a schema-driven [APCore](https://github.com/aiperceivable) module — complete with JSON Schema validation, safety annotations, and fine-grained access control. Any MCP-compatible AI agent can then discover and invoke these modules to read, format, insert, or restructure rich-text content.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![TipTap](https://img.shields.io/badge/TipTap-v2-green.svg)](https://tiptap.dev)

## Features

- **79 built-in commands** across 7 categories (query, format, content, destructive, selection, history, unknown)
- **Automatic extension discovery** — scans TipTap extensions at runtime, no manual wiring
- **MCP Server** in one line — `serve(executor)` exposes all commands via stdio / HTTP / SSE
- **OpenAI Function Calling** — `toOpenaiTools(executor)` exports tool definitions for GPT
- **Role-based ACL** — `readonly`, `editor`, `admin` roles with tag-level and module-level overrides
- **Safety annotations** — every command tagged `readonly`, `destructive`, `idempotent`, `requiresApproval`, `openWorld`, `streaming`
- **Preview & approval** — `apcore.validate()` predicts a command's effects *before* running it; over MCP this drives the `__apcore_module_preview` meta-tool and gates high-risk commands behind human approval automatically
- **Audit logging** — opt-in structured `allow` / `deny` audit trail (`audit: true` → `apcore.getAuditLog()`, or supply your own logger)
- **Strict JSON Schemas** — `inputSchema` + `outputSchema` with `additionalProperties: false` for all known commands
- **Dynamic re-discovery** — call `apcore.refresh()` or `registry.discover()` to pick up extensions added at runtime
- **Dynamic ACL** — call `apcore.setAcl()` to switch roles without recreating the instance
- **Framework agnostic** — works with React, Vue, Angular, or Vanilla JS

## Installation

```bash
npm install tiptap-apcore apcore-js apcore-mcp @tiptap/core
```

`apcore-js`, `apcore-mcp`, and `@tiptap/core` are peer dependencies.

## Quick Start

### Using `TiptapAPCore` class (recommended)

```typescript
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TiptapAPCore } from "tiptap-apcore";

// 1. Create a TipTap editor
const editor = new Editor({
  extensions: [StarterKit],
  content: "<p>Hello world</p>",
});

// 2. Create the APCore instance
const apcore = new TiptapAPCore(editor, {
  acl: { role: "editor" },   // no destructive ops
});

// 3. Call commands directly
await apcore.call("tiptap.format.toggleBold", {});
const { html } = await apcore.call("tiptap.query.getHTML", {});

// 4. Switch roles at runtime (e.g. when user toggles admin mode)
apcore.setAcl({ role: "admin" });

// 5. Launch an MCP Server (Node.js only — import from tiptap-apcore/server)
import { serve } from "tiptap-apcore/server";
await serve(apcore.executor);

// 6. Or export OpenAI tool definitions
import { toOpenaiTools } from "tiptap-apcore/server";
const tools = toOpenaiTools(apcore.executor);
```

### Using `withApcore` factory (shortcut)

```typescript
import { withApcore } from "tiptap-apcore";

const { registry, executor } = withApcore(editor, {
  acl: { role: "editor" },
});

await executor.call("tiptap.format.toggleBold", {});
```

`withApcore` returns a `{ registry, executor }` pair. Use it when you don't need dynamic ACL updates or the convenience methods on `TiptapAPCore`.

## Commands

All commands follow the module ID pattern `{prefix}.{category}.{commandName}`.

### Query (10 commands) — `readonly`, `idempotent`

| Command | Input | Output |
|---------|-------|--------|
| `getHTML` | — | `{ html: string }` |
| `getJSON` | — | `{ json: object }` |
| `getText` | `{ blockSeparator?: string }` | `{ text: string }` |
| `isActive` | `{ name: string, attrs?: object }` | `{ active: boolean }` |
| `getAttributes` | `{ typeOrName: string }` | `{ attributes: object }` |
| `isEmpty` | — | `{ value: boolean }` |
| `isEditable` | — | `{ value: boolean }` |
| `isFocused` | — | `{ value: boolean }` |
| `getCharacterCount` | — | `{ count: number }` |
| `getWordCount` | — | `{ count: number }` |

### Format (36 commands) — non-destructive

`toggleBold`, `toggleItalic`, `toggleStrike`, `toggleCode`, `toggleUnderline`, `toggleSubscript`, `toggleSuperscript`, `toggleHighlight`, `toggleHeading`, `toggleBulletList`, `toggleOrderedList`, `toggleTaskList`, `toggleCodeBlock`, `toggleBlockquote`, `setTextAlign`, `setMark`, `unsetMark`, `unsetAllMarks`, `clearNodes`, `updateAttributes`, `setLink`, `unsetLink`, `setHardBreak`, `setHorizontalRule`, `setBold`, `setItalic`, `setStrike`, `setCode`, `unsetBold`, `unsetItalic`, `unsetStrike`, `unsetCode`, `setBlockquote`, `unsetBlockquote`, `setHeading`, `setParagraph`

### Content (15 commands)

`insertContent`, `insertContentAt`, `setNode`, `splitBlock`, `liftListItem`, `sinkListItem`, `wrapIn`, `joinBackward`, `joinForward`, `lift`, `splitListItem`, `wrapInList`, `toggleList`, `exitCode`, `deleteNode`

### Destructive (6 commands) — `requiresApproval`

`clearContent`, `setContent`, `deleteSelection`, `deleteRange`, `deleteCurrentNode`, `cut`

### Selection (10 commands) — `idempotent`

`setTextSelection`, `setNodeSelection`, `selectAll`, `selectParentNode`, `selectTextblockStart`, `selectTextblockEnd`, `selectText`, `focus`, `blur`, `scrollIntoView`

### History (2 commands)

`undo`, `redo`

### Unknown

Commands discovered from extensions but not in the built-in catalog. Excluded by default (`includeUnsafe: false`). Set `includeUnsafe: true` to include them with permissive schemas.

## Access Control (ACL)

```typescript
// Read-only: only query commands
new TiptapAPCore(editor, { acl: { role: "readonly" } });

// Editor: query + format + content + history + selection
new TiptapAPCore(editor, { acl: { role: "editor" } });

// Admin: everything including destructive
new TiptapAPCore(editor, { acl: { role: "admin" } });

// Custom: readonly base + allow format tag
new TiptapAPCore(editor, { acl: { role: "readonly", allowTags: ["format"] } });

// Custom: admin but deny destructive tag
new TiptapAPCore(editor, { acl: { role: "admin", denyTags: ["destructive"] } });

// Module-level: deny specific commands
new TiptapAPCore(editor, {
  acl: { role: "admin", denyModules: ["tiptap.destructive.clearContent"] },
});

// Dynamic: switch roles at runtime
apcore.setAcl({ role: "admin" });
```

**Precedence:** `denyModules` > `allowModules` > `denyTags` > `allowTags` > role

> **Note:** `allowModules` is additive — it grants access to listed modules but does not deny unlisted ones. Combine with a role to restrict the baseline.

## Preview & Approval (Safety)

Before executing a command, an AI agent can ask **"what would this change?"** via
`validate()` (aka `preflight()`). It runs the same checks as `call()` — editor
readiness, module existence, ACL, and input validation — **without touching the
document**, and returns a structured prediction of the effects.

```typescript
const result = await apcore.validate("tiptap.destructive.setContent", {
  value: "<p>Replaced</p>",
});

// result.valid            → true
// result.requiresApproval → true   (sourced from the command's annotations)
// result.checks           → [{ check: "editor_ready", passed: true }, ...]
// result.predictedChanges → [{
//   action: "replace",
//   target: "editor.content",
//   summary: "Replace all editor content",
//   before: "<p>Hello world</p>",   // truncated snapshot of current content
//   after:  "<p>Replaced</p>",
// }]

if (result.valid && !result.requiresApproval) {
  await apcore.call("tiptap.destructive.setContent", { value: "<p>Replaced</p>" });
}
```

Predicted `Change` records are produced for destructive and content-mutating
commands (`clearContent`, `setContent`, `deleteSelection`, `deleteRange`,
`deleteCurrentNode`, `cut`, `deleteNode`, `insertContent`, `insertContentAt`,
`setLink`). Read-only, formatting, and selection commands report an empty list.

### Automatic MCP preview & approval

This is powered by the apcore `Executor.validate()` contract. When you pass the
executor to `serve()`, **apcore-mcp exposes the `__apcore_module_preview`
meta-tool and gates commands whose `requiresApproval` annotation is `true`
behind its elicitation-based approval flow** — no extra wiring required. All six
`destructive` commands are annotated `requiresApproval: true` out of the box.

```typescript
import { serve } from "tiptap-apcore/server";
await serve(apcore.executor);   // preview meta-tool + approval flow enabled automatically
```

## Audit Logging

Opt in to a structured audit trail of every ACL `allow` / `deny` decision.

```typescript
// Built-in in-memory collector
const apcore = new TiptapAPCore(editor, { acl: { role: "editor" }, audit: true });

await apcore.call("tiptap.query.getHTML", {});                  // allow
await apcore.call("tiptap.destructive.clearContent", {}).catch(() => {}); // deny

apcore.getAuditLog();
// [
//   { timestamp: "2026-07-06T...", targetId: "tiptap.query.getHTML",
//     decision: "allow", roles: ["editor"], reason: "", ... },
//   { timestamp: "2026-07-06T...", targetId: "tiptap.destructive.clearContent",
//     decision: "deny", roles: ["editor"], reason: "Role 'editor' does not permit ...", ... },
// ]

// Or route entries to your own sink (apcore-js AuditLogger)
new TiptapAPCore(editor, {
  audit: (entry) => myLogger.info("acl", entry),
});
```

Entries follow the apcore-js `AuditEntry` wire shape (the TipTap module ID is the
`targetId`), so they interoperate with the rest of the apcore ecosystem.

## MCP Server

Server functions must be imported from the `tiptap-apcore/server` subpath (Node.js only).

```typescript
import { TiptapAPCore } from "tiptap-apcore";
import { serve } from "tiptap-apcore/server";

const apcore = new TiptapAPCore(editor);

// stdio (default)
await serve(apcore.executor);

// HTTP streaming
await serve(apcore.executor, {
  transport: "streamable-http",
  host: "127.0.0.1",
  port: 8000,
});

// Server-Sent Events
await serve(apcore.executor, { transport: "sse", port: 3000 });
```

### Embedding in Express / Koa / Fastify (`asyncServe`)

`asyncServe` returns a Node.js HTTP request handler that you can mount in any existing server — no separate process needed.

```typescript
import express from "express";
import { TiptapAPCore } from "tiptap-apcore";
import { asyncServe } from "tiptap-apcore/server";

const app = express();
const apcore = new TiptapAPCore(editor, { acl: { role: "admin" } });

// Create the MCP handler with the built-in Tool Explorer UI
const { handler, close } = await asyncServe(apcore.executor, {
  endpoint: "/mcp",           // MCP protocol endpoint
  explorer: true,             // Enable /explorer UI for interactive testing
  explorerPrefix: "/explorer",
  allowExecute: true,         // Allow tool execution from the explorer
  name: "my-editor-mcp",
});

// Mount alongside your existing routes
app.all("/mcp", (req, res) => handler(req, res));
app.all("/explorer", (req, res) => handler(req, res));
app.all("/explorer/*", (req, res) => handler(req, res));

app.listen(8000);

// On shutdown:
await close();
```

MCP clients (Claude Desktop, Cursor, etc.) can then connect to your server:

```json
{
  "mcpServers": {
    "my-editor": {
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

## OpenAI Function Calling

```typescript
import { TiptapAPCore } from "tiptap-apcore";
import { toOpenaiTools } from "tiptap-apcore/server";

const apcore = new TiptapAPCore(editor);
const tools = toOpenaiTools(apcore.executor);

// Use with OpenAI API
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
  tools,
});
```

## Vercel AI SDK

APCore's JSON schemas work directly with AI SDK's `jsonSchema()` — no Zod conversion needed. Combined with `generateText({ maxSteps })`, the tool-use loop is fully automatic.

```typescript
import { generateText, tool, jsonSchema } from "ai";
import { openai } from "@ai-sdk/openai";
import { TiptapAPCore } from "tiptap-apcore";

const apcore = new TiptapAPCore(editor, { acl: { role: "editor" } });

// Convert APCore modules to AI SDK tools
const tools: Record<string, CoreTool> = {};
for (const id of apcore.list()) {
  const def = apcore.getDefinition(id)!;
  tools[id.replaceAll(".", "--")] = tool({
    description: def.description,
    parameters: jsonSchema(def.inputSchema),
    execute: (args) => apcore.call(id, args),
  });
}

const { text, steps } = await generateText({
  model: openai("gpt-4o"),
  system: "You are an editor assistant...",
  messages,
  tools,
  maxSteps: 10,
});
```

## API Reference

### `TiptapAPCore` class

The primary entry point. Encapsulates registry, executor, ACL, and extension discovery.

```typescript
const apcore = new TiptapAPCore(editor, options?);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prefix` | `string` | `"tiptap"` | Module ID prefix (lowercase alphanumeric) |
| `acl` | `AclConfig` | `undefined` | Access control configuration (permissive if omitted) |
| `includeUnsafe` | `boolean` | `false` | Include commands not in the built-in catalog |
| `logger` | `Logger` | `undefined` | Logger for diagnostic output |
| `sanitizeHtml` | `(html: string) => string` | `undefined` | HTML sanitizer for insertContent/setContent |

| Method / Property | Description |
|-------------------|-------------|
| `registry` | The APCore Registry (read-only) |
| `executor` | The APCore Executor (read-only) |
| `call(moduleId, inputs)` | Execute a command (async) |
| `list(options?)` | List module IDs, optionally filtered by `tags` and/or `prefix` |
| `getDefinition(moduleId)` | Get full `ModuleDescriptor` or `null` |
| `setAcl(acl)` | Update ACL configuration at runtime (validates role) |
| `refresh()` | Re-scan extensions and update registry; returns module count |

### `withApcore(editor, options?)`

Factory function that creates a `TiptapAPCore` instance and returns `{ registry, executor }`. Accepts the same options as `TiptapAPCore`.

### Registry Methods

| Method | Description |
|--------|-------------|
| `list(options?)` | List module IDs, optionally filtered by `tags` (OR) and/or `prefix` |
| `getDefinition(moduleId)` | Get full `ModuleDescriptor` or `null` |
| `has(moduleId)` | Check if a module exists |
| `iter()` | Iterate `[moduleId, descriptor]` pairs |
| `count` | Number of registered modules |
| `moduleIds` | Array of all module IDs |
| `on(event, callback)` | Listen for `"register"` / `"unregister"` events |
| `discover()` | Re-scan extensions and update registry |

### Executor Methods

| Method | Description |
|--------|-------------|
| `call(moduleId, inputs)` | Execute a module (async) |
| `callAsync(moduleId, inputs)` | Alias for `call()` |
| `registry` | Access the underlying registry |

### Error Codes

All errors are instances of `TiptapModuleError` (extends `Error`).

```typescript
import { TiptapModuleError, ErrorCodes } from "tiptap-apcore";

try {
  await apcore.call("tiptap.format.toggleBold", {});
} catch (err) {
  if (err instanceof TiptapModuleError) {
    console.log(err.code, err.message, err.details);
  }
}
```

| Code | Description |
|------|-------------|
| `MODULE_NOT_FOUND` | Module ID not registered |
| `COMMAND_NOT_FOUND` | Command not available on editor |
| `ACL_DENIED` | Access denied by ACL policy |
| `EDITOR_NOT_READY` | Editor is destroyed |
| `COMMAND_FAILED` | TipTap command returned false |
| `SCHEMA_VALIDATION_ERROR` | Invalid options (bad prefix, bad role) |
| `INTERNAL_ERROR` | Unexpected error |

### Server Exports (`tiptap-apcore/server`)

| Function | Description |
|----------|-------------|
| `serve(executor, options?)` | Launch an MCP server (stdio / streamable-http / sse) |
| `asyncServe(executor, options?)` | Build an embeddable HTTP handler — returns `{ handler, close }` |
| `toOpenaiTools(executor, options?)` | Export OpenAI Function Calling tool definitions |
| `resolveRegistry(executor)` | Access the registry from an executor |
| `resolveExecutor(registry)` | Create an executor from a registry |

#### `asyncServe` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `"apcore-mcp"` | MCP server name |
| `endpoint` | `string` | `"/mcp"` | MCP protocol endpoint path |
| `explorer` | `boolean` | `false` | Enable the browser-based Tool Explorer UI |
| `explorerPrefix` | `string` | `"/explorer"` | URL prefix for the explorer |
| `allowExecute` | `boolean` | `false` | Allow tool execution from the explorer UI |
| `validateInputs` | `boolean` | `false` | Validate inputs against JSON schemas |
| `tags` | `string[]` | `null` | Filter modules by tags |
| `prefix` | `string` | `null` | Filter modules by prefix |

`asyncServe` returns `{ handler, close }` where `handler` is `(IncomingMessage, ServerResponse) => Promise<void>`.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  TipTap Editor   │────▶│  tiptap-apcore   │────▶│  apcore-mcp  │
│  (@tiptap/core)  │     │  (this package)  │     │  (protocol)  │
└──────────────────┘     └──────────────────┘     └──────────────┘
                          Registry + Executor       MCP / OpenAI
```

**tiptap-apcore provides:**
- Extension discovery (`ExtensionScanner`)
- Module building (`ModuleBuilder` + `AnnotationCatalog` + `SchemaCatalog`)
- Command execution (`TiptapExecutor`)
- Access control (`AclGuard`)

**apcore-mcp provides:**
- `serve(executor)` — Launch an MCP server (stdio / HTTP / SSE)
- `toOpenaiTools(executor)` — Export OpenAI Function Calling tool definitions
- Types and constants for the APCore protocol

## AI Capabilities

### Supported (79 commands)

| Category | Count | Commands |
|----------|-------|----------|
| **Query** | 10 | `getHTML`, `getJSON`, `getText`, `isActive`, `getAttributes`, `isEmpty`, `isEditable`, `isFocused`, `getCharacterCount`, `getWordCount` |
| **Format** | 36 | Toggle: `toggleBold`, `toggleItalic`, `toggleStrike`, `toggleCode`, `toggleUnderline`, `toggleSubscript`, `toggleSuperscript`, `toggleHighlight`, `toggleHeading`, `toggleBulletList`, `toggleOrderedList`, `toggleTaskList`, `toggleCodeBlock`, `toggleBlockquote`. Set/Unset: `setBold`, `setItalic`, `setStrike`, `setCode`, `unsetBold`, `unsetItalic`, `unsetStrike`, `unsetCode`, `setBlockquote`, `unsetBlockquote`, `setHeading`, `setParagraph`. Other: `setTextAlign`, `setMark`, `unsetMark`, `unsetAllMarks`, `clearNodes`, `updateAttributes`, `setLink`, `unsetLink`, `setHardBreak`, `setHorizontalRule` |
| **Content** | 15 | `insertContent`, `insertContentAt`, `setNode`, `splitBlock`, `liftListItem`, `sinkListItem`, `wrapIn`, `joinBackward`, `joinForward`, `lift`, `splitListItem`, `wrapInList`, `toggleList`, `exitCode`, `deleteNode` |
| **Destructive** | 6 | `clearContent`, `setContent`, `deleteSelection`, `deleteRange`, `deleteCurrentNode`, `cut` |
| **Selection** | 10 | `setTextSelection`, `setNodeSelection`, `selectAll`, `selectParentNode`, `selectTextblockStart`, `selectTextblockEnd`, `selectText`, `focus`, `blur`, `scrollIntoView` |
| **History** | 2 | `undo`, `redo` |

The `selectText` command enables semantic text selection — the AI can select text by content rather than by position, which is more natural for LLM-driven editing.

### Not Supported

| Feature | Reason |
|---------|--------|
| Clipboard operations (`copy`, `paste`) | Requires browser Clipboard API — not available in headless / server-side |
| Drag and drop | Requires browser DOM events |
| IME / composition events | Requires browser input events |
| Real-time collaboration (Yjs/Hocuspocus) | Collaboration is handled at the transport layer, not the command layer |
| Streaming content generation | Content generation is delegated to the LLM; the executor applies discrete commands |
| Comment threads | Not part of core TipTap — requires `@tiptap-pro` extensions |

## Comparison with TipTap AI Toolkit

TipTap's official AI solution is the **[AI Toolkit](https://tiptap.dev/docs/ai-toolkit/getting-started/overview)** (`@tiptap-pro/ai-toolkit`), a paid extension for client-side AI-powered editing. The two projects serve different use cases and are complementary.

| | TipTap AI Toolkit | tiptap-apcore |
|---|---|---|
| **Type** | Client-side TipTap extension | Server-side / headless adapter |
| **License** | Proprietary (TipTap Pro subscription) | Apache-2.0 (open source) |
| **Runtime** | Browser only | Browser + Node.js + headless |
| **Protocol** | Provider-specific adapters | MCP standard + OpenAI Function Calling |
| **Tools exposed** | 5 coarse tools | 79+ fine-grained commands |
| **Access control** | None built-in | 3 roles + tag/module allow/deny lists |
| **Safety annotations** | None | `readonly`, `destructive`, `idempotent`, `requiresApproval` per command |
| **Streaming output** | `streamText()`, `streamHtml()` | Not yet supported |
| **Headless mode** | Not supported | Full support |

**Use TipTap AI Toolkit when** you need real-time streaming of AI-generated content with a built-in accept/reject review UI.

**Use tiptap-apcore when** you want any MCP-compatible agent to control the editor with fine-grained access control, strict schema validation, and headless/server-side support.

**Use both** when you want streaming AI content generation AND structured command control in the same application.

## Demo

The `demo/` directory contains a full-stack example with two modes:

```bash
cd demo/server && npm install && npm run dev   # Terminal 1
cd demo/frontend && npm install && npm run dev # Terminal 2
# Open http://localhost:5173
```

Set `LLM_MODEL` (e.g. `openai:gpt-4o`, `anthropic:claude-sonnet-4-5`) in `demo/.env`. See [`demo/README.md`](demo/README.md) for details.

### AI Editor Demo tab

A React + Vite frontend with a TipTap editor and an Express backend that uses the [Vercel AI SDK](https://ai-sdk.dev/) to let any LLM edit the document via APCore tools. Includes role-based ACL switching, demo scenarios, and a tool call log.

### MCP Server tab

A persistent headless TipTap editor exposed as an MCP `streamable-http` endpoint via `asyncServe()`. The tab shows:

- **Status** — live server status, tool count, and endpoint URL
- **Tool Explorer** — embedded `/explorer` UI for browsing and executing all 79+ tools interactively
- **Connect** — copy-paste config snippets for Claude Desktop, Cursor, and generic MCP clients

The MCP endpoint is available at `http://localhost:8000/mcp` — connect any MCP client to control the editor remotely.

## Documentation

- [Getting Started Guide](docs/GETTING_STARTED.md) — React integration, ACL roles, MCP and AI SDK setup.
- [Technical Design](docs/tiptap-apcore/tech-design.md) — Architecture, security model, and design decisions.

## Development

```bash
npm install       # Install dependencies
npm test          # Run tests
npm run typecheck # Type check
npm run build     # Build
```

## License

Apache-2.0
