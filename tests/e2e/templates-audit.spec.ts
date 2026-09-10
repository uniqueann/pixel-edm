import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录邮局" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("模板编辑、变量预览、复制归档与管理员审计", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "邮件模板库" })).toBeVisible();
  await expect(page.getByText("6 套")).toBeVisible();
  await expect(page.getByRole("heading", { name: "欢迎新客户" })).toBeVisible();

  await page.getByRole("button", { name: "新建模板" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("模板名称").fill("测试模板");
  await editor.getByLabel("分类").fill("自动测试");
  await editor.getByLabel("邮件主题").fill("Hello ");
  await editor.getByRole("button", { name: "{{name}}" }).click();
  await expect(editor.getByLabel("邮件主题")).toHaveValue("Hello {{name}}");
  await editor.getByLabel("纯文本正文").fill("Dear {{unknown}}");
  await expect(editor.getByText(/正文：未知变量/)).toBeVisible();
  await expect(editor.getByRole("button", { name: "保存模板" })).toBeDisabled();
  await editor.getByLabel("纯文本正文").fill("Dear ");
  await editor.getByRole("button", { name: "{{name}}" }).click();
  await editor.getByText("预览当前内容").click();
  await expect(editor.getByText("Hello Anna")).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await editor.getByRole("button", { name: "复制完整预览" }).click();
  await expect(page.getByText("完整预览已复制")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "主题：Hello Anna",
  );
  await editor.getByRole("button", { name: "保存模板" }).click();
  await expect(page.getByText("模板已保存")).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试模板" })).toBeVisible();

  const card = page
    .getByRole("heading", { name: "测试模板", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await card.getByRole("button", { name: "复制模板" }).click();
  await expect(page.getByText("模板副本已创建")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "测试模板 副本" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "归档" }).click();
  await expect(page.getByText("模板已归档")).toBeVisible();

  await page.getByLabel("模板状态").selectOption("archived");
  await expect(
    page.getByRole("heading", { name: "测试模板", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "测试模板", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']")
    .getByRole("button", { name: "恢复" })
    .click();
  await expect(page.getByText("模板已恢复")).toBeVisible();

  await page.goto("/logs");
  await expect(page.getByRole("heading", { name: "操作记录" })).toBeVisible();
  await expect(page.getByText("新建模板").first()).toBeVisible();
  await expect(page.getByText("复制模板").first()).toBeVisible();
  await page
    .getByLabel("操作者")
    .selectOption("10000000-0000-0000-0000-000000000001");
  await expect(page.getByText("测试模板").first()).toBeVisible();

  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "协作邮局", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "当前工作区" }),
  ).toContainText("协作邮局");
  await page.goto("/templates");
  await expect(page.getByText("当前为只读权限。")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建模板" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "日志", exact: true }),
  ).toHaveCount(0);
  await page.goto("/logs");
  await expect(
    page.getByRole("heading", { name: "没有找到这个页面" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/templates");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const mobileTemplateCard = page.locator("[data-slot='card']").first();
  const mobileTemplateTitle = await mobileTemplateCard
    .getByRole("heading")
    .boundingBox();
  expect(mobileTemplateTitle?.width ?? 0).toBeGreaterThan(120);
  await page.getByRole("button", { name: "预览" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
