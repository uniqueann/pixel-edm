// 统一日期、数字、货币与排序格式化（不依赖 Next.js 运行时，可供服务端、客户端与纯 Node 单测共用）。

export type AppLocale = "zh-CN" | "en";

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

/** 每日额度重置等业务规则统一采用北京时间（UTC+8）。 */
export const BUSINESS_TIME_ZONE = "Asia/Shanghai";

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 格式化日期与时间；若未显式传入 timeZone，在浏览器侧采用用户本地时区。 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale: AppLocale = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

/** 仅格式化日期（如订阅周期到期日）。 */
export function formatDate(
  value: string | number | Date | null | undefined,
  locale: AppLocale = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...options,
  }).format(date);
}

/** 按业务规则时区（北京时间 UTC+8）格式化时间戳。 */
export function formatBusinessDateTime(
  value: string | number | Date | null | undefined,
  locale: AppLocale = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return formatDateTime(value, locale, {
    timeZone: BUSINESS_TIME_ZONE,
    ...options,
  });
}

export function formatNumber(
  value: number,
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatCurrency(
  usd: number,
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(usd) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

export function compareLocalized(
  left: string,
  right: string,
  locale: AppLocale = DEFAULT_LOCALE,
): number {
  return left.localeCompare(right, locale);
}
