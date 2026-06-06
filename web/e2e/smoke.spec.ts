// Web UI E2E smoke — drives the real app against the live /v1 API (and media gateway via the vite
// proxy). Covers the auth gate, the run view (live charts + audio panel sourced from peaks.json /
// server spectrogram), the compare / gallery / datasets surfaces, and logout. Data is seeded by
// web/e2e/seed.py (admin + a project + a run with metrics + a derived audio sample).
//
// Maps to ARCHITECTURE.md §10 — the "Web UI" bullet of issue #12.
import { test, expect, type Page } from "@playwright/test";

const USER = process.env.E2E_WEB_USER || "webe2e";
const PASS = process.env.E2E_WEB_PASS || "resonance-web-e2e";
const PROJECT_NAME = "Web Smoke";
const RUN_NAME = "web-smoke-run";

async function login(page: Page) {
  await page.goto("/");
  await expect(page.getByPlaceholder("username")).toBeVisible(); // the auth gate
  await page.getByPlaceholder("username").fill(USER);
  await page.getByPlaceholder("password").fill(PASS);
  await page.locator('.res-btn[data-kind="primary"]').click(); // the submit button (not the toggles)
  // Landed in the app shell: the top-nav "Projects" entry + the projects grid heading.
  await expect(page.getByRole("button", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
}

test("auth gate → run view (charts + audio) → compare/gallery/datasets → logout", async ({ page }) => {
  await login(page);

  // Open the seeded project → its runs.
  await page.getByText(PROJECT_NAME, { exact: false }).first().click();
  await expect(page.getByRole("heading", { name: PROJECT_NAME, exact: true })).toBeVisible();

  // Open the run. The audio panel lazily presigns peaks (kind=peaks) for the waveform — assert that
  // request fires, proving the waveform is drawn from peaks.json (no client-side audio decode).
  const peaksPresign = page.waitForResponse(
    (r) => /\/v1\/assets\/.+\/url\?kind=peaks/.test(r.url()) && r.status() === 200,
    { timeout: 30_000 },
  );
  await page.getByText(RUN_NAME).first().click();

  // Run detail: live metric charts + the audio panel.
  await expect(page.getByText("Metrics", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Generated audio")).toBeVisible();
  await peaksPresign;
  expect(await page.locator("canvas").count()).toBeGreaterThan(0); // waveform + spectrogram canvases

  // The per-project surfaces render against the real API. Nav names are matched exactly so e.g.
  // "Compare" doesn't also match the run detail's "Add to compare" button.
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sample gallery", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datasets", exact: true })).toBeVisible();

  // Logout via the user menu (the last button in the top-nav header is the avatar).
  await page.locator("header").getByRole("button").last().click();
  await page.getByText("Log out").click();
  await expect(page.getByPlaceholder("username")).toBeVisible(); // back at the auth gate
});
