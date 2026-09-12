"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ban,
  Copy,
  KeyRound,
  MailCheck,
  RotateCw,
  Send,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  disconnectDeliveryChannel,
  configureDeliveryWebhook,
  revokeDeliveryWebhook,
  saveDeliveryChannel,
  sendDeliveryChannelTest,
} from "./actions";
import {
  deliveryChannelInput,
  deliveryChannelStatusLabels,
  directMailRegionLabels,
  type DeliveryChannel,
  type DeliveryChannelInput,
  type DeliveryTestAttempt,
} from "./model";
import { directMailRegions } from "./provider";

const eventPattern = JSON.stringify(
  {
    source: ["acs.dm"],
    type: [
      "dm:Deliver:Succeed",
      "dm:Deliver:Fail",
      "dm:Feedback:FblReport",
      "dm:Feedback:Subscribe",
      "dm:Feedback:UnSubscribe",
      "dm:Trace:Open",
      "dm:Trace:Click",
    ],
  },
  null,
  2,
);

function defaults(input: {
  workspaceId: string;
  workspaceName: string;
  channel: DeliveryChannel | null;
}): DeliveryChannelInput {
  const { channel } = input;
  return {
    workspace_id: input.workspaceId,
    id: channel?.id,
    expected_version: channel?.version,
    region: channel?.region ?? "cn-hangzhou",
    sender_domain: channel?.sender_domain ?? "send.contentup.cc",
    sender_address: channel?.sender_address ?? "edm@send.contentup.cc",
    sender_alias: channel?.sender_alias ?? input.workspaceName.slice(0, 14),
    reply_to_address: channel?.reply_to_address ?? "",
    access_key_id: "",
    access_key_secret: "",
  };
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted px-3 py-2">
      <p className="hint m-0">{label}</p>
      <p className="truncate text-sm" title={value}>
        {value}
      </p>
    </div>
  );
}

