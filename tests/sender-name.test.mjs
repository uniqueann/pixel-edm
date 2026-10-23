import test from "node:test";
import assert from "node:assert/strict";
import {
  isDefaultSenderName,
  memberProfile,
  senderNameDefault,
} from "../src/lib/sender-name.ts";

test("P0-3 对外署名：默认“店主”不预填 sender_name，真实署名原样使用", () => {
  assert.equal(isDefaultSenderName("店主"), true);
  assert.equal(isDefaultSenderName("  店主 "), true);
  assert.equal(isDefaultSenderName("Anna Chen"), false);
  assert.equal(isDefaultSenderName(undefined), false);
  assert.equal(senderNameDefault("店主"), "");
  assert.equal(senderNameDefault(" Anna Chen "), "Anna Chen");
});

test("P0-3 对外署名校验：拒绝空值、默认值和过长署名", () => {
  for (const value of ["", "   ", "店主", " 店主 ", "a".repeat(81)]) {
    assert.equal(
      memberProfile.safeParse({ display_name: value }).success,
      false,
      value,
    );
  }
  const ok = memberProfile.safeParse({ display_name: "  Anna Chen " });
  assert.equal(ok.success, true);
  assert.equal(ok.data.display_name, "Anna Chen");
});
