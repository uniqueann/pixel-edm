"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
    sender_domain:
      channel?.sender_domain ??
      (provider.requires_sender_domain ? "send.contentup.cc" : ""),
    sender_address:
      channel?.sender_address ??
      (provider.requires_sender_domain
        ? "edm@send.contentup.cc"
        : "hello@example.com"),
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
}) {
  const schema = createDeliveryChannelInput({
    provider: provider.provider,
    senderAliasMaxLength: provider.sender_alias_max_length,
    requiresSenderDomain: provider.requires_sender_domain,
  });
  const form = useForm<DeliveryChannelInput>({
    resolver: zodResolver(schema),
    defaultValues: defaults({ workspaceId, workspaceName, provider, channel }),
  });

  const regionKind = regionFieldKind(provider.provider);
  const titleProvider =
    provider.provider === "aliyun_directmail"
      ? "阿里云发信通道"
      : `${provider.display_name} 发信通道`;
  const regionOptions =
    provider.provider === "aliyun_directmail"
      ? directMailRegionOptions()
      : sendGridDataCenterOptions.map((option) => ({
          value: option.value,
          label: option.label,
        }));
  const showCredentialId = provider.provider !== "sendgrid";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onError("");
          form.reset(
            defaults({ workspaceId, workspaceName, provider, channel }),
          );
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        placement="bottom"
        className="bottom-sheet max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {connected ? `更新${titleProvider}` : `连接${titleProvider}`}
          </DialogTitle>
          <DialogDescription>
            保存区域、发件身份和加密凭据；只有点击“发送测试邮件”才会调用
            {provider.display_name}。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            onError("");
            await onSubmit(values);
          })}
        >
          <div className="space-y-2">
            <Label htmlFor="channel-region">
              {regionFieldLabel(provider.provider)}
            </Label>
            {regionKind === "select" ? (
              <Controller
                control={form.control}
                name="region"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="channel-region"
                      className="w-full"
                      aria-label={regionFieldLabel(provider.provider)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {regionOptions.map((option) => (
                        <SelectItem value={option.value} key={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            ) : (
              <Input
                id="channel-region"
                placeholder="us-east-1"
                spellCheck={false}
                {...form.register("region")}
              />
            )}
            <p className="field-error">
              {form.formState.errors.region?.message}
            </p>
          </div>

          {provider.requires_sender_domain && (
            <div className="space-y-2">
              <Label htmlFor="sender-domain">发件域名</Label>
              <Input
                id="sender-domain"
                placeholder="send.contentup.cc"
                {...form.register("sender_domain")}
              />
              <p className="field-error">
                {form.formState.errors.sender_domain?.message}
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sender-address">发件地址</Label>
              <Input
                id="sender-address"
                type="email"
                placeholder={
                  provider.requires_sender_domain
                    ? "hello@send.contentup.cc"
                    : "hello@example.com"
                }
                {...form.register("sender_address")}
              />
              <p className="field-error">
                {form.formState.errors.sender_address?.message}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sender-alias">发件人名称</Label>
              <Input
                id="sender-alias"
                maxLength={provider.sender_alias_max_length}
                {...form.register("sender_alias")}
              />
              <p className="field-error">
                {form.formState.errors.sender_alias?.message}
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="reply-to">回复地址（选填）</Label>
              <Input
                id="reply-to"
                type="email"
                placeholder="support@contentup.cc"
                {...form.register("reply_to_address")}
              />
              <p className="field-error">
                {form.formState.errors.reply_to_address?.message}
              </p>
            </div>
          </div>

          {provider.provider === "sendgrid" && (
            <div className="space-y-2">
              <Label htmlFor="event-webhook-public-key">
                Event Webhook 验签公钥（选填）
              </Label>
              <textarea
                id="event-webhook-public-key"
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-24 w-full rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                placeholder="SendGrid 控制台 Signed Event Webhook 公钥（PEM 或单行 Base64）"
                spellCheck={false}
                {...form.register("event_webhook_public_key")}
              />
              <p className="hint m-0">
                保存后用于 edm-sendgrid-events 校验回执签名；可在配置 Webhook
                前留空，但收到事件前必须填写。
              </p>
              <p className="field-error">
                {form.formState.errors.event_webhook_public_key?.message}
              </p>
            </div>
          )}

          {provider.provider === "amazon_ses" && (
            <div className="space-y-2">
              <Label htmlFor="sns-topic-arn">SNS Topic ARN（选填）</Label>
              <Input
                id="sns-topic-arn"
                placeholder="arn:aws:sns:us-east-1:123456789012:ses-events"
                spellCheck={false}
                {...form.register("sns_topic_arn")}
              />
              <p className="hint m-0">
                用于回执验签；可在配置 Webhook 前填写，区域须与上方 AWS
                区域一致。
              </p>
              <p className="field-error">
                {form.formState.errors.sns_topic_arn?.message}
              </p>
            </div>
          )}

          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold">
              {connected
                ? `替换 ${provider.credentialIdLabel}（选填）`
                : provider.credentialIdLabel}
            </h3>
            {connected && (
              <p className="hint mt-1 mb-3">
                留空会保留现有凭据；同时填写两项会创建新凭据版本。
              </p>
            )}
            <div
              className={
                showCredentialId
                  ? "grid gap-4 sm:grid-cols-2"
                  : "space-y-2"
              }
            >
              {showCredentialId && (
                <div className="space-y-2">
                  <Label htmlFor="access-key-id">
                    {provider.credentialIdLabel}
                  </Label>
                  <Input
                    id="access-key-id"
                    autoComplete="off"
                    spellCheck={false}
                    {...form.register("access_key_id")}
                  />
                  <p className="field-error">
                    {form.formState.errors.access_key_id?.message}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="access-key-secret">
                  {provider.credentialSecretLabel}
                </Label>
                <Input
                  id="access-key-secret"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={
                    provider.provider === "sendgrid" ? "SG.xxxxx" : undefined
                  }
                  {...form.register("access_key_secret")}
                />
                <p className="field-error">
                  {form.formState.errors.access_key_secret?.message}
                </p>
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "安全保存中…" : "安全保存配置"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
