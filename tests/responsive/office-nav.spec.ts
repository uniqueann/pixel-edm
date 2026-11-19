import { expect, test } from "@playwright/test";
import { login } from "./session";

test.use({ hasTouch: true });

test("触摸主导航在横竖屏切换时对齐并恢复焦点", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const nav = page.getByRole("navigation", { name: "邮局导航" });
  const more = nav.getByRole("button", { name: "更多导航" });
  const logs = nav.getByRole("link", { name: "日志", exact: true });
  const help = nav.getByRole("link", { name: "帮助", exact: true });

  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [430, 932],
    [400, 320],
    [568, 320],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const portrait = width < height;
    if (portrait) {
      await expect(more).toBeVisible();
      await expect(logs).toBeHidden();
      await expect(help).toBeHidden();
    } else {
      await expect(more).toBeHidden();
      await expect(logs).toBeVisible();
      await expect(help).toBeVisible();
    }

    const layout = await nav.evaluate(async (element) => {
      await document.fonts.ready;
      return {
        overflow: element.scrollWidth - element.clientWidth,
        tabs: Array.from(element.children)
          .filter((tab) => tab.getClientRects().length)
          .map((tab) => {
            const box = tab.getBoundingClientRect();
            const label = document.createRange();
            label.selectNode(tab.firstChild!);
            return {
              width: box.width,
              height: box.height,
              centerX: box.x + box.width / 2,
              textTop: label.getBoundingClientRect().top,
            };
          }),
      };
    });
    const size = `${width}×${height}`;
    expect(layout.overflow, size).toBeLessThanOrEqual(0);
    const spacing = layout.tabs[1].centerX - layout.tabs[0].centerX;
    for (const [index, tab] of layout.tabs.entries()) {
      expect(tab.width, size).toBeGreaterThanOrEqual(44);
      expect(tab.height, size).toBeGreaterThanOrEqual(44);
      expect(
        Math.abs(tab.textTop - layout.tabs[0].textTop),
        size,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(tab.centerX - layout.tabs[0].centerX - spacing * index),
        size,
      ).toBeLessThanOrEqual(1);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await more.tap();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "日志" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "帮助" }).tap();
  await expect(page).toHaveURL(/\/help$/);
  await expect(
    page.getByRole("heading", { name: "使用帮助", exact: true }),
  ).toBeVisible();
  await expect(more).toHaveClass(/\bactive\b/);
  await expect(more).toHaveCSS("border-bottom-width", "2px");

  await more.tap();
  await expect(menu.getByRole("menuitem", { name: "帮助" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  await more.tap();
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(menu).toBeHidden();
  await expect(help).toBeFocused();
  await expect(help).toHaveAttribute("aria-current", "page");
  await logs.tap();
  await expect(page).toHaveURL(/\/logs$/);
  await expect(logs).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "操作记录", exact: true }),
  ).toBeVisible();
});
