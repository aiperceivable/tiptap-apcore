import type {
  ApcoreOptions,
  EditorLike,
  AclConfig,
  ModuleDescriptor,
  AuditLogger,
  AuditEntry,
} from "../types.js";
import type { PreflightResult } from "apcore-js";
import { ExtensionScanner } from "../discovery/index.js";
import { ModuleBuilder } from "../builder/index.js";
import { TiptapRegistry } from "./TiptapRegistry.js";
import { TiptapExecutor } from "./TiptapExecutor.js";
import { AclGuard } from "../security/index.js";
import { TiptapModuleError, ErrorCodes } from "../errors/index.js";

const PREFIX_PATTERN = /^[a-z][a-z0-9]*$/;

/**
 * TiptapAPCore - Unified entry point for TipTap editor AI control.
 *
 * This class encapsulates the registry, executor, and discovery logic,
 * providing a simplified API for developers.
 */
export class TiptapAPCore {
  private _editor: EditorLike;
  private _options: ApcoreOptions;
  private _registry: TiptapRegistry;
  private _executor: TiptapExecutor;
  private _aclGuard: AclGuard;
  private _scanner: ExtensionScanner;
  private _builder: ModuleBuilder;
  private _auditLogger: AuditLogger | undefined;
  private _auditEntries: AuditEntry[] | undefined;

  constructor(editor: EditorLike, options?: ApcoreOptions) {
    if (editor == null) {
      throw new TypeError("editor must be a valid TipTap Editor instance");
    }

    if (editor.isDestroyed) {
      throw new TiptapModuleError(
        ErrorCodes.EDITOR_NOT_READY,
        "Editor is not ready",
        { editorDestroyed: true },
      );
    }

    this._editor = editor;
    this._options = { ...options };

    // Validate options
    const prefix = this._options.prefix ?? "tiptap";
    if (!PREFIX_PATTERN.test(prefix)) {
      throw new TiptapModuleError(
        ErrorCodes.SCHEMA_VALIDATION_ERROR,
        `Invalid prefix '${prefix}': must match /^[a-z][a-z0-9]*$/`,
        { field: "prefix", value: prefix },
      );
    }

    const validRoles = ["readonly", "editor", "admin"];
    if (
      this._options.acl?.role &&
      !validRoles.includes(this._options.acl.role)
    ) {
      throw new TiptapModuleError(
        ErrorCodes.SCHEMA_VALIDATION_ERROR,
        `Invalid ACL role '${this._options.acl.role}': must be one of ${validRoles.join(", ")}`,
        { field: "acl.role", value: this._options.acl.role },
      );
    }

    // 1. Initialize components
    this._scanner = new ExtensionScanner(this._options.logger);
    this._builder = new ModuleBuilder(prefix);
    this._registry = new TiptapRegistry();
    const resolvedAudit = this.resolveAuditLogger(this._options.audit);
    this._auditLogger = resolvedAudit.logger;
    this._auditEntries = resolvedAudit.entries;
    this._aclGuard = new AclGuard(
      this._options.acl,
      this._options.logger,
      this._auditLogger,
    );
    this._executor = new TiptapExecutor(
      editor,
      this._registry,
      this._aclGuard,
      this._options.sanitizeHtml,
    );

    // 2. Initial discovery
    this.refresh();

    // 3. Set up deferred discovery (for SDK compatibility)
    this._registry.setScanFunction(() => this.refresh());
  }

  /** The APCore Registry containing all discovered module definitions */
  get registry(): TiptapRegistry {
    return this._registry;
  }

  /** The APCore Executor for running commands against the editor */
  get executor(): TiptapExecutor {
    return this._executor;
  }

  /** The structured ACL audit logger, if auditing was enabled via options. */
  get auditLogger(): AuditLogger | undefined {
    return this._auditLogger;
  }

  /**
   * Return the recorded ACL audit entries (allow/deny decisions).
   *
   * Only populated when `audit: true` was passed in the options (which enables
   * the built-in in-memory collector). When a custom {@link AuditLogger}
   * function is supplied instead, entries go to that sink and this returns an
   * empty array — query your own store.
   */
  getAuditLog(): AuditEntry[] {
    return this._auditEntries ? [...this._auditEntries] : [];
  }

