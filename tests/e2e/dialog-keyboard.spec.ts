import { expect, test, type Page } from "@playwright/test";

async function simulateKeyboard(page: Page, visibleHeight: number) {
  await page.evaluate((height) => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("浏览器未提供 VisualViewport");
    Object.defineProperty(viewport, "height", {
      configurable: true,
      value: height,
    });
    viewport.dispatchEvent(new Event("resize"));
  }, visibleHeight);
}

async function expectFocusedFieldVisible(page: Page, visibleHeight: number) {
  const dialog = page.getByRole("dialog");
  await expect
    .poll(async () => {
      const bounds = await dialog.boundingBox();
      return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(visibleHeight + 1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const field = document.activeElement?.getBoundingClientRect();
        const dialog = document.activeElement?.closest(
          "[data-slot='dialog-content']",
        );
        const bounds = dialog?.getBoundingClientRect();
        return Boolean(
          field &&
          bounds &&
          field.top >= bounds.top + 8 &&
          field.bottom <= bounds.bottom - 8,
        );
      }),
    )
    .toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
}

test("移动端输入法出现后底部和居中弹窗仍可见且可滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录邮局" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings");

  await page
    .getByRole("button", {
      name: /添加 阿里云邮件推送|更新发信通道|重新连接发信通道/,
    })
    .click();
  await page.getByRole("dialog").getByLabel("AccessKey Secret").focus();
  await simulateKeyboard(page, 420);
  await expectFocusedFieldVisible(page, 420);
  await simulateKeyboard(page, 844);
  await expect
    .poll(async () => {
      const bounds = await page.getByRole("dialog").boundingBox();
      return bounds ? bounds.y + bounds.height : 0;
    })
    .toBeGreaterThanOrEqual(843);

  await page.reload();
  await page.getByRole("button", { name: /升级团队版|购买团队版/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "应用折扣代码" }).click();
  await dialog.getByPlaceholder("折扣代码").focus();
  await simulateKeyboard(page, 420);
  await expectFocusedFieldVisible(page, 420);
});
