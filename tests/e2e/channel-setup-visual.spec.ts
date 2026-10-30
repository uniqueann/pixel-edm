import {
  expect,
  test,
  type Page,
  type TestInfo,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { measureChannelUi } from "./channel-ui-measure";

async function setChannelScenario(
  request: APIRequestContext,
  data: Record<string, unknown>,
) {
  const response = await request.post(
    "http://127.0.0.1:54329/__fixtures/channels",
    { data },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

function directory(info: TestInfo) {
  const phase = process.env.EDM_CHANNEL_VISUAL_PHASE;
  return phase
    ? path.resolve(".impeccable/visual/channel-setup", phase)
    : info.outputPath("visual");
}

async function capture(page: Page, info: TestInfo, name: string) {
  await mkdir(directory(info), { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(directory(info), `${name}.png`),
    animations: "disabled",
    caret: "hide",
  });
}

test("通道首次配置与测试的四种宽度和明暗主题对照", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120000);
  const before = process.env.EDM_CHANNEL_VISUAL_PHASE === "before";
  const errors: string[] = [];
  const measurements: unknown[] = [];
  expect(
    (
      await request.post("http://127.0.0.1:54329/__fixtures/channels", {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("channels@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "连接并验证发信通道" }).click();
  await expect(page).toHaveURL(/\/settings\?guide=channels#settings-channels$/);

  async function captureSizes(state: string, dialog = false) {
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) =>
          document.documentElement.classList.toggle("dark", value === "dark"),
        theme,
      );
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        if (!dialog) {
          await page.locator("#settings-channels").scrollIntoViewIfNeeded();
          await page.evaluate(() => {
            const section = document.getElementById("settings-channels")!;
            window.scrollTo(0, section.offsetTop - 132);
          });
        }
        await capture(page, info, `${state}-${width}-${theme}`);
        if (!before) {
          const metrics = await measureChannelUi(page, dialog);
          expect(metrics.overflow).toBeLessThanOrEqual(1);
          expect(metrics.minimumControlHeight).toBeGreaterThanOrEqual(44);
          expect(metrics.minimumControlWidth).toBeGreaterThanOrEqual(44);
          expect(metrics.minimumTextContrast.contrast).toBeGreaterThanOrEqual(
            4.5,
          );
          measurements.push({ state, theme, width, ...metrics });
        }
      }
    }
  }

  await captureSizes("empty");
  await page.getByRole("button", { name: "添加 阿里云邮件推送" }).click();
  await captureSizes("form", true);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("发件域名", { exact: true }).fill("send.example.com");
  await dialog
    .getByLabel("发件地址", { exact: true })
    .fill("hello@send.example.com");
  await dialog
    .getByLabel("AccessKey ID", { exact: true })
    .fill("LTAI5tVisual1234");
  await dialog
    .getByLabel("AccessKey Secret", { exact: true })
    .fill("local-visual-test-secret");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByText("已配置，待验证", { exact: true })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 10000,
  });
  await captureSizes("configured");
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  await expect(page.getByText("已验证", { exact: true })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 10000,
  });
  await captureSizes("accepted");
  expect(errors).toEqual([]);
  await writeFile(
    path.join(directory(info), "qa.json"),
    JSON.stringify({ before, errors, measurements }, null, 2) + "\n",
  );
});

test("长身份、异常与断开配置在小屏和缩放后保持可读", async ({
  page,
  request,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  const measurements: unknown[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setChannelScenario(request, {
    seed: true,
    longContent: true,
    testOutcomes: ["unknown"],
  });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("channels@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/dashboard$/);
  await page.goto("/settings#settings-channels");
  const longAddress =
    "long-sender-".repeat(4) +
    "@" +
    "long-domain-".repeat(4) +
    "mail.example.test";
  await expect(page.getByText(longAddress, { exact: true })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) =>
        document.documentElement.classList.toggle("dark", value === "dark"),
      theme,
    );
    for (const width of [320, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page
        .getByText(longAddress, { exact: true })
        .scrollIntoViewIfNeeded();
      const metrics = await measureChannelUi(page);
      expect(metrics.overflow).toBeLessThanOrEqual(1);
      expect(metrics.minimumTextContrast.contrast).toBeGreaterThanOrEqual(4.5);
      measurements.push({ state: "long", width, theme, ...metrics });
      await capture(page, info, `long-${width}-${theme}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "最近测试结果" }),
  ).toContainText("发送结果未知");
  await expect(
    page.getByRole("button", { name: "发送测试邮件", exact: true }),
  ).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 10000,
  });
  await page
    .getByRole("region", { name: "最近测试结果" })
    .scrollIntoViewIfNeeded();
  await capture(page, info, "unknown-390-dark");
  await setChannelScenario(request, {
    seed: true,
    missingCredentials: true,
    status: "verified",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "配置尚未完成" }),
  ).toBeVisible();
  await expect(page.getByText("已验证", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "发送测试邮件", exact: true }),
  ).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "连接并验证发信通道" }),
  ).toBeVisible();
  await setChannelScenario(request, { seed: true, status: "disconnected" });
  await page.goto("/settings#settings-channels");
  await expect(page.getByRole("heading", { name: "通道已断开" })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page
    .getByRole("button", { name: "重新连接发信通道" })
    .scrollIntoViewIfNeeded();
  await capture(page, info, "disconnected-390-dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  // Chromium CSS 缩放检查，仅代表布局模拟，不冒充实体设备或浏览器原生缩放。
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page
    .getByRole("button", { name: "重新连接发信通道" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("heading", { name: "通道已断开" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "重新连接发信通道" }),
  ).toBeInViewport();
  await capture(page, info, "zoom-1440-dark");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  expect(errors).toEqual([]);
  await writeFile(
    path.join(directory(info), "edge-qa.json"),
    JSON.stringify(
      { errors, measurements, zoom: "Chromium CSS 200%" },
      null,
      2,
    ) + "\n",
  );
  await setChannelScenario(request, {});
});
