import type { Executor, EditorLike, ChainLike } from "../types.js";
import type { PreflightResult, PreflightCheckResult, Change } from "apcore-js";
import type { TiptapRegistry } from "./TiptapRegistry.js";
import { AclGuard } from "../security/AclGuard.js";
import { TiptapModuleError, ErrorCodes } from "../errors/index.js";

/** Max length of a content snapshot / preview string embedded in a Change. */
const MAX_PREVIEW_LEN = 500;

// Re-export for backwards compatibility
export type { EditorLike, ChainLike } from "../types.js";

// ── URL safety (C-1) ──────────────────────────────────────────────

const SAFE_PROTOCOLS = /^(https?|mailto|tel):/i;
const SAFE_RELATIVE = /^[/#?]/;

function isSafeUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return SAFE_PROTOCOLS.test(trimmed) || SAFE_RELATIVE.test(trimmed);
}

// ── Prototype pollution guard (C-2 + H-8) ─────────────────────────

const FORBIDDEN_PROPS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);

// ── Input validation helpers (H-2) ────────────────────────────────

function requireString(
  inputs: Record<string, unknown>,
  field: string,
  moduleId: string,
): string {
  const val = inputs[field];
  if (typeof val !== "string" || val.length === 0) {
    throw new TiptapModuleError(
      ErrorCodes.SCHEMA_VALIDATION_ERROR,
      `'${field}' must be a non-empty string`,
      { moduleId, field },
    );
  }
  return val;
}

function requireNumber(
  inputs: Record<string, unknown>,
  field: string,
  moduleId: string,
): number {
  const val = inputs[field];
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new TiptapModuleError(
      ErrorCodes.SCHEMA_VALIDATION_ERROR,
      `'${field}' must be a finite number`,
      { moduleId, field },
    );
  }
  return val;
}

// ── Executor ──────────────────────────────────────────────────────

export class TiptapExecutor implements Executor {
  readonly registry: TiptapRegistry;
  private editor: EditorLike;
  private aclGuard: AclGuard;
  private sanitizeHtml: ((html: string) => string) | undefined;

  constructor(
    editor: EditorLike,
    registry: TiptapRegistry,
    aclGuard: AclGuard,
    sanitizeHtml?: (html: string) => string,
  ) {
    this.editor = editor;
    this.registry = registry;
    this.aclGuard = aclGuard;
    this.sanitizeHtml = sanitizeHtml;
  }

  async call(moduleId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    // 1. Check editor ready
    if (this.editor.isDestroyed) {
      throw new TiptapModuleError(ErrorCodes.EDITOR_NOT_READY, "Editor is not ready", { editorDestroyed: true });
    }

    // 2. Resolve descriptor
    const descriptor = this.registry.getDefinition(moduleId);
    if (!descriptor) {
      throw new TiptapModuleError(ErrorCodes.MODULE_NOT_FOUND, `Module '${moduleId}' not found`, { moduleId });
    }

    // 3. ACL check (throws ACL_DENIED)
    this.aclGuard.check(moduleId, descriptor);

    // 4. Route to handler
    const category = this.extractCategory(moduleId);
    if (category === "query") {
      return this.executeQuery(moduleId, inputs);
    }
    return this.executeCommand(moduleId, inputs);
  }

  async callAsync(moduleId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call(moduleId, inputs);
  }

