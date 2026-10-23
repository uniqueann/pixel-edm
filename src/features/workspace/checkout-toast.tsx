"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { checkoutErrorToast } from "@/lib/billing/checkout-toast-copy";

/** 支付回跳 settings?checkout=success|error 时提示一次，并清掉查询参数。 */
export function CheckoutSuccessToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkout = params.get("checkout");
    if (!checkout) return;

    if (checkout === "error") {
      const reason = params.get("reason");
      const copy = checkoutErrorToast({
        reason,
        plan: params.get("plan"),
      });
      toast.error(copy.title, {
        id: "checkout-error",
        description: copy.description,
      });
    } else if (checkout === "cancel_scheduled") {
      toast.success("已取消续费", {
        id: "checkout-cancel",
        description:
          "当前周期到期前仍可正常使用，到期后自动降为免费版，数据不会丢失。",
      });
    } else if (checkout === "success") {
      const planParam = params.get("plan");
      const planLabel =
        planParam === "team" ? "团队版" : planParam === "pro" ? "专业版" : null;
      toast.success("结账已完成", {
        id: "checkout-success",
        description: planLabel
          ? `${planLabel}订阅生效可能需要几秒。若额度未更新，请刷新设置页。`
          : "订阅生效可能需要几秒。若额度未更新，请刷新页面或稍后在设置中查看。",
      });
    }

    router.replace(pathname, { scroll: false });
  }, [params, pathname, router]);

  return null;
}
