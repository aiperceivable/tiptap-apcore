import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from demo/ directory (parent of server/)
dotenv.config({ path: resolve(__dirname, "../../.env") });

import { app, initMcp, shutdownMcp } from "./app.js";

const port = parseInt(process.env.PORT || "8000", 10);

await initMcp();

const server = app.listen(port, () => {
  console.log(`tiptap-apcore demo server running on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`\n${signal} received, shutting down...`);
    await shutdownMcp();
    server.close();
  });
}
