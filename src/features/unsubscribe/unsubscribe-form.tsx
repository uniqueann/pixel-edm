"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { UnsubscribeLanguageMode } from "@/i18n/config";
import { confirmUnsubscribe, type UnsubscribeActionState } from "./actions";

const initialState: UnsubscribeActionState = { status: "idle" };

type UnsubscribeConfirmProps = {
  token: string;
  maskedEmail: string;
  workspaceName: string;
  mode?: UnsubscribeLanguageMode;
};

export function UnsubscribeConfirm({
  token,
  maskedEmail,
  workspaceName,
  mode = "bilingual",
}: UnsubscribeConfirmProps) {
  const [state, action, pending] = useActionState(
    confirmUnsubscribe,
    initialState,
  );
  const showZh = mode === "zh-CN" || mode === "bilingual";
  const showEn = mode === "en" || mode === "bilingual";

  if (state.status === "success") {
    return (
      <div className="unsubscribe-result" role="status">
        <h1>{mode === "en" ? "Unsubscribed" : "退订完成"}</h1>
        {showZh && (
          <p>
            {state.maskedEmail} 已不会再收到来自 {state.workspaceName}{" "}
            的营销邮件。
          </p>
        )}
        {showEn && (
          <p>
            You have been unsubscribed from future marketing emails from{" "}
            {state.workspaceName}.
          </p>
        )}
      </div>
    );
  }

  const submitLabel =
    mode === "en"
      ? pending
        ? "Processing…"
        : "Unsubscribe"
      : mode === "zh-CN"
        ? pending
          ? "正在处理…"
          : "确认退订"
        : pending
          ? "正在处理… / Processing…"
          : "确认退订 / Unsubscribe";

  return (
    <>
      <h1>
        {mode === "en"
          ? "Unsubscribe from marketing emails?"
          : "停止接收营销邮件？"}
      </h1>
      {showZh && (
        <p>
          即将为 {maskedEmail} 退订 {workspaceName} 的后续营销邮件。
        </p>
      )}
      {showEn && (
        <p>
          Unsubscribe {maskedEmail} from future marketing emails from{" "}
          {workspaceName}?
        </p>
      )}
      <form action={action} className="unsubscribe-form">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" disabled={pending}>
          {submitLabel}
        </Button>
        {state.status === "invalid" && (
          <p className="field-error" role="alert">
            {mode === "en"
              ? "This unsubscribe link is invalid."
              : mode === "zh-CN"
                ? "退订链接无效。"
                : "退订链接无效。 / This unsubscribe link is invalid."}
          </p>
        )}
        {state.status === "unavailable" && (
          <p className="field-error" role="alert">
            {mode === "en"
              ? "Temporarily unavailable. Please try again later."
              : mode === "zh-CN"
                ? "暂时无法处理，请稍后重试。"
                : "暂时无法处理，请稍后重试。 / Please try again later."}
          </p>
        )}
      </form>
    </>
  );
}
