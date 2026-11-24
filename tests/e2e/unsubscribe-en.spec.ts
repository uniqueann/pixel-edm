import { test, expect } from "@playwright/test";

test.describe("英文退订页与 one-click API", () => {
  test.use({ locale: "en-US" });

  test("Accept-Language 为英文时退订页默认展示纯英文并可完成退订", async ({
    page,
  }) => {
    await page.goto("/unsubscribe/page.signature");
    await expect(page).toHaveTitle(/Unsubscribe/);
    await expect(page.getByText("Pixel EDM", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Unsubscribe from marketing emails?",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unsubscribe", exact: true }),
    ).toBeVisible();
    // 纯英文模式不混出中文标题
    await expect(page.getByText("停止接收营销邮件？")).toHaveCount(0);

    // 显式 ?lang=en 对无效链接同样返回纯英文
    await page.goto("/unsubscribe/invalid.invalid?lang=en");
    await expect(
      page.getByRole("heading", { name: "Invalid link" }),
    ).toBeVisible();
    await expect(page.getByText("链接无效")).toHaveCount(0);
  });

  test("one-click POST 按 Accept-Language 返回对应语言错误响应", async ({
    request,
  }) => {
    const enBadFormat = await request.post("/api/unsubscribe/wrong.signature", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept-language": "en-US,en;q=0.9",
      },
      data: "List-Unsubscribe=No",
    });
    expect(enBadFormat.status()).toBe(400);
    expect(await enBadFormat.text()).toBe("Invalid request format");

    const enInvalid = await request.post("/api/unsubscribe/invalid.invalid", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept-language": "en-US,en;q=0.9",
      },
      data: "List-Unsubscribe=One-Click",
    });
    expect(enInvalid.status()).toBe(404);
    expect(await enInvalid.text()).toBe("Invalid unsubscribe link");

    const zhInvalid = await request.post("/api/unsubscribe/invalid.invalid", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept-language": "zh-CN,zh;q=0.9",
      },
      data: "List-Unsubscribe=One-Click",
    });
    expect(zhInvalid.status()).toBe(404);
    expect(await zhInvalid.text()).toBe("退订链接无效");
  });
});
