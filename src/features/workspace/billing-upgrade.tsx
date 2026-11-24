"use client";
import { Notice } from "@/components/ui/notice";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { EdmBilledPlan } from "@/lib/billing/metadata";
import { Button } from "@/components/ui/button";
import type { WorkspaceDeliveryPlan } from "./delivery-plan";
import type { WorkspaceBillingStatus } from "./billing";
import { billingProviderLabel } from "./plan-labels";
import { BillingCheckoutDialog } from "./billing-checkout-dialog";
import { remainingAtUsageNudge } from "@/lib/billing/usage-nudge";
import {
  DEFAULT_LOCALE,
  formatDate,
  formatNumber,
  type AppLocale,
} from "@/i18n/format";
import { isAppLocale } from "@/i18n/config";

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

function usagePercent(used: number, max: number) {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function PlanUsageMetric({
  label,
  used,
  max,
  locale,
  valueText,
}: {
  label: string;
  used: number;
  max: number;
  locale: AppLocale;
  valueText?: string;
}) {
  return (
    <li className="plan-usage-item">
      <div className="plan-usage-item-head">
        <span className="plan-usage-label">{label}</span>
        <span className="plan-usage-value">
          {valueText ??
            `${formatNumber(used, locale)} / ${formatNumber(max, locale)}`}
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

/** 设置页展示当前工作区套餐、额度与结账入口。 */
export function BillingUpgrade({
  workspaceId,
  deliveryPlan,
  billing,
  canUpgrade,
  checkoutAvailability = { pro: true, team: true },
}: BillingUpgradeProps) {
  const t = useTranslations("billing");
  const rawLocale = useLocale();
  const locale: AppLocale = isAppLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const [checkoutPlan, setCheckoutPlan] = useState<EdmBilledPlan | null>(null);

  const planKey = deliveryPlan.plan;
  const label =
    planKey === "free" || planKey === "pro" || planKey === "team"
      ? t(`plans.${planKey}`)
      : deliveryPlan.plan_display_name || planKey;
  const providerLabel = billingProviderLabel(billing?.payment_provider ?? null);
  const periodEnd = billing?.current_period_end
    ? formatDate(billing.current_period_end, locale) || null
    : null;
  const subStatus = billing?.subscription_status ?? "none";
  const statusLabel =
    subStatus === "none" ||
    subStatus === "inactive" ||
    subStatus === "active" ||
    subStatus === "trialing" ||
    subStatus === "past_due" ||
    subStatus === "canceled" ||
    subStatus === "unpaid" ||
    subStatus === "incomplete"
      ? t(`subscriptionStatus.${subStatus}`)
      : subStatus;

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
        {t("currentPlan", { plan: label })}
      </p>
      <ul className="plan-usage-list">
        <PlanUsageMetric
          label={t("metrics.contacts")}
          used={deliveryPlan.billable_contacts}
          max={deliveryPlan.max_billable_contacts}
          locale={locale}
        />
        {deliveryPlan.max_custom_templates !== null ? (
          <PlanUsageMetric
            label={t("metrics.customTemplates")}
            used={deliveryPlan.custom_templates}
            max={deliveryPlan.max_custom_templates}
            locale={locale}
          />
        ) : (
          <li className="plan-usage-item">
            <div className="plan-usage-item-head">
              <span className="plan-usage-label">
                {t("metrics.customTemplates")}
              </span>
              <span className="plan-usage-value">{t("metrics.unlimited")}</span>
            </div>
          </li>
        )}
        {deliveryPlan.max_confirmed_campaigns_per_month !== null && (
          <PlanUsageMetric
            label={t("metrics.confirmedCampaigns")}
            used={deliveryPlan.confirmed_campaigns_this_month}
            max={deliveryPlan.max_confirmed_campaigns_per_month}
            locale={locale}
          />
        )}
        <li className="plan-usage-item">
          <div className="plan-usage-item-head">
            <span className="plan-usage-label">
              {t("metrics.maxRecipients")}
            </span>
            <span className="plan-usage-value">
              {t("metrics.recipientsValue", {
                count: formatNumber(
                  deliveryPlan.max_recipients_per_campaign,
                  locale,
                ),
              })}
            </span>
          </div>
        </li>
        {deliveryPlan.allows_team_collaboration ? (
          <PlanUsageMetric
            label={t("metrics.teamSeats")}
            used={deliveryPlan.active_members}
            max={deliveryPlan.max_active_members}
            locale={locale}
          />
        ) : (
          <li className="plan-usage-item">
            <div className="plan-usage-item-head">
              <span className="plan-usage-label">
                {t("metrics.collaboration")}
              </span>
              <span className="plan-usage-value">
                {t("metrics.personalOnly")}
              </span>
            </div>
          </li>
        )}
        <PlanUsageMetric
          label={t("metrics.dailySends")}
          used={deliveryPlan.usage_today}
          max={deliveryPlan.daily_send_quota}
          locale={locale}
          valueText={t("metrics.dailySendsValue", {
            used: formatNumber(deliveryPlan.usage_today, locale),
            max: formatNumber(deliveryPlan.daily_send_quota, locale),
          })}
        />
      </ul>
      <p className="plan-meta mb-0">
        {t("quotaResetNote")}
        {!deliveryPlan.allows_team_collaboration && t("teamUpgradeHint")}
      </p>
      {billing?.has_payment_provider && (
        <p className="plan-meta mb-0">
          {t("subscriptionSummary", {
            provider: providerLabel ?? "—",
            status: statusLabel,
          })}
          {periodEnd ? t("periodEnd", { date: periodEnd }) : ""}
          {billing.cancel_at_period_end ? t("cancelAtPeriodEnd") : ""}
        </p>
      )}
      {billing?.cancel_at_period_end && (
        <p className="plan-meta mb-0">{t("cancelScheduledNote")}</p>
      )}
      {contactNudge !== null && (
        <Notice tone="warning" className="mt-3">
          {t("nudges.contactsRemaining", { count: contactNudge })}
        </Notice>
      )}
      {seatNudge !== null && (
        <Notice tone="warning" className="mt-3">
          {t("nudges.seatsRemaining", { count: seatNudge })}
        </Notice>
      )}
      {memberCapLocked && (
        <Notice tone="warning" className="mt-3">
          {t("nudges.memberCapLocked")}
        </Notice>
      )}
      {deliveryPlan.plan === "free" && !canUpgrade && (
        <p className="hint mt-2 mb-0">{t("adminOnlyUpgrade")}</p>
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
              {t("upgradePro")}
            </Button>
          )}
          {canBuyTeam && (
            <Button
              type="button"
              size="sm"
              variant={canBuyPro ? "outline" : "default"}
              onClick={() => setCheckoutPlan("team")}
            >
              {deliveryPlan.plan === "pro" ? t("upgradeTeam") : t("buyTeam")}
            </Button>
          )}
          {canUpgrade &&
            (deliveryPlan.plan === "free" || deliveryPlan.plan === "pro") &&
            !teamSkuReady && (
              <p className="hint mb-0 w-full text-left">
                {t("teamSkuUnavailable")}
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
        <p className="hint mt-2 mb-0">{t("manageSubscriptionHint")}</p>
      )}
      {canCancelRenewal && (
        <form
          className="mt-3"
          action="/api/billing/cancel"
          method="post"
          onSubmit={(event) => {
            if (!window.confirm(t("cancelRenewalConfirm"))) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <Button type="submit" size="sm" variant="outline">
            {t("cancelRenewalButton")}
          </Button>
        </form>
      )}
      {deliveryPlan.plan === "pro" && canBuyTeam && (
        <p className="hint mt-2 mb-0">{t("proToTeamHint")}</p>
      )}
    </div>
  );
}
