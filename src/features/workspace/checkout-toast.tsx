"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CheckoutErrorReason } from "@/lib/billing/checkout-toast-copy";

const KNOWN_REASONS = new Set<CheckoutErrorReason>([
  "missing_product",
  "config",
  "provider",
  "discount",
  "auth",
  "forbidden",
  "plan",
]);

/** 支付回跳 settings?checkout=success|error 时提示一次，并清掉查询参数。 */
export function CheckoutSuccessToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("billing");

  useEffect(() => {
    const checkout = params.get("checkout");
    if (!checkout) return;

    const planParam = params.get("plan");
    const planLabel =
      planParam === "team"
        ? t("plans.team")
        : planParam === "pro"
          ? t("plans.pro")
          : null;

    if (checkout === "error") {
      const rawReason = params.get("reason");
      const reason =
        rawReason && KNOWN_REASONS.has(rawReason as CheckoutErrorReason)
          ? (rawReason as CheckoutErrorReason)
          : "default";
      const title = t(`toasts.errors.${reason}.title`);
      const description =
        reason === "plan"
          ? t("toasts.errors.plan.description", {
              plan: planLabel ?? t("plans.fallback"),
            })
          : t(`toasts.errors.${reason}.description`);
      toast.error(title, {
        id: "checkout-error",
        description,
      });
    } else if (checkout === "cancel_scheduled") {
      toast.success(t("toasts.cancelScheduledTitle"), {
        id: "checkout-cancel",
        description: t("toasts.cancelScheduledDescription"),
      });
    } else if (checkout === "success") {
      toast.success(t("toasts.successTitle"), {
        id: "checkout-success",
        description: planLabel
          ? t("toasts.successWithPlan", { plan: planLabel })
          : t("toasts.successGeneric"),
      });
    }

    router.replace(pathname, { scroll: false });
  }, [params, pathname, router, t]);

  return null;
}
