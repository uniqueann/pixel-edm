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
import {
  directMailRegionOptions,
  mergeProviderRecord,
  regionFieldKind,
  regionFieldLabel,
  sendGridDataCenterOptions,
  type DeliveryProviderRecord,
} from "./registry";

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
  const router = useRouter();
  const prefix = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const lastFieldRef = useRef<HTMLElement | null>(null);
  const formScrollRef = useRef<HTMLDivElement>(null);
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
        message: "连接前请填写访问凭据",
      });
    if (provider.provider !== "sendgrid" && !values.access_key_id)
      context.addIssue({
        code: "custom",
        path: ["access_key_id"],
        message: "连接前请填写访问密钥 ID",
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
    cancelLabel: "继续编辑",
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
      const scrollEl = formScrollRef.current;
      const field = lastFieldRef.current;
      if (!scrollEl || !field || document.activeElement !== field) return;
      const footer = scrollEl
        .closest("form")
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
      ? directMailRegionOptions()
      : sendGridDataCenterOptions.map((option) => ({
          value: option.value,
          label: option.label,
        }));
  const titleProvider =
    provider.provider === "aliyun_directmail"
      ? "阿里云发信通道"
      : `${provider.display_name} 发信通道`;
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
            {errors[name]?.message}
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
          className={`bottom-sheet ${styles.dialog}`}
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
          <DialogHeader className={styles.dialogHeader}>
            <DialogTitle>
              {connected ? `更新${titleProvider}` : `连接${titleProvider}`}
            </DialogTitle>
            <DialogDescription>
              先保存发件身份与访问凭据，再向当前管理员邮箱发送测试。保存配置不代表已通过验证。
            </DialogDescription>
            {provider.provider === "aliyun_directmail" && (
              <Link
                href="/help#help-directmail-setup"
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit text-sm underline underline-offset-2"
              >
                查看 DirectMail 图文开通教程（新标签页）
              </Link>
            )}
          </DialogHeader>
          <form
            className={styles.formShell}
            noValidate
            aria-busy={isSubmitting}
            onSubmit={form.handleSubmit(async (values) => {
              onError("");
              try {
                await onSubmit(values);
              } catch {
                onError(
                  "暂时无法确认保存结果，输入已保留。请核对通道状态后重试。",
                );
              }
            })}
          >
            <div
              ref={formScrollRef}
              className={styles.formScroll}
              data-dialog-scroll-body
            >
              <fieldset className={styles.formGroup} disabled={isSubmitting}>
                <legend>发件身份</legend>
                <p className={styles.supporting}>
                  先在服务商控制台完成发件身份验证，再将相同信息填入下方。
                </p>
                <div className={styles.fieldGrid}>
                  {renderField(
                    "sender_alias",
                    "发件人名称",
                    `显示在收件人邮箱的“发件人”一栏，最多 ${provider.sender_alias_max_length} 个字符。`,
                    {
                      maxLength: provider.sender_alias_max_length,
                      required: true,
                      autoComplete: "off",
                    },
                  )}
                  {renderField(
                    "sender_address",
                    "发件地址",
                    provider.requires_sender_domain
                      ? "须属于下方发件域名，并已在服务商控制台完成验证。"
                      : "使用已在服务商控制台验证的发件身份。",
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
                    "发件域名",
                    "填写已验证的域名，不含 https:// 或路径。",
                    {
                      required: true,
                      placeholder: "send.example.com",
                      autoComplete: "off",
                      spellCheck: false,
                    },
                  )}
                {renderField(
                  "reply_to_address",
                  "回复地址（选填）",
                  "收件人点击回复时使用；留空则跟随发件地址。",
                  {
                    type: "email",
                    placeholder: "support@example.com",
                    autoComplete: "off",
                  },
                )}
                <p className={styles.supporting}>
                  发件人名称与邮件正文署名分别设置。需要修改落款时，
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
                    前往我的署名
                  </Link>
                  ；页脚联系地址在店铺信息中填写。
                </p>
              </fieldset>

              <fieldset className={styles.formGroup} disabled={isSubmitting}>
                <legend>服务区域</legend>
                <div className={styles.field}>
                  <Label htmlFor={`${prefix}-region`}>
                    {regionFieldLabel(provider.provider)}
                  </Label>
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
                            aria-label={regionFieldLabel(provider.provider)}
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
                    与服务商控制台中发件身份所在区域保持一致；默认选项不代表已核对。
                  </p>
                  {errors.region && (
                    <p
                      id={`${prefix}-region-error`}
                      className={styles.fieldError}
                      role="alert"
                    >
                      {errors.region.message}
                    </p>
                  )}
                </div>
              </fieldset>

              <fieldset className={styles.formGroup} disabled={isSubmitting}>
                <legend>
                  访问凭据{credentialRequired ? "（必填）" : "（可替换）"}
                </legend>
                <p className={styles.supporting}>
                  {credentialRequired
                    ? "从服务商控制台获取具有发信权限的专用凭据。"
                    : "已有凭据已安全保存。留空则保留；替换时需填写完整的新凭据。"}
                </p>
                <div className={styles.fieldGrid}>
                  {provider.provider !== "sendgrid" &&
                    renderField(
                      "access_key_id",
                      provider.credentialIdLabel,
                      "与 Secret 配套使用。",
                      {
                        autoComplete: "off",
                        spellCheck: false,
                        required: credentialRequired,
                      },
                    )}
                  {renderField(
                    "access_key_secret",
                    provider.credentialSecretLabel,
                    provider.provider === "sendgrid"
                      ? "API Key 需具备 Mail Send 权限。"
                      : "仅本次输入可见，保存后不回显明文。",
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
                      回执验证信息 <span>首次测试可暂不填写</span>
                    </summary>
                    <div className={styles.disclosureBody}>
                      {provider.provider === "amazon_ses"
                        ? renderField(
                            "sns_topic_arn",
                            "SNS Topic ARN（选填）",
                            "配置回执前填写；Topic 所在区域须与上方 AWS 区域一致。",
                            {
                              placeholder:
                                "arn:aws:sns:us-east-1:123456789012:ses-events",
                              spellCheck: false,
                            },
                          )
                        : renderField(
                            "event_webhook_public_key",
                            "Event Webhook 验签公钥（选填）",
                            "启用 Signed Event Webhook 前必须填写服务商控制台提供的验签公钥。",
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
                  <p className={styles.fieldError}>配置未能确认保存</p>
                  <p className={styles.supporting}>{error}</p>
                  <p className={styles.supporting}>
                    当前输入仍保留在此弹窗，可核对后再次保存。若提示版本冲突，请先关闭并重新打开最新配置。
                  </p>
                </div>
              )}
            </div>
            <div
              className={styles.formFooter}
              data-channel-form-footer
              data-dialog-scroll-footer
            >
              <p role="status">
                {isSubmitting
                  ? "正在保存配置，请保持页面打开。"
                  : isDirty
                    ? "有未保存的更改"
                    : "保存后还需发送测试验证"}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={guard.requestClose}
              >
                取消
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "正在保存…" : "保存配置"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {guard.discardConfirm}
    </>
  );
}
