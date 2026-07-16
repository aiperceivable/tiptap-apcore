import type { Registry, Executor, ModuleDescriptor } from "tiptap-apcore";

interface ToolPanelProps {
  registry: Registry | null;
  executor: Executor | null;
  onLog: (entry: LogEntry) => void;
}

export interface LogEntry {
  type: "success" | "error" | "info";
  message: string;
  timestamp: number;
}

/** Group module IDs by their category (second segment). */
function groupByCategory(
  moduleIds: string[],
  registry: Registry,
): Map<string, Array<{ id: string; descriptor: ModuleDescriptor }>> {
  const groups = new Map<
    string,
    Array<{ id: string; descriptor: ModuleDescriptor }>
  >();

  const categoryOrder = [
    "query",
    "format",
    "content",
    "destructive",
    "history",
    "selection",
  ];

  // Initialize in display order
  for (const cat of categoryOrder) {
    groups.set(cat, []);
  }

  for (const id of moduleIds) {
    const parts = id.split(".");
    const category = parts.length >= 2 ? parts[1] : "unknown";
    const descriptor = registry.getDefinition(id);
    if (!descriptor) continue;

    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push({ id, descriptor });
  }

  // Remove empty groups
  for (const [key, value] of groups) {
    if (value.length === 0) {
      groups.delete(key);
    }
  }

  return groups;
}

export default function ToolPanel({
  registry,
  executor,
  onLog,
}: ToolPanelProps) {
  if (!registry || !executor) {
    return (
      <div className="card tool-panel">
        <h2>Modules</h2>
        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Initializing...
        </p>
      </div>
    );
  }

  const allIds = registry.list();
  const groups = groupByCategory(allIds, registry);

  /** Check if a module requires inputs by inspecting its inputSchema */
  function requiresInputs(moduleId: string): boolean {
    if (!registry) return false;
    const descriptor = registry.getDefinition(moduleId);
    if (!descriptor) return false;
    const schema = descriptor.inputSchema as Record<string, unknown>;
    const required = schema.required as string[] | undefined;
    return Array.isArray(required) && required.length > 0;
  }

  async function handleExecute(moduleId: string) {
    if (!executor) return;

    // If the command requires inputs, prompt the user
    if (requiresInputs(moduleId)) {
      const descriptor = registry!.getDefinition(moduleId);
      const schema = descriptor!.inputSchema as Record<string, unknown>;
      const required = schema.required as string[];
      const input = window.prompt(
        `${moduleId} requires: ${required.join(", ")}\nEnter as JSON (e.g. ${JSON.stringify(Object.fromEntries(required.map((k) => [k, ""])))}):`,
      );
      if (input === null) return; // cancelled
      try {
        const parsed = JSON.parse(input);
        const result = await executor.call(moduleId, parsed);
        onLog({
          type: "success",
          message: `${moduleId}(${input}) -> ${JSON.stringify(result)}`,
          timestamp: Date.now(),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onLog({
          type: "error",
          message: `${moduleId} -> ${msg}`,
          timestamp: Date.now(),
        });
      }
      return;
    }

    try {
      const result = await executor.call(moduleId, {});
      onLog({
        type: "success",
        message: `${moduleId} -> ${JSON.stringify(result)}`,
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog({
        type: "error",
        message: `${moduleId} -> ${msg}`,
        timestamp: Date.now(),
      });
    }
  }

  return (
    <div className="card tool-panel">
      <h2>APCore Modules</h2>
      <div className="module-count">{allIds.length} modules registered</div>

      {Array.from(groups.entries()).map(([category, modules]) => (
        <div key={category} className="module-category">
          <div className="category-header">
            <span className={`category-badge ${category}`}>{category}</span>
            <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
              ({modules.length})
            </span>
          </div>
          {modules.map(({ id }) => {
            const shortName = id.split(".").pop() ?? id;
            return (
              <button
                key={id}
                className="module-btn"
                onClick={() => handleExecute(id)}
                title={id}
              >
                {shortName}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
