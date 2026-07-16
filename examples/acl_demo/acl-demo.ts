/**
 * tiptap-apcore ACL demo.
 *
 * The apcore framework integrations share an `examples/acl_demo/` that shows
 * role-based access control over apcore module calls. tiptap governs *editor
 * commands* (not REST `orders.*`), so this demo uses tiptap's native
 * `readonly` / `editor` / `admin` roles and its tag-based `AclGuard`:
 *
 *   role      | query | format | destructive
 *   readonly  |  yes  |   no   |     no
 *   editor    |  yes  |  yes   |     no
 *   admin     |  yes  |  yes   |    yes
 *
 * Run it:
 *   npx tsx examples/acl_demo/acl-demo.ts
 */

import { TiptapAPCore } from "../../src/runtime/TiptapAPCore.js";
import type { EditorLike } from "../../src/types.js";

export type Role = "readonly" | "editor" | "admin";

/** One representative module per governed tag. */
export const SAMPLES = {
  query: "tiptap.query.getHTML",
  format: "tiptap.format.toggleBold",
  destructive: "tiptap.destructive.clearContent",
} as const;

/**
 * A minimal mock TipTap editor exposing one query, one format, and one
 * destructive command so the demo can show tag-based ACL without a browser.
 * Real apps pass a live TipTap `Editor` instance.
 */
export function createMockEditor(): EditorLike {
  const chain: Record<string, unknown> = new Proxy(
    {},
    { get: (_t, prop) => (prop === "run" ? () => true : () => chain) },
  );
  return {
    isDestroyed: false,
    getHTML: () => "<p>Hello</p>",
    getJSON: () => ({ type: "doc", content: [] }),
    getText: () => "Hello",
    isActive: () => false,
    getAttributes: () => ({}),
    isEmpty: false,
    isEditable: true,
    isFocused: true,
    state: { doc: { content: { size: 10 }, descendants: () => {} } },
    storage: {},
    commands: { toggleBold: () => true, clearContent: () => true },
    chain: () => chain,
    can: () => ({ chain: () => chain }),
    extensionManager: {
      extensions: [
        {
          name: "starter-kit",
          type: "extension",
          addCommands: () => ({ toggleBold: () => {}, clearContent: () => {} }),
        },
      ],
    },
  } as unknown as EditorLike;
}

/** Build a TiptapAPCore governed by the given single active role. */
export function createDemo(role: Role): TiptapAPCore {
  return new TiptapAPCore(createMockEditor(), { acl: { role } });
}

/** Whether the active role is permitted to run the given module. */
export async function isAllowed(apcore: TiptapAPCore, moduleId: string): Promise<boolean> {
  try {
    await apcore.call(moduleId, {});
    return true;
  } catch (err) {
    if (err instanceof Error && /access denied/i.test(err.message)) return false;
    throw err;
  }
}

async function main(): Promise<void> {
  const roles: Role[] = ["readonly", "editor", "admin"];
  const cell = (b: boolean): string => (b ? " yes " : "  no ");
  // eslint-disable-next-line no-console
  console.log("role      | query | format | destructive");
  for (const role of roles) {
    const apcore = createDemo(role);
    const q = await isAllowed(apcore, SAMPLES.query);
    const f = await isAllowed(apcore, SAMPLES.format);
    const d = await isAllowed(apcore, SAMPLES.destructive);
    // eslint-disable-next-line no-console
    console.log(`${role.padEnd(9)} |${cell(q)} |${cell(f)}  |${cell(d)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
