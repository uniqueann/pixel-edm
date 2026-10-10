import test from "node:test";
import assert from "node:assert/strict";
import {
  completeAuthCallback,
  planAuthCallback,
  safeAuthNext,
} from "../src/lib/supabase/auth-callback.ts";
import {
  authCallbackUrl,
  passwordRecoveryRedirectUrl,
} from "../src/lib/supabase/config.ts";

const origin = "https://edm.contentup.cc";
process.env.NEXT_PUBLIC_SITE_URL = origin;

function sameOrigin(path) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  return url;
}

test("注册确认与重置密码用 token_hash 在本站建立会话", async () => {
  const calls = [];
  const auth = {
    async verifyOtp(params) {
      calls.push(["verify", params]);
      return { error: null };
    },
    async exchangeCodeForSession(code) {
      calls.push(["code", code]);
      return { error: null };
    },
  };

  const signup = planAuthCallback({
    code: null,
    tokenHash: " pkce_signup ",
    type: " email ",
    next: null,
  });
  assert.deepEqual(signup, {
    kind: "otp",
    type: "email",
    tokenHash: "pkce_signup",
    destination: "/onboarding",
  });
  assert.equal(await completeAuthCallback(signup, auth), "/onboarding");

  const typedSignup = planAuthCallback({
    code: "should-not-run",
    tokenHash: "hash-signup",
    type: "signup",
    next: "/invite/abc_DEF-01",
  });
  assert.equal(typedSignup.destination, "/invite/abc_DEF-01");
  assert.equal(
    await completeAuthCallback(typedSignup, auth),
    "/invite/abc_DEF-01",
  );

  const recovery = planAuthCallback({
    code: "should-not-run",
    tokenHash: "hash-recovery",
    type: "recovery",
    next: "https://evil.example/phish",
  });
  assert.equal(recovery.destination, "/reset-password");
  assert.equal(await completeAuthCallback(recovery, auth), "/reset-password");

  assert.deepEqual(
    calls.map(([name]) => name),
    ["verify", "verify", "verify"],
  );
  assert.deepEqual(calls[0][1], {
    type: "email",
    token_hash: "pkce_signup",
  });
  assert.deepEqual(calls[2][1], {
    type: "recovery",
    token_hash: "hash-recovery",
  });
  for (const path of ["/onboarding", "/invite/abc_DEF-01", "/reset-password"]) {
    sameOrigin(path);
  }
});

test("token_hash 校验失败进入登录错误页，且不改走 code", async () => {
  const calls = [];
  const auth = {
    async verifyOtp() {
      calls.push("verify");
      return { error: { message: "expired" } };
    },
    async exchangeCodeForSession() {
      calls.push("code");
      return { error: null };
    },
  };
  const plan = planAuthCallback({
    code: "oauth-code",
    tokenHash: "used-once",
    type: "email",
    next: "/onboarding",
  });
  assert.equal(await completeAuthCallback(plan, auth), "/login?error=callback");
  assert.deepEqual(calls, ["verify"]);
  sameOrigin("/login?error=callback");
});

test("Google 与仍使用 code 的邮件模板保持原跳转", async () => {
  const calls = [];
  const auth = {
    async verifyOtp() {
      calls.push("verify");
      return { error: null };
    },
    async exchangeCodeForSession(code) {
      calls.push(code);
      return { error: null };
    },
  };

  const google = planAuthCallback({
    code: "google-code",
    tokenHash: null,
    type: null,
    next: null,
  });
  assert.equal(google.kind, "code");
  assert.equal(await completeAuthCallback(google, auth), "/onboarding");

  const invite = planAuthCallback({
    code: "invite-code",
    tokenHash: null,
    type: "invite",
    next: "/invite/token",
  });
  assert.equal(await completeAuthCallback(invite, auth), "/invite/token");

  const magic = planAuthCallback({
    code: "magic-code",
    tokenHash: "ignored-without-email-type",
    type: "magiclink",
    next: "/reset-password",
  });
  assert.equal(magic.kind, "code");
  assert.equal(await completeAuthCallback(magic, auth), "/reset-password");

  const emailChange = planAuthCallback({
    code: "change-code",
    tokenHash: null,
    type: "email_change",
    next: "/dashboard",
  });
  assert.equal(await completeAuthCallback(emailChange, auth), "/onboarding");

  assert.deepEqual(calls, [
    "google-code",
    "invite-code",
    "magic-code",
    "change-code",
  ]);
});

test("code 交换失败或缺少参数时回到登录错误页", async () => {
  const plan = planAuthCallback({
    code: "bad-code",
    tokenHash: null,
    type: null,
    next: "/invite/ok",
  });
  assert.equal(
    await completeAuthCallback(plan, {
      async verifyOtp() {
        throw new Error("不应调用");
      },
      async exchangeCodeForSession() {
        return { error: { message: "invalid" } };
      },
    }),
    "/login?error=callback",
  );
  assert.deepEqual(
    planAuthCallback({
      code: null,
      tokenHash: null,
      type: "email",
      next: "/invite/ok",
    }),
    { kind: "error" },
  );
  assert.deepEqual(
    planAuthCallback({
      code: "",
      tokenHash: "   ",
      type: "recovery",
      next: null,
    }),
    { kind: "error" },
  );
});

test("next 只允许重置密码和邀请路径", () => {
  assert.equal(safeAuthNext(null), "/onboarding");
  assert.equal(safeAuthNext(""), "/onboarding");
  assert.equal(safeAuthNext("/onboarding"), "/onboarding");
  assert.equal(safeAuthNext("/reset-password"), "/reset-password");
  assert.equal(safeAuthNext("/reset-password/extra"), "/onboarding");
  assert.equal(safeAuthNext("/invite/abc"), "/invite/abc");
  assert.equal(safeAuthNext("/invite"), "/onboarding");
  for (const blocked of [
    "//evil.com",
    "https://evil.example",
    "https://edm.contentup.cc.evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
    "https://contentup.cc/account",
  ]) {
    assert.equal(safeAuthNext(blocked), "/onboarding");
    assert.equal(
      planAuthCallback({
        code: null,
        tokenHash: "hash",
        type: "email",
        next: blocked,
      }).destination,
      "/onboarding",
    );
    assert.equal(
      planAuthCallback({
        code: null,
        tokenHash: "hash",
        type: "recovery",
        next: blocked,
      }).destination,
      "/reset-password",
    );
  }
});

test("注册与重置密码的邮件回跳落在本站 /auth/callback", () => {
  assert.equal(authCallbackUrl(), `${origin}/auth/callback`);
  assert.equal(authCallbackUrl("/onboarding"), `${origin}/auth/callback`);
  assert.equal(authCallbackUrl("/dashboard"), `${origin}/auth/callback`);
  assert.equal(authCallbackUrl("//evil.com"), `${origin}/auth/callback`);
  assert.equal(
    authCallbackUrl("https://contentup.cc/account"),
    `${origin}/auth/callback`,
  );
  assert.equal(
    authCallbackUrl("/invite/abc"),
    `${origin}/auth/callback?next=%2Finvite%2Fabc`,
  );
  assert.equal(
    passwordRecoveryRedirectUrl(),
    `${origin}/auth/callback?next=/reset-password`,
  );
  assert.equal(
    new URL(passwordRecoveryRedirectUrl()).searchParams.get("next"),
    "/reset-password",
  );
});
