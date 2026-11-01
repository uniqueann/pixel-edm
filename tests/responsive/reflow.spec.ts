import { expect, test } from "@playwright/test";
import { login } from "./session";

test("长弹窗随视口、字号及文字间距变化切换滚动布局", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing", visualSnapshot: true },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const [route, trigger, field, footer] of [
    [
      "/templates",
      "新建模板",
      "模板名称",
      '[data-testid="template-editor-footer"]',
    ],
    ["/settings", "更新发信通道", "发件人名称", "[data-channel-form-footer]"],
  ]) {
    await page.goto(route);
    await page.getByRole("button", { name: trigger, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).not.toHaveAttribute("data-dialog-reflow");
    await page.getByLabel(field, { exact: true }).fill("长名称测试".repeat(2));
    await page.setViewportSize({ width: 320, height: 256 });
    await expect(dialog).toHaveAttribute("data-dialog-reflow");
    await expect
      .poll(
        async () =>
          (await page.locator(footer).boundingBox())!.y +
          (await page.locator(footer).boundingBox())!.height,
      )
      .toBeLessThanOrEqual(257);
    const viewport = dialog.locator("[data-dialog-scroll-viewport]");
    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(
      await viewport.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).not.toHaveAttribute("data-dialog-reflow");
    await expect(page.getByLabel(field, { exact: true })).toHaveValue(
      "长名称测试".repeat(2),
    );

    await page.addStyleTag({
      content:
        "p, label, button, input, textarea, select, summary, h1, h2, h3 { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; } html { font-size: 200%; }",
    });
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const viewport = element.querySelector(
            "[data-dialog-scroll-viewport]",
          )!;
          const body = element.querySelector("[data-dialog-scroll-body]")!;
          return element.hasAttribute("data-dialog-reflow")
            ? viewport.clientHeight
            : body.clientHeight;
        }),
      )
      .toBeGreaterThanOrEqual(140);
    await expect
      .poll(
        async () =>
          (await page.locator(footer).boundingBox())!.y +
          (await page.locator(footer).boundingBox())!.height,
      )
      .toBeLessThanOrEqual(845);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    // 通过原有放弃确认结束本次隔离输入，保留业务保护逻辑。
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByTestId("confirm-dialog")
      .getByRole("button", { name: "放弃更改", exact: true })
      .click();
    await expect(dialog).toBeHidden();
  }
});

test("断点之间的普通内容和长字段自然回流", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing", visualSnapshot: true, longName: true },
  });
  await login(page);
  for (const width of [
    639, 640, 641, 767, 768, 819, 820, 959, 960, 1023, 1024,
  ]) {
    await page.setViewportSize({ width, height: 720 });
    for (const route of [
      "/settings",
      "/campaigns",
      "/templates",
      "/contacts/import",
    ]) {
      await page.goto(route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
        `${route} ${width}`,
      ).toBeLessThanOrEqual(1);
    }
  }
});
