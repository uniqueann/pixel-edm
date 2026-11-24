// 统一应用错误码与数据库/业务错误映射体系（不依赖 Next.js 运行时，可供服务端、客户端与纯 Node 单测共用）。

export type AppErrorParams = Record<string, string | number>;

export type AppErrorPayload = {
  code: string;
  params?: AppErrorParams;
  /** 缺省中文文案：用于 P0-a 过渡期与单测断言，接入 next-intl 后由展示层按 code 翻译。 */
  message?: string;
};

export type AppErrorTranslator = (
  code: string,
  params?: AppErrorParams,
) => string | undefined;

export type ActionErrorResponse = {
  error: string;
  errorCode: string;
  errorPayload: AppErrorPayload;
};

/** 带有稳定错误码与安全展示标记的业务错误。 */
export class AppError extends Error {
  readonly code: string;
  readonly params?: AppErrorParams;
  /** 是否允许将错误语义直接展示给终端用户（取代用中文正则过滤内部异常的做法）。 */
  readonly expose: boolean;

  constructor(
    code: string,
    message?: string,
    params?: AppErrorParams,
    expose = true,
  ) {
    super(message ?? formatErrorTemplate(code, params));
    this.name = "AppError";
    this.code = code;
    this.params = params;
    this.expose = expose;
  }

  toPayload(): AppErrorPayload {
    return {
      code: this.code,
      ...(this.params ? { params: this.params } : {}),
      message: this.message,
    };
  }
}

export type CodedError = Error & {
  code: string;
  params?: AppErrorParams;
  expose?: boolean;
};

export function isAppError(error: unknown): error is CodedError {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0;
}

export function isExposableAppError(error: unknown): error is CodedError {
  if (error instanceof AppError) return error.expose;
  return isAppError(error) && (error as { expose?: unknown }).expose === true;
}

export function getAppErrorCode(error: unknown): string | null {
  return isAppError(error) ? error.code : null;
}

