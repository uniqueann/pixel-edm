import { test, expect } from "@playwright/test";
import { acceptConfirmDialog } from "./confirm-dialog";
test("客户新增、标签、编辑、归档恢复与窄屏", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/contacts");
  const desktopShell = await page.locator(".app-shell").boundingBox();
  expect(desktopShell).not.toBeNull();
  expect(desktopShell!.width).toBeGreaterThanOrEqual(1100);
  expect(desktopShell!.width).toBeLessThanOrEqual(1180);
  await page.getByRole("button", { name: "添加客户", exact: true }).click();
  const desktopDialogBox = await page.getByRole("dialog").boundingBox();
  expect(desktopDialogBox).not.toBeNull();
  expect(
    Math.abs(
      desktopDialogBox!.y +
        desktopDialogBox!.height / 2 -
        (await page.evaluate(() => window.innerHeight)) / 2,
    ),
  ).toBeLessThan(2);
  await page.getByLabel("邮箱", { exact: true }).fill("customer@example.test");
  await page.getByLabel("姓名（选填）").fill("测试客户");
  await page.getByLabel("标签", { exact: true }).fill("VIP");
  await page.getByRole("button", { name: "添加标签" }).click();
  await page.getByRole("button", { name: "保存客户" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).toBeVisible();
  const customerCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "customer@example.test" });
  await customerCard.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("姓名（选填）").fill("客户改名");
  await page.getByRole("button", { name: "保存客户" }).click();
  await expect(page.getByText("客户改名", { exact: true })).toBeVisible();
  await customerCard.getByRole("button", { name: "归档", exact: true }).click();
  await acceptConfirmDialog(page, "归档");
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("客户状态").selectOption("archived");
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).toBeVisible();
  await page
    .locator('[data-slot="card"]')
    .filter({ hasText: "customer@example.test" })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("客户状态").selectOption("active");
  await expect(
    page.getByText("customer@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索邮箱或姓名").fill("没有匹配");
  await expect(
    page.getByRole("heading", { name: "没有匹配的客户", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "添加客户", exact: true }).click();
  const dialogBox = await page.getByRole("dialog").boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(15);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(375);
  expect(Math.abs(dialogBox!.x - (390 - dialogBox!.width) / 2)).toBeLessThan(1);
  expect(Math.abs(dialogBox!.y + dialogBox!.height - 844)).toBeLessThan(1);
});

test("手动添加客户可声明已获得同意并变为已订阅", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/contacts");

  await page.getByRole("button", { name: "添加客户", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("plain-new@example.test");
  await page.getByRole("button", { name: "保存客户" }).click();
  const plainCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "plain-new@example.test" });
  await expect(plainCard.getByText("未确认", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "添加客户", exact: true }).click();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("consented-new@example.test");
  await page.getByLabel("我确认该客户已明确同意接收商业邮件").check();
  await page.getByLabel("同意来源").fill("展会名片");
  await page.getByRole("button", { name: "保存客户" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("授权说明").fill("客户现场书面同意");
  await page.getByRole("button", { name: "保存客户" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const consentedCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "consented-new@example.test" });
  await expect(
    consentedCard.getByText("已订阅", { exact: true }),
  ).toBeVisible();

  await plainCard.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("我确认该客户已明确同意接收商业邮件").check();
  await page.getByLabel("同意来源").fill("历史订单");
  await page.getByLabel("授权说明").fill("下单时勾选接收促销邮件");
  await page.getByRole("button", { name: "保存客户" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(plainCard.getByText("已订阅", { exact: true })).toBeVisible();

  await consentedCard
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await expect(
    page.getByLabel("我确认该客户已明确同意接收商业邮件"),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("展会名片");
});
