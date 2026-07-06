/**
 * tiptap-apcore: Let AI safely control your TipTap editor.
 *
 * Public API:
 * - withApcore(editor, options?) - Create APCore Registry + Executor from a TipTap editor
 *
 * Server-only (import from "tiptap-apcore/server"):
 * - serve(registryOrExecutor, options?) - Launch an MCP Server
 * - toOpenaiTools(registryOrExecutor, options?) - Export OpenAI tool definitions
 */

export { withApcore } from "./withApcore.js";
export { TiptapAPCore } from "./runtime/TiptapAPCore.js";
export type {
  ApcoreOptions,
  ApcoreResult,
  AclConfig,
  ExtensionCommandInfo,
  AnnotationEntry,
  SelectionEffect,
  SchemaEntry,
  Logger,
  EditorLike,
  ChainLike,
  Registry,
  Executor,
  ModuleDescriptor,
  ModuleAnnotations,
  JsonSchema,
  AuditLogger,
  AuditEntry,
} from "./types.js";
export { TiptapModuleError, ErrorCodes } from "./errors/index.js";
export { TiptapRegistry } from "./runtime/index.js";
export { TiptapExecutor } from "./runtime/index.js";
export { AclGuard } from "./security/index.js";

// Re-export apcore-mcp types and constants (runtime server functions moved to tiptap-apcore/server)
export type {
  ServeOptions,
  AsyncServeOptions,
  AsyncServeApp,
  ToOpenaiToolsOptions,
  RegistryOrExecutor,
  OpenAIToolDef,
} from "apcore-mcp";
export { REGISTRY_EVENTS, MODULE_ID_PATTERN } from "apcore-mcp";

// Re-export apcore-js safety/preview contract types. These describe the result
// of TiptapAPCore.validate()/preflight(), which drive the apcore-mcp preview
// meta-tool and approval flow.
export type {
  PreflightResult,
  PreflightCheckResult,
  PreviewResult,
  Change,
} from "apcore-js";
