import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBusinessDateTime,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
} from "../src/i18n/format.ts";

test("formatNumber 与 formatCurrency 按 locale 格式化", () => {
  assert.equal(formatNumber(12345, "zh-CN"), "12,345");
  assert.equal(formatNumber(12345, "en"), "12,345");
  assert.match(formatCurrency(29.9, "en"), /\$29\.90/);
  assert.match(formatCurrency(29.9, "zh-CN"), /29\.90/);
});

test("formatDate / formatDateTime / formatBusinessDateTime 处理有效与无效输入", () => {
  const iso = "2026-09-22T00:00:00Z";
  assert.ok(formatDate(iso, "zh-CN").includes("2026"));
  assert.ok(formatDate(iso, "en").includes("2026"));
  assert.ok(formatDateTime(iso, "en", { timeZone: "UTC" }).includes("2026"));
  // UTC 00:00 对应北京时间 08:00
  assert.match(formatBusinessDateTime(iso, "zh-CN"), /08:00/);
  assert.equal(formatDate("invalid-date", "zh-CN"), "invalid-date");
  assert.equal(formatDate(null, "zh-CN"), "");
});
