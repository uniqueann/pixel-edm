"use client";

import { useTranslations } from "next-intl";
import { DeliveryProviderErrorBlock } from "@/components/delivery-provider-error";
import { LocalDate } from "@/components/local-date";
import type { DeliveryTestAttempt } from "./model";
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
  const t = useTranslations("channels.testResult");
  const timestamp = attempt.completed_at ?? attempt.created_at;
  const statusHeading =
    attempt.status === "accepted"
      ? acceptedLabel
      : t(`${attempt.status}.title`);

  return (
    <section
      className={styles.result}
      aria-label={t("sectionAria")}
      aria-live="polite"
      aria-atomic="true"
      data-tone={attempt.status === "failed" ? "error" : undefined}
    >
      <h3 className="text-sm font-semibold">
        {t("heading", { status: statusHeading })}
      </h3>
      <p className={styles.supporting}>{t(`${attempt.status}.detail`)}</p>
      <p className={styles.supporting}>
        {attempt.recipient_hint &&
          t("recipientPrefix", { recipient: attempt.recipient_hint })}
        <LocalDate value={timestamp} />
      </p>
      {historical && (
        <p className={styles.supporting}>{t("historicalNotice")}</p>
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
