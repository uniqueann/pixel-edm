import { expect, test } from "@playwright/test";
import { login } from "./session";

test("活动编辑器在窄屏放大时保持字段和操作在容器内", async ({
  page,
  request,
}, info) => {
  await request.post("http://127.0.0.1:54329/__fixtures/onboarding", {
    data: { state: "existing", visualSnapshot: true, longName: true },
  });
  await login(page);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto("/campaigns");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.getByRole("button", { name: "新建活动", exact: true }).click();
  const metrics = await page.getByRole("dialog").evaluate((dialog) => {
    const right = dialog.getBoundingClientRect().right;
    return {
      width: dialog.clientWidth,
      scrollWidth: dialog.scrollWidth,
      selects: [...dialog.querySelectorAll("select")].map((element) => ({
        id: element.id,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        box: element.getBoundingClientRect().width,
        css: {
          width: getComputedStyle(element).width,
          minWidth: getComputedStyle(element).minWidth,
          fontSize: getComputedStyle(element).fontSize,
          lineHeight: getComputedStyle(element).lineHeight,
          transform: getComputedStyle(element).transform,
        },
      })),
      scrollRegions: [...dialog.querySelectorAll<HTMLElement>("*")]
        .filter(
          (element) =>
            element.clientWidth > 0 &&
            element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => ({
          tag: element.tagName,
          className: String(element.className),
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          text: element.textContent?.slice(0, 40),
        })),
      children: [...dialog.querySelectorAll<HTMLElement>("*")]
        .filter((element) => element.getBoundingClientRect().right > right + 1)
        .map((element) => ({
          tag: element.tagName,
          className: String(element.className),
          text: element.textContent?.slice(0, 50),
          right: element.getBoundingClientRect().right,
        })),
    };
  });
  await page.screenshot({
    path: info.outputPath("campaign-text200.png"),
    animations: "disabled",
  });
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(
    metrics.width + 1,
  );
});