/** 缺省中文错误词表（与后续 messages/zh-CN/errors.json 保持同构）。 */
export const DEFAULT_ZH_ERROR_MESSAGES: Record<string, string> = {
  // 通用与数据库错误
  "errors.common.unknown": "操作失败，请重试。",
  "errors.common.workspaceSwitched": "工作区已切换，请刷新后重试。",
  "errors.common.workspaceInvalid": "工作区无效。",
  "errors.common.permissionDenied": "没有执行此操作的权限。",
  "errors.common.saveFailed": "保存失败，请确认权限后重试。",
  "errors.db.uniqueViolation": "记录已存在，请检查后重试。",
  "errors.db.foreignKeyViolation": "关联记录不存在或已被删除。",
  "errors.db.valueTooLong": "输入内容过长，请精简后重试。",
  "errors.db.permissionDenied": "没有执行此操作的权限。",
  "errors.db.versionConflict": "记录已被其他人修改，请重新加载后再试。",

  // 客户与导入错误
  "errors.contacts.permissionDenied": "没有客户管理权限。",
  "errors.contacts.duplicateEmail":
    "该邮箱已存在；如已归档，请到已归档列表恢复。",
  "errors.contacts.unsubscribeFailed": "退订失败，请重试。",
  "errors.contacts.importPermissionDenied": "没有名单导入权限。",
  "errors.contacts.importConsentRequired":
    "声明订阅同意时必须填写来源和证据说明。",
  "errors.contacts.importInvalidFormat": "数据格式不正确，请检查后重试。",
  "errors.import.fileTooLarge": "文件或粘贴内容不能超过 2 MiB",
  "errors.import.csvTooLarge": "CSV 文件不能超过 2 MiB，请缩小后重新选择。",
  "errors.import.invalidEncoding": "文件编码无法识别，请另存为 UTF-8 CSV",
  "errors.import.empty": "名单中没有数据",
  "errors.import.tooManyRows": "每次最多导入 1000 行",
  "errors.import.missingEmailHeader": "CSV 必须包含 email 或 邮箱 表头",
  "errors.import.emptyRows": "名单中没有数据行",
  "errors.import.invalidEmail": "邮箱格式无效",

  // 团队管理错误
  "errors.team.actionFailed": "团队操作失败，请重试。",
  "errors.team.adminOnly": "只有管理员可以管理团队。",
  "errors.team.alreadyMember": "该邮箱已是工作区成员。",
  "errors.team.pendingInvitation": "该邮箱已有待处理邀请。",
  "errors.team.invalidEmail": "邮箱格式无效。",
  "errors.team.invitationExpired": "邀请已过期。",
  "errors.team.invitationUnavailable": "该邀请已无法操作。",
  "errors.team.invitationNotFound": "邀请不存在。",
  "errors.team.memberNotFound": "成员不存在。",
  "errors.team.memberConflict": "成员已被修改，请刷新后重试。",
  "errors.team.ownerConstraint": "所有者权限不允许此调整。",
  "errors.team.cannotRemoveOwner": "不能移除工作区所有者。",
  "errors.team.lastAdminRequired": "工作区至少保留一名管理员。",
  "errors.team.newOwnerInvalid": "新的所有者不符合转移条件。",
  "errors.team.ownerOnly": "只有当前所有者可以转移工作区所有权。",

  // 发信通道错误
  "errors.channels.adminOnly": "只有管理员可以配置发信通道。",
  "errors.channels.invalidConfig": "发信通道配置无效。",
  "errors.channels.saveFailed": "发信通道保存失败，请检查配置后重试。",
  "errors.channels.versionConflict": "发信通道已被修改，请刷新后重试。",
  "errors.channels.reconnectCredentialsRequired":
    "重新连接必须重新填写完整凭据。",
  "errors.channels.initialCredentialsRequired": "首次连接必须填写完整凭据。",
  "errors.channels.serverNotConfigured": "服务器尚未配置凭据加密密钥。",
  "errors.channels.testRateLimited": "测试发送过于频繁，请稍后再试。",
  "errors.channels.emailUnverified": "登录邮箱尚未验证，无法发送测试邮件。",
  "errors.channels.webhookConflict": "Webhook 配置已变化，请刷新后重试。",
  "errors.channels.trackingUnsupported": "行为追踪配置无效或当前通道不支持。",
  "errors.channels.aliyunTagInvalid": "阿里云标签格式无效。",
  "errors.channels.providerUnavailable": "该发信服务商暂不可用。",
  "errors.channels.snsTopicInvalid": "SNS Topic 配置无效。",
  "errors.channels.sesConfigSetInvalid": "SES 配置集名称无效。",
  "errors.channels.disconnected": "已断开的发信通道无法执行此操作。",

  // 计费与折扣码错误
  "errors.billing.unauthenticated": "请先登录。",
  "errors.billing.noWorkspace": "没有可用的工作区。",
  "errors.billing.workspaceRequired": "请先选择工作区。",
  "errors.billing.workspaceForbidden": "无法访问该工作区。",
  "errors.billing.adminOnly": "仅管理员可升级套餐。",
  "errors.billing.workspaceNotFound": "工作区不存在。",
  "errors.billing.alreadyTeamNoPro": "当前已是团队版，无需购买专业版。",
  "errors.billing.proFromFreeOnly":
    "专业版仅可从免费版新购。如需团队能力请升级团队版。",
  "errors.billing.alreadyTeam": "当前已是团队版。",
  "errors.billing.configMissing": "当前环境还不能验证这个折扣代码。",
  "errors.billing.discountInvalidFormat":
    "折扣代码格式无效：仅支持 1-14 位大写字母或数字。",
  "errors.billing.discountRequired": "请输入折扣代码。",
  "errors.billing.discountInvalid": "折扣代码无效。",
  "errors.billing.discountMissing": "折扣代码不存在",
  "errors.billing.discountRetry": "暂时无法验证这个折扣代码，请稍后重试。",
  "errors.billing.discountNotStarted": "这个折扣代码尚未生效",
  "errors.billing.discountExpired": "这个折扣代码已过期",
  "errors.billing.discountDepleted": "这个折扣代码已用完",
  "errors.billing.discountPlanMismatch": "这个折扣代码不能用于当前套餐",
  "errors.billing.discountSavings": "太棒了！你节省了 {percent}%！",
  "errors.billing.discountAvailable": "太棒了！这个折扣代码可用。",
  "errors.billing.discountBothChannels":
    "这个折扣代码可用于两种支付方式，最终优惠以结账页为准。",
  "errors.billing.discountSingleChannelSavings":
    "太棒了！你节省了 {percent}%！仅适用于其中一种支付方式。",
  "errors.billing.discountSingleChannelAvailable":
    "太棒了！这个折扣代码可用。仅适用于其中一种支付方式。",
  "errors.billing.discountCreemAccepted":
    "这个折扣代码可用，最终优惠以结账页为准。",
};

