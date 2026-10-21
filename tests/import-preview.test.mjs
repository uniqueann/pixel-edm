import test from "node:test";
import assert from "node:assert/strict";
import {
  countDedupedValidEmails,
  dedupeImportMessages,
} from "../src/features/contacts/import-model.ts";

test("预检说明重复的邮箱格式错误只保留一句", () => {
  assert.equal(
    dedupeImportMessages("邮箱格式无效；邮箱格式无效"),
    "邮箱格式无效",
  );
  assert.equal(
    dedupeImportMessages("姓名最多 100 字；邮箱格式无效；邮箱格式无效"),
    "姓名最多 100 字；邮箱格式无效",
  );
});

test("去重后有效邮箱数不计入格式无效地址", () => {
  const rows = [
    { message: "" },
    { message: "" },
    { message: "邮箱格式无效；邮箱格式无效" },
  ];
  assert.equal(countDedupedValidEmails(rows), 2);
});
