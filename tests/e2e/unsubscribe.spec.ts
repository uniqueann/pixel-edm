import { test, expect } from "@playwright/test";

test("公开退订确认页、幂等状态与安全响应头", async ({ page }) => {
  await page.goto("/unsubscribe/page.signature");
  await expect(
    page.getByRole("heading", { name: "停止接收营销邮件？" }),
  ).toBeVisible();
  await expect(page.getByText("c***@example.test").first()).toBeVisible();
  await expect(
    page.getByText(/Unsubscribe c\*\*\*@example\.test/),
  ).toBeVisible();
  const response = await page.request.get("/unsubscribe/header.signature");
  expect(response.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");

  await page.getByRole("button", { name: "确认退订 / Unsubscribe" }).click();
  await expect(page.getByRole("heading", { name: "退订完成" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "已经退订" })).toBeVisible();

  await page.goto("/unsubscribe/invalid.invalid");
  await expect(page.getByRole("heading", { name: "链接无效" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("标准 one-click POST 严格校验请求并保持幂等", async ({ request }) => {
  const options = {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: "List-Unsubscribe=One-Click",
  };
  const first = await request.post(
    "/api/unsubscribe/oneclick.signature",
    options,
  );
  expect(first.status()).toBe(200);
  const repeated = await request.post(
    "/api/unsubscribe/oneclick.signature",
    options,
  );
  expect(repeated.status()).toBe(200);

  const wrongBody = await request.post("/api/unsubscribe/wrong.signature", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: "List-Unsubscribe=No",
  });
  expect(wrongBody.status()).toBe(400);
  const wrongType = await request.post("/api/unsubscribe/wrong.signature", {
    data: { "List-Unsubscribe": "One-Click" },
  });
  expect(wrongType.status()).toBe(400);
  const invalid = await request.post(
    "/api/unsubscribe/invalid.invalid",
    options,
  );
  expect(invalid.status()).toBe(404);
  const get = await request.get("/api/unsubscribe/get.signature");
  expect(get.status()).toBe(405);
});