export function ChannelSettings({
  workspaceId,
  workspaceName,
  initialChannel,
  initialTest,
  testRecipient,
  canEdit,
  canStoreCredentials,
}: {
  workspaceId: string;
  workspaceName: string;
  initialChannel: DeliveryChannel | null;
  initialTest: DeliveryTestAttempt | null;
  testRecipient: string;
  canEdit: boolean;
  canStoreCredentials: boolean;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState(initialChannel);
  const [lastTest, setLastTest] = useState(initialTest);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [disconnecting, startDisconnect] = useTransition();
  const [testing, startTesting] = useTransition();
  const [updatingWebhook, startWebhookUpdate] = useTransition();
  const testIdempotency = useRef<string | null>(null);
  const form = useForm<DeliveryChannelInput>({
    resolver: zodResolver(deliveryChannelInput),
    defaultValues: defaults({ workspaceId, workspaceName, channel }),
  });

  function prepareEditor() {
    setError("");
    form.reset(defaults({ workspaceId, workspaceName, channel }));
  }

  function disconnect() {
    if (
      !channel ||
      !window.confirm("确认断开发信通道？已保存的 AccessKey 密文会被删除。")
    )
      return;
    startDisconnect(async () => {
      const result = await disconnectDeliveryChannel({
        workspace_id: workspaceId,
        id: channel.id,
        expected_version: channel.version,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setChannel(result.data);
      toast.success("发信通道已断开，凭据已删除");
      router.refresh();
    });
  }

  function sendTest() {
    if (!channel || testing) return;
    const idempotencyKey = testIdempotency.current ?? crypto.randomUUID();
    testIdempotency.current = idempotencyKey;
    startTesting(async () => {
      const result = await sendDeliveryChannelTest({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_version: channel.version,
        idempotency_key: idempotencyKey,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      testIdempotency.current = null;
      setLastTest(result.data);
      if (result.channel) setChannel(result.channel);
      if (result.data.status === "accepted")
        toast.success("测试邮件已被 DirectMail 接收");
      else if (result.data.status === "unknown")
        toast.warning("发送结果未知，请先核对邮箱和 DirectMail 控制台");
      else toast.error(`测试发送失败：${result.data.error_code ?? "UNKNOWN"}`);
      router.refresh();
    });
  }

  function copy(value: string, label: string) {
    void navigator.clipboard.writeText(value).then(
      () => toast.success(`${label}已复制`),
      () => toast.error(`${label}复制失败，请手动复制`),
    );
  }

  function configureWebhook() {
    if (!channel || updatingWebhook) return;
    startWebhookUpdate(async () => {
      const result = await configureDeliveryWebhook({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_token_version: channel.webhook?.token_version,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setChannel(result.data);
      setWebhookToken(result.token);
      toast.success(
        channel.webhook?.configured
          ? "Webhook 令牌已轮换"
          : "Webhook 令牌已生成",
      );
      router.refresh();
    });
  }

  function revokeWebhook() {
    if (
      !channel?.webhook?.configured ||
      !channel.webhook.token_version ||
      !window.confirm("确认停用回执 Webhook？EventBridge 后续请求将被拒绝。")
    )
      return;
    startWebhookUpdate(async () => {
      const result = await revokeDeliveryWebhook({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_token_version: channel.webhook?.token_version,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setChannel(result.data);
      setWebhookToken(null);
      toast.success("回执 Webhook 已停用");
      router.refresh();
    });
  }

  const connected = channel && channel.status !== "disconnected";

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary">
              <MailCheck className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2>阿里云邮件推送 DirectMail</h2>
              <p className="hint m-0">
                每个工作区使用自己的阿里云账号与发件域名。
              </p>
            </div>
          </div>
          <Badge
            variant={channel?.status === "error" ? "destructive" : "outline"}
          >
            {channel ? deliveryChannelStatusLabels[channel.status] : "未连接"}
          </Badge>
        </div>

        {channel ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Detail
              label="区域"
              value={directMailRegionLabels[channel.region]}
            />
            <Detail label="发件域名" value={channel.sender_domain} />
            <Detail label="发件地址" value={channel.sender_address} />
            <Detail label="发件人" value={channel.sender_alias} />
            <Detail
              label="回复地址"
              value={channel.reply_to_address || "跟随发件地址"}
            />
            <Detail
              label="AccessKey"
              value={
                channel.credential_configured
                  ? channel.access_key_hint
                    ? `••••${channel.access_key_hint}`
                    : "已安全保存"
                  : "未保存"
              }
            />
            <Detail
              label="最近验证"
              value={
                channel.last_verified_at
                  ? new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(channel.last_verified_at))
                  : "尚未通过测试发送"
              }
            />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm">尚未配置发信通道。</p>
            <p className="hint m-0">
              保存区域、已验证发件身份和专用 RAM AccessKey 后即可测试发送。
            </p>
          </div>
        )}

        {channel && canEdit && channel.webhook && (
          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Webhook className="mt-0.5 size-5" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold">投递回执 Webhook</h3>
                  <p className="hint mt-1 mb-0">
                    接收投递、投诉、退订及行为事件；断开发信通道不会自动停用回执。
                  </p>
                </div>
              </div>
              <Badge variant="outline">
                {!channel.webhook.configured
                  ? "未配置"
                  : channel.webhook.last_event_at
                    ? "正在接收"
                    : "等待首个事件"}
              </Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-endpoint">HTTPS 目标地址</Label>
              <div className="flex gap-2">
                <Input
                  id="webhook-endpoint"
                  readOnly
                  value={channel.webhook.endpoint}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="复制 Webhook 地址"
                  onClick={() =>
                    copy(channel.webhook!.endpoint, "Webhook 地址")
                  }
                >
                  <Copy aria-hidden="true" />
                </Button>
              </div>
            </div>

            {webhookToken && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="text-sm font-medium">
                  请立即保存令牌，仅本次显示
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookToken}
                    className="bg-background font-mono text-xs"
                    aria-label="Webhook 令牌"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="复制 Webhook 令牌"
                    onClick={() => copy(webhookToken, "Webhook 令牌")}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                </div>
                <p className="m-0 text-xs">
                  在 EventBridge HTTP 目标高级选项中将它填入 Token；请求头名称为
                  x-eventbridge-signature-token。
                </p>
              </div>
            )}

            <details className="rounded-lg bg-muted p-3">
              <summary className="cursor-pointer text-sm font-medium">
                EventBridge 事件规则
              </summary>
              <p className="hint mt-2 mb-2">
                事件源请选择 acs.dm，消息体选择“完整事件”，不要选择
                acs.directmail。生产环境请启用指数退避并配置 MNS 死信队列。
              </p>
              <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
                {eventPattern}
              </pre>
            </details>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={channel.webhook.configured ? "outline" : "default"}
                disabled={updatingWebhook}
                onClick={configureWebhook}
              >
                {channel.webhook.configured && <RotateCw aria-hidden="true" />}
                {updatingWebhook
                  ? "处理中…"
                  : channel.webhook.configured
                    ? "轮换令牌"
                    : "生成令牌"}
              </Button>
              {channel.webhook.configured && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatingWebhook}
                  onClick={revokeWebhook}
                >
                  <Ban aria-hidden="true" />
                  停用 Webhook
                </Button>
              )}
            </div>
            {channel.webhook.configured && (
              <p className="hint m-0">
                当前令牌尾号 ••••{channel.webhook.token_hint}。轮换后旧令牌保留
                15 分钟宽限期，便于无中断更新 EventBridge。
              </p>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-muted p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="hint m-0">
            AccessKey 使用 AES-256-GCM 加密后存入私密 schema，页面不会回显
            Secret。测试邮件只发送到当前管理员的已验证登录邮箱。
          </p>
        </div>

        {lastTest && (
          <div className="rounded-xl border p-4 text-sm">
            <p className="font-medium">
              最近测试：
              {
                {
                  pending: "等待发送",
                  processing: "发送中",
                  accepted: "DirectMail 已接收",
                  failed: "发送失败",
                  unknown: "发送结果未知",
                }[lastTest.status]
              }
            </p>
            <p className="hint mt-1 mb-0">
              {lastTest.recipient_hint &&
                `收件人 ${lastTest.recipient_hint} · `}
              {lastTest.completed_at
                ? new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(lastTest.completed_at))
                : "尚未完成"}
              {lastTest.error_code && ` · ${lastTest.error_code}`}
            </p>
          </div>
        )}

        {!canStoreCredentials && canEdit && (
          <p role="alert" className="field-error">
            服务器尚未配置凭据加密密钥，发信通道暂时只能查看。
          </p>
        )}
        {!canEdit && (
          <p className="hint m-0">仅管理员可以连接或修改发信通道。</p>
        )}

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button disabled={!canStoreCredentials} onClick={prepareEditor}>
                  <KeyRound aria-hidden="true" />
                  {connected
                    ? "更新发信通道"
                    : channel
                      ? "重新连接发信通道"
                      : "连接发信通道"}
                </Button>
              </DialogTrigger>
              <DialogContent
                placement="bottom"
                className="bottom-sheet max-h-[90dvh] overflow-y-auto"
              >
                <DialogHeader>
                  <DialogTitle>
                    {connected ? "更新阿里云发信通道" : "连接阿里云发信通道"}
                  </DialogTitle>
                  <DialogDescription>
                    保存区域、发件身份和加密凭据；只有点击“发送测试邮件”才会调用
                    DirectMail。
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={form.handleSubmit(async (values) => {
                    setError("");
                    const result = await saveDeliveryChannel(values);
                    if ("error" in result) {
                      setError(result.error);
                      return;
                    }
                    setChannel(result.data);
                    setOpen(false);
                    toast.success(
                      connected ? "发信通道已更新" : "发信通道已连接",
                    );
                    router.refresh();
                  })}
                >
                  <div className="space-y-2">
                    <Label htmlFor="directmail-region">阿里云区域</Label>
                    <Controller
                      control={form.control}
                      name="region"
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger
                            id="directmail-region"
                            className="w-full"
                            aria-label="阿里云区域"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {directMailRegions.map((region) => (
                              <SelectItem value={region} key={region}>
                                {directMailRegionLabels[region]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
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
                    <div className="space-y-2">
                      <Label htmlFor="sender-address">发件地址</Label>
                      <Input
                        id="sender-address"
                        type="email"
                        placeholder="hello@send.contentup.cc"
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
                        maxLength={14}
                        {...form.register("sender_alias")}
                      />
                      <p className="field-error">
                        {form.formState.errors.sender_alias?.message}
                      </p>
                    </div>
                    <div className="space-y-2">
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
                  <div className="rounded-xl border p-4">
                    <h3 className="text-sm font-semibold">
                      {connected ? "替换 AccessKey（选填）" : "AccessKey"}
                    </h3>
                    {connected && (
                      <p className="hint mt-1 mb-3">
                        留空会保留现有凭据；同时填写两项会创建新凭据版本。
                      </p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="access-key-id">AccessKey ID</Label>
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
                      <div className="space-y-2">
                        <Label htmlFor="access-key-secret">
                          AccessKey Secret
                        </Label>
                        <Input
                          id="access-key-secret"
                          type="password"
                          autoComplete="new-password"
                          spellCheck={false}
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
                    <Button
                      type="submit"
                      disabled={form.formState.isSubmitting}
                    >
                      {form.formState.isSubmitting
                        ? "安全保存中…"
                        : "安全保存配置"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            {connected && (
              <>
                <Button
                  variant="secondary"
                  disabled={testing || !channel.credential_configured}
                  onClick={sendTest}
                  title={testRecipient ? `发送至 ${testRecipient}` : undefined}
                >
                  <Send aria-hidden="true" />
                  {testing ? "测试发送中…" : "发送测试邮件"}
                </Button>
                <Button
                  variant="outline"
                  disabled={disconnecting || testing}
                  onClick={disconnect}
                >
                  {disconnecting ? "断开中…" : "断开发信通道"}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
