import { defineConfig } from "@playwright/test";
import base from "../playwright.config";
import path from "node:path";

const sharedUse = { ...base.use };
delete sharedUse.channel;

// 专项浏览器矩阵独立运行，不改变默认 CI 的 Chrome 配置。
export default defineConfig({
  ...base,
  use: sharedUse,
  testDir: "./responsive",
  timeout: 60000,
  webServer: (Array.isArray(base.webServer)
    ? base.webServer
    : [base.webServer!]
  ).map((server) => ({ ...server, cwd: path.resolve(__dirname, "..") })),
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/responsive-results.json" }],
  ],
  projects: [
    { name: "chrome", use: { browserName: "chromium", channel: "chrome" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
