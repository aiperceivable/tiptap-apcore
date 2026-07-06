import type { Request, Response } from "express";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { withApcore, AclGuard } from "tiptap-apcore";
import type { Registry, AclConfig, AuditEntry } from "tiptap-apcore";
import { toolLoop } from "./toolLoop.js";
import { applyJsdomGlobals, saveGlobals, restoreGlobals, globalsMutex } from "./jsdomGlobals.js";

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  editorHtml: string;
  model?: string;
  role: "readonly" | "editor" | "admin";
}

const DEFAULT_MODEL = process.env.LLM_MODEL || "openai:gpt-4o";

/** Extract command name from a moduleId like "tiptap.format.toggleBold" */
function commandName(moduleId: string): string {
  const parts = moduleId.split(".");
  return parts[parts.length - 1];
}

/** Extract category from a moduleId like "tiptap.format.toggleBold" -> "format" */
function categoryOf(moduleId: string): string {
  const parts = moduleId.split(".");
  return parts.length >= 3 ? parts[1] : "unknown";
}

/**
 * Build a dynamic command map grouped by category from the registry.
 * Only includes commands actually available (respects ACL filtering).
 */
function buildCommandMap(registry: Registry): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const moduleId of registry.list()) {
    const cat = categoryOf(moduleId);
    if (!map[cat]) map[cat] = [];
    map[cat].push(commandName(moduleId));
  }
  return map;
}

/**
 * Classify available commands by selection behavior.
 * Reads selectionEffect from each module's metadata (set by AnnotationCatalog).
 * Fully dynamic — no hardcoded command names.
 */
function classifySelectionBehavior(registry: Registry): {
  require: string[];
  preserve: string[];
  destroy: string[];
  none: string[];
} {
  const result: Record<string, string[]> = {
    require: [],
    preserve: [],
    destroy: [],
    none: [],
  };

  for (const moduleId of registry.list()) {
    const desc = registry.getDefinition(moduleId);
    const effect = (desc?.metadata as Record<string, unknown>)?.selectionEffect as string ?? "preserve";
    const name = commandName(moduleId);
    if (result[effect]) {
      result[effect].push(name);
    } else {
      result.preserve.push(name);
    }
  }

  return result as { require: string[]; preserve: string[]; destroy: string[]; none: string[] };
}

/**
 * Create a registry view that only surfaces modules the given AclGuard permits.
 * Prevents the AI from seeing (and attempting to call) commands it cannot use.
 */
