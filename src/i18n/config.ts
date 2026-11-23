// 站点国际化核心常量与语言协商纯函数（零 Next.js 依赖，供服务端、客户端与纯 Node 单测共用）。

export const LOCALES = ["zh-CN", "en"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

export const LOCALE_COOKIE = "NEXT_LOCALE";

/** 语言偏好 Cookie 有效期（1 年）。 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 全部 16 个消息命名空间（与 messages/{locale}/*.json 一一对应）。 */
export const ALL_NAMESPACES = [
  "common",
  "shell",
  "auth",
  "dashboard",
  "settings",
  "team",
  "campaigns",
  "contacts",
  "templates",
  "channels",
  "billing",
  "audit",
  "help",
  "unsubscribe",
  "errors",
  "validation",
] as const;

export type MessageNamespace = (typeof ALL_NAMESPACES)[number];

/** 根布局 NextIntlClientProvider 下发的公共小包，避免首屏注入全站所有业务文案。 */
export const ROOT_CLIENT_NAMESPACES: readonly MessageNamespace[] = [
  "common",
  "shell",
  "errors",
  "validation",
];

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en";
}

/** 将常见语言标签归一化为站点支持的 locale；无法识别时返回 null。 */
export function normalizeLocale(
  value: string | null | undefined,
): AppLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return null;
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

/**
 * 解析 HTTP Accept-Language 请求头，按 q 权重降序匹配首个受支持语言。
 * 未匹配时返回 null（调用方可据此决定回退 DEFAULT_LOCALE 或双语兜底）。
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
): AppLocale | null {
  if (!header) return null;
  const entries = header
    .split(",")
    .map((part, index) => {
      const [rawTag, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const [k, v] = param.trim().split("=");
        if (k?.trim().toLowerCase() === "q" && v !== undefined) {
          const parsed = Number.parseFloat(v.trim());
          if (Number.isFinite(parsed)) q = parsed;
        }
      }
      return { tag: rawTag?.trim() ?? "", q, index };
    })
    .filter((item) => item.tag.length > 0 && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const item of entries) {
    if (item.tag === "*") continue;
    const matched = normalizeLocale(item.tag);
    if (matched) return matched;
  }
  return null;
}

export type UnsubscribeLanguageMode = AppLocale | "bilingual";

/**
 * 退订页语言协商：?lang=zh|en → Accept-Language → 中英双语兜底。
 * 不读取也不依赖 NEXT_LOCALE cookie，避免登录态干扰外部收件人体验。
 */
export function resolveUnsubscribeLanguage(input: {
  langParam?: string | null;
  acceptLanguage?: string | null;
}): UnsubscribeLanguageMode {
  const fromQuery = normalizeLocale(input.langParam);
  if (fromQuery) return fromQuery;
  const fromHeader = parseAcceptLanguage(input.acceptLanguage);
  if (fromHeader) return fromHeader;
  return "bilingual";
}
