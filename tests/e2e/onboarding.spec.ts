import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const fixtureUrl = "http://127.0.0.1:54329/__fixtures/onboarding";
test.use({ actionTimeout: 10000 });
async function scenario(
  request: APIRequestContext,
  data: Record<string, unknown> = {},
) {
  const response = await request.post(fixtureUrl, { data });
  expect(response.ok(), await response.text()).toBe(true);
}
async function login(page: Page, email = "onboarding@example.test") {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
}
const guide = (page: Page) => page.getByTestId("onboarding-guide");
const item = (page: Page, key: string) =>
  page.locator(`[data-preparation='${key}']`);

test("自动初始化失败只手动重试，重复进入不创建第二个工作区", async ({
  page,
  request,
}) => {
  await scenario(request, { initializeFailures: 1 });
  await login(page, "fresh@example.test");
  await expect(page).toHaveURL(/onboarding\?error=1$/);
  await expect(page.getByRole("status")).toContainText(
    "重复操作不会创建重复工作区",
  );
  expect((await (await request.get(fixtureUrl)).json()).freshWorkspaces).toBe(
    0,
  );
  await page.getByRole("button", { name: "重试准备工作区" }).click();
  await expect(page).toHaveURL(/dashboard$/);
  expect((await (await request.get(fixtureUrl)).json()).freshWorkspaces).toBe(
    1,
  );
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/dashboard$/);
  expect((await (await request.get(fixtureUrl)).json()).freshWorkspaces).toBe(
    1,
  );
});

