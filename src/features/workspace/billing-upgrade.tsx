"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { WorkspaceDeliveryPlan } from "./delivery-plan";
import type { WorkspaceBillingStatus } from "./billing";
import {
  billingProviderLabel,
  deliveryPlanLabel,
  subscriptionStatusLabel,
} from "./plan-labels";

type BillingUpgradeProps = {
  workspaceId: string;
  deliveryPlan: WorkspaceDeliveryPlan;
  billing: WorkspaceBillingStatus | null;
  canUpgrade: boolean;
};

function formatPeriodEnd(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function BillingUpgrade({
  workspaceId,
  deliveryPlan,
  billing,
  canUpgrade,
}: BillingUpgradeProps) {
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [open, setOpen] = useState(false);
  const label = deliveryPlanLabel(
    deliveryPlan.plan,
    deliveryPlan.plan_display_name,
  );
  const providerLabel = billingProviderLabel(billing?.payment_provider ?? null);
  const periodEnd = formatPeriodEnd(billing?.current_period_end ?? null);
  const showUpgrade = canUpgrade && deliveryPlan.plan === "free";

  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">
        当前套餐：{label} · 有效客户 {deliveryPlan.billable_contacts} /{" "}
        {deliveryPlan.max_billable_contacts}
        {deliveryPlan.max_custom_templates !== null
          ? ` · 自定义模板 ${deliveryPlan.custom_templates} / ${deliveryPlan.max_custom_templates}`
          : " · 自定义模板不限"}
        {deliveryPlan.max_confirmed_campaigns_per_month !== null
          ? ` · 本月已确认活动 ${deliveryPlan.confirmed_campaigns_this_month} / ${deliveryPlan.max_confirmed_campaigns_per_month}`
          : null}
      </p>
      <p className="hint mt-1 mb-0">
        单活动最多 {deliveryPlan.max_recipients_per_campaign} 位收件人。
        {deliveryPlan.allows_team_collaboration
          ? ` 团队席位 ${deliveryPlan.active_members} / ${deliveryPlan.max_active_members}。`
          : " 个人版为单人使用，协作请升级团队版。"}
        平台日发信护栏 {deliveryPlan.usage_today} /{" "}
        {deliveryPlan.daily_send_quota} 封（{deliveryPlan.quota_timezone}{" "}
        日界）。
      </p>
      {billing?.has_payment_provider && (
        <p className="hint mt-2 mb-0">
          订阅：{providerLabel ?? "—"} ·{" "}
          {subscriptionStatusLabel(billing.subscription_status)}
          {periodEnd ? ` · 当前周期至 ${periodEnd}` : ""}
          {billing.cancel_at_period_end ? " · 已设置周期末取消" : ""}
        </p>
      )}
      {deliveryPlan.plan === "free" && !canUpgrade && (
        <p className="hint mt-2 mb-0">仅管理员可为工作区升级套餐。</p>
      )}
      {showUpgrade && (
        <div className="mt-3">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm">
                升级专业版
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>选择支付方式</DialogTitle>
                <DialogDescription>
                  Pixel EDM 专业版（{interval === "yearly" ? "年付" : "月付"}
                  ）·
                  更大客户名单与团队协作席位。支付由第三方处理，不会经过本站点保存卡号。
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={interval === "monthly" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInterval("monthly")}
                >
                  月付
                </Button>
                <Button
                  type="button"
                  variant={interval === "yearly" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInterval("yearly")}
                >
                  年付
                </Button>
              </div>
              <div className="space-y-2">
                <form action="/api/creem/checkout" method="post">
                  <input
                    type="hidden"
                    name="workspace_id"
                    value={workspaceId}
                  />
                  <input type="hidden" name="plan" value="pro" />
                  <input type="hidden" name="interval" value={interval} />
                  <Button type="submit" className="w-full justify-between">
                    <span>
                      <span className="block text-left text-sm font-bold">
                        Creem
                      </span>
                      <span className="block text-left text-xs font-normal opacity-80">
                        产品订阅
                      </span>
                    </span>
                    <span aria-hidden>→</span>
                  </Button>
                </form>
                <form action="/api/dodo/checkout" method="post">
                  <input
                    type="hidden"
                    name="workspace_id"
                    value={workspaceId}
                  />
                  <input type="hidden" name="plan" value="pro" />
                  <input type="hidden" name="interval" value={interval} />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="w-full justify-between"
                  >
                    <span>
                      <span className="block text-left text-sm font-bold">
                        Dodo Payments
                      </span>
                      <span className="block text-left text-xs font-normal opacity-80">
                        国际支付
                      </span>
                    </span>
                    <span aria-hidden>→</span>
                  </Button>
                </form>
              </div>
              <p className="hint mb-0 text-xs leading-relaxed">
                订阅将按所选周期自动续费；取消续费后当前周期结束会回到免费版额度。Team
                档与自助降档将在后续版本提供。
              </p>
            </DialogContent>
          </Dialog>
        </div>
      )}
      {deliveryPlan.plan !== "free" && !showUpgrade && (
        <p className="hint mt-2 mb-0">
          如需调整订阅或退款，请通过付款时使用的 Creem / Dodo
          账户管理；额度以当前工作区 plan 为准。
        </p>
      )}
    </div>
  );
}
