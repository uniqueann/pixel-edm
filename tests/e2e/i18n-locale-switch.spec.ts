import { test, expect } from "@playwright/test";

test("无路由语言切换：公开页、登录后 DB 持久化、退出登录保持偏好与 URL 不变", async ({
  page,
}) => {
  // 1. 未登录公开页切换语言：URL 保持 /login，<html lang> 与 title 切换并跨刷新保持
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle(/卖家邮局/);

  await page.getByRole("button", { name: "切换界面语言" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(/Pixel EDM/);
  await expect(page).toHaveURL(/\/login$/);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // 2. 先切回中文再登录 viewer 账号，在设置页「界面外观」卡切英文并持久化到 DB
  await page.getByRole("button", { name: "Switch language" }).click();
  await page.getByRole("menuitem", { name: "简体中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await page.getByLabel("邮箱", { exact: true }).fill("viewer@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");
  const langGroup = page.getByRole("radiogroup", { name: "界面语言" });
  await langGroup.getByRole("radio", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveURL(/\/settings$/);

  // 刷新后仍为英文（DB + cookie 一致）
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page
      .getByRole("radiogroup", { name: "Language" })
      .getByRole("radio", { name: "English" }),
  ).toHaveAttribute("aria-checked", "true");

  // 3. 退出登录后仍保留英文偏好，不跳回中文
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // 4. 复位 viewer 账号回简体中文，避免污染后续复用同一夹具的测试
  await page.getByLabel("Email", { exact: true }).fill("viewer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "Switch language" }).click();
  await page.getByRole("menuitem", { name: "简体中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("退订页通过 ?lang=en / ?lang=zh 独立切换语言，不污染 NEXT_LOCALE cookie", async ({
  page,
}) => {
  await page.goto("/unsubscribe/page.signature?lang=en");
  await expect(
    page.getByRole("heading", { name: "Unsubscribe from marketing emails?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unsubscribe", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "中文" }).click();
  await expect(page).toHaveURL(/\?lang=zh$/);
  await expect(
    page.getByRole("heading", { name: "停止接收营销邮件？" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认退订", exact: true }),
  ).toBeVisible();

  // 确认未写入 NEXT_LOCALE cookie
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "NEXT_LOCALE")).toBe(false);
});
