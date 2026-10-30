import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/contacts");
  await page
    .getByRole("link", { name: "导入名单", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/contacts\/import$/);
}

async function fillList(page: Page, name: string, text: string) {
  await page.getByLabel("名单来源名称").fill(name);
  await page.getByLabel("名单内容").fill(text);
}

async function preflight(page: Page) {
  await page.getByRole("button", { name: "预检名单", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "确认预检结果", exact: true }),
  ).toBeVisible();
  return new URL(page.url()).searchParams.get("id")!;
}

async function protectedOnUnload(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

const isAction = (request: import("@playwright/test").Request) =>
  request.method() === "POST" && Boolean(request.headers()["next-action"]);

test("长文件名、明暗主题与放大后的输入区域不横向溢出", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.getByRole("button", { name: "CSV 文件", exact: true }).click();
  const name = "会员授权与回访名单-".repeat(24) + ".csv";
  await page.getByLabel("选择 CSV 文件", { exact: true }).setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(
      "邮箱,姓名,标签\nlong-file@example.test,长文件名客户,会员|复购",
    ),
  });
  await expect(page.getByLabel("名单来源名称")).toHaveValue(name.slice(0, 200));
  await expect(
    page.getByText(`已读取：${name}`, { exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) =>
        document.documentElement.classList.toggle("dark", value === "dark"),
      theme,
    );
    for (const width of [320, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("long-file-dark-mobile.png"),
    fullPage: false,
  });
  await page.locator("[data-contact-import]").evaluate((element) => {
    (element as HTMLElement).style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.getByLabel("名单来源名称").focus();
  await expect(page.getByLabel("名单来源名称")).toBeInViewport();
});

test("返回修改保留输入，真正新建清空输入；名单计数与错误口径准确", async ({
  page,
}) => {
  await login(page);
  const content =
    "邮箱,姓名,标签\nboundary@example.test,客户,会员\nBOUNDARY@example.test,,老客\nbad,错误行,";
  await fillList(page, "状态边界名单", content);
  expect(await protectedOnUnload(page)).toBe(true);
  const firstId = await preflight(page);
  await expect(page.getByLabel("名单计数")).toContainText("源数据行3");
  await expect(page.getByLabel("名单计数")).toContainText("去重后邮箱数1");
  await expect(page.getByLabel("名单计数")).toContainText("处理记录2");
  await expect(page.getByLabel("预检处理摘要")).toContainText("将新增1");
  await expect(page.getByLabel("预检处理摘要")).toContainText("错误1");
  await expect(
    page.getByText("尚未写入客户资料。核对处理结果后，再确认导入。", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await protectedOnUnload(page)).toBe(false);
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  await expect(page.getByLabel("名单内容")).toHaveValue(content);
  await expect(page.getByLabel("名单来源名称")).toHaveValue("状态边界名单");
  expect(await protectedOnUnload(page)).toBe(true);
  const secondId = await preflight(page);
  expect(secondId).not.toBe(firstId);
  await page.getByRole("button", { name: "新建导入", exact: true }).click();
  await expect(page.getByLabel("名单内容")).toHaveValue("");
  await expect(page.getByLabel("名单来源名称")).toHaveValue("手动导入");
  await expect(page).toHaveURL(/\/contacts\/import$/);
  expect(await protectedOnUnload(page)).toBe(false);
  await page
    .getByRole("button", { name: /状态边界名单/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(secondId));
  await expect(
    page.getByRole("button", { name: "返回修改", exact: true }),
  ).toHaveCount(0);
});

test("未预检内容的站内导航、后退、刷新及历史跳转均可取消", async ({ page }) => {
  await login(page);
  await fillList(page, "可恢复预检", "guard-history@example.test");
  const id = await preflight(page);
  await page.getByRole("button", { name: "新建导入", exact: true }).click();
  await fillList(page, "未保存草稿", "guard-unsaved@example.test");
  const confirm = page.getByTestId("confirm-dialog");
  await page.getByRole("link", { name: "返回客户名单", exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("名单内容")).toHaveValue(
    "guard-unsaved@example.test",
  );

  await page.getByRole("button", { name: /可恢复预检/ }).click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("名单来源名称")).toHaveValue("未保存草稿");
  expect(await protectedOnUnload(page)).toBe(true);
  let nativeBackPrompt = false;
  const cancelNativeBack = async (
    dialog: import("@playwright/test").Dialog,
  ) => {
    nativeBackPrompt = dialog.type() === "beforeunload";
    await dialog.dismiss();
  };
  page.once("dialog", cancelNativeBack);
  const backAttempt = page.goBack({ timeout: 2000 }).catch(() => null);
  await expect
    .poll(async () => nativeBackPrompt || (await confirm.isVisible()))
    .toBe(true);
  if (!nativeBackPrompt)
    await confirm
      .getByRole("button", { name: "继续编辑", exact: true })
      .click();
  await backAttempt;
  page.off("dialog", cancelNativeBack);
  await expect(page).toHaveURL(/\/contacts\/import$/);

  const dialogPromise = page.waitForEvent("dialog");
  const reload = page.reload({ timeout: 2000 }).catch(() => null);
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reload;
  await expect(page.getByLabel("名单内容")).toHaveValue(
    "guard-unsaved@example.test",
  );

  await page.getByRole("button", { name: /可恢复预检/ }).click();
  await confirm
    .getByRole("button", { name: "放弃并离开", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(id));
  await expect(
    page.getByRole("heading", { name: "确认预检结果", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建导入", exact: true }).click();
  await fillList(
    page,
    "确认离开后的新草稿",
    "guard-second-session@example.test",
  );
  // 模拟同页其他入口提供的历史任务链接，确认离开后组件仍会被复用。
  await page.evaluate((jobId) => {
    const anchor = document.createElement("a");
    anchor.href = `/contacts/import?id=${jobId}`;
    anchor.textContent = "测试历史任务入口";
    document.querySelector("main")!.prepend(anchor);
  }, id);
  await page
    .getByRole("link", { name: "测试历史任务入口", exact: true })
    .click();
  await confirm
    .getByRole("button", { name: "放弃并离开", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "确认预检结果", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建导入", exact: true }).click();
  await fillList(page, "再次编辑仍受保护", "guard-third-session@example.test");
  expect(await protectedOnUnload(page)).toBe(true);
  await page.getByRole("link", { name: "返回客户名单", exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("名单内容")).toHaveValue(
    "guard-third-session@example.test",
  );
});

test("空输入、授权错误和预检网络失败均在原位置恢复", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.getByRole("button", { name: "预检名单", exact: true }).click();
  await expect(page.getByLabel("名单内容")).toBeFocused();
  await expect(
    page.getByText("请粘贴名单，或选择含数据的 CSV 文件。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("名单来源名称").fill(" ");
  await page.getByLabel("名单内容").fill("empty-name@example.test");
  await page.getByRole("button", { name: "预检名单", exact: true }).click();
  await expect(page.getByLabel("名单来源名称")).toBeFocused();
  await fillList(page, "授权恢复名单", "consent-retry@example.test");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "预检名单", exact: true }).click();
  await expect(page.getByLabel("同意来源")).toBeFocused();
  await page.getByLabel("同意时间").fill("2099-01-01T10:00");
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "预检名单", exact: true }).click();
  await expect(page.getByLabel("同意时间")).toBeFocused();
  await expect(
    page.getByText("请填写有效且不晚于当前时间的同意时间。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("同意时间").fill("");
  await page.getByRole("checkbox").check();
  await page.getByLabel("同意来源").fill("会员注册页");
  await page.getByLabel("授权说明").fill("客户主动勾选，并保留后台授权记录");
  await page.route("**/contacts/import*", async (route) => {
    if (isAction(route.request())) await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "预检名单", exact: true }).click();
  await expect(
    page.locator("[data-contact-import]").getByRole("alert"),
  ).toContainText("预检未完成");
  await expect(page.getByLabel("名单内容")).toHaveValue(
    "consent-retry@example.test",
  );
  await expect(page.getByLabel("授权说明")).toHaveValue(
    "客户主动勾选，并保留后台授权记录",
  );
  await page.screenshot({
    path: testInfo.outputPath("prepare-error.png"),
    fullPage: true,
  });
  await page.unroute("**/contacts/import*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "确认预检结果", exact: true }),
  ).toBeVisible();
});

test("文件读取等待、超限和异常保持名单一致，支持重选同名文件", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.getByRole("button", { name: "CSV 文件", exact: true }).click();
  const file = page.getByLabel("选择 CSV 文件", { exact: true });
  await file.setInputFiles({
    name: "首次名单.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("邮箱,姓名\nfile-first@example.test,初次客户"),
  });
  await expect(
    page.getByText("已读取：首次名单.csv", { exact: true }),
  ).toBeVisible();
  await file.setInputFiles({
    name: "超限名单.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 65),
  });
  await expect(
    page.locator("[data-contact-import]").getByRole("alert"),
  ).toContainText("CSV 文件不能超过 2 MiB");
  await expect(page.getByLabel("名单来源名称")).toHaveValue("首次名单.csv");
  await expect(
    page.getByRole("button", { name: "预检名单", exact: true }),
  ).toBeDisabled();

  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === "读取异常.csv")
        throw new Error("本地文件读取失败，请重新选择。");
      if (this.name === "等待名单.csv")
        await new Promise<void>((resolve) => {
          (window as unknown as { finishFileRead: () => void }).finishFileRead =
            resolve;
        });
      return original.call(this);
    };
  });
  await file.setInputFiles({
    name: "读取异常.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("邮箱\nbad-read@example.test"),
  });
  await expect(
    page.locator("[data-contact-import]").getByRole("alert"),
  ).toContainText("本地文件读取失败");
  await page.getByLabel("分隔符", { exact: true }).selectOption(",");
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "预检名单", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("名单内容")).toHaveValue(
    "邮箱,姓名\nfile-first@example.test,初次客户",
  );
  await page
    .getByLabel("名单内容")
    .fill("tsv-hidden-delimiter@example.test\t客户\t会员");
  await preflight(page);
  await expect(
    page.getByText("tsv-hidden-delimiter@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  await page.getByRole("button", { name: "CSV 文件", exact: true }).click();
  await file.setInputFiles({
    name: "等待名单.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("邮箱\nfile-wait@example.test"),
  });
  await expect(
    page.getByText("正在读取文件，请稍候…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "粘贴", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("file-reading.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    (window as unknown as { finishFileRead: () => void }).finishFileRead(),
  );
  await expect(
    page.getByText("已读取：等待名单.csv", { exact: true }),
  ).toBeVisible();
  await file.setInputFiles({
    name: "等待名单.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("邮箱\nfile-reselected@example.test"),
  });
  await page.evaluate(() =>
    (window as unknown as { finishFileRead: () => void }).finishFileRead(),
  );
  await expect(
    page.getByRole("button", { name: "预检名单", exact: true }),
  ).toBeEnabled();
  await preflight(page);
  await expect(
    page.getByText("file-reselected@example.test", { exact: true }),
  ).toBeVisible();
});

test("CSV逐行状态优先，空授权列不回填，退订与归档保护持续展示", async ({
  page,
}) => {
  await login(page);
  await fillList(
    page,
    "逐行授权核对",
    [
      "邮箱,姓名,订阅状态,同意来源,授权说明",
      "csv-unconfirmed@example.test,未确认客户,未确认,,",
      "csv-subscribed@example.test,已同意客户,已订阅,会员注册,主动勾选记录",
      "csv-missing-evidence@example.test,缺少证据客户,已订阅,,",
      "csv-unsubscribed@example.test,退订客户,已退订,,",
      "preview-suppressed@example.test,保护客户,已订阅,会员注册,主动勾选记录",
      "preview-archived@example.test,归档客户,未确认,,",
    ].join("\n"),
  );
  await page.getByRole("checkbox").check();
  await page.getByLabel("同意来源").fill("批量默认来源");
  await page.getByLabel("授权说明").fill("批量默认授权说明");
  await preflight(page);
  const table = page.getByRole("table", { name: "名单逐条处理结果" });
  await expect(
    table.getByRole("row").filter({ hasText: "csv-unconfirmed@example.test" }),
  ).toContainText("导入状态：未确认");
  await expect(
    table
      .getByRole("row")
      .filter({ hasText: "csv-missing-evidence@example.test" }),
  ).toContainText("已订阅记录必须提供同意来源和证据说明");
  await expect(
    table
      .getByRole("row")
      .filter({ hasText: "preview-suppressed@example.test" }),
  ).toContainText("保留防打扰状态");
  await expect(
    table.getByRole("row").filter({ hasText: "preview-archived@example.test" }),
  ).toContainText("已归档（跳过）");
  await page
    .getByRole("button", { name: "确认并开始导入", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "名单处理完成", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看客户名单", exact: true }).click();
  const cards = page.locator('[data-slot="card"]');
  await expect(
    cards.filter({ hasText: "csv-unconfirmed@example.test" }),
  ).toContainText("未确认");
  await expect(
    cards.filter({ hasText: "csv-subscribed@example.test" }),
  ).toContainText("已订阅");
  await expect(
    cards.filter({ hasText: "csv-unsubscribed@example.test" }),
  ).toContainText("已退订");
});

test("分批中断后刷新继续原任务，处理时禁止切换，下载失败可以恢复", async ({
  page,
}, testInfo) => {
  await login(page);
  await fillList(
    page,
    "中断续导名单",
    "邮箱\n" +
      Array.from({ length: 151 }, (_, i) => `resume-${i}@example.test`).join(
        "\n",
      ),
  );
  const id = await preflight(page);
  await expect(page.getByLabel("名单计数").locator("dd").nth(1)).toHaveText(
    "151",
  );
  let requests = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/contacts/import*", async (route) => {
    if (!isAction(route.request())) return route.continue();
    requests++;
    if (requests === 3) {
      await pending;
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "确认并开始导入", exact: true })
    .click();
  await expect(
    page.getByText("已处理 100 / 151 条（含错误与跳过）", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建导入", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /中断续导名单/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "返回客户名单", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("link", { name: "返回客户名单", exact: true })
    .click({ force: true });
  await expect(page).toHaveURL(new RegExp(id));
  await page.screenshot({
    path: testInfo.outputPath("processing.png"),
    fullPage: true,
  });
  release();
  await expect(
    page.locator("[data-contact-import]").getByRole("alert"),
  ).toContainText("导入请求未完成");
  expect(requests).toBe(3);
  await page.unroute("**/contacts/import*");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "继续未完成的导入", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("resume-task.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "继续导入", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "名单处理完成", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(id));
  await expect(
    page.getByText("已处理 151 / 151 条（含错误与跳过）", { exact: true }),
  ).toBeVisible();
  await page.route("**/contacts/import*", async (route) => {
    if (isAction(route.request())) await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "下载报告", exact: true }).click();
  await expect(
    page.locator("[data-contact-import]").getByRole("alert"),
  ).toContainText("报告未下载");
  await page.unroute("**/contacts/import*");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  const download = await downloadPromise;
  const report = await readFile((await download.path())!, "utf8");
  expect(report.split("\r\n")).toHaveLength(152);
  expect(report.match(/已新增/g)).toHaveLength(151);
});

test("确认响应丢失后只恢复同一任务，不重复确认或新建", async ({ page }) => {
  await login(page);
  await fillList(page, "确认响应恢复", "confirm-lost@example.test");
  const id = await preflight(page);
  let lost = false;
  await page.route("**/contacts/import*", async (route) => {
    if (!lost && isAction(route.request())) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "确认并开始导入", exact: true })
    .click();
  await expect(
    page.locator("[data-contact-import]").getByRole("alert"),
  ).toContainText("导入请求未完成");
  await page.unroute("**/contacts/import*");
  await page.getByRole("button", { name: "重试原任务", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "名单处理完成", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(id));
  await expect(page.getByRole("button", { name: /确认响应恢复/ })).toHaveCount(
    1,
  );
});

test("分页失败保留原页，错误定位跨页，手机键盘收缩后操作可达", async ({
  page,
}, testInfo) => {
  await login(page);
  await fillList(
    page,
    "多页错误核对",
    "邮箱\n" +
      Array.from({ length: 52 }, (_, i) => `pages-${i}@example.test`)
        .concat("错误邮箱")
        .join("\n"),
  );
  const id = await preflight(page);
  await expect(page.getByLabel("名单计数").locator("dd").nth(1)).toHaveText(
    "52",
  );
  await page.route("**/contacts/import*", async (route) => {
    if (isAction(route.request())) await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(
    page.locator("[data-contact-import]").getByRole("alert"),
  ).toContainText("结果未加载");
  await expect(
    page.getByText("pages-0@example.test", { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  await page.unroute("**/contacts/import*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${id}&page=2`));
  await expect(page.getByText("邮箱格式无效", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(
    page.getByText("pages-0@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "定位首个错误", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${id}&page=2`));
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 840 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  await page.getByRole("checkbox").check();
  const note = page.getByLabel("授权说明");
  await note.fill("软键盘收缩时保留的授权说明");
  await note.focus();
  await page.setViewportSize({ width: 390, height: 380 });
  await expect(note).toBeInViewport();
  const noteBounds = await note.boundingBox();
  const headerBounds = await page.locator(".app-sticky-header").boundingBox();
  expect(noteBounds!.y).toBeGreaterThanOrEqual(
    headerBounds!.y + headerBounds!.height,
  );
  expect(noteBounds!.y + noteBounds!.height).toBeLessThanOrEqual(380);
  expect(
    await note.evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("16px");
  await page.screenshot({
    path: testInfo.outputPath("keyboard-viewport-simulation.png"),
    fullPage: false,
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "预检名单", exact: true }),
  ).toBeFocused();
});
