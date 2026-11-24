"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { formatOutboundFromLine } from "@/lib/email-outbound-preview";
import { mailingAddressProblemCode } from "@/lib/mailing-address";
import { useValidationMessage } from "@/i18n/use-resolvers";
import { cn } from "@/lib/utils";

export {
  formatOutboundFromLine,
  outboundFooterPlainText,
} from "@/lib/email-outbound-preview";

export function EmailOutboundFromPreview({
  senderAlias,
  senderAddress,
  className,
  onSettingsNavigate,
}: {
  senderAlias: string | null | undefined;
  senderAddress: string | null | undefined;
  className?: string;
  onSettingsNavigate?: ComponentProps<typeof Link>["onNavigate"];
}) {
  const t = useTranslations("common.outboundPreview");
  const fromLine = formatOutboundFromLine(senderAlias, senderAddress);
  const missingAlias = !(senderAlias ?? "").trim();
  const missingAddress = !(senderAddress ?? "").trim();

  return (
    <div className={cn("text-sm", className)}>
      <p className="mb-1 text-xs text-muted-foreground">{t("fromLabel")}</p>
      {fromLine ? (
        <p className="break-all font-medium">{fromLine}</p>
      ) : (
        <p className="text-destructive" role="note">
          {missingAlias && missingAddress
            ? t("missingBoth")
            : missingAddress
              ? t("missingAddress")
              : t("missingAlias")}
          <Link
            href="/settings"
            onNavigate={onSettingsNavigate}
            className="ml-1 underline underline-offset-2"
          >
            {t("goToChannels")}
          </Link>
        </p>
      )}
    </div>
  );
}

export function EmailOutboundFooterPreview({
  workspaceName,
  mailingAddress,
  className,
  onSettingsNavigate,
}: {
  workspaceName: string;
  mailingAddress: string;
  className?: string;
  onSettingsNavigate?: ComponentProps<typeof Link>["onNavigate"];
}) {
  const t = useTranslations("common.outboundPreview");
  const resolveValidation = useValidationMessage();
  const name = workspaceName.trim() || t("workspacePlaceholder");
  const address = mailingAddress.trim();
  const addressProblemKey = mailingAddressProblemCode(mailingAddress);
  const addressProblem = addressProblemKey
    ? resolveValidation(addressProblemKey)
    : null;
  const addressDisplay = address || t("addressEmpty");

  return (
    <div
      className={cn(
        "mt-4 border-t pt-4 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
      data-testid="email-outbound-footer-preview"
    >
      <p className="mb-2 text-xs font-medium text-foreground">
        {t("footerTitle")}
      </p>
      <div className="space-y-1">
        <p className="break-words">{name}</p>
        <p className="break-words">
          Contact address / 联系地址:{" "}
          <span className={addressProblem ? "text-destructive" : ""}>
            {addressDisplay}
          </span>
        </p>
        {addressProblem && (
          <p className="text-destructive" role="note">
            {addressProblem}
            <Link
              href="/settings"
              onNavigate={onSettingsNavigate}
              className="ml-1 underline underline-offset-2"
            >
              {t("goToStoreSettings")}
            </Link>
          </p>
        )}
        <p>
          <span
            className="cursor-default text-primary underline underline-offset-2"
            aria-disabled="true"
            title={t("unsubscribeTitle")}
          >
            Unsubscribe / 退订
          </span>
        </p>
      </div>
    </div>
  );
}
