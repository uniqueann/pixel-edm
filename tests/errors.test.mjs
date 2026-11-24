import test from "node:test";
import assert from "node:assert/strict";
import {
  AppError,
  getAppErrorCode,
  isExposableAppError,
  mapChannelActionError,
  mapDatabaseError,
  mapTeamActionError,
  resolveErrorText,
} from "../src/lib/errors.ts";
import {
  configBlockedDiscountCheck,
  isBillingConfigMissingError,
} from "../src/lib/billing/discount-availability.ts";
import { getDodoApiKey } from "../src/lib/billing/dodo.ts";
import { parseImportText } from "../src/features/contacts/import-parser.ts";
import {
  isInvalidEmailImportMessage,
  parseImportMessageParts,
} from "../src/features/contacts/import-model.ts";
import { activityFilterMeta } from "../src/features/audit/model.ts";

test("AppError 与 duck-typed 错误协议可稳定识别可展示错误", () => {
  const exposed = new AppError("errors.team.adminOnly");
  assert.equal(isExposableAppError(exposed), true);
  assert.equal(getAppErrorCode(exposed), "errors.team.adminOnly");
  assert.equal(
    resolveErrorText(exposed.toPayload()),
    "只有管理员可以管理团队。",
  );

  const hidden = new AppError(
    "errors.billing.configMissing",
    "secret missing",
    undefined,
    false,
  );
  assert.equal(isExposableAppError(hidden), false);
  assert.equal(isExposableAppError(new TypeError("Failed to fetch")), false);

  // parseImportText 抛出的业务校验错误带有可展示错误码
  assert.throws(
    () => parseImportText("", { sourceType: "paste", delimiter: "" }),
    (error) =>
      isExposableAppError(error) &&
      getAppErrorCode(error) === "errors.import.empty",
  );
});

test("数据库错误与团队/通道错误前缀正确映射为结构化错误码", () => {
  const dup = mapDatabaseError({ code: "23505" }, "errors.common.saveFailed", {
    uniqueViolationCode: "errors.contacts.duplicateEmail",
  });
  assert.equal(dup.code, "errors.contacts.duplicateEmail");

  const conflict = mapDatabaseError({
    code: "P0001",
    message: "客户已被其他人修改，请重新加载后重试。",
  });
  assert.equal(conflict.code, "errors.db.versionConflict");

  const teamErr = mapTeamActionError(new Error("该邮箱已是工作区成员。"));
  assert.equal(teamErr.errorCode, "errors.team.alreadyMember");
  assert.equal(teamErr.error, "该邮箱已是工作区成员。");

  const teamFallback = mapTeamActionError(new Error("unexpected internal bug"));
  assert.equal(teamFallback.errorCode, "errors.team.actionFailed");

  const channelErr = mapChannelActionError(
    new Error("测试发送过于频繁，请稍后再试。"),
  );
  assert.equal(channelErr.errorCode, "errors.channels.testRateLimited");
});

test("resolveErrorText 优先调用外部翻译器并在缺省时回退", () => {
  const text = resolveErrorText(
    {
      code: "errors.billing.discountSavings",
      params: { percent: "15" },
    },
    (code, params) =>
      code === "errors.billing.discountSavings"
        ? `Awesome! You saved ${params?.percent}%!`
        : undefined,
  );
  assert.equal(text, "Awesome! You saved 15%!");
});

test("计费配置缺失通过结构化错误码识别，不依赖中文子串", () => {
  const prev = process.env.DODO_PAYMENTS_API_KEY;
  delete process.env.DODO_PAYMENTS_API_KEY;
  try {
    let caught;
    try {
      getDodoApiKey();
    } catch (error) {
      caught = error;
    }
    assert.equal(isBillingConfigMissingError(caught), true);
    const check = configBlockedDiscountCheck(caught);
    assert.equal(check.available, false);
    assert.equal(check.messageCode, "errors.billing.configMissing");
  } finally {
    if (prev !== undefined) process.env.DODO_PAYMENTS_API_KEY = prev;
  }
});

test("导入消息结构化解析与操作日志结构化分组不依赖中文切割", () => {
  const parts = parseImportMessageParts(
    "邮箱格式无效；姓名最多 100 字;errors.import.invalidEmail",
  );
  assert.equal(parts.length, 2);
  assert.equal(parts[0].code, "errors.import.invalidEmail");
  assert.equal(isInvalidEmailImportMessage("errors.import.invalidEmail"), true);

  const meta = activityFilterMeta("template.created");
  assert.equal(meta.group, "template");
  assert.equal(meta.groupLabel, "模板");
  assert.equal(meta.shortLabel, "新建");
});
