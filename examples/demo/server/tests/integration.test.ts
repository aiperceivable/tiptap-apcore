/**
 * Integration tests for the demo server API.
 *
 * Prerequisites (examples/demo/.env):
 *   LLM_MODEL=<provider>:<model>      e.g. google:gemini-2.5-pro
 *   GOOGLE_GENERATIVE_AI_API_KEY=...  (if provider is google/gemini)
 *   OPENAI_API_KEY=...                (if provider is openai)
 *   ANTHROPIC_API_KEY=...             (if provider is anthropic)
 *
 * LLM-dependent tests are automatically skipped when the above are not set.
 * Validation tests run regardless.
 */

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

// ---------------------------------------------------------------------------
// Precondition detection
// ---------------------------------------------------------------------------

const PROVIDER_KEY_VAR: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const LLM_MODEL = process.env.LLM_MODEL;
const provider = LLM_MODEL?.split(":")[0];
const apiKeyVar = provider ? PROVIDER_KEY_VAR[provider] : undefined;
const apiKey = apiKeyVar ? process.env[apiKeyVar] : undefined;
const MODEL_READY = !!LLM_MODEL && !!apiKey;

function skipReason(): string {
  if (!LLM_MODEL) return "LLM_MODEL not set in examples/demo/.env";
  if (!apiKeyVar) return `Unknown provider '${provider}' in LLM_MODEL`;
  if (!apiKey) return `${apiKeyVar} not set in examples/demo/.env`;
  return "";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_HTML = "<p>Welcome to <strong>APCore</strong> powered by TipTap!</p>";

interface ToolCallLog {
  moduleId: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

interface ChatResponse {
  reply: string;
  updatedHtml: string;
  toolCalls: ToolCallLog[];
}

async function chat(opts: {
  content: string;
  html?: string;
  role?: "readonly" | "editor" | "admin";
  model?: string;
}) {
  return request(app)
    .post("/api/chat")
    .send({
      messages: [{ role: "user", content: opts.content }],
      editorHtml: opts.html ?? SAMPLE_HTML,
      role: opts.role ?? "editor",
      model: opts.model ?? LLM_MODEL,
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Demo Server API", () => {
  // ─── Health check (no LLM required) ───────────────────────────────────────

  describe("GET /api/health", () => {
    it("returns status ok with providers array", async () => {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.defaultModel).toMatch(/^(openai|google|gemini|anthropic):/);
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.providers).toHaveLength(3);
    });

    it("provider.configured reflects env vars", async () => {
      const res = await request(app).get("/api/health");
      const google = res.body.providers.find((p: { id: string }) => p.id === "google");
      const openai = res.body.providers.find((p: { id: string }) => p.id === "openai");
      const anthropic = res.body.providers.find((p: { id: string }) => p.id === "anthropic");

      expect(google.configured).toBe(!!process.env.GOOGLE_GENERATIVE_AI_API_KEY);
      expect(openai.configured).toBe(!!process.env.OPENAI_API_KEY);
      expect(anthropic.configured).toBe(!!process.env.ANTHROPIC_API_KEY);
    });

    it("each provider includes a models list", async () => {
      const res = await request(app).get("/api/health");
      for (const p of res.body.providers) {
        expect(Array.isArray(p.models)).toBe(true);
        expect(p.models.length).toBeGreaterThan(0);
        for (const m of p.models) {
          expect(m.id).toMatch(/^(openai|google|anthropic):/);
        }
      }
    });
  });

  // ─── Input validation (no LLM required) ───────────────────────────────────

  describe("POST /api/chat — input validation", () => {
    it("missing messages → 400", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ editorHtml: "<p>test</p>", role: "editor" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/messages/i);
    });

    it("empty messages array → 400", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ messages: [], editorHtml: "<p>test</p>", role: "editor" });
      expect(res.status).toBe(400);
    });

    it("missing editorHtml → 400", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ messages: [{ role: "user", content: "hello" }], role: "editor" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/editorHtml/i);
    });

    it("invalid role → 400", async () => {
      const res = await request(app).post("/api/chat").send({
        messages: [{ role: "user", content: "hello" }],
        editorHtml: "<p>test</p>",
        role: "superadmin",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/role/i);
    });
  });

  // ─── Shortcut commands (no LLM required) ─────────────────────────────────

  describe("POST /api/chat — shortcut commands", () => {
    it("undo shortcut returns editorHtml unchanged", async () => {
      const res = await chat({ content: "undo", html: SAMPLE_HTML });
      expect(res.status).toBe(200);
      expect(res.body.updatedHtml).toBe(SAMPLE_HTML);
      expect(res.body.toolCalls).toEqual([]);
      expect(res.body.reply).toMatch(/undo|revert/i);
    });

    it("cancel shortcut returns editorHtml unchanged", async () => {
      const res = await chat({ content: "cancel", html: SAMPLE_HTML });
      expect(res.status).toBe(200);
      expect(res.body.updatedHtml).toBe(SAMPLE_HTML);
      expect(res.body.toolCalls).toEqual([]);
    });

    it("redo shortcut returns editorHtml unchanged", async () => {
      const res = await chat({ content: "redo", html: SAMPLE_HTML });
      expect(res.status).toBe(200);
      expect(res.body.updatedHtml).toBe(SAMPLE_HTML);
      expect(res.body.toolCalls).toEqual([]);
      expect(res.body.reply).toMatch(/redo/i);
    });

    it("normal messages still go through LLM (not treated as shortcut)", async () => {
      // "make text bold" should NOT match any shortcut pattern.
      // Without a valid LLM key this will fail with 500 — that's fine,
      // the point is it does NOT return a shortcut response.
      const res = await chat({ content: "make text bold", html: SAMPLE_HTML });
      if (res.status === 200) {
        // LLM key was available — response should have toolCalls or a real reply
        expect(res.body.reply).toBeDefined();
      } else {
        // No LLM key — server tried the LLM path and failed, proving it wasn't short-circuited
        expect(res.status).toBe(500);
      }
    });
  });

  // ─── LLM-dependent tests ──────────────────────────────────────────────────

  describe.skipIf(!MODEL_READY)(
    `LLM Operations [model=${LLM_MODEL ?? "not set"}]${skipReason() ? ` — SKIP: ${skipReason()}` : ""}`,
    () => {
      beforeAll(() => {
        console.log(`\n  Using model: ${LLM_MODEL}`);
        console.log(`  Provider: ${provider}, API key: ${apiKeyVar}=<set>`);
      });

      // ── Response shape ────────────────────────────────────────────────────

      describe("Response shape", () => {
        it("always returns reply, updatedHtml, toolCalls", async () => {
          const res = await chat({ content: "what's in the document?" });

          expect(res.status).toBe(200);
          expect(typeof res.body.reply).toBe("string");
          expect(typeof res.body.updatedHtml).toBe("string");
          expect(Array.isArray(res.body.toolCalls)).toBe(true);
        });

        it("toolCalls entries have moduleId, inputs, result fields", async () => {
          const res = await chat({ content: "what is the text content?" });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          for (const tc of body.toolCalls) {
            expect(typeof tc.moduleId).toBe("string");
            expect(tc.moduleId).toMatch(/^tiptap\./);
            expect(typeof tc.inputs).toBe("object");
            expect(typeof tc.result).toBe("object");
          }
        });
      });

      // ── Text deletion (the fixed bug) ─────────────────────────────────────

      describe("Text deletion", () => {
        it("editor: delete 'APCore' removes it from the document", async () => {
          const res = await chat({ content: "delete APCore", role: "editor" });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).not.toContain("APCore");

          const selectCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.selection.selectText",
          );
          const deleteCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.destructive.deleteSelection",
          );

          expect(selectCall?.result.found).toBe(true);
          expect(deleteCall?.result.success).toBe(true);
        });

        it("editor: delete text that doesn't exist leaves document unchanged", async () => {
          const res = await chat({
            content: "delete the word 'Nonexistent'",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("APCore"); // unchanged

          const selectCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.selection.selectText",
          );
          if (selectCall) {
            expect(selectCall.result.found).toBe(false);
          }
        });

        it("editor: delete text preserves surrounding content", async () => {
          const res = await chat({ content: "delete 'APCore'", role: "editor" });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("Welcome to");
          expect(body.updatedHtml).toContain("powered by TipTap");
          expect(body.updatedHtml).not.toContain("APCore");
        });
      });

      // ── Text formatting ───────────────────────────────────────────────────

      describe("Text formatting", () => {
        it("editor: make 'TipTap' bold", async () => {
          const res = await chat({
            content: "make the word TipTap bold",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("<strong>");

          const hasSelectText = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.selection.selectText",
          );
          expect(hasSelectText).toBe(true);
        });

        it("editor: make 'Welcome' italic", async () => {
          const res = await chat({
            content: "make 'Welcome' italic",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("<em>");
        });
      });

      // ── Content operations ────────────────────────────────────────────────

      describe("Content operations", () => {
        it("editor: replace 'APCore' with 'MyEditor'", async () => {
          const res = await chat({
            content: "replace 'APCore' with 'MyEditor'",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("MyEditor");
          expect(body.updatedHtml).not.toContain("APCore");
        });

        it("editor: insert text at end of document", async () => {
          const res = await chat({
            content: "add the text 'Hello World' at the end",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml.toLowerCase()).toContain("hello world");
        });
      });

      // ── Query operations ──────────────────────────────────────────────────

      describe("Query operations", () => {
        it("readonly: getText returns document text in reply", async () => {
          const res = await chat({
            content: "what is the text content of the document?",
            role: "readonly",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.reply).toContain("APCore");
          // Readonly cannot modify the document
          expect(body.updatedHtml).toBe(SAMPLE_HTML);
        });

        it("readonly: only query tool calls are allowed", async () => {
          const res = await chat({
            content: "get all the text in the document",
            role: "readonly",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          const nonQuery = body.toolCalls.filter(
            (t) => !t.moduleId.startsWith("tiptap.query."),
          );
          expect(nonQuery).toHaveLength(0);
        });
      });

      // ── ACL role enforcement ──────────────────────────────────────────────

      describe("ACL role enforcement", () => {
        it("editor: clearContent is not exposed as a tool", async () => {
          const res = await chat({
            content: "use clearContent to clear all document content",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          const clearCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.destructive.clearContent",
          );
          expect(clearCall).toBeUndefined();
        });

        it("editor: deleteRange is not exposed as a tool", async () => {
          const res = await chat({
            content: "delete range from position 0 to 10",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          const rangeCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.destructive.deleteRange",
          );
          expect(rangeCall).toBeUndefined();
        });

        it("admin: clearContent is available and empties the document", async () => {
          const res = await chat({
            content: "clear all content from the document",
            role: "admin",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          const clearCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.destructive.clearContent",
          );
          if (clearCall) {
            expect(clearCall.result.success).toBe(true);
            expect(body.updatedHtml).not.toContain("APCore");
          } else {
            // AI may have chosen deleteSelection after selectAll — both valid
            expect(body.updatedHtml).not.toContain("APCore");
          }
        });

        it("readonly: format commands are not available", async () => {
          const res = await chat({
            content: "make APCore bold",
            role: "readonly",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          // Document must be unchanged — readonly cannot apply formatting
          expect(body.updatedHtml).toBe(SAMPLE_HTML);
          const formatCalls = body.toolCalls.filter((t) =>
            t.moduleId.startsWith("tiptap.format."),
          );
          expect(formatCalls).toHaveLength(0);
        });
      });

      // ── Daily formatting operations ───────────────────────────────────────

      describe("Daily formatting operations", () => {
        // Headings
        it("editor: convert paragraph to heading H1", async () => {
          const res = await chat({
            content: "make the current line a heading level 1",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<h1/i);
          const hasHeading = body.toolCalls.some(
            (t) =>
              t.moduleId === "tiptap.format.toggleHeading" ||
              t.moduleId === "tiptap.format.setHeading",
          );
          expect(hasHeading).toBe(true);
        });

        it("editor: convert paragraph to heading H2", async () => {
          const res = await chat({
            content: "select the text 'Welcome' and convert the paragraph to a heading level 2",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<h2/i);
        });

        // Lists
        it("editor: create a bullet list", async () => {
          const res = await chat({
            html: "<p>Buy milk</p>",
            content: "make this paragraph a bullet list item",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<ul/i);
          const hasList = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.format.toggleBulletList",
          );
          expect(hasList).toBe(true);
        });

        it("editor: create a numbered list", async () => {
          const res = await chat({
            content: "convert the paragraph to a numbered list",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<ol/i);
          const hasList = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.format.toggleOrderedList",
          );
          expect(hasList).toBe(true);
        });

        // Inline marks
        it("editor: apply strikethrough to 'APCore'", async () => {
          const res = await chat({
            content: "apply strikethrough to the word APCore",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<s>|<del>|data-type="strike"/i);
          const hasStrike = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.format.toggleStrike",
          );
          expect(hasStrike).toBe(true);
        });

        it("editor: apply inline code to 'APCore'", async () => {
          const res = await chat({
            content: "format 'APCore' as inline code",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("<code>");
          // Model may use toggleCode, insertContent, insertContentAt, setMark,
          // or other strategies — all are valid as long as <code> is in the HTML.
          expect(body.toolCalls.length).toBeGreaterThan(0);
        });

        // Block-level
        it("editor: wrap paragraph in blockquote", async () => {
          const res = await chat({
            content: "wrap this paragraph in a blockquote",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<blockquote/i);
          const hasQuote = body.toolCalls.some(
            (t) =>
              t.moduleId === "tiptap.format.toggleBlockquote" ||
              t.moduleId === "tiptap.format.setBlockquote",
          );
          expect(hasQuote).toBe(true);
        });

        it("editor: convert to code block", async () => {
          const res = await chat({
            html: "<p>console.log('hello')</p>",
            content: "wrap this paragraph in a code block",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<pre|<code/i);
          const hasCodeBlock = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.format.toggleCodeBlock",
          );
          expect(hasCodeBlock).toBe(true);
        });

        it("editor: insert a horizontal rule", async () => {
          const res = await chat({
            content: "insert a horizontal rule at the end of the document",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toMatch(/<hr/i);
          const hasHr = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.format.setHorizontalRule",
          );
          expect(hasHr).toBe(true);
        });

        // Clear formatting
        it("editor: remove all formatting from 'APCore'", async () => {
          const html = "<p>Welcome to <strong><em>APCore</em></strong> powered by TipTap!</p>";
          const res = await chat({
            content: "remove all formatting from the word APCore",
            html,
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          // After removing marks, APCore should no longer be wrapped in bold/italic
          expect(body.updatedHtml).not.toMatch(/<strong><em>APCore/);
          const hasClear = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.format.unsetAllMarks",
          );
          expect(hasClear).toBe(true);
        });

        // History — modify then undo, verify document is restored
        it("editor: undo after making a change restores the document", async () => {
          const originalHtml = "<p>Hello World</p>";
          const res = await chat({
            content:
              "First make 'Hello' bold, then immediately undo that change so the document is back to normal",
            html: originalHtml,
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);

          // Must have called undo
          const hasUndo = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.history.undo",
          );
          expect(hasUndo).toBe(true);

          // The undo tool call must have succeeded (not { success: false })
          const undoCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.history.undo",
          )!;
          expect(undoCall.result).toEqual({ success: true });

          // After undo, the document should be restored — no <strong> tag
          expect(body.updatedHtml).not.toContain("<strong>");
          expect(body.updatedHtml).toContain("Hello World");
        });

        // Multi-mark: insert bold+italic content via insertContent (HTML)
        it("editor: insert bold+italic text via insertContent with HTML", async () => {
          const res = await chat({
            content: "use insertContent to replace 'APCore' with the HTML string '<strong><em>APCore</em></strong>'",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("<strong>");
          expect(body.updatedHtml).toContain("<em>");
          const hasInsert = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.content.insertContent",
          );
          expect(hasInsert).toBe(true);
        });

        // Replace with formatted content
        it("editor: replace plain text with bold version using insertContent", async () => {
          const res = await chat({
            content: "replace 'APCore' with bold text 'APCore'",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          expect(body.updatedHtml).toContain("<strong>");
          // insertContent should be used for replace+format in one step
          const hasInsert = body.toolCalls.some(
            (t) => t.moduleId === "tiptap.content.insertContent",
          );
          expect(hasInsert).toBe(true);
        });
      });

      // ── selectText behavior ───────────────────────────────────────────────

      describe("selectText behavior", () => {
        it("returns found:true with from/to for existing text", async () => {
          const res = await chat({
            content: "select the word APCore",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          const selectCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.selection.selectText",
          );
          if (selectCall) {
            expect(selectCall.result.found).toBe(true);
            expect(typeof selectCall.result.from).toBe("number");
            expect(typeof selectCall.result.to).toBe("number");
            expect(selectCall.result.to as number).toBeGreaterThan(
              selectCall.result.from as number,
            );
          }
        });

        it("returns found:false for text not in document", async () => {
          const res = await chat({
            content: "select 'ZZZ_NOTFOUND_ZZZ' in the document",
            role: "editor",
          });
          const body = res.body as ChatResponse;

          expect(res.status).toBe(200);
          const selectCall = body.toolCalls.find(
            (t) => t.moduleId === "tiptap.selection.selectText",
          );
          if (selectCall) {
            expect(selectCall.result.found).toBe(false);
          }
        });
      });
    },
  );
});
