import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录邮局" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("粘贴去重、错误报告、退订保护和 CSV 引号解析", async ({ page }) => {
  await login(page);
  await page.goto("/contacts/import");
  await page.getByLabel("名单来源名称").fill("粘贴回归名单");
  await page
    .getByLabel("名单内容")
    .fill(
      [
        "邮箱,姓名,标签",
        "IMPORT@example.test,导入客户,VIP",
        "import@example.test,,老客",
        "错误邮箱,错误行,",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "预检名单" }).click();
  await expect(page.getByText("源数据行").locator("..")).toContainText("3");
  await expect(page.getByText("去重后").locator("..")).toContainText("2");
  await expect(page.getByText("邮箱格式无效")).toBeVisible();
  await page.getByRole("button", { name: "确认并开始导入" }).click();
  await expect(page.getByText("已新增", { exact: true })).toBeVisible();
  const report = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载报告" }).click();
  expect((await report).suggestedFilename()).toMatch(/^名单导入报告-.*\.csv$/);

  await page.goto("/contacts");
  await expect(
    page.getByText("import@example.test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('span[data-slot="badge"]').filter({ hasText: "未确认" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退订", exact: true }).click();
  await page.getByLabel("退订原因").fill("客户来信要求退订");
  await page.getByRole("button", { name: "确认退订" }).click();
  await expect(
    page.locator('span[data-slot="badge"]').filter({ hasText: "已退订" }),
  ).toBeVisible();

  await page.goto("/contacts/import");
  await page.getByLabel("名单来源名称").fill("重新订阅尝试");
  await page
    .getByLabel("名单内容")
    .fill("邮箱,姓名\nimport@example.test,不能恢复订阅");
  await page
    .getByText("我确认名单中的未指定状态客户已提供可核验的订阅同意")
    .click();
  await page.getByLabel("同意来源").fill("会员注册");
  await page.getByLabel("证据说明").fill("注册页勾选记录");
  await page.getByRole("button", { name: "预检名单" }).click();
  await expect(page.getByText("抑制保护", { exact: true })).toBeVisible();

  await page.goto("/contacts/import");
  await page.getByRole("button", { name: "CSV 文件" }).click();
  await page.getByLabel("名单来源名称").fill("CSV 引号回归名单");
  await page.locator('input[type="file"]').setInputFiles({
    name: "quoted.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      '\uFEFF邮箱,姓名,标签\r\ncsv@example.test,"张,三","VIP|新品"\r\n',
    ),
  });
  await page.getByRole("button", { name: "预检名单" }).click();
  await expect(
    page.getByText("csv@example.test", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("VIP、新品", { exact: true })).toBeVisible();
});
