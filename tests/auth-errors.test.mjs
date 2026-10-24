import assert from "node:assert/strict";
import test from "node:test";
import { mapAuthError } from "../src/lib/auth-errors.ts";

test("mapAuthError 映射常见 Supabase 错误码", () => {
  assert.equal(
    mapAuthError({ code: "invalid_credentials" }).message,
    "邮箱或密码不正确，请检查后重试。",
  );
  assert.equal(
    mapAuthError({ code: "email_not_confirmed" }).canResendVerification,
    true,
  );
  assert.equal(
    mapAuthError({ code: "over_request_rate_limit" }).message,
    "操作过于频繁，请稍后再试。",
  );
  assert.equal(mapAuthError({ code: "unknown" }).canResendVerification, false);
});
