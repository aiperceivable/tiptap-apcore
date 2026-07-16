/**
 * Vitest global setup: load demo/.env before any test modules are imported.
 * This ensures API keys are available when the AI SDK providers initialize.
 */
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });
