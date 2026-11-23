import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeValidationIssue,
  parseValidationIssue,
  resolveValidationMessage,
} from "../src/lib/validation-messages.ts";
import { mailingAddressProblemCode } from "../src/lib/mailing-address.ts";
import { memberProfile } from "../src/lib/sender-name.ts";
import { contactInput } from "../src/features/contacts/model.ts";
import { templateInput } from "../src/features/templates/model.ts";
import { campaignInput } from "../src/features/campaigns/model.ts";
import { importRequestSchema } from "../src/features/contacts/import-model.ts";

test("encodeValidationIssue 与 resolveValidationMessage 支持静态与带参数错误码", () => {
  const encoded = encodeValidationIssue(
    "validation.channelSenderAliasTooLong",
    {
      max: 14,
    },
  );
  assert.deepEqual(parseValidationIssue(encoded), {
    code: "validation.channelSenderAliasTooLong",
    params: { max: "14" },
  });
  assert.equal(resolveValidationMessage(encoded), "发件人名称最多 14 个字符");
  assert.equal(
    resolveValidationMessage(encoded, (code, params) =>
      code === "validation.channelSenderAliasTooLong"
        ? `Max ${params?.max} chars`
        : undefined,
    ),
    "Max 14 chars",
  );
  // 存量非 key 文案原样兜底
  assert.equal(resolveValidationMessage("历史错误提示"), "历史错误提示");
});

test("各核心 zod schema 均输出稳定 validation.* 错误码并可解析为中文文案", () => {
  assert.equal(
    mailingAddressProblemCode(""),
    "validation.mailingAddressRequired",
  );

  const senderErr = memberProfile.safeParse({ display_name: "店主" });
  assert.equal(senderErr.success, false);
  assert.equal(
    senderErr.error.issues[0].message,
    "validation.senderNameDefaultForbidden",
  );
  assert.match(
    resolveValidationMessage(senderErr.error.issues[0].message),
    /不能使用默认的“店主”/,
  );

  const contactErr = contactInput.safeParse({
    workspace_id: "10000000-0000-0000-0000-000000000001",
    email: "not-an-email",
    name: "",
    tags: [],
  });
  assert.equal(contactErr.success, false);
  assert.equal(contactErr.error.issues[0].message, "validation.emailInvalid");
  assert.equal(
    resolveValidationMessage(contactErr.error.issues[0].message),
    "请输入有效邮箱",
  );

  const templateErr = templateInput.safeParse({
    workspace_id: "10000000-0000-0000-0000-000000000001",
    name: "测试",
    category: "常规",
    subject: "Hi {{unknown_var}}",
    body: "Body",
  });
  assert.equal(templateErr.success, false);
  assert.equal(
    resolveValidationMessage(templateErr.error.issues[0].message),
    "未知变量 {{unknown_var}}",
  );

  const campaignErr = campaignInput.safeParse({
    workspace_id: "10000000-0000-0000-0000-000000000001",
    name: "",
    template_id: "10000000-0000-0000-0000-000000000002",
    audience_type: "all",
    variables: {},
  });
  assert.equal(campaignErr.success, false);
  assert.equal(
    campaignErr.error.issues[0].message,
    "validation.campaignNameRequired",
  );

  const importErr = importRequestSchema.safeParse({
    workspace_id: "10000000-0000-0000-0000-000000000001",
    source_type: "paste",
    source_name: "",
    consent_declared: false,
    rows: [],
  });
  assert.equal(importErr.success, false);
  assert.equal(
    importErr.error.issues[0].message,
    "validation.importSourceNameRequired",
  );
});
