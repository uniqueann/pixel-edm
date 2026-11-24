"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useUnsavedEditDialog } from "@/hooks/use-unsaved-edit-dialog";
import { settingsSectionHref } from "@/features/settings/anchors";
import styles from "./channel-setup.module.css";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createDeliveryChannelInput,
  type DeliveryChannel,
  type DeliveryChannelInput,
} from "./model";
import { directMailRegions } from "./provider";
import {
  mergeProviderRecord,
  regionFieldKind,
  sendGridDataCenterOptions,
  type DeliveryProviderRecord,
} from "./registry";
import { useValidationMessage } from "@/i18n/use-resolvers";

function defaults(input: {
  workspaceId: string;
  workspaceName: string;
  provider: DeliveryProviderRecord;
  channel: DeliveryChannel | null;
}): DeliveryChannelInput {
  const { channel, provider } = input;
  const config = channel?.provider_config ?? {};
  return {
    workspace_id: input.workspaceId,
    provider: provider.provider,
    id: channel?.id,
    expected_version: channel?.version,
    region:
      channel?.region ??
      (provider.provider === "aliyun_directmail"
        ? "cn-hangzhou"
        : provider.provider === "sendgrid"
          ? "global"
          : "us-east-1"),
    sender_domain: channel?.sender_domain ?? "",
    sender_address: channel?.sender_address ?? "",
    sender_alias:
      channel?.sender_alias ??
      input.workspaceName.slice(0, provider.sender_alias_max_length),
    reply_to_address: channel?.reply_to_address ?? "",
    sns_topic_arn:
      typeof config.sns_topic_arn === "string" ? config.sns_topic_arn : "",
    event_webhook_public_key:
      typeof config.event_webhook_public_key === "string"
        ? config.event_webhook_public_key
        : "",
    access_key_id: "",
    access_key_secret: "",
  };
}

