// 统一表单与 zod 校验错误码字典与解析器（零 Next.js 依赖，供服务端、客户端与纯 Node 单测共用）。

export type ValidationParams = Record<string, string | number>;

export type ValidationTranslator = (
  code: string,
  params?: ValidationParams,
) => string | undefined;

export const DEFAULT_ZH_VALIDATION_MESSAGES: Record<string, string> = {
  // 工作区与认证
  "validation.workspaceNameRequired": "请填写工作区名称",
  "validation.workspaceNameTooLong": "名称不能超过 80 字",
  "validation.mailingAddressTooLong": "地址不能超过 500 字",
  "validation.mailingAddressRequired": "请填写邮件页脚实体地址",
  "validation.mailingAddressNoEmail":
    "邮箱不能代替实体地址，请填写街道和门牌号",
  "validation.mailingAddressNoUrl": "网址不能代替实体地址，请填写街道和门牌号",
  "validation.mailingAddressPlaceholder":
    "这看起来是占位文本，请填写可以收信的真实地址（如街道、门牌号、城市）",
  "validation.mailingAddressNoNumbersOnly":
    "不能只填电话或数字，请填写街道和门牌号",
  "validation.mailingAddressTooShort": "地址过短，请至少写到街道和门牌号",
  "validation.emailInvalid": "请输入有效邮箱",
  "validation.passwordRequired": "请输入密码",
  "validation.passwordTooShort": "密码至少 8 位",
  "validation.passwordTooLong": "密码过长",

  // 对外署名
  "validation.senderNameRequired": "请填写对外署名",
  "validation.senderNameTooLong": "署名不能超过 80 字",
  "validation.senderNameDefaultForbidden":
    "请填写真实姓名或品牌名，不能使用默认的“店主”",

  // 客户与导入
  "validation.contactNameTooLong": "姓名最多 100 字",
  "validation.contactTagTooLong": "标签最多 30 字",
  "validation.contactTagsTooMany": "每位客户最多 20 个标签",
  "validation.consentSourceTooLong": "同意来源最多 100 字",
  "validation.consentNoteTooLong": "授权说明最多 500 字",
  "validation.consentRequired": "声明订阅同意时必须填写同意来源和授权说明",
  "validation.unsubscribeReasonRequired": "请填写退订原因",
  "validation.importSourceNameRequired": "请填写名单来源名称",
  "validation.importEmpty": "名单中没有数据",
  "validation.importTooManyRows": "每次最多导入 1000 行",

  // 模板
  "validation.templateNameRequired": "请输入模板名称",
  "validation.templateCategoryRequired": "请输入分类",
  "validation.templateSubjectRequired": "请输入邮件主题",
  "validation.templateSubjectNoNewline": "邮件主题不能换行",
  "validation.templateBodyRequired": "请输入邮件正文",
  "validation.templateBodyTooLong": "邮件正文最多 20000 字",
  "validation.templateVariableSyntaxInvalid": "变量“{raw}”语法无效",
  "validation.templateVariableUnknown": "未知变量 {{key}}",
  "validation.templateUnclosedBraces": "存在未闭合的双花括号",

  // 活动
  "validation.campaignStoreNameTooLong": "店铺名称最多 200 字",
  "validation.campaignSenderNameTooLong": "发件人最多 200 字",
  "validation.campaignDiscountTooLong": "优惠信息最多 200 字",
  "validation.campaignProductTooLong": "商品名称最多 200 字",
  "validation.campaignOrderNumberTooLong": "订单号最多 200 字",
  "validation.campaignUnknownVariables": "活动包含未知变量",
  "validation.campaignNameRequired": "请输入活动名称",
  "validation.campaignTemplateInvalid": "请选择有效模板",
  "validation.campaignTagInvalid": "请选择有效标签",
  "validation.campaignVersionRequired": "缺少活动版本，请重新加载后重试",
  "validation.campaignAllAudienceNoTag": "全部客户活动不能指定标签",
  "validation.campaignTagRequired": "请选择客户标签",

  // 发信通道与追踪
  "validation.channelRegionRequired": "请输入区域",
  "validation.channelSenderAddressInvalid": "发件地址格式无效",
  "validation.channelSenderAliasRequired": "请输入发件人名称",
  "validation.channelSenderAliasTooLong": "发件人名称最多 {max} 个字符",
  "validation.channelReplyToInvalid": "回复地址格式无效",
  "validation.channelVersionRequired": "缺少通道版本，请重新加载后重试",
  "validation.channelAliyunRegionInvalid": "阿里云区域无效",
  "validation.channelSendgridRegionInvalid": "SendGrid 数据中心无效",
  "validation.channelAwsRegionInvalid": "AWS 区域格式无效",
  "validation.channelSenderDomainRequired": "请输入发件域名",
  "validation.channelSenderDomainInvalid": "发件域名格式无效",
  "validation.channelSenderDomainMismatch": "发件地址必须属于所填发件域名",
  "validation.channelSnsTopicInvalid": "SNS Topic ARN 格式无效",
  "validation.channelSendgridKeyRequired": "首次连接必须填写 SendGrid API Key",
  "validation.channelApiKeyTooShort": "API Key 长度无效",
  "validation.channelCredentialsPairRequired":
    "{label} ID 和 Secret 必须同时填写",
  "validation.channelCredentialsInitialRequired":
    "首次连接必须填写完整 {label}",
  "validation.channelAccessKeyIdTooShort": "访问密钥 ID 长度无效",
  "validation.channelAccessKeySecretTooShort": "访问密钥 Secret 长度无效",
  "validation.channelCredentialSecretBeforeConnect": "连接前请填写访问凭据",
  "validation.channelCredentialIdBeforeConnect": "连接前请填写访问密钥 ID",
  "validation.trackingAliyunTagRequired": "开启追踪前请填写阿里云标签",
  "validation.trackingAliyunTagInvalid": "阿里云标签仅支持字母、数字和下划线",
  "validation.trackingSesConfigSetRequired": "开启追踪前请填写 SES 配置集名称",
  "validation.trackingSesConfigSetInvalid":
    "SES 配置集名称仅支持 1 至 64 位字母、数字、下划线和连字符",
};

