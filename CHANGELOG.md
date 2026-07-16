# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-16

ACL demo + dependency uplift to the aligned apcore-js 0.26.0 / apcore-mcp 0.17.2 governance train. All 946 tests pass.

### Added

- **ACL demo (`examples/acl_demo/`)** — the cross-integration `examples/acl_demo/` pattern, in tiptap's own domain: a headless (mock-editor) demonstration of tiptap's tag-based role ACL — `readonly` may only run `query` commands, `editor` may also `format` but not `destructive`, `admin` may run everything. Covered by `tests/integration/acl-demo.test.ts` (4 cases). Unlike the web-framework integrations it uses tiptap's native `readonly` / `editor` / `admin` roles and editor commands rather than the `X-Roles` + `orders.*` contract.

### Changed

- **Dependency floors raised to the aligned governance train and loosened from caret to `>=`** (so future apcore minor releases need no downstream edits): `apcore-js >= 0.26.0` (was `^0.25.0`), `apcore-mcp >= 0.17.2` (was `^0.17.0`).
- **Full-stack demo moved to `examples/demo/`** (was `demo/`), consolidating all examples under `examples/` alongside the new `examples/acl_demo/`. README, Dockerfiles, docker-compose, and the demo README were updated to the new paths.

## [0.4.0] - 2026-07-06

### Added

- **Preview & approval (safety) support.** `TiptapExecutor` now implements the apcore `Executor.validate()` contract (PROTOCOL_SPEC §5.6). Passing the executor to `serve()` automatically enables apcore-mcp's `__apcore_module_preview` meta-tool and its elicitation-based approval flow — AI agents can ask "what would this change?" and high-risk commands are gated behind human approval, with no extra wiring.
  - `TiptapAPCore.validate(moduleId, inputs)` / `preflight(moduleId, inputs)` — validate a command and predict its effects **without executing it**. Returns a `PreflightResult` with per-step `checks` (`editor_ready`, `module_exists`, `acl`, `input_schema`), a `requiresApproval` flag from the module's annotations, and structured `predictedChanges`.
  - Predicted `Change` records (`action`, `target`, `summary`, `before`, `after`) are produced for destructive and content-mutating commands (`clearContent`, `setContent`, `deleteSelection`, `deleteRange`, `deleteCurrentNode`, `cut`, `deleteNode`, `insertContent`, `insertContentAt`, `setLink`), including truncated HTML snapshots for full-document replacements.
- **Structured ACL audit logging** via the new `audit` option on `TiptapAPCore`:
  - `audit: true` records every allow/deny decision in a built-in in-memory log, readable via `TiptapAPCore.getAuditLog()`.
  - `audit: <fn>` routes decisions to a custom apcore-js `AuditLogger` callback.
  - Entries follow the apcore-js `AuditEntry` wire shape (module ID as `targetId`) for cross-ecosystem consistency.
- Public type exports: `PreflightResult`, `PreflightCheckResult`, `PreviewResult`, `Change`, `AuditLogger`, `AuditEntry`.

### Changed

- Upgraded `apcore-js` peer dependency from `>=0.14.0` to `>=0.25.0`.
- Upgraded `apcore-mcp` peer/dev dependency from `^0.10.0` to `^0.17.0`.
- Existing `call()` behavior is unchanged; all new capabilities are additive and backward compatible. All re-exports (`serve`, `asyncServe`, `toOpenaiTools`, `resolveRegistry`, `resolveExecutor`) are unchanged.

### Dependencies

- **Peer**: `apcore-js` >=0.25.0 (was >=0.14.0), `apcore-mcp` ^0.17.0 (was ^0.10.0).
- `apcore-toolkit` 0.9.1 now enters the tree transitively via `apcore-mcp`.

## [0.3.1] - 2026-03-22

### Changed
- Rebrand: aipartnerup → aiperceivable

## [0.2.0] - 2026-03-14

### Changed

- **BREAKING**: Upgraded `apcore-js` peer dependency from `^0.6.0` to `^0.13.0`.
- **BREAKING**: Upgraded `apcore-mcp` peer dependency from `^0.7.0` to `^0.10.0`.
- **BREAKING**: Removed `ExplorerHandler` and `ExplorerHandlerOptions` re-exports from `tiptap-apcore/server` — these no longer exist in apcore-mcp 0.10.0 (replaced by `mcp-embedded-ui`).
- Query command annotations now include `cacheable: true` to leverage apcore-mcp 0.10.0 caching support.

