// Browser shim for apcore-mcp.
// The frontend only uses tiptap-apcore's own code (withApcore, Registry, Executor).
// The apcore-mcp re-exports (serve, toOpenaiTools, etc.) are server-only
// and pull in Node.js dependencies that cannot run in the browser.

export function serve() {
  throw new Error("serve() is server-only");
}

export function toOpenaiTools() {
  throw new Error("toOpenaiTools() is server-only");
}

export function resolveRegistry(registryOrExecutor: unknown) {
  if (registryOrExecutor && typeof registryOrExecutor === "object" && "registry" in registryOrExecutor) {
    return (registryOrExecutor as { registry: unknown }).registry;
  }
  return registryOrExecutor;
}

export function resolveExecutor(registryOrExecutor: unknown) {
  if (registryOrExecutor && typeof registryOrExecutor === "object" && "call" in registryOrExecutor) {
    return registryOrExecutor;
  }
  throw new Error("resolveExecutor() requires apcore-js (server-only)");
}

export const REGISTRY_EVENTS = {
  REGISTER: "register",
  UNREGISTER: "unregister",
};

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export const ErrorCodes = {};
