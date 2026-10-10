import { expect, test, type APIRequestContext } from "@playwright/test";

async function callbackLocation(request: APIRequestContext, search: string) {
  const response = await request.get(`/auth/callback?${search}`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  return new URL(response.headers().location ?? "http://invalid.local");
}

test("邮件链接在本站完成验证，code 分支仍回到登录错误", async ({
  page,
  request,
}) => {
  await page.goto("/auth/callback?token_hash=nope&type=email");
  await expect(page).toHaveURL(/\/login\?error=callback$/);
  await expect(
    page.getByText("验证链接无效或已过期，请重新登录或申请邮件。"),
  ).toBeVisible();

  await page.goto("/auth/callback?token_hash=valid-email&type=email");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "我的邮局", exact: true }),
  ).toBeVisible();

  const recovery = await callbackLocation(
    request,
    `token_hash=valid-recovery&type=recovery&next=${encodeURIComponent("/invite/should-not-win")}`,
  );
  expect(recovery.pathname).toBe("/reset-password");

  const signupInvite = await callbackLocation(
    request,
    `token_hash=valid-email&type=signup&next=${encodeURIComponent("/invite/abc")}`,
  );
  expect(signupInvite.pathname).toBe("/invite/abc");

  const blocked = await callbackLocation(
    request,
    `token_hash=valid-email&type=email&next=${encodeURIComponent("//evil.com")}`,
  );
  expect(blocked.origin).toBe("http://localhost:3100");
  expect(blocked.pathname).toBe("/onboarding");

  const code = await callbackLocation(
    request,
    `code=google-code&next=${encodeURIComponent("/invite/abc")}`,
  );
  expect(code.pathname).toBe("/login");
  expect(code.searchParams.get("error")).toBe("callback");
});
