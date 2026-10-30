import test from "node:test";
import assert from "node:assert/strict";
import {
  countDedupedValidEmails,
  dedupeImportMessages,
  normalizeImportRows,
} from "../src/features/contacts/import-model.ts";
import { parseImportText } from "../src/features/contacts/import-parser.ts";
import {
  displayedImportResult,
  importRowExplanation,
} from "../src/features/contacts/import-presentation.ts";

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

test("CSV逐行状态与空授权列优先于批量默认，错误记录单独保留", () => {
  const parsed = parseImportText(
    [
      "\uFEFF邮箱,姓名,订阅状态,同意来源,授权说明,未识别列",
      'a@example.test,"张,三",未确认,,,忽略',
      "b@example.test,缺少证据,已订阅,,,忽略",
    ].join("\r\n"),
    { sourceType: "csv", delimiter: "" },
  );
  assert.equal(parsed.rows[0].name, "张,三");
  assert.deepEqual(parsed.warnings, ["已忽略未知列：未识别列"]);
  const normalized = normalizeImportRows(parsed.rows, {
    consent_declared: true,
    consent_source: "批量来源",
    consent_note: "批量证据",
    consent_at: "",
  });
  assert.equal(normalized[0].requested_status, "unconfirmed");
  assert.equal(normalized[0].validation_error, "");
  assert.equal(normalized[1].requested_status, "subscribed");
  assert.equal(
    normalized[1].validation_error,
    "已订阅记录必须提供同意来源和证据说明",
  );
});

test("原有大小、行数、表头及去重合并规则保持一致", () => {
  assert.throws(
    () =>
      parseImportText("x".repeat(2 * 1024 * 1024 + 1), {
        sourceType: "paste",
        delimiter: "",
      }),
    /2 MiB/,
  );
  assert.throws(
    () =>
      parseImportText(
        "邮箱\n" +
          Array.from({ length: 1001 }, (_, i) => `${i}@example.test`).join(
            "\n",
          ),
        { sourceType: "csv", delimiter: "" },
      ),
    /1000 行/,
  );
  assert.throws(
    () =>
      parseImportText("a@example.test,客户", {
        sourceType: "csv",
        delimiter: "",
      }),
    /表头/,
  );
  const { rows } = parseImportText(
    "邮箱,姓名,标签\nA@example.test,,VIP\na@example.test,补全姓名,vip|老客\nbad,错误行,",
    { sourceType: "paste", delimiter: "" },
  );
  const normalized = normalizeImportRows(rows, {
    consent_declared: false,
    consent_source: "",
    consent_note: "",
    consent_at: "",
  });
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0].source_rows, [2, 3]);
  assert.equal(normalized[0].name, "补全姓名");
  assert.deepEqual(normalized[0].tags, ["VIP", "老客"]);
  assert.equal(normalized[1].validation_error, "邮箱格式无效");
});

test("待处理只展示预检判断，防打扰说明不声称跳过所有资料更新", () => {
  const row = { result: "pending", preview_result: "suppressed_protected" };
  assert.equal(displayedImportResult(row), "suppressed_protected");
  assert.match(importRowExplanation(row), /不会恢复订阅/);
  assert.match(importRowExplanation(row), /资料仍按现有规则补全/);
  assert.equal(
    displayedImportResult({ result: "error", preview_result: "new" }),
    "error",
  );
});

test("去重后有效邮箱数不计入格式无效地址", () => {
  const rows = [
    { email: "a@example.test", message: "" },
    { email: "b@example.test", message: "" },
    { email: "格式无效", message: "邮箱格式无效；邮箱格式无效" },
  ];
  assert.equal(countDedupedValidEmails(rows), 2);
});

test("格式有效但字段出错的重复邮箱不会被重复计数", () => {
  assert.equal(
    countDedupedValidEmails([
      { email: "A@example.test", message: "姓名最多 100 字" },
      { email: "a@example.test", message: "订阅状态无法识别" },
      { email: "b@example.test", validation_error: "" },
      { email: "bad", validation_error: "邮箱格式无效" },
    ]),
    2,
  );
});
