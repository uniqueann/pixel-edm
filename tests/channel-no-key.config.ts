import { defineConfig } from "@playwright/test";
import original from "../playwright.config";

const servers = Array.isArray(original.webServer) ? original.webServer : [];

/** 独立启动无加密密钥的本地服务，不改生产配置或默认回归环境。 */
export default defineConfig({
  ...original,
  testDir: "./e2e",
  testMatch: "channel-encryption.spec.ts",
  outputDir: "../test-results/channel-no-key",
  webServer: servers.map((server, index) => ({
    ...server,
    cwd: process.cwd(),
    ...(index === 1
      ? { env: { ...server.env, EDM_CREDENTIAL_KEYRING: "" } }
      : {}),
  })),
});
