import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { measurePreparationUi } from "./preparation-ui-measure";

test("首次使用总览的真实准备状态、角色与双主题响应式对照", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180000);
  const phase = process.env.EDM_ONBOARDING_VISUAL_PHASE;
  const before = phase === "before";
  const directory = phase
    ? path.resolve(".impeccable/visual/onboarding", phase)
    : info.outputPath("visual");
  await mkdir(directory, { recursive: true });
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: {},
  });
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const measurements: unknown[] = [];
  const scenarios: [string, Record<string, unknown>][] = [
    ["new", {}],
    ["partial", { state: "partial", unconfirmed: true }],
    ["ready", { state: "ready" }],
    ["existing", { state: "existing" }],
    ["viewer", { role: "viewer" }],
    ["editor-long", { role: "editor", longName: true }],
    ["invalidated", { state: "invalidated", archivedTemplates: true }],
    [
      "unavailable",
      {
        failedRpcs: [
          "list_contacts",
          "list_templates",
          "list_campaigns",
          "list_delivery_channels",
        ],
      },
    ],
  ];
  for (const [state, data] of scenarios) {
    const response = await request.post(
      "http://127.0.0.1:54329/__fixtures/onboarding",
      { data },
    );
    expect(response.ok(), await response.text()).toBe(true);
    await page.goto("/dashboard");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    if (!before)
      await expect(
        page.locator('[data-testid="onboarding-guide"]:visible'),
      ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("theme", value);
        document.documentElement.classList.toggle("dark", value === "dark");
        document.documentElement.style.colorScheme = value;
      }, theme);
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(async () => {
          window.scrollTo(0, 0);
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
        await page.screenshot({
          path: path.join(directory, `${state}-${width}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
          caret: "hide",
        });
        if (!before) {
          const metrics = await measurePreparationUi(page);
          expect(metrics.overflow).toBeLessThanOrEqual(1);
          expect(metrics.minimumControlHeight).toBeGreaterThanOrEqual(44);
          expect(metrics.minimumControlWidth).toBeGreaterThanOrEqual(44);
          expect(metrics.minimumTextContrast).toBeGreaterThanOrEqual(4.5);
          measurements.push({ state, theme, width, ...metrics });
        }
      }
    }
  }
  await writeFile(
    path.join(directory, "measurements.json"),
    JSON.stringify(measurements, null, 2),
  );
});
