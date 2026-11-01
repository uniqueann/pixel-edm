import { expect, test, type Page } from "@playwright/test";

const fixture = "http://127.0.0.1:54329/__fixtures/onboarding";
async function login(page: Page) {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "切换主题", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("onboarding@example.test");
  await page.getByLabel("密码", { exact: true }).fill("edm-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
test.afterEach(async ({ request }) => {
  await request.post(fixture, { data: {} });
});

test("活动 50 / 100 条分页按摘要接口边界分批，筛选仍然生效", async ({
  page,
  request,
}) => {
  await request.post(fixture, {
    data: { state: "existing", campaignCount: 100, visualSnapshot: true },
  });
  await login(page);
  for (const size of [50, 100]) {
    await page.goto(`/campaigns?page_size=${size}`);
    await expect(
      page.getByRole("heading", { name: "发信活动", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="card"] h2')).toHaveCount(size);
    await expect(page.getByText("邮局暂时没有连接上")).toHaveCount(0);
  }
  await page.getByRole("textbox", { name: "搜索活动" }).fill("分页活动 001");
  await expect(page.locator('[data-slot="card"] h2')).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "分页活动 001", exact: true }),
  ).toBeVisible();
});

test("活动预览只发一次请求，署名读取失败不阻塞结果，关闭后恢复焦点", async ({
  page,
  request,
}, info) => {
  await request.post(fixture, {
    data: {
      state: "existing",
      visualSnapshot: true,
      failedRpcs: ["get_campaign"],
    },
  });
  await login(page);
  await page.goto("/campaigns");
  const preview = page.getByRole("button", { name: "预览", exact: true });
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"])
      posts++;
  });
  await preview.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("目标客户").locator("..")).toContainText("1");
  await expect(dialog.getByText(/计算时间/)).toBeVisible();
  expect(posts).toBe(1);
  await page.screenshot({
    path: info.outputPath("preview-detail-fallback.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(preview).toBeFocused();
  await preview.click();
  await expect(dialog.getByText(/计算时间/)).toBeVisible();
  expect(posts).toBe(2);
});
