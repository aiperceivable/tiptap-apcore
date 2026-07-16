import { generateText, tool, jsonSchema, type CoreTool, NoSuchToolError } from "ai";
import { createProviderRegistry } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { Executor, Registry } from "tiptap-apcore";

export interface ToolCallLog {
  moduleId: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface ToolLoopResult {
  reply: string;
  toolCalls: ToolCallLog[];
}

const registry = createProviderRegistry({ openai, anthropic, google, gemini: google });

/**
 * Recursively sanitize a JSON Schema for Gemini compatibility.
 *
 * APCore schemas target OpenAI strict mode:
 *   - additionalProperties: false
 *   - ALL keys in required (optional ones made nullable via type: [X, "null"])
 *   - anyOf used for union types
 *
 * Gemini requires:
 *   - No additionalProperties
 *   - No array-style type (["string", "null"])
 *   - No anyOf (limited support, causes provider-level stripping)
 *   - required must only list truly required (non-optional) properties
 *
 * Strategy: deep-clone, then recursively simplify. Nullable properties
 * (which were optional before OpenAI strict mode wrapping) are removed
 * from required so Gemini treats them as optional.
 */
function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  // Deep clone to avoid mutating frozen originals
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  return sanitizeNode(clone);
}

function sanitizeNode(node: Record<string, unknown>): Record<string, unknown> {
  // Handle additionalProperties:
  // - For non-empty objects: remove (Gemini doesn't support it)
  // - For empty objects ({ type: "object", properties: {} }): set to true
  //   to prevent @ai-sdk/google from stripping the property via isEmptyObjectSchema()
  const isEmptyObj = node.type === "object"
    && (!node.properties || (typeof node.properties === "object" && Object.keys(node.properties as Record<string, unknown>).length === 0));
  if (isEmptyObj) {
    node.additionalProperties = true;
  } else {
    delete node.additionalProperties;
  }

  // Convert type arrays: ["string", "null"] -> type: "string", nullable: true
  if (Array.isArray(node.type)) {
    const types = (node.type as string[]).filter((t) => t !== "null");
    if ((node.type as string[]).includes("null")) {
      node.nullable = true;
    }
    node.type = types[0] ?? "string";
  }

  // Flatten anyOf: pick the first non-null variant as the type
  // Gemini has limited anyOf support and the provider may strip these properties
  if (Array.isArray(node.anyOf)) {
    const variants = node.anyOf as Record<string, unknown>[];
    const hasNull = variants.some((v) => v.type === "null");
    const nonNull = variants.filter((v) => v.type !== "null");
    if (nonNull.length > 0) {
      const picked = sanitizeNode(nonNull[0]);
      delete node.anyOf;
      Object.assign(node, picked);
    } else {
      delete node.anyOf;
      node.type = "string";
    }
    if (hasNull) node.nullable = true;
  }

  // Recursively sanitize nested properties
  if (node.properties && typeof node.properties === "object") {
    const props = node.properties as Record<string, unknown>;
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "object" && value !== null) {
        props[key] = sanitizeNode(value as Record<string, unknown>);
      }
    }
  }

  // Recursively sanitize items (for array types)
  if (node.items && typeof node.items === "object") {
    node.items = sanitizeNode(node.items as Record<string, unknown>);
  }

  // Filter required: only keep non-nullable properties that exist in properties
  if (Array.isArray(node.required) && node.properties) {
    const props = node.properties as Record<string, Record<string, unknown>>;
    const propKeys = new Set(Object.keys(props));
    node.required = (node.required as string[]).filter((k) => {
      if (!propKeys.has(k)) return false;
      // Nullable properties were optional before OpenAI strict-mode wrapping
      return !props[k]?.nullable;
    });
    if ((node.required as string[]).length === 0) {
      delete node.required;
    }
  }

  return node;
}

/**
 * Convert APCore modules into AI SDK tool definitions.
 *
 * Tool names use double-hyphens (e.g. "tiptap--format--toggleBold") because
 * dots are not valid in AI SDK tool names. Double-hyphens ensure lossless
 * round-tripping even if a segment contains a single hyphen.
 */
function buildTools(apcoreRegistry: Registry, executor: Executor, isGemini: boolean) {
  const tools: Record<string, CoreTool> = {};

  for (const moduleId of apcoreRegistry.list()) {
    const descriptor = apcoreRegistry.getDefinition(moduleId);
    if (!descriptor) continue;

    // Use double-hyphen as separator so single hyphens inside segment names
    // survive the round-trip (e.g. "tiptap.format.toggleBold" → "tiptap--format--toggleBold").
    const toolName = moduleId.replaceAll(".", "--");

    // Ensure schema has properties (some providers require it)
    let schema = { ...descriptor.inputSchema } as Record<string, unknown>;
    if (!schema.properties) {
      schema.properties = {};
    }

    if (isGemini) {
      schema = sanitizeSchemaForGemini(schema);
    }

    tools[toolName] = tool({
      description: descriptor.description,
      parameters: jsonSchema(schema),
      execute: async (args) => {
        const denormalized = toolName.replaceAll("--", ".");
        return executor.call(denormalized, args as Record<string, unknown>);
      },
    });
  }

  return tools;
}

export async function toolLoop(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  apcoreRegistry: Registry,
  executor: Executor,
  modelId: string,
): Promise<ToolLoopResult> {
  const model = registry.languageModel(modelId as Parameters<typeof registry.languageModel>[0]);
  const isGemini = modelId.startsWith("google:") || modelId.startsWith("gemini:");
  const tools = buildTools(apcoreRegistry, executor, isGemini);

  const allToolCalls: ToolCallLog[] = [];

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools,
      maxSteps: 10,
      onStepFinish: (step) => {
        const stepToolCalls = step.toolCalls as { toolName: string; args: unknown }[] | undefined;
        const stepToolResults = step.toolResults as { result: unknown }[] | undefined;
        if (!stepToolCalls || stepToolCalls.length === 0) return;

        for (let i = 0; i < stepToolCalls.length; i++) {
          const tc = stepToolCalls[i];
          const moduleId = tc.toolName.replaceAll("--", ".");
          const resultValue = stepToolResults?.[i]?.result ?? {};
          allToolCalls.push({
            moduleId,
            inputs: tc.args as Record<string, unknown>,
            result: resultValue as Record<string, unknown>,
          });
        }
      },
    });

    return {
      reply: result.text,
      toolCalls: allToolCalls,
    };
  } catch (err) {
    // Model attempted to call a tool that is not available for the current role.
    // Return a graceful error reply instead of crashing with a 500.
    if (err instanceof NoSuchToolError) {
      const available = Object.keys(tools).map((t) => t.replaceAll("--", ".")).join(", ");
      return {
        reply: `I'm unable to complete this request. The action you requested requires permissions that are not available for your current role. Available commands: ${available}.`,
        toolCalls: allToolCalls,
      };
    }
    throw err;
  }
}
