"use client";

import { DeliveryProviderErrorBlock } from "@/components/delivery-provider-error";
import type { DeliveryTestAttempt } from "./model";
import { testResultCopy } from "./channel-presentation";
import styles from "./channel-setup.module.css";

export function ChannelTestResult({
  attempt,
  acceptedLabel,
  historical,
}: {
  attempt: DeliveryTestAttempt;
  acceptedLabel: string;
  historical: boolean;
}) {
  const copy = testResultCopy[attempt.status];
  const timestamp = attempt.completed_at ?? attempt.created_at;
  return (
    <section
      className={styles.result}
      aria-label="最近测试结果"
      aria-live="polite"
      aria-atomic="true"
      data-tone={attempt.status === "failed" ? "error" : undefined}
    >
      <h3 className="text-sm font-semibold">
        最近测试：{attempt.status === "accepted" ? acceptedLabel : copy.title}
      </h3>
      <p className={styles.supporting}>{copy.detail}</p>
      <p className={styles.supporting}>
        {attempt.recipient_hint && `收件人 ${attempt.recipient_hint} · `}
        <time dateTime={timestamp}>
          {new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(timestamp))}
        </time>
      </p>
      {historical && (
        <p className={styles.supporting}>
          这是此前配置的测试记录，不能替代当前配置的验证。
        </p>
      )}
      {attempt.status === "failed" && (
        <DeliveryProviderErrorBlock
          error_category={attempt.error_category}
          error_code={attempt.error_code}
        />
      )}
    </section>
  );
}
