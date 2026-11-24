"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Tag } from "lucide-react";
import type { EdmBilledPlan } from "@/lib/billing/metadata";
import { normalizeCheckoutDiscountCode } from "@/lib/billing/discount-code";
import { getAppErrorCode, type AppErrorParams } from "@/lib/errors";
import { useErrorMessage } from "@/i18n/use-resolvers";
import { EDM_PLAN_PRICING, formatUsd } from "@/lib/billing/edm-plan-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** 结账按钮不展示支付服务商名称。 */

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
  const t = useTranslations("billing");
  const translateError = useErrorMessage();
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [discountOpen, setDiscountOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState<AppliedDiscount | null>(null);
  const [notice, setNotice] = useState<DiscountNotice | null>(null);
  const pricing = EDM_PLAN_PRICING[checkoutPlan];
  const priceLabel =
    interval === "yearly"
      ? t("checkout.perYear", { price: formatUsd(pricing.yearlyUsd) })
      : t("checkout.perMonth", { price: formatUsd(pricing.monthlyUsd) });
  const planName = t(`plans.${checkoutPlan}`);
  const cycleLabel =
    interval === "yearly"
      ? t("checkout.cycleYearly")
      : t("checkout.cycleMonthly");
  const checkoutDescription =
    checkoutPlan === "team"
      ? t("checkout.descriptionTeam", { cycle: cycleLabel })
      : t("checkout.descriptionPro", { cycle: cycleLabel });
  const draftNeedsVerify =
    discountOpen &&
    draft.trim().length > 0 &&
    applied?.code !== draft.trim().toUpperCase();

  function changeInterval(next: "monthly" | "yearly") {
    setInterval(next);
    setApplied(null);
    if (draft.trim()) {
      setNotice({
        tone: "error",
        text: t("checkout.intervalChangedNotice"),
      });
    }
  }

  async function verifyDiscount() {
    let code = "";
    try {
      code = normalizeCheckoutDiscountCode(draft);
    } catch (error) {
      setApplied(null);
      const errCode = getAppErrorCode(error);
      setNotice({
        tone: "error",
        text: translateError(
          errCode
            ? {
                code: errCode,
                message: error instanceof Error ? error.message : undefined,
              }
            : error instanceof Error
              ? error.message
              : undefined,
          "errors.billing.discountInvalid",
        ),
      });
      return;
    }
    if (!code) {
      setApplied(null);
      setNotice({
        tone: "error",
        text: translateError("errors.billing.discountRequired"),
      });
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
        errorCode?: string;
        code?: string;
        available?: boolean;
        message?: string;
        messageCode?: string;
        messageParams?: AppErrorParams;
        creem?: boolean;
        dodo?: boolean;
      };
      if (!response.ok || !data.ok || !data.code) {
        setApplied(null);
        setNotice({
          tone: "error",
          text: translateError(
            data.errorCode
              ? { code: data.errorCode, message: data.error }
              : data.error,
            "errors.billing.discountRetry",
          ),
        });
        return;
      }
      if (!data.available) {
        setApplied(null);
        setNotice({
          tone: "error",
          text: translateError(
            data.messageCode
              ? {
                  code: data.messageCode,
                  params: data.messageParams,
                  message: data.message,
                }
              : data.message,
            "errors.billing.discountMissing",
          ),
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
        text: translateError(
          data.messageCode
            ? {
                code: data.messageCode,
                params: data.messageParams,
                message: data.message,
              }
            : data.message,
          "errors.billing.discountAvailable",
        ),
      });
    } catch {
      setApplied(null);
      setNotice({
        tone: "error",
        text: translateError("errors.billing.discountRetry"),
      });
    } finally {
      setChecking(false);
    }
  }

  function guardUnverified(event: FormEvent) {
    if (!draftNeedsVerify) return;
    event.preventDefault();
    setNotice({
      tone: "error",
      text: t("checkout.verifyBeforeCheckout"),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-left">
            {t("checkout.dialogTitle", { plan: planName, price: priceLabel })}
          </DialogTitle>
          <DialogDescription className="text-left leading-relaxed text-pretty">
            <span className="block">{checkoutDescription}</span>
            <span className="mt-2 block text-xs text-muted-foreground">
              {t("checkout.thirdPartyPaymentNote")}
            </span>
          </DialogDescription>
        </DialogHeader>
        <p className="text-left text-sm font-medium text-foreground">
          {t("checkout.billingCycle")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={interval === "monthly" ? "default" : "outline"}
            size="sm"
            onClick={() => changeInterval("monthly")}
          >
            {t("checkout.monthlyButton", {
              price: formatUsd(pricing.monthlyUsd),
            })}
          </Button>
          <Button
            type="button"
            variant={interval === "yearly" ? "default" : "outline"}
            size="sm"
            onClick={() => changeInterval("yearly")}
          >
            {t("checkout.yearlyButton", {
              price: formatUsd(pricing.yearlyUsd),
            })}
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
          {t("checkout.paymentMethods")}
        </p>
        <div className="space-y-2">
          <BillingProviderForm
            action="/api/creem/checkout"
            workspaceId={workspaceId}
            plan={checkoutPlan}
            interval={interval}
            title={t("checkout.primaryCheckout")}
            hint={t("checkout.primaryHint")}
            appliedSubline={t("checkout.discountAppliedSubline")}
            excludedSubline={t("checkout.discountExcludedSubline")}
            variant="default"
            discountCode={applied?.creem ? applied.code : ""}
            discountHint={providerDiscountHint(applied, "creem")}
            disabled={checking}
            onSubmit={guardUnverified}
          />
          <BillingProviderForm
            action="/api/dodo/checkout"
            workspaceId={workspaceId}
            plan={checkoutPlan}
            interval={interval}
            title={t("checkout.altCheckout")}
            hint={t("checkout.altHint")}
            appliedSubline={t("checkout.discountAppliedSubline")}
            excludedSubline={t("checkout.discountExcludedSubline")}
            variant="outline"
            discountCode={applied?.dodo ? applied.code : ""}
            discountHint={providerDiscountHint(applied, "dodo")}
            disabled={checking}
            onSubmit={guardUnverified}
          />
        </div>
        {showProCancelHint && (
          <p className="hint mb-0 text-left text-xs leading-relaxed">
            {t("checkout.proCancelReminder")}
          </p>
        )}
        <p className="hint mb-0 text-left text-xs leading-relaxed">
          {t("checkout.renewalFootnote")}
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
  const t = useTranslations("billing.checkout");
  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("haveDiscountCode")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-expanded={false}
          onClick={onOpen}
        >
          <Tag aria-hidden />
          {t("applyDiscountCode")}
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
          placeholder={t("discountPlaceholder")}
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
          {t("verifyDiscount")}
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

type ProviderChannel = "creem" | "dodo";

/** 折扣只命中一个支付渠道时，在按钮副文案上标明。 */
function providerDiscountHint(
  applied: AppliedDiscount | null,
  channel: ProviderChannel,
): "applied" | "excluded" | null {
  if (!applied) return null;
  const eligible = channel === "creem" ? applied.creem : applied.dodo;
  const otherEligible = channel === "creem" ? applied.dodo : applied.creem;
  if (eligible && !otherEligible) return "applied";
  if (!eligible && otherEligible) return "excluded";
  return null;
}

function BillingProviderForm({
  action,
  workspaceId,
  plan,
  interval,
  title,
  hint,
  appliedSubline,
  excludedSubline,
  variant,
  discountCode,
  discountHint,
  disabled,
  onSubmit,
}: {
  action: string;
  workspaceId: string;
  plan: EdmBilledPlan;
  interval: "monthly" | "yearly";
  title: string;
  hint: string;
  appliedSubline: string;
  excludedSubline: string;
  variant: "default" | "outline" | "secondary";
  discountCode: string;
  discountHint: "applied" | "excluded" | null;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const subline =
    discountHint === "applied"
      ? appliedSubline
      : discountHint === "excluded"
        ? excludedSubline
        : hint;
  const buttonVariant = discountHint === "excluded" ? "secondary" : variant;

  return (
    <form action={action} method="post" onSubmit={onSubmit}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />
      {discountCode && (
        <input type="hidden" name="discount_code" value={discountCode} />
      )}
      <Button
        type="submit"
        variant={buttonVariant}
        disabled={disabled}
        className="h-auto w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left"
      >
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs font-normal opacity-80">{subline}</span>
      </Button>
    </form>
  );
}
