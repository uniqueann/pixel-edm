"use client";

import { useState } from "react";
import type { EdmBilledPlan } from "@/lib/billing/metadata";
import {
  EDM_PLAN_PRICING,
  edmPlanCheckoutDescription,
  edmPlanShortLabel,
  formatUsd,
} from "@/lib/billing/edm-plan-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BillingCheckoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  checkoutPlan: EdmBilledPlan;
  /** 从专业版升团队版时提示避免双订阅 */
  showProCancelHint?: boolean;
};

export function BillingCheckoutDialog({
  open,
  onOpenChange,
  workspaceId,
  checkoutPlan,
  showProCancelHint = false,
}: BillingCheckoutDialogProps) {
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const pricing = EDM_PLAN_PRICING[checkoutPlan];
  const priceLabel =
    interval === "yearly"
      ? `${formatUsd(pricing.yearlyUsd)}/年`
      : `${formatUsd(pricing.monthlyUsd)}/月`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            购买{edmPlanShortLabel(checkoutPlan)} · {priceLabel}
          </DialogTitle>
          <DialogDescription>
            {edmPlanCheckoutDescription(checkoutPlan, interval)}
            支付由第三方处理，不会在本站保存卡号。
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={interval === "monthly" ? "default" : "outline"}
            size="sm"
            onClick={() => setInterval("monthly")}
          >
            月付 {formatUsd(pricing.monthlyUsd)}
          </Button>
          <Button
            type="button"
            variant={interval === "yearly" ? "default" : "outline"}
            size="sm"
            onClick={() => setInterval("yearly")}
          >
            年付 {formatUsd(pricing.yearlyUsd)}
          </Button>
        </div>
        <div className="space-y-2">
          <BillingProviderForm
            action="/api/creem/checkout"
            workspaceId={workspaceId}
            plan={checkoutPlan}
            interval={interval}
            providerName="Creem"
            providerHint="产品订阅"
            variant="default"
          />
          <BillingProviderForm
            action="/api/dodo/checkout"
            workspaceId={workspaceId}
            plan={checkoutPlan}
            interval={interval}
            providerName="Dodo Payments"
            providerHint="国际支付"
            variant="secondary"
          />
        </div>
        {showProCancelHint && (
          <p className="hint mb-0 text-xs leading-relaxed">
            团队版生效后，请到 Creem / Dodo 账户取消原专业版订阅，避免重复扣费。
          </p>
        )}
        <p className="hint mb-0 text-xs leading-relaxed">
          订阅将按所选周期自动续费；取消续费后当前周期结束会回到免费版额度。席位加购与自助降档后续提供。
        </p>
      </DialogContent>
    </Dialog>
  );
}

function BillingProviderForm({
  action,
  workspaceId,
  plan,
  interval,
  providerName,
  providerHint,
  variant,
}: {
  action: string;
  workspaceId: string;
  plan: EdmBilledPlan;
  interval: "monthly" | "yearly";
  providerName: string;
  providerHint: string;
  variant: "default" | "secondary";
}) {
  return (
    <form action={action} method="post">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />
      <Button
        type="submit"
        variant={variant}
        className="w-full justify-between"
      >
        <span>
          <span className="block text-left text-sm font-bold">
            {providerName}
          </span>
          <span className="block text-left text-xs font-normal opacity-80">
            {providerHint}
          </span>
        </span>
        <span aria-hidden>→</span>
      </Button>
    </form>
  );
}
