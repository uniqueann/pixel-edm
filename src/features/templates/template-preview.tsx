"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type ComponentProps } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmailOutboundFooterPreview,
  EmailOutboundFromPreview,
  formatOutboundFromLine,
  outboundFooterPlainText,
} from "@/components/email-outbound-preview";
import {
  isMemberSenderNameCustomized,
  senderNameDefault,
} from "@/lib/sender-name";
import {
  renderTemplate,
  templateVariables,
  type TemplateValues,
  type TemplateVariable,
} from "./model";
import styles from "./templates.module.css";

const KNOWN_VARIABLE_KEYS = new Set<string>(
  templateVariables.map((variable) => variable.key),
);

export function TemplatePreview({
  subject,
  body,
  workspaceName,
  memberName,
  memberDisplayNameCustomized,
  mailingAddress,
  senderAlias,
  senderAddress,
  onSettingsNavigate,
}: {
  subject: string;
  body: string;
  workspaceName: string;
  memberName: string;
  memberDisplayNameCustomized?: boolean;
  mailingAddress: string;
  senderAlias: string;
  senderAddress: string;
  onSettingsNavigate?: ComponentProps<typeof Link>["onNavigate"];
}) {
  const t = useTranslations("templates");
  const [values, setValues] = useState<TemplateValues>({
    name: "Anna",
    email: "anna@example.com",
    store_name: workspaceName,
    sender_name: senderNameDefault(memberName),
    discount: "10%",
    product: "Canvas Tote",
    order_number: "#1001",
  });
  const rendered = useMemo(
    () =>
      renderTemplate(subject, body, values, (key) =>
        t("preview.missingToken", { key }),
      ),
    [subject, body, values, t],
  );
  const previewId = useId();
  const sampleControlsRef = useRef<HTMLDetailsElement>(null);
  const usedKeys = new Set(
    Array.from(`${subject}\n${body}`.matchAll(/{{([\s\S]*?)}}/g), (match) =>
      match[1].trim(),
    ),
  );
  const usedVariables = templateVariables.filter((variable) =>
    usedKeys.has(variable.key),
  );
  const primaryVariables = templateVariables.filter(
    (variable) =>
      usedKeys.has(variable.key) ||
      (variable.key === "email" && usedKeys.has("name")),
  );
  const otherVariables = templateVariables.filter(
    (variable) => !primaryVariables.includes(variable),
  );
  const variableLabel = (key: string) =>
    KNOWN_VARIABLE_KEYS.has(key)
      ? t(`variables.${key as TemplateVariable}`)
      : key;

  function sampleFields(
    variables: readonly (typeof templateVariables)[number][],
  ) {
    return (
      <div className={styles.sampleFields}>
        {variables.map((variable) => (
          <div key={variable.key} className={styles.field}>
            <Label htmlFor={`${previewId}-${variable.key}`}>
              {variableLabel(variable.key)}
              <code>{`{{${variable.key}}}`}</code>
            </Label>
            <Input
              id={`${previewId}-${variable.key}`}
              value={values[variable.key]}
              maxLength={200}
              aria-describedby={`${previewId}-boundary`}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [variable.key]: event.target.value,
                }))
              }
            />
          </div>
        ))}
      </div>
    );
  }

  async function copyPreview() {
    if (rendered.missing.length) return;
    const fromLine = formatOutboundFromLine(senderAlias, senderAddress);
    const bodyWithFooter = outboundFooterPlainText({
      body: rendered.body,
      workspaceName,
      mailingAddress,
    });
    const fromPrefix = fromLine
      ? `${t("preview.copyFromPrefix", { from: fromLine })}\n\n`
      : "";
    const subjectLine = t("preview.copySubjectPrefix", {
      subject: rendered.subject,
    });
    try {
      await navigator.clipboard.writeText(
        `${fromPrefix}${subjectLine}\n\n${bodyWithFooter}`,
      );
      toast.success(t("preview.copySuccess"));
    } catch {
      toast.error(t("preview.copyFailed"));
    }
  }

  const showDefaultSenderHint =
    !isMemberSenderNameCustomized({
      display_name: memberName,
      display_name_customized: memberDisplayNameCustomized,
    }) && usedKeys.has("sender_name");

  return (
    <div className={styles.preview}>
      <p
        id={`${previewId}-boundary`}
        className={styles.previewNote}
        role="note"
      >
        {t("preview.sampleNote")}
      </p>
      <details ref={sampleControlsRef} className={styles.sampleControls}>
        <summary>
          <span>
            {t("preview.sampleControlsSummary", {
              count: usedVariables.length,
            })}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={styles.sampleGroups}>
          {primaryVariables.length ? (
            [
              { label: t("editor.groupCustomer"), customer: true },
              { label: t("editor.groupCampaign"), customer: false },
            ].map((group) => {
              const fields = primaryVariables.filter(
                (variable) =>
                  group.customer ===
                  (variable.key === "name" || variable.key === "email"),
              );
              return fields.length ? (
                <div key={group.label} className={styles.variableGroup}>
                  <p className={styles.groupLabel}>{group.label}</p>
                  {sampleFields(fields)}
                  {group.customer && usedKeys.has("name") && (
                    <p className={styles.help}>
                      {t("preview.nameFallbackHelp")}
                    </p>
                  )}
                </div>
              ) : null;
            })
          ) : (
            <p className={styles.help}>{t("preview.noVariablesUsed")}</p>
          )}
          {otherVariables.length > 0 && (
            <details className={styles.otherSamples}>
              <summary>
                {t("preview.unusedSamplesSummary", {
                  count: otherVariables.length,
                })}
              </summary>
              {sampleFields(otherVariables)}
            </details>
          )}
        </div>
      </details>
      {rendered.missing.length > 0 && (
        <div className={styles.previewValidation} role="alert">
          <p>
            {t("preview.missingPrefix", {
              fields: rendered.missing
                .map((key) => variableLabel(key))
                .join(t("preview.missingSeparator")),
            })}
          </p>
          <Button
            type="button"
            variant="link"
            className={styles.copyButton}
            onClick={() => {
              if (sampleControlsRef.current)
                sampleControlsRef.current.open = true;
              document
                .getElementById(`${previewId}-${rendered.missing[0]}`)
                ?.focus();
            }}
          >
            {t("preview.fillMissingAction")}
          </Button>
        </div>
      )}
      <div className={styles.mail}>
        <EmailOutboundFromPreview
          senderAlias={senderAlias}
          senderAddress={senderAddress}
          onSettingsNavigate={onSettingsNavigate}
          className="mb-4"
        />
        <p className={styles.mailLabel}>{t("preview.subjectLabel")}</p>
        <p className={styles.mailSubject}>
          {rendered.subject || t("preview.subjectEmpty")}
        </p>
        <div className="my-4 border-t" />
        <p className={styles.mailLabel}>{t("preview.bodyLabel")}</p>
        <pre className={styles.mailBody}>
          {rendered.body || t("preview.bodyEmpty")}
        </pre>
        <EmailOutboundFooterPreview
          workspaceName={workspaceName}
          mailingAddress={mailingAddress}
          onSettingsNavigate={onSettingsNavigate}
        />
      </div>
      {showDefaultSenderHint && (
        <p className={styles.previewNote} role="note">
          {t("preview.defaultSenderPrefix")}
          <Link
            href="/settings"
            onNavigate={onSettingsNavigate}
            className="underline underline-offset-2"
          >
            {t("preview.defaultSenderLink")}
          </Link>
          {t("preview.defaultSenderSuffix")}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className={styles.copyButton}
        disabled={rendered.missing.length > 0}
        onClick={copyPreview}
      >
        <Copy size={16} aria-hidden="true" />
        {t("preview.copyButton")}
      </Button>
    </div>
  );
}