function interpolate(template: string, params?: AppErrorParams) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

export function formatErrorTemplate(code: string, params?: AppErrorParams) {
  const template = DEFAULT_ZH_ERROR_MESSAGES[code];
  if (!template) return code;
  return interpolate(template, params);
}

/**
 * 统一展示层错误文案解析器：
 * - 若提供 translator（后续接入 next-intl 的 t），优先按 code 翻译；
 * - 否则回退到 payload.message 或缺省中文词表。
 */
export function resolveErrorText(
  error: AppErrorPayload | string | null | undefined,
  translator?: AppErrorTranslator,
  fallbackCode = "errors.common.unknown",
): string {
  if (!error) return formatErrorTemplate(fallbackCode);
  if (typeof error === "string") {
    if (translator && error in DEFAULT_ZH_ERROR_MESSAGES) {
      const translated = translator(error);
      if (translated) return translated;
    }
    return DEFAULT_ZH_ERROR_MESSAGES[error] ?? error;
  }
  if (translator) {
    const translated = translator(error.code, error.params);
    if (translated) return translated;
  }
  if (error.message) return error.message;
  return formatErrorTemplate(error.code, error.params);
}

type PrefixRule = { prefix: string; code: string };

const TEAM_PREFIX_RULES: PrefixRule[] = [
  { prefix: "工作区已切换", code: "errors.common.workspaceSwitched" },
  { prefix: "只有管理员", code: "errors.team.adminOnly" },
  { prefix: "该邮箱已是工作区成员", code: "errors.team.alreadyMember" },
  { prefix: "该邮箱已有待处理邀请", code: "errors.team.pendingInvitation" },
  { prefix: "邮箱格式无效", code: "errors.team.invalidEmail" },
  { prefix: "邀请已过期", code: "errors.team.invitationExpired" },
  { prefix: "该邀请已无法", code: "errors.team.invitationUnavailable" },
  { prefix: "邀请不存在", code: "errors.team.invitationNotFound" },
  { prefix: "成员不存在", code: "errors.team.memberNotFound" },
  { prefix: "成员已被修改", code: "errors.team.memberConflict" },
  { prefix: "所有者必须", code: "errors.team.ownerConstraint" },
  { prefix: "不能移除工作区所有者", code: "errors.team.cannotRemoveOwner" },
  { prefix: "工作区至少保留一名管理员", code: "errors.team.lastAdminRequired" },
  { prefix: "新的所有者必须", code: "errors.team.newOwnerInvalid" },
  { prefix: "只有当前所有者", code: "errors.team.ownerOnly" },
  { prefix: "新的所有者", code: "errors.team.newOwnerInvalid" },
];

const CHANNEL_PREFIX_RULES: PrefixRule[] = [
  { prefix: "工作区已切换", code: "errors.common.workspaceSwitched" },
  { prefix: "只有管理员", code: "errors.channels.adminOnly" },
  { prefix: "发信通道已被修改", code: "errors.channels.versionConflict" },
  {
    prefix: "重新连接必须",
    code: "errors.channels.reconnectCredentialsRequired",
  },
  {
    prefix: "首次连接必须",
    code: "errors.channels.initialCredentialsRequired",
  },
  { prefix: "服务器尚未配置", code: "errors.channels.serverNotConfigured" },
  { prefix: "测试发送过于频繁", code: "errors.channels.testRateLimited" },
  { prefix: "登录邮箱尚未验证", code: "errors.channels.emailUnverified" },
  { prefix: "Webhook 配置已变化", code: "errors.channels.webhookConflict" },
  { prefix: "行为追踪", code: "errors.channels.trackingUnsupported" },
  { prefix: "阿里云标签", code: "errors.channels.aliyunTagInvalid" },
  { prefix: "该发信服务商", code: "errors.channels.providerUnavailable" },
  { prefix: "SNS Topic", code: "errors.channels.snsTopicInvalid" },
  { prefix: "SES 配置集", code: "errors.channels.sesConfigSetInvalid" },
  { prefix: "已断开的发信通道", code: "errors.channels.disconnected" },
];