### Added

- Re-export `asyncServe()` from `tiptap-apcore/server` — embeddable MCP HTTP handler for mounting into existing servers (new in apcore-mcp 0.9.0).
- Re-export `AsyncServeOptions` and `AsyncServeApp` types from both `tiptap-apcore` and `tiptap-apcore/server`.

### Dependencies

- **Peer**: `apcore-js` ^0.13.0 (was ^0.6.0), `apcore-mcp` ^0.10.0 (was ^0.7.0).

## [0.1.0] - 2026-02-28

Initial release of **tiptap-apcore** — let AI safely control your TipTap editor through standardized, schema-validated, access-controlled modules.

### Added

#### Core API

- `withApcore(editor, options?)` factory function — single entry point that returns an APCore `Registry` + `Executor` from any TipTap editor instance.
- Configurable options: `acl`, `prefix`, `includeUnsafe`, `logger`, `sanitizeHtml`.
- Server-only exports via `tiptap-apcore/server`: `serve()`, `toOpenaiTools()`, `resolveRegistry()`, `resolveExecutor()`, `ExplorerHandler`.

#### Command Coverage — 79 Built-in Commands across 6 Categories

- **Query (10)**: `getHTML`, `getJSON`, `getText`, `isActive`, `getAttributes`, `isEmpty`, `isEditable`, `isFocused`, `getCharacterCount`, `getWordCount` — read-only, idempotent.
- **Format (36)**: `toggleBold`, `toggleItalic`, `toggleStrike`, `toggleCode`, `toggleUnderline`, `toggleSubscript`, `toggleSuperscript`, `toggleHighlight`, `toggleHeading`, `toggleBulletList`, `toggleOrderedList`, `toggleTaskList`, `toggleCodeBlock`, `toggleBlockquote`, `setTextAlign`, `setBold`, `setItalic`, `setStrike`, `setCode`, `setLink`, `setMark`, `setHeading`, `setParagraph`, `setBlockquote`, `setHardBreak`, `setHorizontalRule`, `unsetBold`, `unsetItalic`, `unsetStrike`, `unsetCode`, `unsetLink`, `unsetMark`, `unsetAllMarks`, `unsetBlockquote`, `clearNodes`, `updateAttributes`.
- **Content (15)**: `insertContent`, `insertContentAt`, `setNode`, `splitBlock`, `liftListItem`, `sinkListItem`, `wrapIn`, `joinBackward`, `joinForward`, `lift`, `splitListItem`, `wrapInList`, `toggleList`, `exitCode`, `deleteNode`.
- **Destructive (6)**: `clearContent`, `setContent`, `deleteSelection`, `deleteRange`, `deleteCurrentNode`, `cut` — marked `destructive: true`, `requiresApproval: true`.
- **Selection (10)**: `setTextSelection`, `setNodeSelection`, `selectAll`, `selectParentNode`, `selectTextblockStart`, `selectTextblockEnd`, `selectText`, `focus`, `blur`, `scrollIntoView`.
- **History (2)**: `undo`, `redo`.

#### Custom APCore Command: `selectText`

- Semantic text search and selection — not a native TipTap command.
- Parameters: `text` (required string), `occurrence` (optional, 1-based integer, defaults to 1).
- Returns `{ found: boolean, from?: number, to?: number }`.
- Substring matching via `doc.descendants()` traversal.

#### Selection Effect Metadata

- New `SelectionEffect` type (`require` | `preserve` | `destroy` | `none`) added to `AnnotationEntry`.
- Every command annotated with its selection behavior at the source level (`AnnotationCatalog`).
- Exposed via `ModuleDescriptor.metadata.selectionEffect` for external consumers to read dynamically.

#### Automatic Extension Discovery

- `ExtensionScanner` introspects `editor.extensionManager.extensions` at runtime.
- Discovers commands from `addCommands()` on each extension.
- Detects node, mark, and extension types.
- Dynamic re-discovery via `registry.discover()` — only emits events for changed modules.

#### Module Builder & Schema Catalog

- `ModuleBuilder` transforms command names into complete `ModuleDescriptor` objects.
- Module ID pattern: `{prefix}.{category}.{commandName}` (e.g., `tiptap.format.toggleBold`).
- `SchemaCatalog` provides strict JSON Schema definitions for all 79 commands — `additionalProperties: false` for OpenAI strict mode compatibility.
- Human-readable descriptions auto-generated from camelCase names.
- Documentation links auto-generated: `https://tiptap.dev/docs/editor/api/commands/{commandName}`.