function filterRegistryByAcl(registry: Registry, guard: AclGuard): Registry {
  return new Proxy(registry, {
    get(target: Registry, prop: string | symbol) {
      if (prop === "list") {
        return (options?: { tags?: string[] | null; prefix?: string | null }) =>
          target.list(options).filter((id) => {
            const desc = target.getDefinition(id);
            return desc != null && guard.isAllowed(id, desc);
          });
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * Build the system prompt dynamically from the registry.
 *
 * Static: behavioral rules, patterns, anti-patterns (generic, no hardcoded command names).
 * Dynamic: available commands grouped by category, selection behavior classification.
 */
function buildSystemPrompt(registry: Registry, editorHtml: string): string {
  const cmdMap = buildCommandMap(registry);
  const sel = classifySelectionBehavior(registry);

  // Build available commands section
  const commandSections = Object.entries(cmdMap)
    .map(([cat, cmds]) => `  ${cat}: ${cmds.join(", ")}`)
    .join("\n");

  return `You are an AI assistant for rich-text editing via a TipTap editor. You have access to TipTap editor commands as tools. You may use up to 10 tool calls per request. After making changes, summarize what you did.

## Available Commands (by category)

${commandSections}

## Selection State Machine — THE CORE RULE

Every command interacts with the editor's invisible "selection state." You MUST mentally track it:

REQUIRE SELECTION (do nothing without an active text range):
  ${sel.require.join(", ") || "(none available)"}

PRESERVE SELECTION (selection survives after execution):
  ${sel.preserve.join(", ") || "(none available)"}

DESTROY SELECTION (cursor collapses — subsequent format has no effect):
  ${sel.destroy.join(", ") || "(none available)"}

NO SELECTION NEEDED (operate on the block at cursor position):
  ${sel.none.join(", ") || "(none available)"}

KEY RULE: After any selection-destroying command, you MUST re-select text before applying formatting.

MULTI-OCCURRENCE RULE: When the user says "change X" or "make X bold" without saying "first" or "one", you MUST apply the change to ALL occurrences. Loop with selectText(text, occurrence=1) -> edit, repeat until selectText returns { found: false }. Do NOT stop after the first match.

## Common Task Patterns

1. Format existing text: selectText -> format command (e.g. toggleBold)
2. Replace + format — THE PREFERRED PATTERN: selectText -> ONE insertContent with HTML (e.g. "<strong>new text</strong>"). This is a single operation that replaces the selection AND applies formatting. Example: to change "APCore" to bold lowercase, do: selectText("APCore") -> insertContent("<strong>apcore</strong>"). Done — do NOT call insertContent again.
3. Replace + format (alternative, error-prone): selectText -> insertContent (plain) -> selectText (re-select) -> format command. Caution: re-select may match a different occurrence — use the occurrence parameter to target the correct one.
4. Multi-format same text: selectText -> toggleBold -> toggleItalic (formats preserve selection)
5. Change block type: selectText (any text in target block) -> node-level command (e.g. toggleHeading)
6. Add content at end: focus("end") -> insertContent
7. Delete specific text: selectText -> deleteSelection
8. Replace entire document: setContent (single command, no selection needed)
9. Check before acting: getText -> read result -> plan edits -> execute
10. Change ALL occurrences: selectText(text, occurrence=1) -> edit -> repeat with occurrence=1 until { found: false }. After each replacement remaining matches shift down, so always use occurrence=1.

## Command Category Rules

QUERY: Safe anytime, no state changes. Use getText/getHTML to inspect content before ambiguous edits.

FORMAT: Mark-level commands need an active text selection. Node-level commands operate on the block at the cursor. insertContent accepts HTML strings for inline formatting (e.g. "<em>italic</em>").

CONTENT: insertContent replaces the current selection if one exists; accepts plain text or HTML.

DESTRUCTIVE: Commands like clearContent and setContent affect the entire document — only use for full document replacement. deleteSelection requires a prior selectText.

SELECTION: selectText is your PRIMARY tool for targeting text. It performs SUBSTRING matching — a short string will match inside longer words. When the same text appears multiple times, use the occurrence parameter (1-based integer) to target the correct one. Analyze the user's intent and document context to determine which occurrence they mean. Always check the "found" field in the result before proceeding. Never calculate ProseMirror positions manually.

HISTORY: undo/redo only work for changes made within the SAME request (the editor is recreated per request, so history from previous requests is lost). If the user asks to "undo" or "rollback" a change from a PREVIOUS message, do NOT use the undo command — it will fail. Instead, tell the user to click the "Undo" button in the UI. Within the same request, undo works normally.

## Error Handling & Recovery

- If selectText returns { found: false }: inform the user. Use getText to show actual content.
- If a format command has no visible effect: you likely forgot to select text first.
- User asks to undo a previous change: tell them to use the Undo button (undo command only works within the same request).
- Do not retry failed commands blindly — diagnose why they failed first.

## Anti-Patterns — NEVER DO THESE

- NEVER call insertContent twice for a single replacement. If you need to replace text AND format it, use ONE insertContent with HTML markup (Pattern 2). Calling insertContent(plain) then insertContent(formatted) will DUPLICATE the text.
- NEVER apply a format command right after insertContent (selection is destroyed — re-select first)
- NEVER use setTextSelection with guessed positions (use selectText instead)
- NEVER use clearContent/setContent unless the user explicitly wants full document replacement
- NEVER assume selectText succeeded without checking the "found" field
- NEVER apply a mark-level format command without a preceding selectText
- CAUTION: selectText does substring matching. When re-selecting after insertContent, the text may match at the wrong location. Use the occurrence parameter or prefer insertContent with HTML formatting to avoid ambiguity.

## Current Document HTML

${editorHtml}`;
}

function createHeadlessEditor(html: string): Editor {
  // Set up a minimal DOM environment for TipTap
  const dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"editor\"></div></body></html>");
  applyJsdomGlobals(dom);

  const element = dom.window.document.getElementById("editor")!;

  const editor = new Editor({
    element,
    extensions: [StarterKit],
    content: html,
  });

  return editor;
}

export async function chatHandler(req: Request, res: Response): Promise<void> {
  const { messages, editorHtml, model: requestModel, role } = req.body as ChatRequest;

  // Validate request
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }
  if (typeof editorHtml !== "string") {
    res.status(400).json({ error: "editorHtml string is required" });
    return;
  }
  if (!["readonly", "editor", "admin"].includes(role)) {
    res.status(400).json({ error: "role must be 'readonly', 'editor', or 'admin'" });
    return;
  }

  // Fast path: detect undo/cancel/redo shortcuts and return immediately
  // without creating an editor or calling the LLM.
  const UNDO_PATTERNS = /^(undo|cancel|revert)$/i;
  const REDO_PATTERNS = /^(redo)$/i;
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastText = lastUserMsg?.content.trim() ?? "";

  if (UNDO_PATTERNS.test(lastText)) {
    res.json({
      reply: "Done — reverted to the previous version. (Note: the server cannot undo across requests. Use the frontend Undo button for full undo support.)",
      updatedHtml: editorHtml,
      toolCalls: [],
    });
    return;
  }
  if (REDO_PATTERNS.test(lastText)) {
    res.json({
      reply: "Redo is not supported via the chat API. Use Ctrl+Y / Cmd+Shift+Z in the editor.",
      updatedHtml: editorHtml,
      toolCalls: [],
    });
    return;
  }

  const model = requestModel || DEFAULT_MODEL;

  // Validate model format: must be "provider:model-name"
  if (!/^[a-z]+:.+$/.test(model)) {
    res.status(400).json({ error: `Invalid model format '${model}'. Expected 'provider:model-name' (e.g. 'openai:gpt-4o').` });
    return;
  }

  let editor: Editor | null = null;

  // Acquire mutex to prevent concurrent requests from corrupting globals
  await globalsMutex.acquire();
  const savedGlobals = saveGlobals();

  try {
    // 1. Create headless TipTap editor
    editor = createHeadlessEditor(editorHtml);

    // 2. Create APCore executor with ACL.
    // "editor" role gets scoped delete commands (deleteSelection, deleteCurrentNode)
    // in addition to its normal allowed categories. Broad destructive commands
    // (clearContent, setContent, deleteRange, cut) remain admin-only.
    const aclConfig: AclConfig = role === "editor"
      ? {
        role,
        allowModules: [
          "tiptap.destructive.deleteSelection",
          "tiptap.destructive.deleteCurrentNode",
        ],
      }
      : { role };

    const auditTrail: AuditEntry[] = [];
    const { executor, registry } = withApcore(editor as unknown as import("tiptap-apcore").EditorLike, { acl: aclConfig, includeUnsafe: false, audit: (entry: AuditEntry) => { auditTrail.push(entry); } });

    // Filter registry so AI only sees commands it can actually call.
    // This prevents the AI from discovering and attempting restricted commands.
    const aclGuard = new AclGuard(aclConfig);
    const filteredRegistry = filterRegistryByAcl(registry, aclGuard);

    // 3. Build system prompt dynamically from registry + document
    const systemPrompt = buildSystemPrompt(filteredRegistry, editorHtml);

    // 4. Run tool loop via AI SDK
    const result = await toolLoop(systemPrompt, messages, filteredRegistry, executor, model);

    // 5. Return response
    res.json({
      reply: result.reply,
      updatedHtml: editor.getHTML(),
      toolCalls: result.toolCalls,
      audit: auditTrail,
    });
  } catch (err: unknown) {
    console.error("Chat handler error:", err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  } finally {
    if (editor) {
      editor.destroy();
    }
    restoreGlobals(savedGlobals);
    globalsMutex.release();
  }
}
