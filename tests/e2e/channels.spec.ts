import { test, expect } from "@playwright/test";

test("管理员配置轮换断开 DirectMail，查看者保持只读且移动端不溢出", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录邮局" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "邮局设置", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加 阿里云邮件推送" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("发件域名")).toHaveValue("send.contentup.cc");
  await dialog.getByLabel("发件地址").fill("hello@send.contentup.cc");
  await dialog.getByLabel("AccessKey ID").fill("LTAI5tTestAccess1234");
  await dialog
    .getByLabel("AccessKey Secret")
    .fill("test-secret-that-is-never-rendered");
  await dialog.getByRole("button", { name: "安全保存配置" }).click();
  await expect(page.getByText("发信通道已连接")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "阿里云邮件推送 DirectMail" }),
  ).toBeVisible();
  await expect(
    page.getByText("已配置，待验证", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("••••1234", { exact: true })).toBeVisible();
  await expect(
    page.getByText("test-secret-that-is-never-rendered"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "发送测试邮件" }).click();
  await expect(page.getByText("测试邮件已被 DirectMail 接收")).toBeVisible();
  await expect(page.getByText("已验证", { exact: true })).toBeVisible();
  await expect(page.getByText(/收件人 o\*\*\*@example\.test/)).toBeVisible();
  await expect(
    page.getByText("DirectMail 已接收", { exact: false }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "打开与点击追踪" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /为未来正式活动开启追踪/ }).check();
  await page.getByLabel("DirectMail 标签").fill("pixel_edm_tracking");
  await page.getByRole("button", { name: "保存追踪设置" }).click();
  await expect(page.getByText("行为追踪已开启", { exact: true })).toBeVisible();
  await expect(
    page.getByText("已开启 · pixel_edm_tracking", { exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "投递回执 Webhook" }),
  ).toBeVisible();
  await expect(page.getByText("未配置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成令牌" }).click();
  await expect(page.getByText("Webhook 令牌已生成")).toBeVisible();
  const firstWebhookToken = await page
    .getByRole("textbox", { name: "Webhook 令牌", exact: true })
    .inputValue();
  expect(firstWebhookToken.length).toBeGreaterThanOrEqual(40);
  await expect(page.getByText("等待首个事件", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Webhook 令牌", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "轮换令牌" }).click();
  await expect(page.getByText("Webhook 令牌已轮换")).toBeVisible();
  const rotatedWebhookToken = await page
    .getByRole("textbox", { name: "Webhook 令牌", exact: true })
    .inputValue();
  expect(rotatedWebhookToken).not.toBe(firstWebhookToken);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "更新发信通道" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("AccessKey ID")).toHaveValue("");
  await expect(dialog.getByLabel("AccessKey Secret")).toHaveValue("");
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(15);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(375);
  expect(Math.abs(dialogBox!.y + dialogBox!.height - 844)).toBeLessThan(1);
  await dialog.getByLabel("AccessKey ID").fill("LTAI5tRotatedAccess5678");
  await dialog.getByLabel("AccessKey Secret").fill("rotated-test-secret-value");
  await dialog.getByRole("button", { name: "安全保存配置" }).click();
  await expect(page.getByText("发信通道已更新")).toBeVisible();
  await expect(page.getByText("••••5678", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "断开发信通道" }).click();
  await expect(page.getByText("发信通道已断开，凭据已删除")).toBeVisible();
  await expect(page.getByText("已断开", { exact: true })).toBeVisible();
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新连接发信通道" }),
  ).toBeVisible();
  await expect(page.getByText("等待首个事件", { exact: true })).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "停用 Webhook" }).click();
  await expect(page.getByText("回执 Webhook 已停用")).toBeVisible();
  await expect(page.getByText("未配置", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "协作邮局", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "当前工作区" }),
  ).toContainText("协作邮局");
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "邮局设置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /添加 阿里云邮件推送/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /更新发信通道|连接发信通道/ }),
  ).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
