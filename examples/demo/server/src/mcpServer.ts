import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { withApcore } from "tiptap-apcore";
import { asyncServe } from "tiptap-apcore/server";
import type { AsyncServeApp, EditorLike } from "tiptap-apcore";
import { applyJsdomGlobals, deleteGlobals } from "./jsdomGlobals.js";

let mcpApp: AsyncServeApp | null = null;
let editor: Editor | null = null;
let toolCount = 0;

export async function initMcpServer(): Promise<AsyncServeApp> {
  if (mcpApp) return mcpApp;

  // Set up persistent JSDOM globals for the MCP editor
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="editor"></div></body></html>');
  applyJsdomGlobals(dom);

  const element = dom.window.document.getElementById("editor")!;

  editor = new Editor({
    element,
    extensions: [StarterKit],
    content: `<h1>Welcome to tiptap-apcore</h1>
<p>This is a <strong>persistent</strong> editor managed by the MCP server.</p>
<p>Use the Tool Explorer or connect an MCP client to interact with the editor tools.</p>
<ul><li>Format text with bold, italic, and more</li><li>Insert and modify content</li><li>Query document state</li></ul>`,
  });

  const { executor, registry } = withApcore(editor as unknown as EditorLike, {
    acl: { role: "admin" },
  });

  toolCount = registry.list().length;

  mcpApp = await asyncServe(executor, {
    explorer: true,
    allowExecute: true,
    endpoint: "/mcp",
    explorerPrefix: "/explorer",
    name: "tiptap-apcore-demo",
  });

  console.log(`MCP server initialized: ${toolCount} tools`);
  return mcpApp;
}

export async function closeMcpServer(): Promise<void> {
  if (mcpApp) {
    await mcpApp.close();
    mcpApp = null;
  }
  if (editor) {
    editor.destroy();
    editor = null;
  }
  toolCount = 0;
  deleteGlobals();
}

export function getMcpStatus(): { initialized: boolean; toolCount: number } {
  return { initialized: mcpApp !== null, toolCount };
}
