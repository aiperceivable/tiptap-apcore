/**
 * Shared JSDOM global management utilities.
 *
 * Both the persistent MCP editor and per-request chat editors need to set
 * browser globals that TipTap/ProseMirror rely on. This module centralises
 * that logic and provides a mutex to prevent concurrent chat requests from
 * corrupting each other's (or the MCP editor's) global state.
 */

import { JSDOM } from "jsdom";

export const GLOBAL_KEYS = [
  "document", "window", "navigator", "Node", "HTMLElement",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
] as const;

export type SavedGlobals = Map<string, { exists: boolean; value: unknown }>;

export function setGlobal(key: string, value: unknown): void {
  try {
    (globalThis as Record<string, unknown>)[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
}

/** Assign all JSDOM globals needed by TipTap/ProseMirror. */
export function applyJsdomGlobals(dom: JSDOM): void {
  setGlobal("document", dom.window.document);
  setGlobal("window", dom.window);
  setGlobal("navigator", dom.window.navigator);
  setGlobal("Node", dom.window.Node);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("getComputedStyle", dom.window.getComputedStyle);
  setGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  setGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
}

/** Delete all JSDOM globals. */
export function deleteGlobals(): void {
  for (const key of GLOBAL_KEYS) {
    try {
      delete (globalThis as Record<string, unknown>)[key];
    } catch {
      Object.defineProperty(globalThis, key, {
        value: undefined,
        writable: true,
        configurable: true,
      });
    }
  }
}

/** Snapshot current global values so they can be restored later. */
export function saveGlobals(): SavedGlobals {
  const saved: SavedGlobals = new Map();
  for (const key of GLOBAL_KEYS) {
    const exists = key in globalThis;
    saved.set(key, {
      exists,
      value: exists ? (globalThis as Record<string, unknown>)[key] : undefined,
    });
  }
  return saved;
}

/** Restore globals to a previously saved state. */
export function restoreGlobals(saved: SavedGlobals): void {
  for (const [key, { exists, value }] of saved) {
    if (exists) {
      setGlobal(key, value);
    } else {
      try {
        delete (globalThis as Record<string, unknown>)[key];
      } catch {
        Object.defineProperty(globalThis, key, {
          value: undefined,
          writable: true,
          configurable: true,
        });
      }
    }
  }
}

/**
 * Simple async mutex to serialize access to JSDOM globals.
 *
 * Prevents concurrent chat requests from corrupting each other's
 * global state (or the MCP editor's persistent globals).
 */
class GlobalsMutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._locked = false;
    }
  }
}

export const globalsMutex = new GlobalsMutex();
