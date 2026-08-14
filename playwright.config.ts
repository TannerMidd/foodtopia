import { defineConfig, devices } from "@playwright/test";

const chromeBaseUrl = "http://127.0.0.1:3210";
const safariBaseUrl = "http://127.0.0.1:3211";
const reuseE2EServers = process.env.FOODTOPIA_REUSE_E2E_SERVERS === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // The local beta harness intentionally keeps demo state in one server
  // process. Serial workers prevent test households from sharing that state.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Route-level API fault injection must not be bypassed by a previously
    // installed worker. Service-worker behavior is covered separately by the
    // production build/install checks.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], baseURL: chromeBaseUrl },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 15"], baseURL: safariBaseUrl },
    },
  ],
  webServer: [
    {
      command: "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3210",
      env: {
        ...process.env,
        FOODTOPIA_DEMO_MODE: "true",
      },
      url: chromeBaseUrl,
      reuseExistingServer: reuseE2EServers,
      timeout: 120_000,
    },
    {
      command: "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3211",
      env: {
        ...process.env,
        FOODTOPIA_DEMO_MODE: "true",
      },
      url: safariBaseUrl,
      reuseExistingServer: reuseE2EServers,
      timeout: 120_000,
    },
  ],
});
