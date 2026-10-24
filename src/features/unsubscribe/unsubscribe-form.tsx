"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { confirmUnsubscribe, type UnsubscribeActionState } from "./actions";

const initialState: UnsubscribeActionState = { status: "idle" };

type UnsubscribeConfirmProps = {
  token: string;
  maskedEmail: string;
  workspaceName: string;
};

export function UnsubscribeConfirm({
  token,
  maskedEmail,
  workspaceName,
}: UnsubscribeConfirmProps) {
  const [state, action, pending] = useActionState(
    confirmUnsubscribe,
    initialState,
  );

  if (state.status === "success") {
    return (
      <div className="unsubscribe-result" role="status">
        <h1>退订完成</h1>
        <p>
          {state.maskedEmail} 已不会再收到来自 {state.workspaceName}{" "}
          的营销邮件。
        </p>
        <p>
          You have been unsubscribed from future marketing emails from{" "}
          {state.workspaceName}.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="eyebrow">邮件偏好 / EMAIL PREFERENCES</p>
      <h1>停止接收营销邮件？</h1>
      <p>
        即将为 {maskedEmail} 退订 {workspaceName} 的后续营销邮件。
      </p>
      <p>
        Unsubscribe {maskedEmail} from future marketing emails from{" "}
        {workspaceName}?
      </p>
      <form action={action} className="unsubscribe-form">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "正在处理… / Processing…" : "确认退订 / Unsubscribe"}
        </Button>
        {state.status === "invalid" && (
          <p className="field-error" role="alert">
            退订链接无效。 / This unsubscribe link is invalid.
          </p>
        )}
        {state.status === "unavailable" && (
          <p className="field-error" role="alert">
            暂时无法处理，请稍后重试。 / Please try again later.
          </p>
        )}
      </form>
    </>
  );
}
