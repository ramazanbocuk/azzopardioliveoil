import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run a real browser against a production build with its
 * own database (see e2e/server.ts). They never touch the development data.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 45_000,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: { command: "npx tsx e2e/server.ts", url: "http://localhost:3100", timeout: 240_000, reuseExistingServer: false, stdout: "ignore", stderr: "pipe" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
