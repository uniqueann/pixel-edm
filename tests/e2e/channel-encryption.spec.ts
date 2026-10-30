import { expect, test } from "@playwright/test";

test("凭据加密不可用时，空通道页解释原因并禁用连接", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.EDM_CHANNEL_NO_KEY !== "1",
    "使用独立无密钥配置执行，避免改变默认回归环境",
  );
  expect(
    (
      await request.post("http://127.0.0.1:54329/__fixtures/channels", {
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("channels@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/dashboard$/);
  await page.goto("/settings#settings-channels");
  const root = page.locator("[data-channel-settings]");
  await expect(root.getByRole("alert")).toContainText("凭据加密能力尚未就绪");
  await expect(root.getByRole("alert")).toContainText("联系部署管理员");
  await expect(
    root.getByRole("button", { name: "添加 阿里云邮件推送" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});
