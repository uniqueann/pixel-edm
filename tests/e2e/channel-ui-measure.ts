import type { Page } from "@playwright/test";

/** 只测量可见控件与文本，不读取表单值、凭据或浏览器存储。 */
export async function measureChannelUi(page: Page, dialog = false) {
  return page.evaluate((inDialog) => {
    const root = inDialog
      ? document.querySelector("[data-slot='dialog-content']")!
      : document.getElementById("settings-channels")!;
    const visible = (element: Element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[aria-hidden="true"]');
    const controls = Array.from(
      root.querySelectorAll(
        "button,input:not([type='checkbox']),select,summary,a",
      ),
    ).filter(visible);
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((channel) => channel / 255)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        );
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const samples = Array.from(
      root.querySelectorAll("p,dt,dd,label,summary,a,input[placeholder]"),
    )
      .filter(visible)
      .filter(
        (element) =>
          element.textContent?.trim() || element.getAttribute("placeholder"),
      )
      .map((element) => {
        const placeholder = element.matches("input[placeholder]");
        const color = getComputedStyle(
          element,
          placeholder ? "::placeholder" : null,
        ).color;
        let background = getComputedStyle(document.body).backgroundColor;
        let parent: Element | null = element;
        while (parent) {
          const candidate = getComputedStyle(parent).backgroundColor;
          if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
            background = candidate;
            break;
          }
          parent = parent.parentElement;
        }
        const foregroundValue = luminance(color);
        const backgroundValue = luminance(background);
        return {
          text: (placeholder
            ? element.getAttribute("placeholder")
            : element.textContent
          )?.slice(0, 40),
          contrast:
            (Math.max(foregroundValue, backgroundValue) + 0.05) /
            (Math.min(foregroundValue, backgroundValue) + 0.05),
        };
      });
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      minimumControlHeight: Math.min(
        ...controls.map((element) => element.getBoundingClientRect().height),
      ),
      minimumControlWidth: Math.min(
        ...controls.map((element) => element.getBoundingClientRect().width),
      ),
      minimumTextContrast: samples.reduce((a, b) =>
        a.contrast < b.contrast ? a : b,
      ),
      textSampleCount: samples.length,
    };
  }, dialog);
}
