import { expect, test, type Page } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:54329/__fixtures/onboarding";

async function scenario(data: Record<string, unknown>) {
  const response = await fetch(fixtureUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  expect(response.ok, await response.text()).toBe(true);
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

test("总览页头常驻创建入口，已有活动时运营内容先于准备清单", async ({
  page,
}) => {
  // 4/4、无活动：页头与最近活动空态都提供就近创建入口。
  await scenario({ state: "ready" });
  await login(page);
  const header = page.locator(".page-header");
  await expect(
    header.getByRole("link", { name: "创建活动", exact: true }),
  ).toBeVisible();
  const recentCard = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "最近活动", exact: true }),
  });
  await expect(
    recentCard.getByRole("link", { name: "创建活动", exact: true }),
  ).toBeVisible();
  await expect(
    recentCard.getByRole("link", { name: "查看全部发信活动" }),
  ).toHaveCount(0);

  // 页头动作直达活动页，活动页自身的「新建活动」随即可用。
  await header.getByRole("link", { name: "创建活动", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\?guide=campaigns$/);
  await expect(
    page.getByRole("heading", { name: "发信活动", exact: true }),
  ).toBeVisible();

  // 已有活动：指标 → 最近活动 → 准备清单，清单默认收起。
  await scenario({ state: "existing" });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "工作区准备清单", exact: true }),
  ).toBeVisible();
  const layout = await page.evaluate(() => {
    const guide = document.querySelector('[data-testid="onboarding-guide"]');
    const stats = document.querySelector(".stat-grid");
    const recentHeading = [...document.querySelectorAll("h2")].find(
      (heading) => heading.textContent?.trim() === "最近活动",
    );
    const recentCard = recentHeading?.closest('[data-slot="card"]');
    const rect = (element: Element | null | undefined) =>
      element?.getBoundingClientRect();
    return {
      statsTop: rect(stats)?.top ?? null,
      recentBottom: rect(recentCard)?.bottom ?? null,
      guideTop: rect(guide)?.top ?? null,
      guideExpanded: document
        .querySelector('button[aria-controls="preparation-content"]')
        ?.getAttribute("aria-expanded"),
    };
  });
  expect(layout.statsTop).not.toBeNull();
  expect(layout.recentBottom).not.toBeNull();
  expect(layout.guideTop).not.toBeNull();
  expect(layout.statsTop!).toBeLessThan(layout.recentBottom!);
  expect(layout.guideTop!).toBeGreaterThan(layout.recentBottom!);
  expect(layout.guideExpanded).toBe("false");

  // 移动端页头动作换行后仍满足 44px 触控目标，且不产生横向溢出。
  await page.setViewportSize({ width: 390, height: 844 });
  const create = header.getByRole("link", { name: "创建活动", exact: true });
  await expect(create).toBeVisible();
  const box = await create.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);

  // 320px 下主标签与「更多」仍为 44×44，且导航不需要横向滚动。
  await page.setViewportSize({ width: 320, height: 568 });
  const navMetrics = await page.locator(".tabs").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(navMetrics.scrollWidth).toBeLessThanOrEqual(
    navMetrics.clientWidth + 1,
  );
  const tabBoxes = await page.locator(".tabs .tab").evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim(),
          width: rect.width,
          height: rect.height,
        };
      }),
  );
  expect(tabBoxes.length).toBeGreaterThan(0);
  for (const tab of tabBoxes) {
    expect(tab.width, tab.text).toBeGreaterThanOrEqual(44);
    expect(tab.height, tab.text).toBeGreaterThanOrEqual(44);
  }

  // 「更多」菜单项同样满足触摸尺寸。
  await page.getByRole("button", { name: "更多导航" }).click();
  const menuItems = page.getByRole("menuitem");
  await expect(menuItems.first()).toBeVisible();
  for (const item of await menuItems.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    }),
  )) {
    expect(item.height).toBeGreaterThanOrEqual(44);
    expect(item.width).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
});