  /**
   * Resolve the `audit` option into an apcore-js {@link AuditLogger} callback.
   *
   * - `true` → a built-in in-memory collector (entries readable via
   *   {@link getAuditLog}).
   * - an {@link AuditLogger} function → used directly as the sink.
   * - falsy → auditing disabled.
   */
  private resolveAuditLogger(audit: boolean | AuditLogger | undefined): {
    logger: AuditLogger | undefined;
    entries: AuditEntry[] | undefined;
  } {
    if (!audit) return { logger: undefined, entries: undefined };
    if (audit === true) {
      const entries: AuditEntry[] = [];
      return { logger: (entry) => { entries.push(entry); }, entries };
    }
    return { logger: audit, entries: undefined };
  }

  /**
   * Execute an editor command via APCore.
   *
   * @param moduleId - The module ID (e.g., 'tiptap.format.toggleBold')
   * @param inputs - Input arguments for the command
   * @returns The execution result
   */
  async call(
    moduleId: string,
    inputs: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this._executor.call(moduleId, inputs);
  }

  /**
   * Validate a command and predict its effects WITHOUT executing it.
   *
   * Delegates to the executor's apcore `validate()` contract, returning a
   * PreflightResult with validity, approval requirement, and predicted changes.
   * This is what powers the apcore-mcp preview meta-tool and approval flow.
   *
   * @param moduleId - The module ID (e.g., 'tiptap.destructive.clearContent')
   * @param inputs - Input arguments for the command
   */
  async validate(
    moduleId: string,
    inputs: Record<string, unknown>,
  ): Promise<PreflightResult> {
    return this._executor.validate(moduleId, inputs);
  }

  /**
   * Preflight — alias for {@link validate}, mirroring the apcore-js Executor API.
   */
  async preflight(
    moduleId: string,
    inputs: Record<string, unknown>,
  ): Promise<PreflightResult> {
    return this._executor.preflight(moduleId, inputs);
  }

  /**
   * List available modules in the registry.
   *
   * @param options - Optional filters (tags, prefix)
   * @returns Array of module IDs
   */
  list(options?: { tags?: string[]; prefix?: string }): string[] {
    return this._registry.list(options);
  }

  /**
   * Get the full definition of a module.
   *
   * @param moduleId - The module ID to look up
   * @returns The module descriptor or null if not found
   */
  getDefinition(moduleId: string): ModuleDescriptor | null {
    return this._registry.getDefinition(moduleId);
  }

  /**
   * Update the ACL configuration without recreating the instance.
   *
   * @param acl - The new ACL configuration
   */
  setAcl(acl: AclConfig): void {
    const validRoles = ["readonly", "editor", "admin"];
    if (acl.role && !validRoles.includes(acl.role)) {
      throw new TiptapModuleError(
        ErrorCodes.SCHEMA_VALIDATION_ERROR,
        `Invalid ACL role '${acl.role}': must be one of ${validRoles.join(", ")}`,
        { field: "acl.role", value: acl.role },
      );
    }
    this._options.acl = acl;
    this._aclGuard.updateConfig(acl);
  }

  /**
   * Trigger a re-scan of TipTap extensions to update the registry.
   *
   * @returns The number of modules discovered
   */
  refresh(): number {
    const includeUnsafe = this._options.includeUnsafe ?? false;
    const extensionMap = this._scanner.scan(this._editor);
    const newIds = new Set<string>();

    // Register new/updated
    for (const [, extensionInfo] of extensionMap) {
      for (const commandName of extensionInfo.commandNames) {
        const descriptor = this._builder.build(commandName, extensionInfo);

        // Skip unknown commands if includeUnsafe is false
        if (!includeUnsafe && descriptor.tags?.includes("unknown")) {
          continue;
        }

        newIds.add(descriptor.moduleId);
        this._registry.register(descriptor);
      }
    }

    // Unregister removed
    for (const oldId of this._registry.list()) {
      if (!newIds.has(oldId)) {
        this._registry.unregister(oldId);
      }
    }

    return newIds.size;
  }
}
