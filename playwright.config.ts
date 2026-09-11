import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
  webServer: [
    {
      command: "node tests/auth-fixture.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
    },
    {
      command: "npx next dev --port 3100",
      url: "http://localhost:3100/login",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
        EDM_CREDENTIAL_KEYRING:
          '{"active":"test-v1","keys":{"test-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}}',
      },
    },
  ],
});
