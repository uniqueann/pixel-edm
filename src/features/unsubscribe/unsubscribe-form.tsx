"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { confirmUnsubscribe, type UnsubscribeActionState } from "./actions";

const initialState: UnsubscribeActionState = { status: "idle" };

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    confirmUnsubscribe,
    initialState,
  );
  if (state.status === "success")
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
  return (
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
  );
}