  /**
   * Validate inputs and predict effects WITHOUT executing the command.
   *
   * Implements the apcore Executor `validate()` contract (PROTOCOL_SPEC §5.6).
   * When this executor is passed to `serve()`, apcore-mcp exposes the
   * `__apcore_module_preview` meta-tool and gates high-risk calls behind its
   * elicitation-based approval flow — both driven entirely by this method.
   *
   * @returns A PreflightResult describing whether the call is valid, whether it
   *   requires human approval, and a structured prediction of its changes.
   */
  async validate(
    moduleId: string,
    inputs: Record<string, unknown>,
  ): Promise<PreflightResult> {
    const checks: PreflightCheckResult[] = [];
    const errors: Array<Record<string, unknown>> = [];

    // 1. Editor readiness
    if (this.editor.isDestroyed) {
      checks.push({ check: "editor_ready", passed: false, error: { editorDestroyed: true } });
      errors.push({ code: ErrorCodes.EDITOR_NOT_READY, message: "Editor is not ready" });
      return { valid: false, checks, requiresApproval: false, errors };
    }
    checks.push({ check: "editor_ready", passed: true });

    // 2. Module resolution
    const descriptor = this.registry.getDefinition(moduleId);
    if (!descriptor) {
      checks.push({ check: "module_exists", passed: false });
      errors.push({ code: ErrorCodes.MODULE_NOT_FOUND, message: `Module '${moduleId}' not found` });
      return { valid: false, checks, requiresApproval: false, errors };
    }
    checks.push({ check: "module_exists", passed: true });

    // 3. Access control (non-throwing — mirrors the check enforced by call())
    const aclAllowed = this.aclGuard.isAllowed(moduleId, descriptor);
    checks.push({ check: "acl", passed: aclAllowed });
    if (!aclAllowed) {
      errors.push({
        code: ErrorCodes.ACL_DENIED,
        message: `Access denied: module '${moduleId}' is not permitted`,
      });
    }

    // 4. Input validation (dry — reuses the same arg-building logic as call())
    const inputError = this.dryValidateInputs(moduleId, inputs);
    checks.push({ check: "input_schema", passed: inputError == null, error: inputError ?? undefined });
    if (inputError) {
      errors.push(inputError);
    }

    // 5. Approval requirement, sourced from the module's safety annotations
    const requiresApproval = descriptor.annotations?.requiresApproval ?? false;

    // 6. Predicted changes — only meaningful when the call would actually run
    const predictedChanges = errors.length === 0 ? this.predictChanges(moduleId, inputs) : [];

    return {
      valid: errors.length === 0,
      checks,
      requiresApproval,
      errors,
      predictedChanges,
    };
  }

  /**
   * Preflight — apcore-js API-parity alias for {@link validate}. Validates the
   * call without side effects and returns the same PreflightResult.
   */
  async preflight(
    moduleId: string,
    inputs: Record<string, unknown>,
  ): Promise<PreflightResult> {
    return this.validate(moduleId, inputs);
  }

