/**
 * @vitest-environment jsdom
 *
 * Registry validation tests — no LLM required.
 *
 * Verifies that:
 *  1. All APCore module IDs follow the tiptap.[category].[command] pattern
 *  2. Each role gets exactly the right set of modules (ACL enforcement)
 *  3. Known commands are present in their expected categories
 *  4. Module metadata (tags, description, inputSchema) is complete
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { withApcore, AclGuard } from "tiptap-apcore";
import type { AclConfig, Registry, ModuleDescriptor } from "tiptap-apcore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EDITOR_ACL: AclConfig = {
  role: "editor",
  allowModules: [
    "tiptap.destructive.deleteSelection",
    "tiptap.destructive.deleteCurrentNode",
  ],
};

function buildRegistry(role: "readonly" | "editor" | "admin") {
  const aclConfig: AclConfig = role === "editor" ? EDITOR_ACL : { role };
  const editor = new Editor({
    extensions: [StarterKit],
    content: "<p>Test content</p>",
  });
  const { registry } = withApcore(editor, { acl: aclConfig, includeUnsafe: false });
  const guard = new AclGuard(aclConfig);
  const allowed = registry
    .list()
    .filter((id) => {
      const desc = registry.getDefinition(id);
      return desc != null && guard.isAllowed(id, desc);
    });
  return { editor, registry, guard, allowed };
}

// Build one admin registry shared across tests
let editor: Editor;
let adminRegistry: Registry;
let adminAllowed: string[];

beforeAll(() => {
  const r = buildRegistry("admin");
  editor = r.editor;
  adminRegistry = r.registry;
  adminAllowed = r.allowed;
});

afterAll(() => {
  editor?.destroy();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("APCore Module Registry", () => {
  // ── Module ID pattern ────────────────────────────────────────────────────

  describe("Module ID pattern", () => {
    it("all IDs match tiptap.[category].[command]", () => {
      const pattern = /^tiptap\.(query|format|content|destructive|selection|history)\.\w+$/;
      for (const id of adminAllowed) {
        expect(id, `ID "${id}" does not match pattern`).toMatch(pattern);
      }
    });

    it("only known categories are used", () => {
      const knownCategories = new Set([
        "query", "format", "content", "destructive", "selection", "history",
      ]);
      for (const id of adminAllowed) {
        const category = id.split(".")[1];
        expect(knownCategories.has(category), `Unknown category "${category}" in "${id}"`).toBe(true);
      }
    });

    it("no duplicate module IDs", () => {
      const seen = new Set<string>();
      for (const id of adminAllowed) {
        expect(seen.has(id), `Duplicate module ID: ${id}`).toBe(false);
        seen.add(id);
      }
    });
  });

  // ── Module metadata completeness ─────────────────────────────────────────

  describe("Module metadata", () => {
    it("every module has a non-empty description", () => {
      for (const id of adminAllowed) {
        const desc = adminRegistry.getDefinition(id) as ModuleDescriptor;
        expect(desc.description, `${id} missing description`).toBeTruthy();
        expect(typeof desc.description).toBe("string");
      }
    });

    it("every module has at least one tag", () => {
      for (const id of adminAllowed) {
        const desc = adminRegistry.getDefinition(id) as ModuleDescriptor;
        expect(Array.isArray(desc.tags), `${id} tags not an array`).toBe(true);
        expect((desc.tags ?? []).length, `${id} has no tags`).toBeGreaterThan(0);
      }
    });

    it("every module has an inputSchema with type=object", () => {
      for (const id of adminAllowed) {
        const desc = adminRegistry.getDefinition(id) as ModuleDescriptor;
        expect(desc.inputSchema, `${id} missing inputSchema`).toBeTruthy();
        expect((desc.inputSchema as Record<string, unknown>).type).toBe("object");
      }
    });

    it("tags match the category in the module ID", () => {
      for (const id of adminAllowed) {
        const category = id.split(".")[1];
        const desc = adminRegistry.getDefinition(id) as ModuleDescriptor;
        expect(
          (desc.tags ?? []).includes(category),
          `${id}: tags ${JSON.stringify(desc.tags)} do not include category "${category}"`,
        ).toBe(true);
      }
    });
  });

  // ── Role-based filtering (ACL) ───────────────────────────────────────────

  describe("Role-based ACL filtering", () => {
    it("readonly: only query modules exposed", () => {
      const { allowed } = buildRegistry("readonly");
      expect(allowed.length).toBeGreaterThan(0);
      for (const id of allowed) {
        expect(id, `readonly got non-query module: ${id}`).toMatch(/^tiptap\.query\./);
      }
    });

    it("readonly: has all query commands", () => {
      const { allowed } = buildRegistry("readonly");
      const queryIds = allowed.filter((id) => id.startsWith("tiptap.query."));
      expect(queryIds).toContain("tiptap.query.getText");
      expect(queryIds).toContain("tiptap.query.getHTML");
      expect(queryIds).toContain("tiptap.query.getJSON");
      expect(queryIds).toContain("tiptap.query.isActive");
      expect(queryIds).toContain("tiptap.query.isEmpty");
    });

    it("editor: has format, content, selection, history, query categories", () => {
      const { allowed } = buildRegistry("editor");
      const categories = new Set(allowed.map((id) => id.split(".")[1]));
      expect(categories.has("query")).toBe(true);
      expect(categories.has("format")).toBe(true);
      expect(categories.has("content")).toBe(true);
      expect(categories.has("selection")).toBe(true);
      expect(categories.has("history")).toBe(true);
    });

    it("editor: deleteSelection is accessible (allowModules fix)", () => {
      const { allowed } = buildRegistry("editor");
      expect(allowed).toContain("tiptap.destructive.deleteSelection");
    });

    it("editor: deleteCurrentNode is accessible (allowModules fix)", () => {
      const { allowed } = buildRegistry("editor");
      expect(allowed).toContain("tiptap.destructive.deleteCurrentNode");
    });

    it("editor: clearContent is NOT accessible", () => {
      const { allowed } = buildRegistry("editor");
      expect(allowed).not.toContain("tiptap.destructive.clearContent");
    });

    it("editor: setContent is NOT accessible", () => {
      const { allowed } = buildRegistry("editor");
      expect(allowed).not.toContain("tiptap.destructive.setContent");
    });

    it("editor: deleteRange is NOT accessible", () => {
      const { allowed } = buildRegistry("editor");
      expect(allowed).not.toContain("tiptap.destructive.deleteRange");
    });

    it("editor: cut is NOT accessible", () => {
      const { allowed } = buildRegistry("editor");
      expect(allowed).not.toContain("tiptap.destructive.cut");
    });

    it("admin: all destructive commands are accessible", () => {
      const { allowed } = buildRegistry("admin");
      expect(allowed).toContain("tiptap.destructive.clearContent");
      expect(allowed).toContain("tiptap.destructive.setContent");
      expect(allowed).toContain("tiptap.destructive.deleteSelection");
      expect(allowed).toContain("tiptap.destructive.deleteRange");
      expect(allowed).toContain("tiptap.destructive.deleteCurrentNode");
      expect(allowed).toContain("tiptap.destructive.cut");
    });

    it("admin has more modules than editor, editor has more than readonly", () => {
      const { allowed: adminList } = buildRegistry("admin");
      const { allowed: editorList } = buildRegistry("editor");
      const { allowed: readonlyList } = buildRegistry("readonly");
      expect(adminList.length).toBeGreaterThan(editorList.length);
      expect(editorList.length).toBeGreaterThan(readonlyList.length);
    });
  });

  // ── Known commands per category ──────────────────────────────────────────

  describe("Known commands — format category", () => {
    it("mark commands: toggleBold, toggleItalic, toggleStrike, toggleCode", () => {
      expect(adminAllowed).toContain("tiptap.format.toggleBold");
      expect(adminAllowed).toContain("tiptap.format.toggleItalic");
      expect(adminAllowed).toContain("tiptap.format.toggleStrike");
      expect(adminAllowed).toContain("tiptap.format.toggleCode");
    });

    it("heading commands: toggleHeading, setHeading", () => {
      expect(adminAllowed).toContain("tiptap.format.toggleHeading");
      expect(adminAllowed).toContain("tiptap.format.setHeading");
    });

    it("list commands: toggleBulletList, toggleOrderedList", () => {
      expect(adminAllowed).toContain("tiptap.format.toggleBulletList");
      expect(adminAllowed).toContain("tiptap.format.toggleOrderedList");
    });

    it("block commands: toggleBlockquote, toggleCodeBlock", () => {
      expect(adminAllowed).toContain("tiptap.format.toggleBlockquote");
      expect(adminAllowed).toContain("tiptap.format.toggleCodeBlock");
    });

    it("inline commands: setHardBreak, setHorizontalRule", () => {
      expect(adminAllowed).toContain("tiptap.format.setHardBreak");
      expect(adminAllowed).toContain("tiptap.format.setHorizontalRule");
    });

    it("unset commands: unsetAllMarks, clearNodes", () => {
      expect(adminAllowed).toContain("tiptap.format.unsetAllMarks");
      expect(adminAllowed).toContain("tiptap.format.clearNodes");
    });
  });

  describe("Known commands — content category", () => {
    it("insert commands: insertContent, insertContentAt", () => {
      expect(adminAllowed).toContain("tiptap.content.insertContent");
      expect(adminAllowed).toContain("tiptap.content.insertContentAt");
    });

    it("node commands: deleteNode, setNode", () => {
      expect(adminAllowed).toContain("tiptap.content.deleteNode");
      expect(adminAllowed).toContain("tiptap.content.setNode");
    });
  });

  describe("Known commands — selection category", () => {
    it("selectText (custom APCore command) is present", () => {
      expect(adminAllowed).toContain("tiptap.selection.selectText");
    });

    it("native selection commands: selectAll, focus, blur", () => {
      expect(adminAllowed).toContain("tiptap.selection.selectAll");
      expect(adminAllowed).toContain("tiptap.selection.focus");
      expect(adminAllowed).toContain("tiptap.selection.blur");
    });
  });

  describe("Known commands — history category", () => {
    it("undo and redo are present", () => {
      expect(adminAllowed).toContain("tiptap.history.undo");
      expect(adminAllowed).toContain("tiptap.history.redo");
    });
  });

  describe("Known commands — query category", () => {
    it("all query commands are present", () => {
      const expected = [
        "tiptap.query.getHTML",
        "tiptap.query.getJSON",
        "tiptap.query.getText",
        "tiptap.query.isActive",
        "tiptap.query.getAttributes",
        "tiptap.query.isEmpty",
        "tiptap.query.isEditable",
        "tiptap.query.isFocused",
      ];
      for (const id of expected) {
        expect(adminAllowed, `${id} not found`).toContain(id);
      }
    });
  });

  // ── Security: no unknown/unsafe commands leak through ───────────────────

  describe("Security — no unsafe commands exposed", () => {
    it("no module has 'unknown' tag (includeUnsafe=false)", () => {
      for (const id of adminAllowed) {
        const desc = adminRegistry.getDefinition(id) as ModuleDescriptor;
        expect(
          (desc.tags ?? []).includes("unknown"),
          `${id} has 'unknown' tag — should be excluded`,
        ).toBe(false);
      }
    });

    it("all modules have moduleId matching their registry key", () => {
      for (const id of adminAllowed) {
        const desc = adminRegistry.getDefinition(id) as ModuleDescriptor;
        expect(desc.moduleId).toBe(id);
      }
    });
  });
});
