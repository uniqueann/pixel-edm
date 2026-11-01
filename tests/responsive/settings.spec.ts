import { expect, test } from "@playwright/test";
import { login } from "./session";

test("设置页文字放大后普通内容保持屏幕内回流", async ({ page, request }) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing", visualSnapshot: true, longName: true },
  });
  await login(page);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto("/settings");
  await expect(
    page.getByRole("status", { name: "加载中", exact: true }),
  ).toBeHidden();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const overflow = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (
        !node.textContent?.trim() ||
        node.parentElement?.closest("script, style, nextjs-portal")
      )
        continue;
      const range = document.createRange();
      range.selectNode(node);
      const box = range.getBoundingClientRect();
      if (box.width > 0 && box.right > innerWidth + 1)
        nodes.push({
          text: node.textContent.slice(0, 70),
          className: node.parentElement?.className,
          right: box.right,
        });
    }
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      nodes,
      elements: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) => element.getBoundingClientRect().right > innerWidth + 1,
        )
        .map((element) => ({
          tag: element.tagName,
          id: element.id,
          className: String(element.className),
          width: element.getBoundingClientRect().width,
          right: element.getBoundingClientRect().right,
          position: getComputedStyle(element).position,
        })),
      regions: [
        "html",
        "body",
        ".app-shell",
        ".app-sticky-header",
        ".tabs-scroll-wrap",
        ".tabs",
        ".view",
        ".app-footer",
        ".settings-section",
      ].map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const box = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return {
          selector,
          left: box.left,
          right: box.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          overflowX: css.overflowX,
          overflowY: css.overflowY,
          position: css.position,
        };
      }),
    };
  });
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
    321,
  );
});
