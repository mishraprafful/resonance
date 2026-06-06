import { defineConfig, devices } from "@playwright/test";

// Web UI E2E. Runs against a live web dev server (vite, :5280) backed by the real stack — driven by
// e2e/run.sh (which starts the stack + services + web, seeds data, then invokes `playwright test`).
// The server is NOT started here; point PLAYWRIGHT_BASE_URL at a running dev server to run manually.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // One retry in CI only — for the genuinely-external first-load wait against a freshly-started
  // stack + vite, not to mask races (mirrors the pytest suite's flakiness budget).
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5280",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
