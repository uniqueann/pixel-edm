import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function evidenceDirectory(testInfo: TestInfo) {
  const phase = process.env.EDM_IMPORT_VISUAL_PHASE;
  return phase
    ? path.resolve(".impeccable/visual/contact-import", phase)
    : testInfo.outputPath("visual");
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = evidenceDirectory(testInfo);
  await mkdir(directory, { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
}

async function measureImportUi(page: Page) {
  return page.locator("[data-contact-import]").evaluate((root) => {
    const controls = Array.from(
      root.querySelectorAll(
        "button, input:not([type=checkbox]), select, summary, a",
      ),
    ).filter((element) => element.getClientRects().length);
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
      root.querySelectorAll(
        "p,dt,dd,small,label,summary,a,[data-error],input[placeholder],textarea[placeholder]",
      ),
    )
      .filter((element) => element.getClientRects().length)
      .map((element) => {
        const placeholder = element.matches(
          "input[placeholder],textarea[placeholder]",
        );
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
          )?.slice(0, 48),
          color,
          background,
          contrast:
            (Math.max(foregroundValue, backgroundValue) + 0.05) /
            (Math.min(foregroundValue, backgroundValue) + 0.05),
        };
      });
    return {
      smallestControlHeight: Math.min(
        ...controls.map((element) => element.getBoundingClientRect().height),
      ),
      minimumTextContrast: samples.reduce((a, b) =>
        a.contrast < b.contrast ? a : b,
      ),
      textSampleCount: samples.length,
      tableDisplay: root.querySelector("tbody tr")
        ? getComputedStyle(root.querySelector("tbody tr")!).display
        : null,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

test("客户导入代表场景的明暗主题与四种宽度", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const before = process.env.EDM_IMPORT_VISUAL_PHASE === "before";
  const errors: string[] = [];
  const measurements: unknown[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/contacts/import");

  async function captureSizes(state: string) {
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) =>
          document.documentElement.classList.toggle("dark", value === "dark"),
        theme,
      );
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator("table").evaluateAll((tables) =>
          tables.forEach((table) => {
            if (table.parentElement) table.parentElement.scrollLeft = 0;
          }),
        );
        await capture(page, testInfo, `${state}-${width}-${theme}`);
        if (state !== "initial") {
          await page
            .getByText("邮箱格式无效", { exact: true })
            .scrollIntoViewIfNeeded();
          await capture(page, testInfo, `${state}-error-${width}-${theme}`);
        }
        // 修改前仅归档基线，修改后用相同场景验证实际布局与对比度。
        if (!before) {
          const measured = await measureImportUi(page);
          expect(measured.overflow).toBeLessThanOrEqual(1);
          expect(measured.smallestControlHeight).toBeGreaterThanOrEqual(44);
          expect(measured.minimumTextContrast.contrast).toBeGreaterThanOrEqual(
            4.5,
          );
          if (state !== "initial")
            expect(measured.tableDisplay).toBe(
              width < 768 ? "grid" : "table-row",
            );
          measurements.push({ state, theme, width, ...measured });
        }
      }
    }
  }

  await captureSizes("initial");
  await page.getByLabel("名单来源名称").fill("秋季会员授权名单与售后订阅核对");
  await page
    .getByLabel("名单内容")
    .fill(
      [
        "邮箱,姓名,标签",
        "preview-alpha@example.test,老客户,会员|秋季新品",
        "import-visual@example.test,新客户,秋季新品|复购",
        "IMPORT-VISUAL@example.test,,会员",
        "preview-suppressed@example.test,受保护客户,会员",
        "preview-archived@example.test,已归档客户,会员",
        "错误邮箱,待修正客户,",
        `${"long-customer-".repeat(4)}@${"example-long-domain-".repeat(3)}example.test,长邮箱客户,很长的客户标签与来源记录`,
      ].join("\n"),
    );
  await page.getByRole("button", { name: "预检名单", exact: true }).click();
  await expect(page.getByText("邮箱格式无效", { exact: true })).toBeVisible();
  if (before)
    await expect(
      page.getByText("预检完成，请确认结果后开始导入", { exact: true }),
    ).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 10000,
  });
  await captureSizes("preview");
  await page
    .getByRole("button", { name: "确认并开始导入", exact: true })
    .click();
  await expect(
    page.getByText(
      before ? "名单导入完成" : "名单处理完成，请核对结果与订阅状态",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 10000,
  });
  await captureSizes("completed");
  if (!before) {
    expect(errors).toEqual([]);
    await writeFile(
      path.join(evidenceDirectory(testInfo), "qa.json"),
      JSON.stringify({ errors, measurements }, null, 2) + "\n",
    );
  }
});
