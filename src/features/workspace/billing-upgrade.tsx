"use client";
import { Notice } from "@/components/ui/notice";

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

function usagePercent(used: number, max: number) {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function PlanUsageMetric({
  label,
  used,
  max,
  unit = "",
}: {
  label: string;
  used: number;
  max: number;
  unit?: string;
}) {
  return (
    <li className="plan-usage-item">
      <div className="plan-usage-item-head">
        <span className="plan-usage-label">{label}</span>
        <span className="plan-usage-value">
          {used.toLocaleString("zh-CN")} / {max.toLocaleString("zh-CN")}
          {unit}
        </span>
      </div>
      <div className="plan-usage-track" aria-hidden>
        <div
          className="plan-usage-fill"
          style={{ width: `${usagePercent(used, max)}%` }}
        />
      </div>
    </li>
  );
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
      <p className="font-medium text-foreground">当前套餐：{label}</p>
      <ul className="plan-usage-list">
        <PlanUsageMetric
          label="有效客户"
          used={deliveryPlan.billable_contacts}
          max={deliveryPlan.max_billable_contacts}
        />
        {deliveryPlan.max_custom_templates !== null ? (
          <PlanUsageMetric
            label="自定义模板"
            used={deliveryPlan.custom_templates}
            max={deliveryPlan.max_custom_templates}
          />
        ) : (
          <li className="plan-usage-item">
            <div className="plan-usage-item-head">
              <span className="plan-usage-label">自定义模板</span>
              <span className="plan-usage-value">不限</span>
            </div>
          </li>
        )}
        {deliveryPlan.max_confirmed_campaigns_per_month !== null && (
          <PlanUsageMetric
            label="本月已确认活动"
            used={deliveryPlan.confirmed_campaigns_this_month}
            max={deliveryPlan.max_confirmed_campaigns_per_month}
          />
        )}
        <li className="plan-usage-item">
          <div className="plan-usage-item-head">
            <span className="plan-usage-label">单活动收件人上限</span>
            <span className="plan-usage-value">
              {deliveryPlan.max_recipients_per_campaign.toLocaleString("zh-CN")}{" "}
              人
            </span>
          </div>
        </li>
        {deliveryPlan.allows_team_collaboration ? (
          <PlanUsageMetric
            label="团队席位"
            used={deliveryPlan.active_members}
            max={deliveryPlan.max_active_members}
          />
        ) : (
          <li className="plan-usage-item">
            <div className="plan-usage-item-head">
              <span className="plan-usage-label">协作</span>
              <span className="plan-usage-value">个人版单人使用</span>
            </div>
          </li>
        )}
        <PlanUsageMetric
          label="今日发信"
          used={deliveryPlan.usage_today}
          max={deliveryPlan.daily_send_quota}
          unit=" 封"
        />
      </ul>
      <p className="plan-meta mb-0">
        每日发信额度在北京时间 00:00 重置。
        {!deliveryPlan.allows_team_collaboration &&
          " 如需多人协作请升级团队版。"}
      </p>
      {billing?.has_payment_provider && (
        <p className="plan-meta mb-0">
          订阅：{providerLabel ?? "—"} ·{" "}
          {subscriptionStatusLabel(billing.subscription_status)}
          {periodEnd ? ` · 当前周期至 ${periodEnd}` : ""}
          {billing.cancel_at_period_end ? " · 已设置到期不续费" : ""}
        </p>
      )}
      {billing?.cancel_at_period_end && (
        <p className="plan-meta mb-0">
          当前周期到期前仍可正常使用。到期后将转为免费版，已有客户和成员均会保留。
        </p>
      )}
      {contactNudge !== null && (
        <Notice tone="warning" className="mt-3">
          有效客户还剩 {contactNudge} 个名额。用满后不能再新增，已有客户会保留。
        </Notice>
      )}
      {seatNudge !== null && (
        <Notice tone="warning" className="mt-3">
          团队席位还剩 {seatNudge} 个。席位加购尚未开放。
        </Notice>
      )}
      {memberCapLocked && (
        <Notice tone="warning" className="mt-3">
          当前成员数已超出套餐席位。成员仍会保留，但运营人员的操作权限已暂停。管理员可移除多余成员或升级套餐以恢复。
        </Notice>
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
              <p className="hint mb-0 w-full text-left">
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
