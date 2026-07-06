/**
 * Type definitions for tiptap-apcore.
 *
 * Core APCore types (Registry, Executor, ModuleDescriptor, ModuleAnnotations, JsonSchema)
 * are re-exported from the apcore-mcp package.
 */

export type {
  Registry,
  Executor,
  ModuleDescriptor,
  ModuleAnnotations,
  JsonSchema,
} from "apcore-mcp";

import type { ModuleAnnotations, JsonSchema } from "apcore-mcp";
import type { AuditLogger } from "apcore-js";

/** Structured ACL audit logger, re-exported from apcore-js. */
export type { AuditLogger, AuditEntry } from "apcore-js";

/** Minimal logger interface for diagnostic output */
export interface Logger {
  info?(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

/** Minimal TipTap Editor interface needed by executor and scanner */
export interface EditorLike {
  isDestroyed: boolean;
  getHTML(): string;
  getJSON(): Record<string, unknown>;
  getText(options?: { blockSeparator?: string }): string;
  isActive(name: string, attrs?: Record<string, unknown>): boolean;
  getAttributes(typeOrName: string): Record<string, unknown>;
  isEmpty: boolean;
  isEditable: boolean;
  isFocused: boolean;
  state: {
    doc: {
      content: { size: number };
      descendants(
        callback: (node: { isText: boolean; text?: string | null }, pos: number) => boolean | void,
      ): void;
    };
  };
  storage: Record<string, Record<string, unknown>>;
  commands: Record<string, (...args: unknown[]) => boolean>;
  chain(): ChainLike;
  can(): { chain(): ChainLike };
  extensionManager: {
    extensions: Array<{
      name: string;
      type: string;
      addCommands?: () => Record<string, unknown>;
      config?: {
        addCommands?: () => Record<string, unknown>;
        [key: string]: unknown;
      };
      options?: Record<string, unknown>;
      storage?: Record<string, unknown>;
    }>;
  };
}

export interface ChainLike {
  focus(position?: unknown): ChainLike;
  run(): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (...args: any[]) => any;
}

/** ACL configuration for access control */
export interface AclConfig {
  /** Preset access role */
  role?: "readonly" | "editor" | "admin";
  /** Tags to explicitly allow */
  allowTags?: string[];
  /** Tags to explicitly deny (takes precedence over allow) */
  denyTags?: string[];
  /** Module IDs to explicitly allow (additive — does NOT deny unlisted modules) */
  allowModules?: string[];
  /** Module IDs to explicitly deny (highest precedence — overrides all allow rules) */
  denyModules?: string[];
}

/** Options for withApcore() */
export interface ApcoreOptions {
  /** Access control configuration */
  acl?: AclConfig;
  /** Module ID prefix (default: "tiptap") */
  prefix?: string;
  /** Whether to include commands not in the catalog (default: false) */
  includeUnsafe?: boolean;
  /** Optional logger for diagnostic output */
  logger?: Logger;
  /** Optional HTML sanitizer applied to insertContent/setContent values */
  sanitizeHtml?: (html: string) => string;
  /**
   * Structured audit logging for ACL decisions. Pass `true` to record every
   * allow/deny decision in an in-memory apcore-js audit log (queryable via
   * {@link TiptapAPCore.getAuditLog}), or supply your own {@link AuditLogger}.
   * Defaults to disabled.
   */
  audit?: boolean | AuditLogger;
}

/** Return value of withApcore() */
export interface ApcoreResult {
  /** APCore Registry containing all discovered module descriptors */
  registry: import("apcore-mcp").Registry;
  /** APCore Executor that routes calls to editor commands */
  executor: import("apcore-mcp").Executor;
}

/** Information about commands discovered from a TipTap extension */
export interface ExtensionCommandInfo {
  extensionName: string;
  commandNames: string[];
  extensionType: "node" | "mark" | "extension";
}

/** How a command affects the editor's text selection */
export type SelectionEffect =
  | "require"   // needs an active text selection to have any effect
  | "preserve"  // selection survives after execution
  | "destroy"   // cursor collapses, selection is lost
  | "none";     // operates on block at cursor, no selection needed

/** Annotation catalog entry */
export interface AnnotationEntry {
  annotations: ModuleAnnotations;
  tags: string[];
  category: string;
  selectionEffect: SelectionEffect;
}

/** Schema catalog entry */
export interface SchemaEntry {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}
