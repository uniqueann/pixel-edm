import test from "node:test";
import assert from "node:assert/strict";
import {
  describeDeliveryProviderError,
  deliveryProviderErrorToast,
} from "../src/lib/delivery-provider-error.ts";

test("鉴权类错误码映射为中文主文案", () => {
  const copy = describeDeliveryProviderError({
    error_category: "authentication",
    error_code: "HTTP_403",
  });
  assert.match(copy.message, /鉴权失败/);
  assert.match(copy.hint ?? "", /AccessKey/);
  assert.match(copy.debugDetail, /authentication/);
  assert.match(copy.debugDetail, /HTTP_403/);
});

test("发件域名未验证类错误码", () => {
  const copy = describeDeliveryProviderError({
    error_category: "configuration",
    error_code: "MailFromDomainNotVerifiedException",
  });
  assert.match(copy.message, /域名/);
  assert.match(copy.hint ?? "", /控制台/);
});

test("配额与区域类错误", () => {
  const quota = describeDeliveryProviderError({
    error_category: "rate_limit",
    error_code: "Throttling",
  });
  assert.match(quota.message, /配额|频率/);

  const region = describeDeliveryProviderError({
    error_category: "configuration",
    error_code: "INVALID_REGION_ENDPOINT",
  });
  assert.match(region.message, /区域|端点/);
});

test("平台内置错误码", () => {
  const unsupported = describeDeliveryProviderError({
    error_category: "configuration",
    error_code: "DELIVERY_PROVIDER_UNSUPPORTED",
  });
  assert.match(unsupported.message, /不支持发送/);

  const changed = describeDeliveryProviderError({
    error_category: "configuration",
    error_code: "CHANNEL_CONFIGURATION_CHANGED",
  });
  assert.match(changed.message, /配置已变更/);
});

test("未知错误码保留技术详情并提供兜底文案", () => {
  const copy = describeDeliveryProviderError({
    error_category: "unknown",
    error_code: "VENDOR_XYZ_999",
  });
  assert.match(copy.message, /未识别|待确认/);
  assert.match(copy.debugDetail, /VENDOR_XYZ_999/);
});

test("toast 文案不把英文 category 当作标题", () => {
  const toast = deliveryProviderErrorToast({
    error_category: "authentication",
    error_code: "HTTP_401",
  });
  assert.doesNotMatch(toast.title, /^authentication/i);
  assert.match(toast.description ?? "", /技术信息：/);
});