  /**
   * Run the same input validation that call() performs, but without executing
   * the command. Returns a structured error record when inputs are invalid,
   * or null when they pass.
   */
  private dryValidateInputs(
    moduleId: string,
    inputs: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const category = this.extractCategory(moduleId);
    const commandName = this.extractCommandName(moduleId);
    try {
      if (category === "query") {
        this.validateQueryInputs(commandName, inputs, moduleId);
      } else if (commandName === "selectText") {
        requireString(inputs, "text", moduleId);
      } else if (!FORBIDDEN_PROPS.has(commandName)) {
        // buildArgs performs the same required-field and URL-safety checks as
        // call(), and has no side effects, so it doubles as a dry validator.
        this.buildArgs(commandName, inputs, moduleId);
      }
      return null;
    } catch (err) {
      if (err instanceof TiptapModuleError) {
        return { code: err.code, message: err.message, ...(err.details ?? {}) };
      }
      return {
        code: ErrorCodes.SCHEMA_VALIDATION_ERROR,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Validate required inputs for the built-in query commands. */
  private validateQueryInputs(
    commandName: string,
    inputs: Record<string, unknown>,
    moduleId: string,
  ): void {
    switch (commandName) {
      case "isActive":
        requireString(inputs, "name", moduleId);
        break;
      case "getAttributes":
        requireString(inputs, "typeOrName", moduleId);
        break;
      // Remaining query commands take no required inputs.
    }
  }

  /**
   * Produce a structured prediction of the side effects a command would have,
   * per the apcore preview contract. Only destructive and content-mutating
   * commands report changes; read-only, formatting, and selection commands
   * return an empty list.
   */
  private predictChanges(moduleId: string, inputs: Record<string, unknown>): Change[] {
    const commandName = this.extractCommandName(moduleId);
    switch (commandName) {
      case "clearContent":
        return [{
          action: "delete",
          target: "editor.content",
          summary: "Clear all editor content",
          before: this.snapshot(),
        }];
      case "setContent":
        return [{
          action: "replace",
          target: "editor.content",
          summary: "Replace all editor content",
          before: this.snapshot(),
          after: this.truncate(inputs.value),
        }];
      case "deleteSelection":
        return [{
          action: "delete",
          target: "editor.selection",
          summary: "Delete the current text selection",
        }];
      case "deleteRange":
        return [{
          action: "delete",
          target: `editor.range[${inputs.from}..${inputs.to}]`,
          summary: `Delete the document range from ${inputs.from} to ${inputs.to}`,
        }];
      case "deleteCurrentNode":
        return [{
          action: "delete",
          target: "editor.currentNode",
          summary: "Delete the node at the current cursor position",
        }];
      case "cut":
        return [{
          action: "delete",
          target: "editor.selection",
          summary: "Cut (remove) the current selection",
        }];
      case "deleteNode":
        return [{
          action: "delete",
          target: `editor.node[${String(inputs.typeOrName)}]`,
          summary: `Delete the nearest '${String(inputs.typeOrName)}' node`,
        }];
      case "insertContent":
        return [{
          action: "insert",
          target: "editor.selection",
          summary: "Insert content at the cursor",
          after: this.truncate(inputs.value),
        }];
      case "insertContentAt":
        return [{
          action: "insert",
          target: `editor.position[${inputs.position}]`,
          summary: `Insert content at position ${inputs.position}`,
          after: this.truncate(inputs.value),
        }];
      case "setLink":
        return [{
          action: "write",
          target: "editor.selection",
          summary: `Set link href to '${String(inputs.href)}'`,
          after: inputs.href,
        }];
      default:
        return [];
    }
  }

  /** Truncated snapshot of the editor's current HTML, for change previews. */
  private snapshot(): string {
    return this.truncate(this.editor.getHTML());
  }

  /** Coerce a value to a length-bounded preview string. */
  private truncate(value: unknown): string {
    const str = typeof value === "string" ? value : JSON.stringify(value ?? null);
    return str.length > MAX_PREVIEW_LEN ? `${str.slice(0, MAX_PREVIEW_LEN)}...` : str;
  }

  private extractCategory(moduleId: string): string {
    // "tiptap.format.toggleBold" → "format"
    const parts = moduleId.split(".");
    return parts.length >= 2 ? parts[1] : "unknown";
  }

  private extractCommandName(moduleId: string): string {
    // "tiptap.format.toggleBold" → "toggleBold"
    const parts = moduleId.split(".");
    return parts.length >= 3 ? parts[2] : moduleId;
  }

  private executeQuery(moduleId: string, inputs: Record<string, unknown>): Record<string, unknown> {
    const commandName = this.extractCommandName(moduleId);

    switch (commandName) {
      case "getHTML":
        return { html: this.editor.getHTML() };
      case "getJSON":
        return { json: this.editor.getJSON() };
      case "getText": {
        const options: { blockSeparator?: string } = {};
        if (typeof inputs.blockSeparator === "string") {
          options.blockSeparator = inputs.blockSeparator;
        }
        return { text: this.editor.getText(options) };
      }
      case "isActive": {
        const name = requireString(inputs, "name", moduleId);
        return { active: this.editor.isActive(name, (inputs.attrs as Record<string, unknown>) ?? {}) };
      }
      case "getAttributes": {
        const typeOrName = requireString(inputs, "typeOrName", moduleId);
        return { attributes: this.editor.getAttributes(typeOrName) };
      }
      case "isEmpty":
        return { value: this.editor.isEmpty };
      case "isEditable":
        return { value: this.editor.isEditable };
      case "isFocused":
        return { value: this.editor.isFocused };
      case "getCharacterCount": {
        const cc = this.editor.storage?.characterCount;
        if (!cc || typeof cc.characters !== "function") {
          throw new TiptapModuleError(ErrorCodes.COMMAND_NOT_FOUND,
            "Character count extension not available", { moduleId, commandName });
        }
        return { count: cc.characters() as number };
      }
      case "getWordCount": {
        const cc = this.editor.storage?.characterCount;
        if (!cc || typeof cc.words !== "function") {
          throw new TiptapModuleError(ErrorCodes.COMMAND_NOT_FOUND,
            "Character count extension not available", { moduleId, commandName });
        }
        return { count: cc.words() as number };
      }
      default:
        throw new TiptapModuleError(ErrorCodes.COMMAND_NOT_FOUND,
          `Command '${commandName}' not available on editor`, { moduleId, commandName });
    }
  }

  private executeCommand(moduleId: string, inputs: Record<string, unknown>): Record<string, unknown> {
    const commandName = this.extractCommandName(moduleId);

    // Built-in: selectText — find text content and set selection
    if (commandName === "selectText") {
      return this.handleSelectText(inputs, moduleId);
    }

    // C-2 + H-8: Prototype pollution / arbitrary command guard
    if (FORBIDDEN_PROPS.has(commandName)) {
      throw new TiptapModuleError(ErrorCodes.COMMAND_NOT_FOUND,
        `Command '${commandName}' is not allowed`, { moduleId, commandName });
    }

    // Build chain: editor.chain().focus().<commandName>(...args).run()
    const chain = this.editor.chain().focus();
    const commandFn = chain[commandName];

    if (typeof commandFn !== "function") {
      throw new TiptapModuleError(ErrorCodes.COMMAND_NOT_FOUND,
        `Command '${commandName}' not available on editor`, { moduleId, commandName });
    }

    // Spread input arguments into the command
    const args = this.buildArgs(commandName, inputs, moduleId);
    const resultChain = commandFn.call(chain, ...args);
    const success = resultChain.run();

    if (!success) {
      // undo/redo return false when history stack is empty — this is a normal
      // condition (editor is recreated per request), not an execution error.
      if (commandName === "undo" || commandName === "redo") {
        return { success: false, reason: `Nothing to ${commandName}` };
      }
      throw new TiptapModuleError(ErrorCodes.COMMAND_FAILED,
        `Command '${commandName}' failed`, { moduleId, commandName });
    }

    return { success: true };
  }

  private handleSelectText(inputs: Record<string, unknown>, moduleId: string): Record<string, unknown> {
    const text = requireString(inputs, "text", moduleId);
    const occurrence = typeof inputs.occurrence === "number" ? Math.max(1, inputs.occurrence) : 1;

    const doc = this.editor.state.doc;
    let count = 0;
    let foundFrom = -1;
    let foundTo = -1;

    doc.descendants((node, pos) => {
      if (foundFrom >= 0) return false;
      if (node.isText && node.text) {
        let searchFrom = 0;
        while (searchFrom < node.text.length) {
          const idx = node.text.indexOf(text, searchFrom);
          if (idx === -1) break;
          count++;
          if (count === occurrence) {
            foundFrom = pos + idx;
            foundTo = foundFrom + text.length;
            return false;
          }
          searchFrom = idx + 1;
        }
      }
    });

    if (foundFrom < 0) {
      return { found: false };
    }

    // Set text selection around the found text
    const chain = this.editor.chain().focus();
    chain.setTextSelection({ from: foundFrom, to: foundTo }).run();

    return { found: true, from: foundFrom, to: foundTo };
  }

  private buildArgs(commandName: string, inputs: Record<string, unknown>, moduleId: string): unknown[] {
    // Map input object fields to positional command arguments based on command name
    // Most commands take 0 or 1 args
    switch (commandName) {
      // Commands with no args
      case "toggleBold": case "toggleItalic": case "toggleStrike": case "toggleCode":
      case "toggleUnderline": case "toggleSubscript": case "toggleSuperscript":
      case "toggleBulletList": case "toggleOrderedList": case "toggleTaskList":
      case "toggleBlockquote": case "unsetAllMarks": case "clearNodes":
      case "setHardBreak": case "setHorizontalRule": case "unsetLink":
      case "selectAll": case "selectParentNode": case "selectTextblockStart":
      case "selectTextblockEnd": case "blur": case "scrollIntoView":
      case "undo": case "redo": case "deleteSelection": case "deleteCurrentNode":
      case "cut": case "joinBackward": case "joinForward":
      case "setBold": case "unsetBold": case "setItalic": case "unsetItalic":
      case "setStrike": case "unsetStrike": case "setCode": case "unsetCode":
      case "setBlockquote": case "unsetBlockquote": case "setParagraph":
      case "exitCode":
        return [];

      case "splitBlock":
        return inputs.keepMarks !== undefined ? [{ keepMarks: inputs.keepMarks }] : [];

      // Commands with single object arg
      case "toggleHeading":
        return [{ level: inputs.level }];
      case "setHeading":
        return [{ level: inputs.level }];
      case "toggleHighlight":
        return inputs.color ? [{ color: inputs.color }] : [];
      case "toggleCodeBlock":
        return inputs.language ? [{ language: inputs.language }] : [];
      case "setTextAlign":
        return [inputs.alignment as string];
      case "setMark":
        return [inputs.typeOrName as string, inputs.attrs ?? {}];
      case "unsetMark":
        return [inputs.typeOrName as string];
      case "updateAttributes":
        return [inputs.typeOrName as string, inputs.attrs as Record<string, unknown>];
      case "setLink": {
        // C-1: URL protocol validation
        if (!isSafeUrl(inputs.href)) {
          throw new TiptapModuleError(ErrorCodes.SCHEMA_VALIDATION_ERROR,
            "Invalid or unsafe URL protocol", { field: "href" });
        }
        const linkAttrs: Record<string, unknown> = { href: inputs.href };
        if (inputs.target !== undefined) linkAttrs.target = inputs.target;
        if (inputs.rel !== undefined) linkAttrs.rel = inputs.rel;
        return [linkAttrs];
      }

      // Content commands — H-1: sanitize HTML
      case "insertContent": {
        let value = inputs.value;
        if (typeof value === "string" && this.sanitizeHtml) {
          value = this.sanitizeHtml(value);
        }
        return [value, inputs.options ?? {}];
      }
      case "insertContentAt": {
        const position = requireNumber(inputs, "position", moduleId);
        let value = inputs.value;
        if (typeof value === "string" && this.sanitizeHtml) {
          value = this.sanitizeHtml(value);
        }
        return [position, value, inputs.options ?? {}];
      }
      case "setNode":
        return [inputs.typeOrName as string, inputs.attrs ?? {}];
      case "liftListItem": case "sinkListItem":
        return [inputs.typeOrName as string];
      case "wrapIn":
        return [inputs.typeOrName as string, inputs.attrs ?? {}];
      case "lift":
        return [inputs.typeOrName as string, inputs.attrs ?? {}];
      case "splitListItem":
        return [inputs.typeOrName as string, inputs.overrideAttrs ?? {}];
      case "wrapInList":
        return [inputs.typeOrName as string, inputs.attributes ?? {}];
      case "toggleList":
        return [inputs.listTypeOrName as string, inputs.itemTypeOrName as string, inputs.keepMarks ?? false, inputs.attributes ?? {}];
      case "deleteNode":
        return [inputs.typeOrName as string];

      // Destructive commands
      case "clearContent":
        return inputs.emitUpdate !== undefined ? [inputs.emitUpdate] : [];
      case "setContent": {
        let value = inputs.value as string;
        if (typeof value === "string" && this.sanitizeHtml) {
          value = this.sanitizeHtml(value);
        }
        return [value, inputs.emitUpdate ?? true, inputs.parseOptions ?? {}];
      }
      case "deleteRange":
        return [{ from: inputs.from, to: inputs.to }];

      // Selection commands
      case "setTextSelection":
        return [inputs.position];
      case "setNodeSelection": {
        const position = requireNumber(inputs, "position", moduleId);
        return [position];
      }
      case "focus":
        return inputs.position !== undefined ? [inputs.position] : [];

      default:
        // Unknown commands: pass all inputs as single object arg
        return Object.keys(inputs).length > 0 ? [inputs] : [];
    }
  }
}
