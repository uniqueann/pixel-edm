import type { Page } from "@playwright/test";

/** 按浏览器计算样式核对引导区域；不读取客户内容、表单值或存储。 */
export async function measurePreparationUi(page: Page) {
  return page
    .locator('[data-testid="onboarding-guide"]:visible')
    .evaluate((root) => {
      const visible = (element: Element) => element.getClientRects().length > 0;
      const controls = Array.from(root.querySelectorAll("button,a")).filter(
        visible,
      );
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const samples = Array.from(
        root.querySelectorAll("h2,h3,p,a,button,strong,span"),
      )
        .filter(visible)
        .filter((element) => element.textContent?.trim())
        .map((element) => {
          let parent: Element | null = element;
          let background = getComputedStyle(document.body).backgroundColor;
          while (parent) {
            const color = getComputedStyle(parent).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
              background = color;
              break;
            }
            parent = parent.parentElement;
          }
          const foregroundValue = luminance(getComputedStyle(element).color);
          const backgroundValue = luminance(background);
          return (
            (Math.max(foregroundValue, backgroundValue) + 0.05) /
            (Math.min(foregroundValue, backgroundValue) + 0.05)
          );
        });
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        minimumControlHeight: Math.min(
          ...controls.map((element) => element.getBoundingClientRect().height),
        ),
        minimumControlWidth: Math.min(
          ...controls.map((element) => element.getBoundingClientRect().width),
        ),
        minimumTextContrast: Math.min(...samples),
        textSampleCount: samples.length,
      };
    });
}
