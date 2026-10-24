/** 将发信服务商 error_category / error_code 转为用户可读中文，原始码供排障折叠展示。 */

export type DeliveryProviderErrorInput = {
  error_category?: string | null;
  error_code?: string | null;
};

export type DeliveryProviderErrorCopy = {
  message: string;
  hint?: string;
  /** 折叠区展示，如 authentication · HTTP_403 */
  debugDetail: string;
};

type CodeRule = {
  test: (normalizedCode: string) => boolean;
  message: string;
  hint?: string;
};

const CATEGORY_COPY: Record<string, { message: string; hint?: string }> = {
  authentication: {
    message: "访问密钥或 API 鉴权失败",
    hint: "请核对 AccessKey / Secret、SendGrid API Key 等凭据是否准确且未过期。",
  },
  configuration: {
    message: "发信通道配置有误",
    hint: "请核对发件地址、域名验证、区域/数据中心与服务商控制台设置是否一致。",
  },
  rate_limit: {
    message: "发送配额或频率已达上限",
    hint: "请稍后再试，或在服务商控制台提升配额、降低发送频率。",
  },
  temporary: {
    message: "发信服务商暂时不可用",
    hint: "多为短暂故障，请稍后重试；若持续失败请查看服务商状态页。",
  },
  permanent: {
    message: "邮件被收件方或服务商永久拒收",
    hint: "请核对收件地址、内容与发信域名信誉；必要时在服务商控制台查看退信原因。",
  },
  unknown: {
    message: "发送失败，原因待确认",
    hint: "请展开下方技术详情，或在发信服务商控制台查询回执与日志。",
  },
};

const CODE_RULES: CodeRule[] = [
  {
    test: (code) => code === "delivery_provider_unsupported",
    message: "当前发信通道类型暂不支持发送",
    hint: "请在设置中更换已支持的通道，或联系管理员升级配置。",
  },
  {
    test: (code) => code === "channel_configuration_changed",
    message: "测试期间通道配置已变更",
    hint: "请确认当前表单已保存后，重新发起测试发送。",
  },
  {
    test: (code) => code === "delivery_task_not_matched",
    message: "未能匹配到对应的发送任务",
    hint: "多为回执延迟或任务已归档，请刷新发送明细后重试。",
  },
  {
    test: (code) =>
      /invalidaccesskey|unauthorized|forbidden|http_401|http_403|unrecognizedclient|invalidsignature|accessdenied|expiredtoken|credentialprovider/.test(
        code,
      ),
    message: "访问密钥或 API 鉴权失败",
    hint: "请核对 AccessKey / Secret、SendGrid API Key 等凭据是否准确且未过期。",
  },
  {
    test: (code) =>
      /mailfromdomainnotverified|sender|mailfrom|domain.*verif|accountsuspended|sendingpaused/.test(
        code,
      ),
    message: "发件地址或域名尚未通过验证",
    hint: "请在发信服务商控制台完成域名或发件人验证后再试。",
  },
  {
    test: (code) =>
      /region|endpoint|datacenter|sendgrid_api_host|directmail.*region/.test(
        code,
      ),
    message: "通道区域或服务端点配置不符",
    hint: "请确认 DirectMail 区域、Amazon SES 区域或 SendGrid 数据中心与控制台一致。",
  },
  {
    test: (code) =>
      /quota|limitexceeded|throttl|ratelimit|http_429|toomanyrequests|frequency/.test(
        code,
      ),
    message: "发送配额或频率已达上限",
    hint: "请稍后再试，或在服务商控制台提升配额、降低发送频率。",
  },
  {
    test: (code) =>
      /credential_keyring|credential_decrypt|credential_payload|credential_version/.test(
        code,
      ),
    message: "服务器暂无法解密通道凭据",
    hint: "请联系管理员检查凭据加密密钥（CREDENTIAL_KEYRING）配置。",
  },
  {
    test: (code) =>
      code === "network_boundary" ||
      /timeout|network|socket|connection|abort|requestaborted/.test(code),
    message: "连接发信服务商时网络异常",
    hint: "请稍后重试；若持续失败，请检查服务器出站网络或防火墙策略。",
  },
  {
    test: (code) => /http_5|serviceunavailable|internal|temporar/.test(code),
    message: "发信服务商暂时不可用",
    hint: "请稍后重试；若持续失败请查看服务商状态页或工单。",
  },
];

function buildDebugDetail(
  category?: string | null,
  code?: string | null,
): string {
  const parts: string[] = [];
  const trimmedCategory = category?.trim();
  const trimmedCode = code?.trim();
  if (trimmedCategory) parts.push(trimmedCategory);
  if (trimmedCode) parts.push(trimmedCode);
  return parts.length > 0 ? parts.join(" · ") : "UNKNOWN";
}

function matchCodeRule(normalizedCode: string): CodeRule | undefined {
  if (!normalizedCode) return undefined;
  return CODE_RULES.find((rule) => rule.test(normalizedCode));
}

export function describeDeliveryProviderError(
  input: DeliveryProviderErrorInput,
): DeliveryProviderErrorCopy {
  const debugDetail = buildDebugDetail(input.error_category, input.error_code);
  const normalizedCode = (input.error_code ?? "").trim().toLowerCase();
  const normalizedCategory = (input.error_category ?? "").trim().toLowerCase();

  const codeRule = matchCodeRule(normalizedCode);
  if (codeRule) {
    return {
      message: codeRule.message,
      hint: codeRule.hint,
      debugDetail,
    };
  }

  if (normalizedCategory && CATEGORY_COPY[normalizedCategory]) {
    const copy = CATEGORY_COPY[normalizedCategory];
    return {
      message: copy.message,
      hint: copy.hint,
      debugDetail,
    };
  }

  if (normalizedCode) {
    return {
      message: "发送失败，服务商返回未识别的错误",
      hint: "请展开技术详情查看原始错误码，或在服务商控制台查询对应回执。",
      debugDetail,
    };
  }

  return {
    message: CATEGORY_COPY.unknown.message,
    hint: CATEGORY_COPY.unknown.hint,
    debugDetail,
  };
}

/** 测试发信 / 活动明细等处 toast 用的标题与描述。 */
export function deliveryProviderErrorToast(input: DeliveryProviderErrorInput): {
  title: string;
  description?: string;
} {
  const copy = describeDeliveryProviderError(input);
  const descriptionParts: string[] = [];
  if (copy.hint) descriptionParts.push(copy.hint);
  if (copy.debugDetail && copy.debugDetail !== "UNKNOWN") {
    descriptionParts.push(`技术信息：${copy.debugDetail}`);
  }
  return {
    title: copy.message,
    description:
      descriptionParts.length > 0 ? descriptionParts.join("\n") : undefined,
  };
}
