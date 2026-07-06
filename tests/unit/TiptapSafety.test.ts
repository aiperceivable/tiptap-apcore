import { describe, it, expect, vi } from "vitest";
import { TiptapAPCore } from "../../src/runtime/TiptapAPCore.js";
import type { EditorLike, AuditEntry } from "../../src/types.js";

/** A chain whose every method returns itself and whose run() succeeds. */
function makeChain(): any {
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "run") return () => true;
        return () => chain;
      },
    },
  );
  return chain;
}

function makeEditor(overrides: Partial<EditorLike> = {}): EditorLike {
  return {
    isDestroyed: false,
    getHTML: () => "<p>Hello world</p>",
    getJSON: () => ({ type: "doc", content: [] }),
    getText: () => "Hello world",
    isActive: () => false,
    getAttributes: () => ({}),
    isEmpty: false,
    isEditable: true,
    isFocused: true,
    state: { doc: { content: { size: 12 }, descendants: vi.fn() } } as any,
    storage: {},
    commands: {},
    chain: (() => makeChain()) as any,
    can: (() => ({ chain: () => makeChain() })) as any,
    extensionManager: {
      extensions: [
        {
          name: "test-kit",
          type: "extension",
          addCommands: () => ({
            toggleBold: () => {},
            clearContent: () => {},
            setContent: () => {},
            deleteRange: () => {},
            insertContent: () => {},
            setLink: () => {},
          }),
        },
      ],
    },
    ...overrides,
  };
}

describe("TiptapAPCore.validate() — preview contract", () => {
  it("returns a valid preflight for a safe formatting command", async () => {
    const apcore = new TiptapAPCore(makeEditor());
    const result = await apcore.validate("tiptap.format.toggleBold", {});

    expect(result.valid).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.predictedChanges).toEqual([]);
    expect(result.checks.map((c) => c.check)).toEqual([
      "editor_ready",
      "module_exists",
      "acl",
      "input_schema",
    ]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("flags destructive commands as requiring approval and predicts a delete", async () => {
    const apcore = new TiptapAPCore(makeEditor());
    const result = await apcore.validate("tiptap.destructive.clearContent", {});

    expect(result.valid).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.predictedChanges).toHaveLength(1);
    expect(result.predictedChanges?.[0]).toMatchObject({
      action: "delete",
      target: "editor.content",
    });
    expect(result.predictedChanges?.[0].before).toContain("Hello world");
  });

  it("predicts a replace with before/after snapshots for setContent", async () => {
    const apcore = new TiptapAPCore(makeEditor());
    const result = await apcore.validate("tiptap.destructive.setContent", {
      value: "<p>Replaced</p>",
    });

    expect(result.requiresApproval).toBe(true);
    expect(result.predictedChanges?.[0]).toMatchObject({
      action: "replace",
      target: "editor.content",
      after: "<p>Replaced</p>",
    });
    expect(result.predictedChanges?.[0].before).toContain("Hello world");
  });

  it("reports MODULE_NOT_FOUND for an unknown module", async () => {
    const apcore = new TiptapAPCore(makeEditor());
    const result = await apcore.validate("tiptap.format.doesNotExist", {});

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: "MODULE_NOT_FOUND" });
    expect(result.checks.find((c) => c.check === "module_exists")?.passed).toBe(false);
  });

  it("fails the acl check when the role denies the command", async () => {
    const apcore = new TiptapAPCore(makeEditor(), { acl: { role: "readonly" } });
    const result = await apcore.validate("tiptap.format.toggleBold", {});

    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.check === "acl")?.passed).toBe(false);
    expect(result.errors.some((e) => e.code === "ACL_DENIED")).toBe(true);
  });

  it("fails the input_schema check on an unsafe URL", async () => {
    const apcore = new TiptapAPCore(makeEditor());
    const result = await apcore.validate("tiptap.format.setLink", {
      href: "javascript:alert(1)",
    });

    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.check === "input_schema")?.passed).toBe(false);
    expect(result.predictedChanges).toEqual([]);
  });

  it("reports EDITOR_NOT_READY when the editor is destroyed", async () => {
    const editor = makeEditor();
    const apcore = new TiptapAPCore(editor);
    (editor as { isDestroyed: boolean }).isDestroyed = true;

    const result = await apcore.validate("tiptap.format.toggleBold", {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: "EDITOR_NOT_READY" });
  });

  it("preflight() delegates to validate()", async () => {
    const apcore = new TiptapAPCore(makeEditor());
    const result = await apcore.preflight("tiptap.destructive.clearContent", {});
    expect(result.requiresApproval).toBe(true);
    expect(result.predictedChanges?.[0].action).toBe("delete");
  });
});

describe("TiptapAPCore audit logging", () => {
  it("is disabled by default", async () => {
    const apcore = new TiptapAPCore(makeEditor());
    await apcore.call("tiptap.format.toggleBold", {});
    expect(apcore.auditLogger).toBeUndefined();
    expect(apcore.getAuditLog()).toEqual([]);
  });

  it("records allow and deny decisions in the in-memory log when audit: true", async () => {
    const apcore = new TiptapAPCore(makeEditor(), {
      audit: true,
      acl: { role: "readonly" },
    });

    // Query is allowed under the readonly role.
    await apcore.call("tiptap.query.getHTML", {});
    // Formatting is denied under the readonly role.
    await expect(apcore.call("tiptap.format.toggleBold", {})).rejects.toThrow();

    const log = apcore.getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ targetId: "tiptap.query.getHTML", decision: "allow" });
    expect(log[1]).toMatchObject({
      targetId: "tiptap.format.toggleBold",
      decision: "deny",
      roles: ["readonly"],
    });
    expect(typeof log[0].timestamp).toBe("string");
    expect(log[1].reason).not.toBe("");
  });

  it("routes entries to a custom AuditLogger function", async () => {
    const entries: AuditEntry[] = [];
    const apcore = new TiptapAPCore(makeEditor(), {
      audit: (entry) => entries.push(entry),
    });

    await apcore.call("tiptap.format.toggleBold", {});

    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("allow");
    // A custom sink means the built-in collector stays empty.
    expect(apcore.getAuditLog()).toEqual([]);
  });
});
