"use client";

import { useState } from "react";
import type { EdmBilledPlan } from "@/lib/billing/metadata";
import { Button } from "@/components/ui/button";
import type { WorkspaceDeliveryPlan } from "./delivery-plan";
import type { WorkspaceBillingStatus } from "./billing";
import {
  billingProviderLabel,
  deliveryPlanLabel,
  subscriptionStatusLabel,
} from "./plan-labels";
import { BillingCheckoutDialog } from "./billing-checkout-dialog";
import { remainingAtUsageNudge } from "@/lib/billing/usage-nudge";

export type EdmCheckoutAvailability = {
  pro: boolean;
  team: boolean;
};

type BillingUpgradeProps = {
  workspaceId: string;
  deliveryPlan: WorkspaceDeliveryPlan;
  billing: WorkspaceBillingStatus | null;
  canUpgrade: boolean;
  checkoutAvailability?: EdmCheckoutAvailability;
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
  checkoutAvailability = { pro: true, team: true },
}: BillingUpgradeProps) {
  const [checkoutPlan, setCheckoutPlan] = useState<EdmBilledPlan | null>(null);
  const label = deliveryPlanLabel(
    deliveryPlan.plan,
    deliveryPlan.plan_display_name,
  );
  const providerLabel = billingProviderLabel(billing?.payment_provider ?? null);
  const periodEnd = formatPeriodEnd(billing?.current_period_end ?? null);

  const canBuyPro = canUpgrade && deliveryPlan.plan === "free";
  const contactNudge = remainingAtUsageNudge(
    deliveryPlan.billable_contacts,
    deliveryPlan.max_billable_contacts,
  );
  const seatNudge =
    deliveryPlan.plan === "team"
      ? remainingAtUsageNudge(
          deliveryPlan.active_members,
          deliveryPlan.max_active_members,
        )
      : null;
  const memberCapLocked =
    deliveryPlan.active_members > deliveryPlan.max_active_members;
  const canCancelRenewal =
    canUpgrade &&
    (deliveryPlan.plan === "pro" || deliveryPlan.plan === "team") &&
    Boolean(billing?.has_payment_provider) &&
    !billing?.cancel_at_period_end;
  const teamSkuReady = checkoutAvailability.team;
  const canBuyTeam =
    teamSkuReady &&
    canUpgrade &&
    (deliveryPlan.plan === "free" || deliveryPlan.plan === "pro");

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
        每日发信上限 {deliveryPlan.usage_today} /{" "}
        {deliveryPlan.daily_send_quota} 封（北京时间每日 00:00 重置）。
      </p>
      {billing?.has_payment_provider && (
        <p className="hint mt-2 mb-0">
          订阅：{providerLabel ?? "—"} ·{" "}
          {subscriptionStatusLabel(billing.subscription_status)}
          {periodEnd ? ` · 当前周期至 ${periodEnd}` : ""}
          {billing.cancel_at_period_end ? " · 已设置到期不续费" : ""}
        </p>
      )}
      {billing?.cancel_at_period_end && (
        <p className="hint mt-2 mb-0">
          当前周期到期前仍可正常使用。到期后将转为免费版，已有客户和成员均会保留。
        </p>
      )}
      {contactNudge !== null && (
        <p className="hint mt-2 mb-0">
          有效客户还剩 {contactNudge} 个名额。用满后不能再新增，已有客户会保留。
        </p>
      )}
      {seatNudge !== null && (
        <p className="hint mt-2 mb-0">
          团队席位还剩 {seatNudge} 个。席位加购尚未开放。
        </p>
      )}
      {memberCapLocked && (
        <p className="hint mt-2 mb-0">
          当前成员数已超出套餐席位。成员仍会保留，但运营人员的操作权限已暂停。管理员可移除多余成员或升级套餐以恢复。
        </p>
      )}
      {deliveryPlan.plan === "free" && !canUpgrade && (
        <p className="hint mt-2 mb-0">仅管理员可为工作区升级套餐。</p>
      )}
      {(canBuyPro || canBuyTeam) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canBuyPro && (
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => setCheckoutPlan("pro")}
            >
              升级专业版
            </Button>
          )}
          {canBuyTeam && (
            <Button
              type="button"
              size="sm"
              variant={canBuyPro ? "outline" : "default"}
              onClick={() => setCheckoutPlan("team")}
            >
              {deliveryPlan.plan === "pro" ? "升级团队版" : "购买团队版"}
            </Button>
          )}
          {canUpgrade &&
            (deliveryPlan.plan === "free" || deliveryPlan.plan === "pro") &&
            !teamSkuReady && (
              <p className="hint mb-0 w-full text-left text-xs">
                团队版在线支付暂未开放，如需开通请联系客服或管理员。
              </p>
            )}
        </div>
      )}
      {checkoutPlan && (
        <BillingCheckoutDialog
          open
          onOpenChange={(open) => {
            if (!open) setCheckoutPlan(null);
          }}
          workspaceId={workspaceId}
          checkoutPlan={checkoutPlan}
          showProCancelHint={
            checkoutPlan === "team" && deliveryPlan.plan === "pro"
          }
        />
      )}
      {deliveryPlan.plan !== "free" && !canBuyPro && !canBuyTeam && (
        <p className="hint mt-2 mb-0">
          如需调整续费、更改支付方式或申请退款，请直接点击付款收据邮件中的「管理订阅」链接；额度以当前工作区套餐为准。
        </p>
      )}
      {canCancelRenewal && (
        <form
          className="mt-3"
          action="/api/billing/cancel"
          method="post"
          onSubmit={(event) => {
            if (
              !window.confirm(
                "确认取消自动续费？当前周期到期前仍可正常使用，到期后自动降为免费版，数据不会丢失。",
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <Button type="submit" size="sm" variant="outline">
            取消续费
          </Button>
        </form>
      )}
      {deliveryPlan.plan === "pro" && canBuyTeam && (
        <p className="hint mt-2 mb-0">
          已订阅专业版时，可在支付平台管理原订阅；购买团队版后请取消专业版以免重复扣费。
        </p>
      )}
    </div>
  );
}
