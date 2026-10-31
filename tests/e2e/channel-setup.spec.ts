import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:54329/__fixtures/channels";

async function scenario(
  request: APIRequestContext,
  values: Record<string, unknown> = {},
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request.post(fixtureUrl, { data: values });
      expect(response.ok(), await response.text()).toBe(true);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /socket hang up|ECONNRESET|ECONNREFUSED|EPIPE/.test(
        message,
      );
      if (!transient || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("channels@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/settings#settings-channels");
}

async function fillNewChannel(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("发件域名", { exact: true }).fill("send.example.com");
  await dialog
    .getByLabel("发件地址", { exact: true })
    .fill("hello@send.example.com");
  await dialog
    .getByLabel("AccessKey ID", { exact: true })
    .fill("LTAI5tLocal1234");
  await dialog
    .getByLabel("AccessKey Secret", { exact: true })
    .fill("local-only-channel-secret");
}

test.afterEach(async ({ request }) => {
  await scenario(request);
});

test("新建校验、保存失败保留输入与重试、更新保留已有凭据", async ({
  page,
  request,
}) => {
  await scenario(request, { saveFailures: 1 });
  await login(page);
  await page.getByRole("button", { name: "添加 阿里云邮件推送" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  const address = dialog.getByLabel("发件地址", { exact: true });
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(address).toHaveAccessibleDescription(/发件地址格式无效/);
  await expect(address).toBeFocused();
  await fillNewChannel(page);
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存失败");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(address).toHaveValue("hello@send.example.com");
  await expect(
    dialog.getByLabel("AccessKey Secret", { exact: true }),
  ).toHaveValue("local-only-channel-secret");
  expect(
    await page.evaluate(() => {
      const saved = JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        url: location.href,
      });
      return (
        saved.includes("local-only-channel-secret") ||
        saved.includes("LTAI5tLocal1234")
      );
    }),
  ).toBe(false);
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "配置已保存，下一步发送测试" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "更新发信通道" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("AccessKey ID", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    dialog.getByLabel("AccessKey Secret", { exact: true }),
  ).toHaveValue("");
  await dialog.getByLabel("回复地址（选填）", { exact: true }).fill("invalid");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    dialog.getByLabel("回复地址（选填）", { exact: true }),
  ).toHaveAccessibleDescription(/回复地址格式无效/);
  await dialog
    .getByLabel("回复地址（选填）", { exact: true })
    .fill("reply@example.test");
  await scenario(request, { operation: "faults", saveFailures: 1 });
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存失败");
  await expect(
    dialog.getByLabel("回复地址（选填）", { exact: true }),
  ).toHaveValue("reply@example.test");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("reply@example.test", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("••••1234", { exact: true })).toBeVisible();
});

