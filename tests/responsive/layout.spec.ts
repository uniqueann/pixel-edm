import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { login } from "./session";

const phase = process.env.EDM_RESPONSIVE_PHASE;
const before = phase === "before";

test("响应式路由、复杂弹窗、文字放大与短视口", async ({
  page,
  request,
  browser,
}, info) => {
  test.setTimeout(240000);
  const directory = phase
    ? path.resolve(".impeccable/responsive-layout", phase, info.project.name)
    : info.outputPath("visual");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "environment.json"),
    JSON.stringify(
      {
        project: info.project.name,
        browserVersion: browser.version(),
        phase: phase ?? "test",
        fixture: "本地 PGlite 隔离夹具",
        zoom: "根字号模拟，非浏览器原生缩放",
      },
      null,
      2,
    ),
  );
  const records: unknown[] = [];
  async function capture(name: string) {
    await expect(
      page.getByRole("status", { name: "加载中", exact: true }),
    ).toBeHidden();
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    const layout = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const body = dialog?.querySelector<HTMLElement>(
        '[data-testid="template-editor-scroll"], [data-dialog-scroll-body]',
      );
      const viewport = dialog?.querySelector<HTMLElement>(
        "[data-dialog-scroll-viewport]",
      );
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        overflow:
          document.documentElement.scrollWidth > innerWidth + 1
            ? [...document.querySelectorAll<HTMLElement>("body *")]
                .filter((element) => {
                  const box = element.getBoundingClientRect();
                  return (
                    box.width > 0 &&
                    box.right > innerWidth + 1 &&
                    getComputedStyle(element).position !== "fixed"
                  );
                })
                .slice(0, 12)
                .map((element) => ({
                  tag: element.tagName,
                  className: String(element.className),
                  text: element.textContent?.slice(0, 50),
                }))
            : [],
        dialog: dialog
          ? {
              width: dialog.clientWidth,
              scrollWidth: dialog.scrollWidth,
              height: dialog.clientHeight,
              scrollHeight: dialog.scrollHeight,
            }
          : null,
        editor: body
          ? {
              height: body.clientHeight,
              scrollHeight: body.scrollHeight,
              overflowY: getComputedStyle(body).overflowY,
            }
          : null,
        reflow: dialog?.hasAttribute("data-dialog-reflow") ?? false,
        viewport: viewport
          ? {
              height: viewport.clientHeight,
              scrollHeight: viewport.scrollHeight,
            }
          : null,
      };
    });
    records.push({ name, ...layout });
    await page.screenshot({
      path: path.join(directory, `${name}.png`),
      animations: "disabled",
      caret: "hide",
    });
    await writeFile(
      path.join(directory, "evidence.json"),
      JSON.stringify(records, null, 2),
    );
    if (!before) {
      expect(layout.scrollWidth, name).toBeLessThanOrEqual(layout.width + 1);
      if (layout.dialog)
        expect(layout.dialog.scrollWidth, name).toBeLessThanOrEqual(
          layout.dialog.width + 1,
        );
      if (layout.editor) {
        // 固定头尾不能挤掉编辑区；空间不足时必须允许整个弹窗滚动。
        const singleScroll =
          layout.reflow &&
          layout.editor.overflowY === "visible" &&
          layout.viewport!.height >= 44 &&
          layout.viewport!.scrollHeight > layout.viewport!.height;
        expect(
          singleScroll || (!layout.reflow && layout.editor.height >= 140),
          name,
        ).toBe(true);
        if (layout.reflow) {
          const viewport = page.locator("[data-dialog-scroll-viewport]");
          await expect
            .poll(
              () =>
                viewport.evaluate(async (element) => {
                  element.scrollTop = element.scrollHeight;
                  // 等待尺寸观察和原有滚动避让完成，再确认滚动终点稳定可达。
                  await new Promise(requestAnimationFrame);
                  await new Promise(requestAnimationFrame);
                  return (
                    element.scrollHeight -
                    element.clientHeight -
                    element.scrollTop
                  );
                }),
              { message: name },
            )
            .toBeLessThanOrEqual(1);
          const footer = page.locator(
            '[data-testid="template-editor-footer"], [data-channel-form-footer]',
          );
          const bounds = (await footer.boundingBox())!;
          expect(bounds.y, name).toBeGreaterThanOrEqual(-1);
          expect(bounds.y + bounds.height, name).toBeLessThanOrEqual(
            layout.height + 1,
          );
        }
      }
    }
  }
  const fixture = await request.post(
    "http://127.0.0.1:54329/__fixtures/onboarding",
    { data: { state: "existing", visualSnapshot: true, longName: true } },
  );
  expect(fixture.ok()).toBe(true);
  await login(page);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
    for (const route of [
      "dashboard",
      "contacts",
      "contacts/import",
      "templates",
      "campaigns",
      "settings",
      "team",
      "help",
      "logs",
    ]) {
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        await page.goto(`/${route}`);
        await expect(
          page.getByRole("heading", { level: 1 }).first(),
        ).toBeVisible();
        await capture(`${route.replace("/", "-")}-${width}-${theme}`);
      }
    }
  }
  for (const [width, height, size] of [
    [390, 844, 100],
    [1440, 960, 100],
    [320, 600, 200],
    [820, 360, 100],
    [320, 256, 100],
    [390, 844, 200],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/templates");
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size}%`;
    }, size);
    await page.getByRole("button", { name: "新建模板", exact: true }).click();
    await page
      .getByLabel("模板名称", { exact: true })
      .fill("响应式验收 · 长名称与长内容");
    await page.getByLabel("邮件主题", { exact: true }).fill("Hi {{name}}");
    await page
      .getByLabel("纯文本正文", { exact: true })
      .fill("https://shop.example.test/" + "long-product-name-".repeat(50));
    await capture(`template-${width}-${height}-text${size}-edit`);
    if (width < 960)
      await page
        .getByRole("button", { name: "预览当前内容", exact: true })
        .click();
    await capture(`template-${width}-${height}-text${size}-preview`);
    // 独立页面重载只清理测试中的未保存草稿，防离开保护仍由默认回归覆盖。
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload();
    for (const route of ["/contacts/import", "/campaigns", "/settings"]) {
      await page.goto(route);
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}%`;
      }, size);
      if (route === "/settings" && size === 200)
        await capture(`settings-page-${width}-${height}-text${size}`);
      if (route === "/campaigns")
        await page
          .getByRole("button", { name: "新建活动", exact: true })
          .click();
      if (route === "/settings")
        await page
          .getByRole("button", {
            name: /添加 阿里云邮件推送|更新发信通道/,
            exact: true,
          })
          .click();
      await capture(
        `${route.slice(1).replace("/", "-")}-${width}-${height}-text${size}`,
      );
      await page.reload();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "login",
    "register",
    "forgot-password",
    "reset-password",
    "disabled",
    "invite/invalid",
    "setup",
    "unsubscribe/invalid.invalid",
    "missing-responsive-page",
  ]) {
    await page.goto(`/${route}`);
    await capture(route.replaceAll("/", "-"));
  }
});
