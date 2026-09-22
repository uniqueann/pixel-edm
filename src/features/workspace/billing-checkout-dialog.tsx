"use client";

import { useState, type FormEvent } from "react";
import { Tag } from "lucide-react";
import type { EdmBilledPlan } from "@/lib/billing/metadata";
import { normalizeCheckoutDiscountCode } from "@/lib/billing/discount-code";
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
import { Input } from "@/components/ui/input";

/** 两个通道能力一致，副标题统一，避免「产品订阅 / 国际支付」造成误解。 */
const CHECKOUT_PROVIDER_HINT = "订阅结账";

type AppliedDiscount = {
  code: string;
  creem: boolean;
  dodo: boolean;
};

type DiscountNotice = {
  tone: "success" | "error";
  text: string;
};

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
  const [discountOpen, setDiscountOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState<AppliedDiscount | null>(null);
  const [notice, setNotice] = useState<DiscountNotice | null>(null);
  const pricing = EDM_PLAN_PRICING[checkoutPlan];
  const priceLabel =
    interval === "yearly"
      ? `${formatUsd(pricing.yearlyUsd)}/年`
      : `${formatUsd(pricing.monthlyUsd)}/月`;
  const draftNeedsVerify =
    discountOpen &&
    draft.trim().length > 0 &&
    applied?.code !== draft.trim().toUpperCase();

  function changeInterval(next: "monthly" | "yearly") {
    setInterval(next);
    setApplied(null);
    if (draft.trim()) {
      setNotice({ tone: "error", text: "计费周期已更换，请重新验证。" });
    }
  }

  async function verifyDiscount() {
    let code = "";
    try {
      code = normalizeCheckoutDiscountCode(draft);
    } catch (error) {
      setApplied(null);
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "折扣代码无效。",
      });
      return;
    }
    if (!code) {
      setApplied(null);
      setNotice({ tone: "error", text: "请输入折扣代码。" });
      return;
    }
    setChecking(true);
    setNotice(null);
    try {
      const response = await fetch("/api/billing/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          plan: checkoutPlan,
          interval,
          code,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        available?: boolean;
        message?: string;
        creem?: boolean;
        dodo?: boolean;
      };
      if (!response.ok || !data.ok || !data.code) {
        setApplied(null);
        setNotice({
          tone: "error",
          text: data.error ?? "暂时无法验证这个折扣代码，请稍后重试。",
        });
        return;
      }
      if (!data.available) {
        setApplied(null);
        setNotice({
          tone: "error",
          text: data.message ?? "折扣代码不存在",
        });
        return;
      }
      setDraft(data.code);
      setApplied({
        code: data.code,
        creem: Boolean(data.creem),
        dodo: Boolean(data.dodo),
      });
      setNotice({
        tone: "success",
        text: data.message ?? "太棒了！这个折扣代码可用。",
      });
    } catch {
      setApplied(null);
      setNotice({
        tone: "error",
        text: "暂时无法验证这个折扣代码，请稍后重试。",
      });
    } finally {
      setChecking(false);
    }
  }

  function guardUnverified(event: FormEvent) {
    if (!draftNeedsVerify) return;
    event.preventDefault();
    setNotice({ tone: "error", text: "请先点击验证。" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-left">
            购买{edmPlanShortLabel(checkoutPlan)} · {priceLabel}
          </DialogTitle>
          <DialogDescription className="text-left leading-relaxed text-pretty">
            <span className="block">
              {edmPlanCheckoutDescription(checkoutPlan, interval)}
            </span>
            <span className="mt-2 block text-xs text-muted-foreground">
              支付由第三方处理，不会在本站保存卡号。
            </span>
          </DialogDescription>
        </DialogHeader>
        <p className="text-left text-sm font-medium text-foreground">
          计费周期
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={interval === "monthly" ? "default" : "outline"}
            size="sm"
            onClick={() => changeInterval("monthly")}
          >
            月付 {formatUsd(pricing.monthlyUsd)}
          </Button>
          <Button
            type="button"
            variant={interval === "yearly" ? "default" : "outline"}
            size="sm"
            onClick={() => changeInterval("yearly")}
          >
            年付 {formatUsd(pricing.yearlyUsd)}
          </Button>
        </div>
        <CheckoutDiscountCode
          open={discountOpen}
          draft={draft}
          checking={checking}
          notice={notice}
          onOpen={() => setDiscountOpen(true)}
          onDraftChange={(value) => {
            setDraft(value);
            setApplied(null);
            setNotice(null);
          }}
          onVerify={() => void verifyDiscount()}
        />
        <p className="text-left text-sm font-medium text-foreground">
          支付渠道
        </p>
        <div className="space-y-2">
          <BillingProviderForm
            action="/api/creem/checkout"
            workspaceId={workspaceId}
            plan={checkoutPlan}
            interval={interval}
            providerName="Creem"
            providerHint={CHECKOUT_PROVIDER_HINT}
            variant="default"
            discountCode={applied?.creem ? applied.code : ""}
            disabled={checking}
            onSubmit={guardUnverified}
          />
          <BillingProviderForm
            action="/api/dodo/checkout"
            workspaceId={workspaceId}
            plan={checkoutPlan}
            interval={interval}
            providerName="Dodo Payments"
            providerHint={CHECKOUT_PROVIDER_HINT}
            variant="outline"
            discountCode={applied?.dodo ? applied.code : ""}
            disabled={checking}
            onSubmit={guardUnverified}
          />
        </div>
        {showProCancelHint && (
          <p className="hint mb-0 text-left text-xs leading-relaxed">
            团队版生效后，请到 Creem / Dodo 账户取消原专业版订阅，避免重复扣费。
          </p>
        )}
        <p className="hint mb-0 text-left text-xs leading-relaxed">
          订阅将按所选周期自动续费；取消续费后当前周期结束会回到免费版额度。席位加购与自助降档后续提供。
        </p>
      </DialogContent>
    </Dialog>
  );
}

function CheckoutDiscountCode({
  open,
  draft,
  checking,
  notice,
  onOpen,
  onDraftChange,
  onVerify,
}: {
  open: boolean;
  draft: string;
  checking: boolean;
  notice: DiscountNotice | null;
  onOpen: () => void;
  onDraftChange: (value: string) => void;
  onVerify: () => void;
}) {
  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">有折扣代码吗？</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-expanded={false}
          onClick={onOpen}
        >
          <Tag aria-hidden />
          应用折扣代码
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex">
        <Input
          id="checkout-discount-code"
          value={draft}
          placeholder="折扣代码"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={14}
          spellCheck={false}
          aria-invalid={notice?.tone === "error"}
          aria-describedby={notice ? "checkout-discount-notice" : undefined}
          className="h-10 rounded-e-none shadow-none focus-visible:z-10"
          onChange={(event) => onDraftChange(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onVerify();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-s-none border-s-0 px-4"
          disabled={checking}
          aria-busy={checking}
          onClick={onVerify}
        >
          验证
        </Button>
      </div>
      {notice && (
        <p
          id="checkout-discount-notice"
          className={
            notice.tone === "error"
              ? "text-sm text-destructive"
              : "text-sm text-emerald-600 dark:text-emerald-400"
          }
        >
          {notice.text}
        </p>
      )}
    </div>
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
  discountCode,
  disabled,
  onSubmit,
}: {
  action: string;
  workspaceId: string;
  plan: EdmBilledPlan;
  interval: "monthly" | "yearly";
  providerName: string;
  providerHint: string;
  variant: "default" | "outline" | "secondary";
  discountCode: string;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form action={action} method="post" onSubmit={onSubmit}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />
      {discountCode ? (
        <input type="hidden" name="discount_code" value={discountCode} />
      ) : null}
      <Button
        type="submit"
        variant={variant}
        className="w-full justify-between"
        disabled={disabled}
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
