import path from "node:path";
import { defineConfig } from "vitest/config";

// Keep in sync with tests/testDb.ts (the config cannot import TypeScript test files).
const TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:54330/azzopardi_test";

/** Integration tests share one throwaway PostgreSQL server, so files run one at a time. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: { DATABASE_URL: TEST_DATABASE_URL, APP_URL: "http://localhost:3000", NODE_ENV: "test" },
  },
});
