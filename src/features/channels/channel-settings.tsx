"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, MailCheck, ShieldCheck } from "lucide-react";
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
import { disconnectDeliveryChannel, saveDeliveryChannel } from "./actions";
import {
  deliveryChannelInput,
  deliveryChannelStatusLabels,
  directMailRegionLabels,
  type DeliveryChannel,
  type DeliveryChannelInput,
} from "./model";
import { directMailRegions } from "./provider";

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
    region: channel?.region ?? "ap-southeast-1",
    sender_domain: channel?.sender_domain ?? "send.contentup.cc",
    sender_address: channel?.sender_address ?? "",
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
  canEdit,
  canStoreCredentials,
}: {
  workspaceId: string;
  workspaceName: string;
  initialChannel: DeliveryChannel | null;
  canEdit: boolean;
  canStoreCredentials: boolean;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState(initialChannel);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [disconnecting, startDisconnect] = useTransition();
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
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm">尚未配置发信通道。</p>
            <p className="hint m-0">
              先保存配置；有可用账号后再进入验证与测试发送阶段。
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-muted p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="hint m-0">
            AccessKey 使用 AES-256-GCM 加密后存入私密 schema，页面不会回显
            Secret。本阶段保存配置不会发送邮件。
          </p>
        </div>

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
                    当前只保存区域、发件身份和加密凭据，不会调用
                    DirectMail，也不会发送测试邮件。
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
              <Button
                variant="outline"
                disabled={disconnecting}
                onClick={disconnect}
              >
                {disconnecting ? "断开中…" : "断开发信通道"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
