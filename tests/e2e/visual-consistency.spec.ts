import {
  expect,
  test,
  type Page,
  type TestInfo,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const phase = process.env.EDM_CONSISTENCY_PHASE;
const before = phase === "before";

async function scenario(
  request: APIRequestContext,
  data: Record<string, unknown> = {},
) {
  const response = await request.post(
    "http://127.0.0.1:54329/__fixtures/onboarding",
    { data: { ...data, visualSnapshot: true } },
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function capture(page: Page, info: TestInfo, name: string) {
  const directory = phase
    ? path.resolve("test-results/visual-consistency", phase)
    : info.outputPath("visual");
  await mkdir(directory, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const metrics = await page.evaluate(() => {
    const heading = document.querySelector("h1:not([hidden])");
    const style = heading ? getComputedStyle(heading) : null;
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-slot="button"], [data-slot="input"], [data-slot="select-trigger"], .list-filter, [data-slot="dialog-close"]',
      ),
    )
      .filter((element) =>
        element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        }),
      )
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name:
            element.getAttribute("aria-label") ||
            element.textContent?.trim().slice(0, 35),
          width: Math.round(box.width * 100) / 100,
          height: Math.round(box.height * 100) / 100,
        };
      });
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      toolbar: (() => {
        const element = document.querySelector<HTMLElement>(".list-toolbar");
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { height: box.height, width: box.width };
      })(),
      heading: style && {
        size: style.fontSize,
        weight: style.fontWeight,
        lineHeight: style.lineHeight,
      },
      controls,
    };
  });
  await writeFile(
    path.join(directory, `${name}.json`),
    JSON.stringify(metrics, null, 2),
  );
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  if (!before) {
    expect(metrics.overflow, name).toBeLessThanOrEqual(1);
    if (page.viewportSize()!.width <= 640) {
      for (const control of metrics.controls) {
        expect(
          control.height,
          `${name}: ${control.name}`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          control.width,
          `${name}: ${control.name}`,
        ).toBeGreaterThanOrEqual(44);
      }
    }
  }
  return metrics;
}

async function matrix(page: Page, info: TestInfo, name: string) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      localStorage.setItem("theme", theme);
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.style.colorScheme = theme;
    }, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await capture(page, info, `${name}-${width}-${theme}`);
    }
  }
}

test("全站主页面与专用编辑器的桌面手机双主题视觉矩阵", async ({
  page,
  request,
}, info) => {
  test.setTimeout(240000);
  await scenario(request, { state: "existing" });
  await login(page);
  for (const [name, route] of [
    ["dashboard", "/dashboard"],
    ["contacts", "/contacts"],
    ["import", "/contacts/import"],
    ["templates", "/templates"],
    ["campaigns", "/campaigns"],
    ["settings", "/settings"],
    ["team", "/team"],
    ["help", "/help"],
    ["logs", "/logs"],
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await matrix(page, info, name);
  }
  await page.goto("/contacts");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  await matrix(page, info, "contact-editor");
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  await page.getByRole("button", { name: "更新发信通道", exact: true }).click();
  await matrix(page, info, "channel-editor");
  await page.keyboard.press("Escape");
  await page.goto("/campaigns");
  await page.getByRole("button", { name: "预览", exact: true }).first().click();
  await matrix(page, info, "campaign-preview");
  await page.keyboard.press("Escape");
  await page.goto("/templates");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await matrix(page, info, "template-editor");
  await page.keyboard.press("Escape");
  await page.goto("/campaigns");
  await page.getByRole("button", { name: "新建活动", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await matrix(page, info, "campaign-editor");
  await page.keyboard.press("Escape");
});

test("系统页面共用控件的双主题响应式视觉矩阵", async ({ page }, info) => {
  test.setTimeout(180000);
  for (const [name, route] of [
    ["login", "/login"],
    ["register", "/register"],
    ["forgot", "/forgot-password"],
    ["reset", "/reset-password"],
    ["disabled", "/disabled"],
    ["invite", `/invite/${"a".repeat(48)}`],
    ["invite-invalid", "/invite/invalid"],
    ["setup", "/setup"],
    ["unsubscribe", "/unsubscribe/visual.signature"],
    ["unsubscribe-invalid", "/unsubscribe/invalid.invalid"],
    ["not-found", "/missing-visual-page"],
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await matrix(page, info, name);
  }
  await login(page);
  await page.goto("/onboarding?error=initialize");
  await matrix(page, info, "initialization-error");
});

test("长名称、只读、首次空态、无结果与读取失败的视觉边界", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180000);
  await scenario(request, {
    state: "existing",
    longName: true,
    role: "viewer",
  });
  await login(page);
  await matrix(page, info, "long-readonly-dashboard");
  await page.goto("/contacts");
  await matrix(page, info, "readonly-contacts");
  await scenario(request, {});
  await page.goto("/contacts");
  await matrix(page, info, "empty-contacts");
  await page.goto("/templates?q=没有匹配项");
  await matrix(page, info, "no-results");
  await scenario(request, {
    failedRpcs: [
      "list_contacts",
      "list_templates",
      "list_campaigns",
      "list_delivery_channels",
    ],
  });
  await page.goto("/dashboard");
  await matrix(page, info, "unavailable-dashboard");
  await scenario(request, { state: "existing", longName: true });
  for (const width of [320, 820, 1440]) {
    await page.setViewportSize({ width, height: 520 });
    await page.goto("/dashboard");
    await capture(page, info, `short-long-${width}`);
  }
  await page.setViewportSize({ width: 820, height: 960 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await capture(page, info, "text-200-dashboard");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await page.setViewportSize({ width: 390, height: 420 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await capture(page, info, "css-200-dashboard");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await scenario(request, {});
});
