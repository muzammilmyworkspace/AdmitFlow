import { defineConfig, devices } from "@playwright/test";

// Browser E2E — docs/35-testing-strategy.md §"E2E tests".
// Assumes a dev server and seeded database are already running (BASE_URL overrides the
// default), so the suite can be pointed at staging without changing the tests.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // the journey specs share a database; ordering keeps them readable
  // One worker. Two of these drive a Next dev server that compiles routes on demand, and
  // the contention alone pushes sign-up past its timeout — reported as an assertion
  // failure in whichever spec happened to be second, which is a lie about the product.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