/**
 * 将带参数的校验错误码编码为单字符串，供静态 zod schema 的 message 携带。
 * 示例：encodeValidationIssue("validation.channelSenderAliasTooLong", { max: 14 })
 */
export function encodeValidationIssue(
  code: string,
  params?: ValidationParams,
): string {
  if (!params || Object.keys(params).length === 0) return code;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  return `${code}?${search.toString()}`;
}

export function parseValidationIssue(
  raw: string | null | undefined,
): { code: string; params?: ValidationParams } | null {
  if (!raw || !raw.startsWith("validation.")) return null;
  const queryIndex = raw.indexOf("?");
  if (queryIndex === -1) return { code: raw };
  const code = raw.slice(0, queryIndex);
  const search = new URLSearchParams(raw.slice(queryIndex + 1));
  const params: ValidationParams = {};
  for (const [key, value] of search.entries()) {
    params[key] = value;
  }
  return { code, params };
}

function formatTemplate(
  code: string,
  template: string,
  params?: ValidationParams,
) {
  if (code === "validation.templateVariableUnknown" && params?.key) {
    return `未知变量 {{${params.key}}}`;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

/**
 * 在展示层或 Server Action 返回层把 zod 错误码 key 解析为可读文案。
 * 未匹配到 validation.* 编码的存量字符串将原样返回，保证渐进迁移安全。
 */
export function resolveValidationMessage(
  raw: string | null | undefined,
  translator?: ValidationTranslator,
  fallback?: string,
): string {
  if (!raw) return fallback ?? "";
  const parsed = parseValidationIssue(raw);
  if (!parsed) return raw;
  if (translator) {
    const translated = translator(parsed.code, parsed.params);
    if (translated) return translated;
  }
  const zhTemplate = DEFAULT_ZH_VALIDATION_MESSAGES[parsed.code];
  if (!zhTemplate) return fallback ?? raw;
  return formatTemplate(parsed.code, zhTemplate, parsed.params);
}
