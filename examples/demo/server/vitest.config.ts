import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 90_000, // LLM calls can be slow
    hookTimeout: 10_000,
    reporters: ["verbose"],
  },
});
