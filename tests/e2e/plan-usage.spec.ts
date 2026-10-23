import { test, expect, type Page } from "@playwright/test";

async function loginAsFreeAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("viewer@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("免费版在操作附近显示套餐用量，模板达到上限后禁用并指向套餐", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loginAsFreeAdmin(page);

  await page.goto("/contacts");
  await expect(page.getByTestId("contact-quota")).toContainText(
    "有效客户（未归档）：已用 0 / 500",
  );
  await expect(
    page.getByRole("button", { name: "添加客户", exact: true }),
  ).toBeEnabled();

  await page.goto("/campaigns");
  await expect(page.getByTestId("campaign-confirm-quota")).toContainText(
    "本月已确认活动名单：已用 0 / 3",
  );

  await page.goto("/templates");
  await expect(page.getByTestId("template-quota")).toContainText(
    "自定义模板（起步模板不占用）：已用 0 / 3",
  );
  for (let index = 1; index <= 3; index += 1) {
    await page.getByRole("button", { name: "新建模板" }).click();
    const editor = page.getByRole("dialog");
    await editor.getByLabel("模板名称").fill(`额度模板 ${index}`);
    await editor.getByLabel("分类").fill("额度测试");
    await editor.getByLabel("邮件主题").fill(`Quota ${index}`);
    await editor.getByLabel("纯文本正文").fill("Hello");
    await editor.getByRole("button", { name: "保存模板" }).click();
    await expect(page.getByText("模板已保存").last()).toBeVisible();
    await expect(page.getByTestId("template-quota")).toContainText(
      `已用 ${index} / 3`,
    );
  }

  await expect(page.getByRole("button", { name: "新建模板" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "复制模板" }).first(),
  ).toBeDisabled();
  await expect(
    page.getByTestId("template-quota").getByRole("link", { name: "查看套餐" }),
  ).toHaveAttribute("href", "/settings");
  expect(errors).toEqual([]);
});
