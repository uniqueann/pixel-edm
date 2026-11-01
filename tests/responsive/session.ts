import { expect, type Page } from "@playwright/test";

export async function login(page: Page) {
  await page.goto("/login");
  // 主题按钮启用代表客户端已挂载，避免跨引擎极速填值被水合初值覆盖。
  await expect(
    page.getByRole("button", { name: "切换主题", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(
    "onboarding@example.test",
  );
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
