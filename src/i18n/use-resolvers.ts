"use client";

import { useTranslations } from "next-intl";
import {
  resolveErrorText,
  type AppErrorParams,
  type AppErrorPayload,
} from "@/lib/errors";
import {
  resolveValidationMessage,
  type ValidationParams,
} from "@/lib/validation-messages";

type DynamicTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

export type ResolvableErrorInput =
  | AppErrorPayload
  | {
      error?: string;
      errorCode?: string;
      errorPayload?: AppErrorPayload;
    }
  | string
  | null
  | undefined;

/** 表单校验消息翻译器：将 zod validation.* 错误码按当前 locale 解析。 */
export function useValidationMessage() {
  const t = useTranslations("validation") as unknown as DynamicTranslator;
  return (raw: string | null | undefined, fallback?: string) =>
    resolveValidationMessage(
      raw,
      (code: string, params?: ValidationParams) => {
        const key = code.replace(/^validation\./, "");
        return t.has(key) ? t(key, params) : undefined;
      },
      fallback,
    );
}

/** 业务错误消息翻译器：将 AppErrorPayload / ActionErrorResponse / errors.* 错误码按当前 locale 解析。 */
export function useErrorMessage() {
  const t = useTranslations("errors") as unknown as DynamicTranslator;
  return (
    error: ResolvableErrorInput,
    fallbackCode = "errors.common.unknown",
  ) => {
    let normalized: AppErrorPayload | string | null | undefined;
    if (error && typeof error === "object" && !("code" in error)) {
      if (error.errorPayload) {
        normalized = error.errorPayload;
      } else if (error.errorCode) {
        normalized = { code: error.errorCode, message: error.error };
      } else {
        normalized = error.error;
      }
    } else {
      normalized = error;
    }
    return resolveErrorText(
      normalized,
      (code: string, params?: AppErrorParams) => {
        const key = code.replace(/^errors\./, "");
        return t.has(key) ? t(key, params) : undefined;
      },
      fallbackCode,
    );
  };
}
