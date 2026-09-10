import { test, expect } from "@playwright/test";
test("客户新增、标签、编辑、归档恢复与窄屏", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录邮局" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/contacts");
  await page.getByRole("button", { name: "添加客户", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("customer@example.test");
  await page.getByLabel("姓名（选填）").fill("测试客户");
  await page.getByLabel("标签", { exact: true }).fill("VIP");
  await page.getByRole("button", { name: "添加标签" }).click();
  await page.getByRole("button", { name: "保存客户" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("姓名（选填）").fill("客户改名");
  await page.getByRole("button", { name: "保存客户" }).click();
  await expect(page.getByText("客户改名", { exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("客户状态").selectOption("archived");
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("客户状态").selectOption("active");
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索邮箱或姓名").fill("没有匹配");
  await expect(
    page.getByText("没有匹配的客户，请调整搜索或筛选。"),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
