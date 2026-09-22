import { test, expect } from "@playwright/test";
test("登录、初始化、主导航、设置保存、工作区切换和退出", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录邮局" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "我的邮局", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "团队", exact: true }),
  ).toHaveCount(0);
  for (const [label, title] of [
    ["客户", "客户名单"],
    ["模板", "邮件模板库"],
    ["活动", "发信活动"],
    ["日志", "操作记录"],
    ["设置", "邮局设置"],
    ["帮助", "使用帮助"],
  ]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "邮局设置", exact: true }),
  ).toBeVisible();
  await page.getByLabel("店铺 / 工作区名称").fill("测试店铺");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("工作区已保存")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("店铺 / 工作区名称")).toHaveValue("测试店铺");
  await page.goto(
    `/settings?checkout=error&reason=discount&msg=${encodeURIComponent("优惠码无效或不能用于当前套餐。请检查后再试，也可以留空直接结账。")}`,
  );
  await expect(page.getByText("优惠码无效", { exact: true })).toBeVisible();
  await expect(page.getByText("也可以留空直接结账")).toBeVisible();
  await page.getByRole("button", { name: /升级团队版|购买团队版/ }).click();
  const checkout = page.getByRole("dialog");
  await expect(checkout.getByText("有折扣代码吗？")).toBeVisible();
  await checkout.getByRole("button", { name: "应用折扣代码" }).click();
  await checkout.getByRole("button", { name: "验证" }).click();
  await expect(checkout.getByText("请输入折扣代码。")).toBeVisible();
  await checkout.getByPlaceholder("折扣代码").fill("NOPE123");
  await checkout.getByRole("button", { name: "验证" }).click();
  await expect(
    checkout.getByText(/折扣代码不存在|当前环境还不能验证这个折扣代码/),
  ).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/\/settings/);
  await page.keyboard.press("Escape");
  await expect(checkout).not.toBeVisible();
  await page.getByRole("button", { name: "为什么需要联系地址？" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "为什么需要联系地址？" }),
  ).toBeFocused();
  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "协作邮局", exact: true }).click();
  await expect(page.getByLabel("店铺 / 工作区名称")).toHaveValue("协作邮局");
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "邮局设置" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/office-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "退出当前账号" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});