#### Safety Annotations

- 6 safety flags per command: `readonly`, `destructive`, `idempotent`, `requiresApproval`, `openWorld`, `streaming`.
- `AnnotationCatalog` provides static metadata for all known commands.
- Unknown commands excluded by default (`includeUnsafe: false`).

#### Role-Based Access Control (ACL)

- `AclGuard` with 3 preset roles:
  - `readonly` — query commands only.
  - `editor` — query + format + content + history + selection.
  - `admin` — all categories including destructive.
- Fine-grained overrides: `allowTags`, `denyTags`, `allowModules`, `denyModules`.
- Precedence: `denyModules` > `allowModules` > `denyTags` > `allowTags` > role defaults.
- Detailed denial reasons for diagnostics.

#### Security Hardening

- URL protocol validation for `setLink` — allows `http`, `https`, `mailto`, `tel`, and relative paths.
- Prototype pollution guard — blocks `__proto__`, `constructor`, `prototype` in property names.
- Optional `sanitizeHtml` callback for `insertContent`, `insertContentAt`, `setContent`.
- Input validation: non-empty strings, finite numbers, required field enforcement.

#### Error Handling

- `TiptapModuleError` with 7 error codes: `MODULE_NOT_FOUND`, `COMMAND_NOT_FOUND`, `SCHEMA_VALIDATION_ERROR`, `ACL_DENIED`, `EDITOR_NOT_READY`, `COMMAND_FAILED`, `INTERNAL_ERROR`.
- Errors include `moduleId`, `code`, and contextual details.

#### Registry & Event System

- `TiptapRegistry` with full module lifecycle: `register()`, `unregister()`, `list()`, `getDefinition()`, `iter()`.
- Filtering by tags (OR logic) and module ID prefix.
- Event system: `on('register')`, `on('unregister')` with cleanup via `off()` and `removeAllListeners()`.

#### Integration Exports

- MCP Server via `serve(executor)` — supports stdio, HTTP streaming, SSE transports.
- OpenAI Function Calling via `toOpenaiTools(executor)`.
- `ExplorerHandler` for interactive module discovery UI.

#### Demo Application

- **Multi-Provider LLM Support**: OpenAI (GPT-4o, GPT-4.1, GPT-5.1), Anthropic (Claude Sonnet 4.5, Haiku 4.5, Opus 4.5), Google Gemini (2.5 Flash, 2.5 Pro, 2.0 Flash).
- **Dynamic System Prompt**: Built at request time from registry metadata — command list, selection behavior classification, task patterns, anti-patterns. No hardcoded command names.
- **Gemini Schema Sanitization**: Deep-clone sanitizer that removes `additionalProperties`, converts type arrays, flattens `anyOf`, filters `required`, and preserves empty object schemas from SDK stripping.
- **Headless TipTap Editor**: JSDOM-based server-side editor for AI command execution, created and destroyed per request.
- **Frontend Undo/Version Stack**: `useRef`-based HTML history buffer (max 50 entries) with undo and clear controls.
- **Model Selector**: Grouped dropdown populated from `/api/health` with per-provider API key detection.
- **Chat UI**: Multi-turn conversation, tool call inspection (expandable details), loading animation, keyboard shortcuts.
- **Demo Scenarios**: AI-driven insert, format, and clear with confirmation dialog for destructive operations.
- **Tool Panel**: Registry-driven command browser with category badges and manual execution.
- **ACL Switcher**: Live role switching with APCore re-initialization.
- **Responsive Layout**: 4-column grid with breakpoints at 1400px and 1024px.

#### Test Suite

- 925 tests across 10 test files (9 unit, 1 integration).
- Coverage: unit tests for every public class and function.
- Components tested: `TiptapModuleError`, `AnnotationCatalog`, `SchemaCatalog`, `ModuleBuilder`, `ExtensionScanner`, `TiptapRegistry`, `AclGuard`, `TiptapExecutor`, `withApcore`, integration workflows.

### Dependencies

- **Peer**: `@tiptap/core` ^2.0.0, `apcore-js` ^0.6.0, `apcore-mcp` ^0.7.0.
- **Runtime**: Node.js >= 18.0.0.
- **License**: Apache-2.0.

[0.2.0]: https://github.com/aiperceivable/tiptap-apcore/releases/tag/v0.2.0
[0.1.0]: https://github.com/aiperceivable/tiptap-apcore/releases/tag/v0.1.0