test("取消、Esc、遮罩、主动跳转与刷新保护未保存输入并恢复焦点", async ({
  page,
  request,
}) => {
  await scenario(request);
  await login(page);
  const trigger = page.getByRole("button", { name: "添加 阿里云邮件推送" });
  await trigger.click();
  const editor = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "连接阿里云发信通道" }) });
  await editor
    .getByLabel("发件域名", { exact: true })
    .fill("unsaved.example.test");
  await page.mouse.click(2, 200);
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  let confirm = page.getByTestId("confirm-dialog");
  await expect(confirm).toContainText("放弃未保存的更改");
  await confirm.getByRole("button", { name: "继续编辑" }).click();
  await expect(editor.getByLabel("发件域名", { exact: true })).toHaveValue(
    "unsaved.example.test",
  );
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByTestId("confirm-dialog")
    .getByRole("button", { name: "继续编辑" })
    .click();
  await expect
    .poll(() =>
      editor.evaluate((root) => root.contains(document.activeElement)),
    )
    .toBe(true);
  await editor.getByRole("link", { name: "前往我的署名" }).click();
  confirm = page.getByTestId("confirm-dialog");
  await expect(confirm).toContainText("离开并放弃");
  await confirm.getByRole("button", { name: "继续编辑" }).click();
  await Promise.all([
    page.waitForEvent("dialog").then(async (event) => {
      expect(event.type()).toBe("beforeunload");
      await event.dismiss();
    }),
    page.evaluate(() => window.location.reload()),
  ]);
  await expect(editor.getByLabel("发件域名", { exact: true })).toHaveValue(
    "unsaved.example.test",
  );
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByTestId("confirm-dialog")
    .getByRole("button", { name: "放弃更改", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    page.getByRole("dialog").getByLabel("发件域名", { exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("dialog")
    .getByLabel("发件人名称", { exact: true })
    .fill("新名称");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "前往我的署名" })
    .click();
  await page
    .getByTestId("confirm-dialog")
    .getByRole("button", { name: "放弃并离开" })
    .click();
  await expect(page).toHaveURL(/settings#settings-profile$/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("保存期间阻止关闭、Esc 和重复提交", async ({ page, request }) => {
  await scenario(request, { saveDelayMs: 1200 });
  await login(page);
  await page.getByRole("button", { name: "添加 阿里云邮件推送" }).click();
  await fillNewChannel(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "正在保存…" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel("AccessKey ID", { exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("confirm-dialog")).not.toBeVisible();
  await expect(dialog).not.toBeVisible();
  const state = await (await request.get(fixtureUrl)).json();
  expect(
    state.requests.filter(
      (entry: { operation: string }) =>
        entry.operation === "save_delivery_channel",
    ),
  ).toHaveLength(1);
});

for (const [status, label] of [
  ["pending", "等待发送"],
  ["processing", "正在处理"],
]) {
  test(`测试${label}时只读刷新，不重复发送或误报失败`, async ({
    page,
    request,
  }) => {
    await scenario(request, { seed: true, testOutcomes: [status] });
    await login(page);
    await page
      .getByRole("button", { name: "发送测试邮件", exact: true })
      .click();
    const result = page.getByRole("region", { name: "最近测试结果" });
    await expect(result).toContainText(`最近测试：${label}`);
    await expect(
      page.getByRole("button", { name: "更新发信通道" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "断开发信通道" }),
    ).toBeDisabled();
    await page.reload();
    await expect(result).toContainText(label);
    await scenario(request, { operation: "complete" });
    await page.getByRole("button", { name: "刷新本次测试结果" }).click();
    await expect(result).toContainText("DirectMail 已接收");
    await expect(result).toContainText("不代表收件人已收到");
    await expect(page.getByText("已验证", { exact: true })).toBeVisible();
    const state = await (await request.get(fixtureUrl)).json();
    expect(
      state.requests.filter(
        (entry: { operation: string }) => entry.operation === "test",
      ),
    ).toHaveLength(1);
  });
}

test("发送失败复用中文指引；未知结果先核对，再手动新建测试", async ({
  page,
  request,
}) => {
  await scenario(request, {
    seed: true,
    testOutcomes: ["failed", "unknown", "accepted"],
  });
  await login(page);
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  const result = page.getByRole("region", { name: "最近测试结果" });
  await expect(result).toContainText("访问密钥或 API 鉴权失败");
  await result.getByText("技术详情（排障）").click();
  await expect(result).toContainText("InvalidAccessKeyId");
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  await expect(result).toContainText("发送结果未知");
  await page.getByRole("button", { name: "只刷新测试结果" }).click();
  await expect(result).toContainText("发送结果未知");
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  const confirm = page.getByTestId("confirm-dialog");
  await confirm.getByRole("button", { name: "继续核对" }).click();
  let state = await (await request.get(fixtureUrl)).json();
  expect(state.attempts).toHaveLength(2);
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  await confirm.getByRole("button", { name: "已核对，重新测试" }).click();
  await expect(result).toContainText("DirectMail 已接收");
  state = await (await request.get(fixtureUrl)).json();
  expect(state.attempts).toHaveLength(3);
  expect(
    new Set(
      state.requests
        .filter((entry: { operation: string }) => entry.operation === "test")
        .map((entry: { key: string }) => entry.key),
    ).size,
  ).toBe(3);
});

test("发送完成后响应中断，手动恢复沿用幂等键且仅接收一次", async ({
  page,
  request,
}) => {
  await scenario(request, {
    seed: true,
    testOutcomes: ["transport", "accepted"],
  });
  await login(page);
  const send = page.getByRole("button", {
    name: "发送测试邮件",
    exact: true,
  });
  const unknown = page.getByRole("heading", {
    name: "本次测试结果暂时无法确认",
  });
  // 水合完成前的点击不会发出请求，按钮文案保持不变；此时再点一次。
  // 请求已开始后按钮会改成「测试发送中…」，第二次点击拿不到操作锁。
  await expect(async () => {
    if (await send.isVisible()) await send.click();
    await expect(unknown).toBeVisible({ timeout: 2500 });
  }).toPass({ timeout: 15000 });
  await page.getByRole("button", { name: "恢复本次测试" }).click();
  await expect(
    page.getByRole("region", { name: "最近测试结果" }),
  ).toContainText("DirectMail 已接收");
  const state = await (await request.get(fixtureUrl)).json();
  const requests = state.requests.filter(
    (entry: { operation: string }) => entry.operation === "test",
  );
  expect(requests).toHaveLength(2);
  expect(requests[0].key).toBe(requests[1].key);
  expect(state.attempts).toHaveLength(1);
  expect(state.providerAcceptances).toBe(1);
});

test("跨通道操作互斥、主通道同步、断开后重新连接须填写凭据", async ({
  page,
  request,
}) => {
  await scenario(request, { seed: true, multiple: true, testDelayMs: 1200 });
  await login(page);
  const directMail = page.locator(
    "[data-channel-provider='aliyun_directmail']",
  );
  const ses = page.locator("[data-channel-provider='amazon_ses']");
  await directMail
    .getByRole("button", { name: "发送测试邮件", exact: true })
    .click();
  await expect(
    directMail.getByRole("button", { name: "更新发信通道" }),
  ).toBeDisabled();
  await expect(ses.getByRole("button", { name: "设为主通道" })).toBeDisabled();
  await expect(
    ses.getByRole("button", { name: "发送测试邮件", exact: true }),
  ).toBeDisabled();
  await expect(
    directMail.getByRole("region", { name: "最近测试结果" }),
  ).toContainText("已接收");
  await ses.getByRole("button", { name: "设为主通道" }).click();
  await expect(ses.getByText("主通道", { exact: true })).toBeVisible();
  await expect(
    directMail.getByText("主通道", { exact: true }),
  ).not.toBeVisible();
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "连接并验证发信通道" }),
  ).toBeVisible();
  await page.goto("/settings#settings-channels");
  page.once("dialog", (event) => event.accept());
  await ses.getByRole("button", { name: "断开发信通道" }).click();
  await expect(
    ses.getByRole("button", { name: "重新连接发信通道" }),
  ).toBeVisible();
  await ses.getByRole("button", { name: "重新连接发信通道" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    dialog.getByLabel("AWS 访问密钥 ID", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
});

test("主通道验证后衔接地址、正文署名、总览准备与创建活动入口", async ({
  page,
  request,
}) => {
  await scenario(request, { seed: true, missingAddress: true });
  await login(page);
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  const next = page.locator("[data-channel-next-step]");
  await expect(next).toBeVisible();
  await expect(next.getByRole("link", { name: "前往创建活动" })).toHaveCount(0);
  await next.getByRole("link", { name: "补充页脚联系地址" }).click();
  await expect(page).toHaveURL(/settings#settings-store$/);
  await page.getByLabel("邮件页脚实体地址").fill("上海市测试路 3 号");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(
    next.getByRole("link", { name: "补充页脚联系地址" }),
  ).toHaveCount(0);
  await next.getByRole("link", { name: "设置正文署名" }).click();
  await expect(page).toHaveURL(/settings#settings-profile$/);
  await page.getByLabel(/我的对外署名/).fill("Lena Chen");
  await page.getByRole("button", { name: "保存署名", exact: true }).click();
  await expect(next.getByRole("link", { name: "前往创建活动" })).toBeVisible();
  await next.getByRole("link", { name: "返回总览核对准备" }).click();
  await expect(page).toHaveURL(/dashboard#onboarding$/);
  await expect(page.locator('[data-preparation="channels"]')).toContainText(
    "已完成",
  );
  await expect(
    page.getByRole("link", { name: "准备已订阅客户" }),
  ).toBeVisible();
  await page.goto("/settings#settings-channels");
  await next.getByRole("link", { name: "前往创建活动" }).click();
  await expect(
    page.getByRole("heading", { name: "发信活动", exact: true }),
  ).toBeVisible();
});

test("切换工作区后忽略迟到测试结果，只读空态说明权限", async ({
  page,
  request,
}) => {
  await scenario(request, { seed: true, testDelayMs: 1800 });
  await login(page);
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  await page.getByRole("combobox", { name: "当前工作区" }).click();
  await page.getByRole("option", { name: "协作邮局", exact: true }).click();
  await expect(page.getByLabel("店铺 / 工作区名称")).toHaveValue("协作邮局");
  await expect(page.getByText(/当前为只读权限/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /添加 阿里云邮件推送|更新发信通道|发送测试邮件/,
    }),
  ).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await (await request.get(fixtureUrl)).json()).providerAcceptances,
    )
    .toBe(1);
  await expect(page.getByRole("region", { name: "最近测试结果" })).toHaveCount(
    0,
  );
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: /已接收测试邮件/ }),
  ).toHaveCount(0);
});

test("已有通道的只读成员不能修改、测试或查看凭据尾号", async ({
  page,
  request,
}) => {
  await scenario(request, { seed: true, readOnly: true });
  await login(page);
  const root = page.locator("[data-channel-settings]");
  await expect(root.getByText(/当前为只读权限/)).toBeVisible();
  await expect(root.getByText("已配置，待验证", { exact: true })).toBeVisible();
  await expect(
    root.getByRole("button", {
      name: /更新发信通道|发送测试邮件|断开发信通道|设为主通道/,
    }),
  ).toHaveCount(0);
  await expect(root.getByText("••••1234", { exact: true })).toHaveCount(0);
});
