"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import {
  BUSINESS_TIME_ZONE,
  DEFAULT_LOCALE,
  formatDate,
  formatDateTime,
  type AppLocale,
} from "@/i18n/format";
import { isAppLocale } from "@/i18n/config";

const emptySubscribe = () => () => {};

/**
 * 客户端事件时间渲染组件：
 * - SSR 阶段固定使用业务时区避免水合前漂移；
 * - 客户端挂载后自动使用用户浏览器本地时区，兼顾海外用户阅读体验与无 Hydration Mismatch。
 */
export function LocalDate({
  value,
  mode = "dateTime",
  locale,
  className,
}: {
  value: string;
  mode?: "dateTime" | "date";
  locale?: AppLocale;
  className?: string;
}) {
  const activeLocale = useLocale();
  const resolvedLocale: AppLocale =
    locale ?? (isAppLocale(activeLocale) ? activeLocale : DEFAULT_LOCALE);
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const options = mounted ? {} : { timeZone: BUSINESS_TIME_ZONE };
  const text =
    mode === "date"
      ? formatDate(value, resolvedLocale, options)
      : formatDateTime(value, resolvedLocale, options);

  return (
    <time dateTime={value} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
