import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码").fill("edm-test-password");
  await page.getByRole("button", { name: "登录邮局" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("活动草稿创建编辑、动态变量、归档模板、权限与窄屏", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await page.goto("/campaigns");
  await expect(page.getByRole("heading", { name: "发信活动" })).toBeVisible();
  await expect(page.getByText("0 条")).toBeVisible();

  await page.getByRole("button", { name: "新建活动" }).click();
  let editor = page.getByRole("dialog");
  await expect(editor.getByLabel("邮件模板")).toHaveValue("");
  await editor.getByLabel("活动名称").fill("无客户草稿");
  await editor
    .getByLabel("邮件模板")
    .selectOption({ label: "欢迎系列 · 欢迎新客户" });
  await expect(editor.getByLabel(/店铺名称/)).toHaveValue("我的邮局");
  await expect(editor.getByLabel(/发件人/)).toHaveValue("店主");
  await editor.getByLabel(/优惠信息/).fill("WELCOME-20");
  await editor.getByRole("button", { name: "保存活动草稿" }).click();
  await expect(page.getByText("活动草稿已保存").last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "无客户草稿" })).toBeVisible();

  let card = page
    .getByRole("heading", { name: "无客户草稿", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await card.getByRole("button", { name: "编辑" }).click();
  editor = page.getByRole("dialog");
  await editor.getByLabel("活动名称").fill("VIP 物流提醒");
  await editor
    .getByLabel("邮件模板")
    .selectOption({ label: "物流通知 · 物流通知" });
  await expect(editor.getByLabel(/订单号/)).toBeVisible();
  await expect(editor.getByLabel(/优惠信息/)).toHaveCount(0);
  await expect(editor.getByLabel(/发件人/)).toHaveValue("店主");
  await editor.getByLabel("发送对象").selectOption("tag");
  await editor.getByLabel("客户标签").selectOption({ label: "VIP" });
  await editor.getByRole("button", { name: "保存活动草稿" }).click();
  await expect(page.getByText("活动草稿已保存").last()).toBeVisible();
  card = page
    .getByRole("heading", { name: "VIP 物流提醒", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await expect(card.getByText("模板：物流通知")).toBeVisible();
  await expect(card.getByText("受众：标签 · VIP")).toBeVisible();

  await card.getByRole("button", { name: "预览" }).click();
  let previewDialog = page.getByRole("dialog");
  await expect(previewDialog.getByText("目标客户").locator("..")).toContainText(
    "10",
  );
  await expect(previewDialog.getByText("可发送").locator("..")).toContainText(
    "7",
  );
  await expect(previewDialog.getByText("已排除").locator("..")).toContainText(
    "3",
  );
  await expect(previewDialog.getByText(/排除明细/)).toContainText(
    "归档 1 位 · 未订阅 1 位 · 受抑制 1 位",
  );
  await expect(previewDialog.getByText(/请补充活动变量/)).toContainText(
    "{{order_number}}",
  );
  await expect(previewDialog.getByText(/第 1 封/)).toHaveCount(0);
  await previewDialog.getByRole("button", { name: "编辑活动" }).click();
  editor = page.getByRole("dialog");
  await editor.getByLabel(/订单号/).fill("ORDER-1001");
  await editor.getByRole("button", { name: "保存活动草稿" }).click();
  await expect(page.getByText("活动草稿已保存").last()).toBeVisible();

  card = page
    .getByRole("heading", { name: "VIP 物流提醒", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await card.getByRole("button", { name: "预览" }).click();
  previewDialog = page.getByRole("dialog");
  await expect(
    previewDialog.getByText("前 3 封邮件", { exact: true }),
  ).toBeVisible();
  await expect(
    previewDialog.getByText("收件人：preview-alpha@example.test", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    previewDialog.getByText("第 2 封 · preview-blank", { exact: true }),
  ).toBeVisible();
  await expect(
    previewDialog.getByText("主题：Your order ORDER-1001 has shipped").first(),
  ).toBeVisible();
  await previewDialog.getByRole("button", { name: "重新计算" }).click();
  await expect(previewDialog.getByText(/计算时间/)).toBeVisible();
  await previewDialog.getByRole("button", { name: "关闭" }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "归档" }).click();
  await expect(page.getByText("活动已归档")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "VIP 物流提醒", exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("活动归档状态").selectOption("archived");
  await page
    .getByRole("heading", { name: "VIP 物流提醒", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']")
    .getByRole("button", { name: "恢复" })
    .click();
  await expect(page.getByText("活动已恢复")).toBeVisible();
  await page.getByLabel("活动归档状态").selectOption("active");

  await page.goto("/templates");
  const shippingTemplate = page
    .getByRole("heading", { name: "物流通知", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  page.once("dialog", (dialog) => dialog.accept());
  await shippingTemplate.getByRole("button", { name: "归档" }).click();
  await expect(page.getByText("模板已归档")).toBeVisible();
  await page.goto("/campaigns");
  card = page
    .getByRole("heading", { name: "VIP 物流提醒", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await expect(card.getByText("模板已归档")).toBeVisible();
  await card.getByRole("button", { name: "编辑" }).click();
  editor = page.getByRole("dialog");
  await expect(editor.getByLabel("邮件模板")).toContainText(
    "已归档，仅保留当前引用",
  );
  await expect(editor.getByText(/当前模板已归档/)).toBeVisible();
  await editor.getByLabel("活动名称").fill("归档模板活动");
  await editor.getByRole("button", { name: "保存活动草稿" }).click();
  await expect(page.getByText("活动草稿已保存").last()).toBeVisible();

  await page.goto("/templates?status=archived");
  await page
    .getByRole("heading", { name: "物流通知", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']")
    .getByRole("button", { name: "恢复" })
    .click();
  await expect(page.getByText("模板已恢复")).toBeVisible();

  await page.goto("/campaigns");
  card = page
    .getByRole("heading", { name: "归档模板活动", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await card.getByRole("button", { name: "预览" }).click();
  previewDialog = page.getByRole("dialog");
  await expect(
    previewDialog.getByRole("button", { name: "确认并冻结活动" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await previewDialog.getByRole("button", { name: "确认并冻结活动" }).click();
  await expect(page.getByText(/活动已确认，冻结 7 位收件人/)).toBeVisible();
  card = page
    .getByRole("heading", { name: "归档模板活动", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await expect(card.getByText("已确认", { exact: true })).toBeVisible();
  await expect(card.getByText("冻结 7 位收件人")).toBeVisible();
  await expect(card.getByText(/模板版本 3/)).toBeVisible();
  const exportHref = await card
    .getByRole("link", { name: "下载 CSV" })
    .getAttribute("href");
  expect(exportHref).not.toBeNull();

  const downloadEvent = page.waitForEvent("download");
  await card.getByRole("link", { name: "下载 CSV" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(
    /^归档模板活动-\d{8}-[0-9a-f]{8}\.csv$/,
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv.startsWith('\uFEFF"email","name","subject","body"\r\n')).toBe(
    true,
  );
  expect(csv).toContain('"preview-alpha@example.test","\'=2+2"');
  expect(csv).toContain('"preview-charlie@example.test","\'+SUM(1,1)"');
  expect(csv).toContain('"preview-delta@example.test","\'-10"');
  expect(csv).toContain('"preview-echo@example.test","\'@cmd"');
  expect(csv).toContain('"preview-tab@example.test","\'\tTAB"');
  expect(csv).toContain('"preview-cr@example.test","\'\rCR"');
  expect(csv).toContain('"Your order ORDER-1001 has shipped"');
  expect(csv).toContain("\r\n");

  await page.goto("/templates");
  const activeShippingTemplate = page
    .getByRole("heading", { name: "物流通知", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  page.once("dialog", (dialog) => dialog.accept());
  await activeShippingTemplate.getByRole("button", { name: "归档" }).click();
  await expect(page.getByText("模板已归档")).toBeVisible();
  await page.goto("/campaigns");
  card = page
    .getByRole("heading", { name: "归档模板活动", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await card.getByRole("button", { name: "复制为草稿" }).click();
  const duplicateDialog = page.getByRole("dialog");
  await duplicateDialog
    .getByLabel("邮件模板")
    .selectOption({ label: "欢迎系列 · 欢迎新客户" });
  await duplicateDialog.getByRole("button", { name: "创建活动草稿" }).click();
  await expect(page.getByText("已复制为新的活动草稿")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "归档模板活动（副本）" }),
  ).toBeVisible();

  await page.goto("/templates?status=archived");
  await page
    .getByRole("heading", { name: "物流通知", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']")
    .getByRole("button", { name: "恢复" })
    .click();
  await expect(page.getByText("模板已恢复")).toBeVisible();
  await page.goto("/campaigns");

  card = page
    .getByRole("heading", { name: "归档模板活动", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "归档" }).click();
  await expect(page.getByText("活动已归档")).toBeVisible();
  await page.getByLabel("活动归档状态").selectOption("archived");
  card = page
    .getByRole("heading", { name: "归档模板活动", exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
  await expect(card.getByRole("link", { name: "下载 CSV" })).toBeVisible();
  await card.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByText("活动已恢复")).toBeVisible();
  await page.getByLabel("活动归档状态").selectOption("active");

  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "协作邮局", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "当前工作区" }),
  ).toContainText("协作邮局");
  await page.goto("/campaigns");
  await expect(page.getByText("当前为只读权限。")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建活动" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "查看者可见活动" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "归档" })).toHaveCount(0);
  const forbiddenExport = await page.request.get(exportHref!);
  expect(forbiddenExport.status()).toBe(403);

  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "我的邮局", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "当前工作区" }),
  ).toContainText("我的邮局");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "编辑" }).click();
  const dialogBox = await page.getByRole("dialog").boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(15);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(375);
  expect(Math.abs(dialogBox!.x - (390 - dialogBox!.width) / 2)).toBeLessThan(1);
  expect(Math.abs(dialogBox!.y + dialogBox!.height - 844)).toBeLessThan(1);
  expect(errors).toEqual([]);
});