for (const width of [1440, 390]) {
  test(`从准备清单保存地址、导入订阅客户、保存模板、创建预览并确认名单（${width}px）`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 960 });
    const activate = (locator: Locator) =>
      width === 1440 ? locator.press("Enter") : locator.click();
    const directory = process.env.EDM_ONBOARDING_VISUAL_PHASE
      ? path.resolve(".impeccable/visual/onboarding", `flow-${width}`)
      : info.outputPath("flow");
    await mkdir(directory, { recursive: true });
    const capture = async (name: string) => {
      await page.addStyleTag({
        content: "nextjs-portal { display:none !important; }",
      });
      await page.screenshot({
        path: path.join(directory, `${name}.png`),
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      });
    };
    await scenario(request, { journey: width === 390 ? "mobile" : true });
    await login(
      page,
      width === 390 ? "mobile-journey@example.test" : "journey@example.test",
    );
    await expect(guide(page)).toContainText("1/4 项基础准备已完成");
    await activate(
      guide(page).getByRole("link", { name: "填写店铺信息", exact: true }),
    );
    await expect(page).toHaveURL(/settings\?guide=store#settings-store$/);
    await expect(
      page.getByRole("complementary", { name: "首次使用引导" }),
    ).toContainText("准备发件身份");
    await page.getByLabel("邮件页脚实体地址").fill("上海市测试路 5 号");
    await activate(page.getByRole("button", { name: "保存设置", exact: true }));
    await expect(page.getByText("工作区已保存")).toBeVisible();
    await activate(page.getByRole("link", { name: "返回准备清单" }));
    await expect(item(page, "store")).toContainText("已完成");
    await activate(item(page, "contacts").getByRole("link"));
    await expect(page).toHaveURL(/contacts\/import\?guide=contacts$/);
    await page.getByLabel("名单来源名称").fill("首次使用授权名单");
    await page
      .getByLabel("名单内容")
      .fill("邮箱,姓名\nfirst-reader@example.test,首位客户");
    await page
      .getByRole("checkbox", {
        name: /我确认名单中的客户已明确同意接收商业邮件/,
      })
      .press("Space");
    await page.getByLabel("同意来源").fill("会员注册");
    await page.getByLabel("授权说明").fill("隔离夹具中的订阅同意记录");
    await activate(page.getByRole("button", { name: "预检名单", exact: true }));
    await expect(page).toHaveURL(/guide=contacts.*id=/);
    await expect(
      page.getByRole("complementary", { name: "首次使用引导" }),
    ).toBeVisible();
    await activate(page.getByRole("button", { name: "确认并开始导入" }));
    await expect(
      page.getByRole("heading", { name: "名单处理完成", exact: true }),
    ).toBeVisible();
    await capture("import-completed");
    await activate(page.getByRole("link", { name: "返回准备清单" }));
    await expect(item(page, "contacts")).toContainText("已完成");
    await activate(item(page, "templates").getByRole("link"));
    await expect(page).toHaveURL(/templates\?guide=templates$/);
    const template = page.locator('[data-slot="card"]').filter({
      has: page.getByRole("heading", { name: "欢迎新客户", exact: true }),
    });
    await activate(template.getByRole("button", { name: "编辑", exact: true }));
    const templateEditor = page.getByRole("dialog");
    await templateEditor
      .getByLabel("模板名称", { exact: true })
      .fill("首次使用欢迎模板");
    await activate(
      templateEditor.getByRole("button", { name: "保存模板", exact: true }),
    );
    await expect(page.getByText("模板已保存", { exact: true })).toBeVisible();
    await activate(
      page.getByRole("link", { name: "继续创建活动", exact: true }),
    );
    await expect(page).toHaveURL(/campaigns\?guide=campaigns$/);
    await activate(page.getByRole("button", { name: "新建活动", exact: true }));
    const editor = page.getByRole("dialog");
    await editor.getByLabel("活动名称", { exact: true }).fill("我的第一场活动");
    await editor
      .getByLabel("邮件模板", { exact: true })
      .selectOption({ label: "欢迎系列 · 首次使用欢迎模板" });
    await editor.getByLabel(/发件人/).fill("小林");
    await editor.getByLabel(/优惠信息/).fill("新品介绍");
    await activate(
      editor.getByRole("button", { name: "保存活动草稿", exact: true }),
    );
    const card = page.locator("[data-campaign-id]").filter({
      has: page.getByRole("heading", { name: "我的第一场活动", exact: true }),
    });
    await activate(card.getByRole("button", { name: "预览", exact: true }));
    const preview = page.getByRole("dialog");
    await expect(
      preview.getByText("收件人：first-reader@example.test", { exact: true }),
    ).toBeVisible();
    await capture("preview");
    await activate(
      preview.getByRole("button", { name: "确认活动名单", exact: true }),
    );
    await activate(
      page
        .getByTestId("confirm-dialog")
        .getByRole("button", { name: "确认并锁定名单" }),
    );
    await expect(card).toContainText("已锁定 1 位收件人");
    await capture("confirmed");
    await activate(card.getByRole("button", { name: "正式发送", exact: true }));
    const sending = page.getByRole("dialog");
    await expect(sending.getByTestId("send-readiness-channel")).toHaveAttribute(
      "data-ok",
      "false",
    );
    await sending.getByLabel(/输入完整活动名称/).fill("我的第一场活动");
    await expect(
      sending.getByRole("button", { name: "创建正式发送任务" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await activate(page.getByRole("link", { name: "返回准备清单" }));
    await expect(guide(page)).toContainText("活动已创建");
    await expect(guide(page)).not.toContainText("邮件已预览");
  });
}

test("准备状态随刷新更新，默认署名、归档模板和失效通道保持边界", async ({
  page,
  request,
}) => {
  await scenario(request, {
    state: "partial",
    unconfirmed: true,
    archivedTemplates: true,
  });
  await login(page);
  await expect(item(page, "contacts")).toContainText("没有已订阅客户");
  await expect(item(page, "templates")).toContainText("待完成");
  await scenario(request, { state: "ready" });
  await page.reload();
  await expect(guide(page)).toContainText("4/4 项基础准备已完成");
  await expect(
    guide(page).getByRole("link", { name: "建议：完善我的署名" }),
  ).toBeVisible();
  await scenario(request, { state: "invalidated" });
  await page.reload();
  await expect(guide(page)).toContainText("3/4 项基础准备已完成");
  await expect(item(page, "channels")).toContainText("待完成");
  await expect(item(page, "channels")).toContainText("重新连接");
});

test("局部读取失败显示待核对并保留导航，重试后恢复真实进度", async ({
  page,
  request,
}) => {
  await scenario(request, {
    state: "ready",
    failedRpcs: [
      "list_contacts",
      "list_templates",
      "list_campaigns",
      "list_delivery_channels",
    ],
  });
  await login(page);
  for (const key of ["channels", "contacts", "templates"])
    await expect(item(page, key)).toContainText("待核对");
  await expect(guide(page)).not.toContainText("没有已订阅客户");
  await expect(
    page.getByRole("link", { name: "客户", exact: true }),
  ).toBeVisible();
  await scenario(request, { state: "ready" });
  await guide(page).getByRole("button", { name: "重试读取" }).click();
  await expect(guide(page)).toContainText("4/4 项基础准备已完成");
  await scenario(request, {
    state: "ready",
    failedRpcs: ["get_workspace_campaign_statistics", "list_activity_logs"],
  });
  await page.reload();
  await expect(guide(page)).toContainText("4/4 项基础准备已完成");
  await expect(
    page.getByText("最近动态暂时无法读取，其他准备操作仍可继续。"),
  ).toBeVisible();
  await expect(
    guide(page).getByRole("button", { name: "重试读取" }),
  ).toBeVisible();
});

test("管理员、运营、查看者与席位受限角色得到可执行的推荐", async ({
  page,
  request,
}) => {
  await scenario(request);
  await login(page);
  await expect(
    guide(page).getByRole("link", { name: "填写店铺信息", exact: true }),
  ).toBeVisible();
  await scenario(request, { role: "editor" });
  await page.reload();
  await expect(
    guide(page).getByRole("link", { name: "导入第一批客户", exact: true }),
  ).toBeVisible();
  await expect(item(page, "channels").getByRole("link")).toHaveCount(0);
  await expect(item(page, "channels")).toContainText("仅管理员");
  await scenario(request, { role: "viewer" });
  await page.reload();
  await expect(
    guide(page).getByRole("link", { name: "导入第一批客户", exact: true }),
  ).toHaveCount(0);
  await expect(guide(page)).toContainText("当前为查看者");
  await scenario(request, { role: "editor", overCapacity: true });
  await page.reload();
  await expect(guide(page)).toContainText("运营操作已暂停");
  await expect(item(page, "contacts").getByRole("link")).toHaveCount(0);
});

test("收起和重新打开支持键盘、回访及账号工作区角色隔离", async ({
  page,
  request,
}) => {
  await scenario(request);
  await login(page);
  let toggle = guide(page).getByRole("button", { name: "收起清单" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  toggle = guide(page).getByRole("button", { name: "查看准备清单" });
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const state = await (await request.get(fixtureUrl)).json();
  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "回访协作邮局", exact: true }).click();
  await expect(
    guide(page).getByRole("button", { name: "收起清单" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "初次使用邮局", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const stored = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("pixel-edm:onboarding:"),
    ),
  );
  expect(stored).toHaveLength(1);
  expect(stored[0]).toContain(state.workspaces[0]);
  await page.goto("/help#help-onboarding");
  await page.getByRole("link", { name: "查看总览准备清单" }).click();
  await expect(
    guide(page).getByRole("button", { name: "收起清单" }),
  ).toBeVisible();
  await guide(page).getByRole("button", { name: "收起清单" }).click();
  await page.getByRole("button", { name: "退出当前账号" }).click();
  await login(page, "returning@example.test");
  await expect(
    guide(page).getByRole("button", { name: "收起清单" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出当前账号" }).click();
  await scenario(request, { role: "editor" });
  await login(page);
  await expect(
    guide(page).getByRole("button", { name: "收起清单" }),
  ).toBeVisible();
});

test("浏览器存储不可写时仍可收起和展开，不保存任何业务完成标记", async ({
  page,
  request,
}) => {
  await scenario(request);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("存储不可写", "QuotaExceededError");
    };
  });
  await login(page);
  await guide(page).getByRole("button", { name: "收起清单" }).click();
  await expect(
    guide(page).getByRole("button", { name: "查看准备清单" }),
  ).toHaveAttribute("aria-expanded", "false");
  await guide(page).getByRole("button", { name: "查看准备清单" }).click();
  await expect(item(page, "store")).toContainText("待完成");
});

test("短视口和放大后的准备操作可达，焦点可见且收起内容不进入键盘路径", async ({
  page,
  request,
}) => {
  await scenario(request, { longName: true });
  await login(page);
  await page.setViewportSize({ width: 390, height: 420 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  const toggle = guide(page).locator(
    'button[aria-controls="preparation-content"]',
  );
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest("#preparation-content")),
    ),
  ).toBe(false);
  await toggle.focus();
  await page.keyboard.press("Space");
  const action = guide(page).getByRole("link", {
    name: "填写店铺信息",
    exact: true,
  });
  await action.focus();
  expect(
    await action.evaluate((element) => ({
      outline: getComputedStyle(element).outlineStyle,
      shadow: getComputedStyle(element).boxShadow,
    })),
  ).not.toEqual({ outline: "none", shadow: "none" });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/settings\?guide=store#settings-store$/);
});

async function expectGuideAnchorVisible(
  page: Page,
  hash: string,
  title: string,
) {
  const rail = page.getByRole("complementary", { name: "首次使用引导" });
  const back = rail.getByRole("link", { name: "返回准备清单" });
  const heading = page
    .locator(`#${hash}`)
    .getByRole("heading", { level: 2 })
    .first();
  await expect(rail).toContainText(title);
  await expect(page).toHaveURL(new RegExp(`#${hash}$`));
  await expect(back).toBeInViewport();
  await expect(async () => {
    const railBox = await rail.boundingBox();
    const backBox = await back.boundingBox();
    const headingBox = await heading.boundingBox();
    const headerBox = await page.locator(".app-sticky-header").boundingBox();
    const viewport = page.viewportSize();
    expect(railBox).not.toBeNull();
    expect(backBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    const headerBottom = headerBox!.y + headerBox!.height;
    const railBottom = railBox!.y + railBox!.height;
    expect(railBox!.y).toBeGreaterThanOrEqual(-1);
    expect(backBox!.y).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(backBox!.y + backBox!.height).toBeLessThanOrEqual(
      viewport!.height + 1,
    );
    expect(headingBox!.y).toBeGreaterThanOrEqual(railBottom - 1);
    expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(
      viewport!.height + 1,
    );
  }).toPass({ timeout: 8000 });
  expect(
    await rail.evaluate((element) => getComputedStyle(element).position),
  ).toBe("sticky");
}

test("设置页引导深链保持返回清单可见，并露出对应分区", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await scenario(request, { state: "ready" });
  await login(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/dashboard");
    await guide(page)
      .getByRole("link", { name: "补充邮件页脚实体地址", exact: true })
      .click();
    await expectGuideAnchorVisible(page, "settings-store", "准备发件身份");
    await page
      .getByRole("navigation", { name: "设置分区" })
      .getByRole("link", { name: "发信通道", exact: true })
      .click();
    await expectGuideAnchorVisible(page, "settings-channels", "准备发件身份");
    await page.goto("/settings?guide=channels#settings-channels");
    await expectGuideAnchorVisible(
      page,
      "settings-channels",
      "连接并验证主通道",
    );
    await page.goto("/settings?guide=store#settings-store");
    await expectGuideAnchorVisible(page, "settings-store", "准备发件身份");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page.goto("/contacts?guide=contacts");
  const contactsRail = page.getByRole("complementary", {
    name: "首次使用引导",
  });
  await expect(contactsRail).toBeVisible();
  expect(
    await contactsRail.evaluate((element) => ({
      sticky: element.getAttribute("data-sticky"),
      position: getComputedStyle(element).position,
    })),
  ).toEqual({ sticky: null, position: "static" });
});

test("引导深链对齐后上滚不会被拉回锚点", async ({ page, request }) => {
  await scenario(request, { state: "ready" });
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings?guide=channels#settings-channels");
  await expectGuideAnchorVisible(page, "settings-channels", "连接并验证主通道");
  const aligned = await page.evaluate(() => window.scrollY);
  expect(aligned).toBeGreaterThan(200);
  await page.evaluate(() => window.scrollBy(0, -480));
  await page.waitForTimeout(800);
  const afterGuide = await page.evaluate(() => window.scrollY);
  expect(afterGuide).toBeLessThan(aligned - 200);
  await expect(
    page.getByRole("link", { name: "返回准备清单" }),
  ).toBeInViewport();

  await page.goto("/settings#settings-channels");
  await expect(page.locator("#settings-channels")).toBeVisible();
  await page.waitForTimeout(400);
  const plainAligned = await page.evaluate(() => window.scrollY);
  expect(plainAligned).toBeGreaterThan(200);
  await page.evaluate(() => window.scrollBy(0, -480));
  await page.waitForTimeout(800);
  const afterPlain = await page.evaluate(() => window.scrollY);
  expect(afterPlain).toBeLessThan(plainAligned - 200);
});

test("总览清单滚过顶栏时不会透出文字", async ({ page, request }) => {
  await scenario(request, { state: "ready" });
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(guide(page)).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle("dark", value === "dark");
      document.documentElement.style.colorScheme = value;
    }, theme);
    const sample = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".app-sticky-header");
      const text = document.querySelector<HTMLElement>(
        "[data-testid='onboarding-guide'] p",
      );
      if (!header || !text) return null;
      window.scrollTo(0, 0);
      const delta =
        text.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom +
        28;
      window.scrollBy(0, delta);
      const headerRect = header.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      const x = Math.min(
        Math.max(textRect.left + 16, headerRect.left + 8),
        headerRect.right - 8,
      );
      const y = headerRect.bottom - 8;
      const hit = document.elementFromPoint(x, y);
      const style = getComputedStyle(header);
      const color = style.backgroundColor;
      const channels = color.match(/[\d.]+/g)?.map(Number) ?? [];
      const alpha =
        color.startsWith("rgba") || color.includes("/")
          ? (channels.at(-1) ?? 1)
          : channels.length === 4
            ? channels[3]
            : 1;
      return {
        alpha,
        backdrop: style.backdropFilter,
        hitInHeader: Boolean(hit && header.contains(hit)),
        overlaps:
          textRect.top < headerRect.bottom - 1 &&
          textRect.bottom > headerRect.top,
        color,
      };
    });
    expect(sample, theme).not.toBeNull();
    expect(sample!.overlaps, JSON.stringify(sample)).toBe(true);
    expect(sample!.hitInHeader, JSON.stringify(sample)).toBe(true);
    expect(sample!.alpha, JSON.stringify(sample)).toBe(1);
    expect(["none", ""]).toContain(sample!.backdrop);
  }
});