export function matchPrefixCode(
  message: string,
  rules: PrefixRule[],
): string | null {
  const hit = rules.find((rule) => message.startsWith(rule.prefix));
  return hit ? hit.code : null;
}

/** 映射 PostgreSQL SQLSTATE 与已知前缀到稳定错误码。 */
export function mapDatabaseError(
  error: { code?: string; message?: string } | null | undefined,
  fallbackCode = "errors.common.saveFailed",
  overrides?: {
    uniqueViolationCode?: string;
    prefixRules?: PrefixRule[];
  },
): AppErrorPayload {
  const sqlState = error?.code ?? "";
  const rawMessage = error?.message ?? "";

  if (sqlState === "23505") {
    const code = overrides?.uniqueViolationCode ?? "errors.db.uniqueViolation";
    return { code, message: formatErrorTemplate(code) };
  }
  if (sqlState === "23503") {
    return {
      code: "errors.db.foreignKeyViolation",
      message: formatErrorTemplate("errors.db.foreignKeyViolation"),
    };
  }
  if (sqlState === "22001") {
    return {
      code: "errors.db.valueTooLong",
      message: formatErrorTemplate("errors.db.valueTooLong"),
    };
  }
  if (sqlState === "42501") {
    return {
      code: "errors.db.permissionDenied",
      message: formatErrorTemplate("errors.db.permissionDenied"),
    };
  }
  if (sqlState === "P0001") {
    if (overrides?.prefixRules) {
      const matched = matchPrefixCode(rawMessage, overrides.prefixRules);
      if (matched) return { code: matched, message: rawMessage };
    }
    if (
      rawMessage.includes("重新加载") ||
      rawMessage.includes("已被修改") ||
      rawMessage.includes("已被其他人修改")
    ) {
      return {
        code: "errors.db.versionConflict",
        message: rawMessage || formatErrorTemplate("errors.db.versionConflict"),
      };
    }
    return {
      code: fallbackCode,
      message: rawMessage || formatErrorTemplate(fallbackCode),
    };
  }

  return { code: fallbackCode, message: formatErrorTemplate(fallbackCode) };
}

export function buildActionError(
  code: string,
  message?: string,
  params?: AppErrorParams,
): ActionErrorResponse {
  const resolvedMessage = message ?? formatErrorTemplate(code, params);
  return {
    error: resolvedMessage,
    errorCode: code,
    errorPayload: {
      code,
      ...(params ? { params } : {}),
      message: resolvedMessage,
    },
  };
}

export function mapTeamActionError(
  error: unknown,
  fallbackMessage = DEFAULT_ZH_ERROR_MESSAGES["errors.team.actionFailed"],
): ActionErrorResponse {
  if (isAppError(error)) {
    return buildActionError(error.code, error.message, error.params);
  }
  const message = error instanceof Error ? error.message : "";
  const matchedCode = matchPrefixCode(message, TEAM_PREFIX_RULES);
  if (matchedCode) {
    return buildActionError(matchedCode, message);
  }
  return buildActionError("errors.team.actionFailed", fallbackMessage);
}

export function mapChannelActionError(error: unknown): ActionErrorResponse {
  if (isAppError(error)) {
    return buildActionError(error.code, error.message, error.params);
  }
  const message = error instanceof Error ? error.message : "";
  const matchedCode = matchPrefixCode(message, CHANNEL_PREFIX_RULES);
  if (matchedCode) {
    return buildActionError(matchedCode, message);
  }
  return buildActionError("errors.channels.saveFailed");
}