export function ChannelFormDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  provider,
  channel,
  connected,
  error,
  onError,
  onSubmit,
  onReturnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  provider: ReturnType<typeof mergeProviderRecord>;
  channel: DeliveryChannel | null;
  connected: boolean;
  error: string;
  onError: (value: string) => void;
  onSubmit: (values: DeliveryChannelInput) => Promise<void>;
  onReturnFocus?: () => void;
}) {
  const t = useTranslations("channels");
  const tCommon = useTranslations("common");
  const resolveValidation = useValidationMessage();
  const router = useRouter();
  const prefix = useId();
  const formId = `${prefix}-channel-form`;
  const errorRef = useRef<HTMLDivElement>(null);
  const lastFieldRef = useRef<HTMLElement | null>(null);
  const formScrollRef = useRef<HTMLFormElement>(null);
  const schema = createDeliveryChannelInput({
    provider: provider.provider,
    senderAliasMaxLength: provider.sender_alias_max_length,
    requiresSenderDomain: provider.requires_sender_domain,
  }).superRefine((values, context) => {
    if (channel?.credential_configured) return;
    if (!values.access_key_secret)
      context.addIssue({
        code: "custom",
        path: ["access_key_secret"],
        message: "validation.channelCredentialSecretBeforeConnect",
      });
    if (provider.provider !== "sendgrid" && !values.access_key_id)
      context.addIssue({
        code: "custom",
        path: ["access_key_id"],
        message: "validation.channelCredentialIdBeforeConnect",
      });
  });
  const form = useForm<DeliveryChannelInput>({
    resolver: zodResolver(schema),
    defaultValues: defaults({ workspaceId, workspaceName, provider, channel }),
    mode: "onTouched",
  });
  const { isDirty, isSubmitting, errors } = form.formState;
  const guard = useUnsavedEditDialog({
    dirty: isDirty,
    busy: isSubmitting,
    cancelLabel: tCommon("unsavedDialog.continueEditing"),
    confirmClassName: styles.confirmation,
    onReturnFocus: () => {
      if (lastFieldRef.current?.isConnected) lastFieldRef.current.focus();
    },
    onClose: () => {
      form.reset();
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open || (!isDirty && !isSubmitting)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, isDirty, isSubmitting]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const revealField = useCallback(() => {
    requestAnimationFrame(() => {
      const formBody = formScrollRef.current;
      const scrollEl = formBody?.closest("[data-dialog-reflow]")
        ? formBody.closest<HTMLElement>("[data-dialog-scroll-viewport]")
        : formBody;
      const field = lastFieldRef.current;
      if (!scrollEl || !field || document.activeElement !== field) return;
      const footer = scrollEl.parentElement
        ?.querySelector("[data-channel-form-footer]")
        ?.getBoundingClientRect();
      const scrollBox = scrollEl.getBoundingClientRect();
      const bounds = field.getBoundingClientRect();
      const visibleBottom = footer
        ? Math.min(scrollBox.bottom, footer.top)
        : scrollBox.bottom;
      if (bounds.bottom > visibleBottom - 12)
        scrollEl.scrollTop += bounds.bottom - visibleBottom + 12;
      else if (bounds.top < scrollBox.top + 12)
        scrollEl.scrollTop -= scrollBox.top + 12 - bounds.top;
    });
  }, []);

  const regionOptions =
    provider.provider === "aliyun_directmail"
      ? directMailRegions.map((region) => ({
          value: region,
          label: t(`regions.directmail.${region}`),
        }))
      : sendGridDataCenterOptions.map((option) => ({
          value: option.value,
          label: t(`regions.sendgrid.${option.value}`),
        }));
  const titleProvider = t(`providers.${provider.provider}.dialogName`);
  const regionLabel = t(`providers.${provider.provider}.regionFieldLabel`);
  const credentialRequired = !channel?.credential_configured;

  function fieldAttributes(name: keyof DeliveryChannelInput) {
    return {
      id: `${prefix}-${name}`,
      "aria-invalid": Boolean(errors[name]),
      "aria-describedby": `${prefix}-${name}-help${errors[name] ? ` ${prefix}-${name}-error` : ""}`,
      disabled: isSubmitting,
    };
  }

  function renderField(
    name: keyof DeliveryChannelInput,
    label: string,
    help: string,
    inputProps: InputHTMLAttributes<HTMLInputElement> = {},
  ) {
    return (
      <div className={styles.field}>
        <Label htmlFor={`${prefix}-${name}`}>{label}</Label>
        {name === "event_webhook_public_key" ? (
          <textarea
            {...fieldAttributes(name)}
            {...form.register(name)}
            rows={4}
            spellCheck={false}
            autoComplete="off"
            className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-sm"
          />
        ) : (
          <Input
            {...inputProps}
            {...fieldAttributes(name)}
            {...form.register(name)}
          />
        )}
        <p id={`${prefix}-${name}-help`} className={styles.supporting}>
          {help}
        </p>
        {errors[name] && (
          <p
            id={`${prefix}-${name}-error`}
            className={styles.fieldError}
            role="alert"
          >
            {resolveValidation(errors[name]?.message)}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={guard.handleOpenChange}>
        <DialogContent
          placement="bottom"
          className={styles.dialog}
          {...guard.editDialogContentProps}
          onFocusCapture={(event) => {
            if (
              event.target instanceof HTMLInputElement ||
              event.target instanceof HTMLTextAreaElement ||
              event.target.getAttribute("role") === "combobox"
            )
              lastFieldRef.current = event.target;
            revealField();
          }}
          onCloseAutoFocus={(event) => {
            if (onReturnFocus) {
              event.preventDefault();
              onReturnFocus();
            }
          }}
        >
          <div className={styles.dialogViewport} data-dialog-scroll-viewport>
            <DialogHeader
              className={styles.dialogHeader}
              data-dialog-scroll-chrome
            >
              <DialogTitle>
                {connected
                  ? t("dialog.updateTitle", { provider: titleProvider })
                  : t("dialog.connectTitle", { provider: titleProvider })}
              </DialogTitle>
              <DialogDescription>{t("dialog.description")}</DialogDescription>
              {provider.provider === "aliyun_directmail" && (
                <Link
                  href="/help#help-directmail-setup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit text-sm underline underline-offset-2"
                >
                  {t("dialog.directmailGuideLink")}
                </Link>
              )}
            </DialogHeader>
            <form
              id={formId}
              ref={formScrollRef}
              className={styles.formScroll}
              data-dialog-scroll-body
              noValidate
              aria-busy={isSubmitting}
              onSubmit={form.handleSubmit(async (values) => {
                onError("");
                try {
                  await onSubmit(values);
                } catch {
                  onError(t("dialog.saveUnconfirmedError"));
                }
              })}
            >
              <fieldset className={styles.formGroup} disabled={isSubmitting}>
                <legend>{t("dialog.identityLegend")}</legend>
                <p className={styles.supporting}>{t("dialog.identityHelp")}</p>
                <div className={styles.fieldGrid}>
                  {renderField(
                    "sender_alias",
                    t("dialog.senderAliasLabel"),
                    t("dialog.senderAliasHelp", {
                      max: provider.sender_alias_max_length,
                    }),
                    {
                      maxLength: provider.sender_alias_max_length,
                      required: true,
                      autoComplete: "off",
                    },
                  )}
                  {renderField(
                    "sender_address",
                    t("dialog.senderAddressLabel"),
                    provider.requires_sender_domain
                      ? t("dialog.senderAddressHelpWithDomain")
                      : t("dialog.senderAddressHelpNoDomain"),
                    {
                      type: "email",
                      required: true,
                      placeholder: "hello@send.example.com",
                      autoComplete: "off",
                      spellCheck: false,
                    },
                  )}
                </div>
                {provider.requires_sender_domain &&
                  renderField(
                    "sender_domain",
                    t("dialog.senderDomainLabel"),
                    t("dialog.senderDomainHelp"),
                    {
                      required: true,
                      placeholder: "send.example.com",
                      autoComplete: "off",
                      spellCheck: false,
                    },
                  )}
                {renderField(
                  "reply_to_address",
                  t("dialog.replyToLabel"),
                  t("dialog.replyToHelp"),
                  {
                    type: "email",
                    placeholder: "support@example.com",
                    autoComplete: "off",
                  },
                )}
                <p className={styles.supporting}>
                  {t("dialog.signatureNotePrefix")}
                  <Link
                    className="underline underline-offset-2"
                    href={settingsSectionHref("profile")}
                    onClick={(event) => {
                      event.preventDefault();
                      guard.requestLeave(() =>
                        router.push(settingsSectionHref("profile")),
                      );
                    }}
                  >
                    {t("dialog.signatureNoteLink")}
                  </Link>
                  {t("dialog.signatureNoteSuffix")}
                </p>
              </fieldset>

              <fieldset className={styles.formGroup} disabled={isSubmitting}>
                <legend>{t("dialog.regionLegend")}</legend>
                <div className={styles.field}>
                  <Label htmlFor={`${prefix}-region`}>{regionLabel}</Label>
                  {regionFieldKind(provider.provider) === "select" ? (
                    <Controller
                      control={form.control}
                      name="region"
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={isSubmitting}
                        >
                          <SelectTrigger
                            {...fieldAttributes("region")}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            className="w-full"
                            aria-label={regionLabel}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {regionOptions.map((option) => (
                              <SelectItem
                                value={option.value}
                                key={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  ) : (
                    <Input
                      placeholder="us-east-1"
                      spellCheck={false}
                      {...fieldAttributes("region")}
                      {...form.register("region")}
                    />
                  )}
                  <p id={`${prefix}-region-help`} className={styles.supporting}>
                    {t("dialog.regionHelp")}
                  </p>
                  {errors.region && (
                    <p
                      id={`${prefix}-region-error`}
                      className={styles.fieldError}
                      role="alert"
                    >
                      {resolveValidation(errors.region.message)}
                    </p>
                  )}
                </div>
              </fieldset>

              <fieldset className={styles.formGroup} disabled={isSubmitting}>
                <legend>
                  {credentialRequired
                    ? t("dialog.credentialsLegendRequired")
                    : t("dialog.credentialsLegendOptional")}
                </legend>
                <p className={styles.supporting}>
                  {credentialRequired
                    ? t("dialog.credentialsHelpRequired")
                    : t("dialog.credentialsHelpOptional")}
                </p>
                <div className={styles.fieldGrid}>
                  {provider.provider !== "sendgrid" &&
                    renderField(
                      "access_key_id",
                      t(`providers.${provider.provider}.credentialIdLabel`),
                      t("dialog.credentialIdHelp"),
                      {
                        autoComplete: "off",
                        spellCheck: false,
                        required: credentialRequired,
                      },
                    )}
                  {renderField(
                    "access_key_secret",
                    t(`providers.${provider.provider}.credentialSecretLabel`),
                    t(`providers.${provider.provider}.secretHelp`),
                    {
                      type: "password",
                      autoComplete: "new-password",
                      spellCheck: false,
                      required: credentialRequired,
                    },
                  )}
                </div>
              </fieldset>

              {provider.provider !== "aliyun_directmail" && (
                <div className={styles.formGroup}>
                  <details
                    className={styles.disclosure}
                    open={
                      Boolean(
                        errors.sns_topic_arn || errors.event_webhook_public_key,
                      ) || undefined
                    }
                  >
                    <summary>
                      {t("dialog.receiptSummary")}{" "}
                      <span>{t("dialog.receiptSummaryMeta")}</span>
                    </summary>
                    <div className={styles.disclosureBody}>
                      {provider.provider === "amazon_ses"
                        ? renderField(
                            "sns_topic_arn",
                            t("dialog.snsTopicLabel"),
                            t("dialog.snsTopicHelp"),
                            {
                              placeholder:
                                "arn:aws:sns:us-east-1:123456789012:ses-events",
                              spellCheck: false,
                            },
                          )
                        : renderField(
                            "event_webhook_public_key",
                            t("dialog.publicKeyLabel"),
                            t("dialog.publicKeyHelp"),
                            { spellCheck: false, autoComplete: "off" },
                          )}
                    </div>
                  </details>
                </div>
              )}

              {error && (
                <div
                  ref={errorRef}
                  tabIndex={-1}
                  role="alert"
                  className={styles.formError}
                >
                  <p className={styles.fieldError}>
                    {t("dialog.saveErrorTitle")}
                  </p>
                  <p className={styles.supporting}>{error}</p>
                  <p className={styles.supporting}>
                    {t("dialog.saveErrorGuidance")}
                  </p>
                </div>
              )}
            </form>
          </div>
          <div
            aria-hidden="true"
            data-channel-form-gap
            data-dialog-scroll-chrome
            className={styles.formGap}
            style={{ flex: "0 0 8px", height: 8, minHeight: 8 }}
          />
          <div
            className={styles.formFooter}
            data-channel-form-footer
            data-dialog-scroll-footer
            data-dialog-scroll-chrome
          >
            <p role="status">
              {isSubmitting
                ? t("dialog.statusSubmitting")
                : isDirty
                  ? t("dialog.statusDirty")
                  : t("dialog.statusClean")}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={guard.requestClose}
            >
              {tCommon("actions.cancel")}
            </Button>
            <Button type="submit" form={formId} disabled={isSubmitting}>
              {isSubmitting ? t("dialog.saving") : t("dialog.saveButton")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {guard.discardConfirm}
    </>
  );
}
