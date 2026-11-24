import { test, expect } from "@playwright/test";

test.use({ locale: "en-US" });

test("英文浏览器完整体验：公开认证页、校验文案、导航、设置页与切回中文", async ({
  page,
}) => {
  // 1. 英文浏览器首次打开登录页：自动协商为 en，展示英文品牌、表单与校验提示
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Sign in · Pixel EDM");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByText("Pixel EDM", { exact: true })).toBeVisible();

  // 提交空表单触发英文 zod 校验
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Please enter a valid email address"),
  ).toBeVisible();
  await expect(page.getByText("Please enter your password")).toBeVisible();

  // 切换到注册页与找回密码页均展示英文
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Get started with Pixel EDM" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset password" }),
  ).toBeVisible();

  // 2. 登录 viewer 账号：若账号在既有测试中已存有中文偏好则显式切到英文，验证英文顶栏导航与设置页
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("viewer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  if ((await page.locator("html").getAttribute("lang")) !== "en") {
    await page.getByRole("button", { name: "切换界面语言" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  }

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Contacts" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Templates" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Campaigns" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();

  // 3. 设置页英文渲染与署名校验
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Store details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My sign-off name" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Settings sections" }),
  ).toBeVisible();

  // 4. 切回简体中文，导航与设置页恢复中文，且复位测试账号
  await page
    .getByRole("radiogroup", { name: "Language" })
    .getByRole("radio", { name: "简体中文" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "邮局设置", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "邮局导航" })
      .getByRole("link", { name: "设置" }),
  ).toBeVisible();
});

test("英文核心业务流：总览、预置模板本地化、客户与导入、活动、通道/计费、日志与团队", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  if ((await page.locator("html").getAttribute("lang")) !== "en") {
    await page.getByRole("button", { name: "切换界面语言" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  }

  try {
    // 1. 总览页
    await expect(
      page.getByRole("heading", { name: "Recent campaigns" }),
    ).toBeVisible();

    // 2. 模板库：验证预置模板英文名与分类 + 打开新建模板编辑器
    await page.goto("/templates");
    await expect(
      page.getByRole("heading", { name: "Email Templates", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Welcome New Customers" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abandoned Cart Recovery" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New template" }).click();
    await expect(
      page.getByRole("heading", { name: "New template" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Template name", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Plain-text body", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // 3. 客户名单 + CSV 导入页
    await page.goto("/contacts");
    await expect(
      page.getByRole("heading", { name: "Contacts", level: 1 }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Import contacts" }).click();
    await expect(page).toHaveURL(/\/contacts\/import$/);
    await expect(
      page.getByRole("heading", { name: "Import Contacts", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download template" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preview import" }),
    ).toBeVisible();

    // 4. 发信活动：列表与新建草稿弹窗（验证预置模板下拉已英文化）
    await page.goto("/campaigns");
    await expect(
      page.getByRole("heading", { name: "Campaigns", level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New campaign" }).click();
    await expect(
      page.getByRole("heading", { name: "New campaign" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Campaign name", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#campaign-template option", {
        hasText: "Welcome Series · Welcome New Customers",
      }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Cancel" }).click();

    // 5. 设置页：通道与计费套餐区英文渲染
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Sending channels" }),
    ).toBeVisible();
    await expect(page.getByText(/Current plan:/)).toBeVisible();

    // 6. 操作日志、团队页与帮助页外壳
    await page.goto("/logs");
    await expect(page).toHaveTitle("Activity logs · Pixel EDM");
    await expect(
      page.getByRole("heading", { name: "Activity logs", level: 1 }),
    ).toBeVisible();

    await page.goto("/team");
    await expect(page).toHaveTitle("Team · Pixel EDM");
    await expect(
      page.getByRole("heading", { name: "Team", level: 1 }),
    ).toBeVisible();

    await page.goto("/help");
    await expect(page).toHaveTitle("Help · Pixel EDM");
    await expect(
      page.getByRole("heading", { name: "Help", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(/Detailed tutorial body content is currently available/),
    ).toBeVisible();
    const helpToc = page.getByRole("navigation", {
      name: "Help table of contents",
    });
    await expect(
      helpToc.getByRole("link", { name: "What Pixel EDM does" }),
    ).toBeVisible();
    await expect(
      helpToc.getByRole("link", { name: "DirectMail setup walkthrough" }),
    ).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search help guide" })
      .fill("SendGrid");
    await expect(
      page.getByText('Found 2 matching sections for "SendGrid"'),
    ).toBeVisible();
  } finally {
    // 复位 owner 账号回简体中文，避免影响复用同一夹具的中文 E2E
    await page.goto("/dashboard");
    if ((await page.locator("html").getAttribute("lang")) === "en") {
      await page.getByRole("button", { name: "Switch language" }).click();
      await page.getByRole("menuitem", { name: "简体中文" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    }
  }
});

test("英文模式视觉与导航回归：桌面与手机视口无横向溢出且窄屏折叠正常", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  if ((await page.locator("html").getAttribute("lang")) !== "en") {
    await page.getByRole("button", { name: "切换界面语言" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  }

  try {
    const routes = [
      "/dashboard",
      "/contacts",
      "/contacts/import",
      "/templates",
      "/campaigns",
      "/settings",
      "/logs",
      "/team",
      "/help",
    ];

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route);
        const overflow = await page.evaluate(async () => {
          await document.fonts.ready;
          return document.documentElement.scrollWidth - window.innerWidth;
        });
        expect(
          overflow,
          `${route} @ ${viewport.width}x${viewport.height}`,
        ).toBeLessThanOrEqual(0);
      }
    }

    // 窄屏导航折叠交互检查（390x844）
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    const navOverflow = await nav.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(navOverflow, "390x844 nav overflow").toBeLessThanOrEqual(0);

    const more = nav.getByRole("button", { name: "More navigation" });
    await expect(more).toBeVisible();
    await more.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Logs" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Help" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Help" }).click();
    await expect(page).toHaveURL(/\/help$/);
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard");
    if ((await page.locator("html").getAttribute("lang")) === "en") {
      await page.getByRole("button", { name: "Switch language" }).click();
      await page.getByRole("menuitem", { name: "简体中文" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    }
  }
});
