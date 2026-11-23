import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
  },
});
