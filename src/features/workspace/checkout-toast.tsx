"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** 支付回跳 settings?checkout=success|error 时提示一次。 */
export function CheckoutSuccessToast() {
  const params = useSearchParams();
  useEffect(() => {
    const checkout = params.get("checkout");
    if (checkout === "error") {
      const reason = params.get("reason");
      const planParam = params.get("plan");
      const planLabel =
        planParam === "team"
          ? "团队版"
          : planParam === "pro"
            ? "专业版"
            : "该档位";
      if (reason === "missing_product") {
        toast.error("暂时无法跳转支付", {
          id: "checkout-error",
          description: "支付服务暂未就绪，请稍后重试或联系客服。",
        });
      } else if (reason === "discount") {
        toast.error("优惠码无效", {
          id: "checkout-error",
          description:
            params.get("msg") ??
            "优惠码无效或不能用于当前套餐。请检查后再试，也可以留空直接结账。",
        });
      } else {
        toast.error("结账未完成", {
          id: "checkout-error",
          description:
            params.get("msg") ?? "请稍后重试，或联系管理员检查支付配置。",
        });
      }
      return;
    }
    if (checkout === "cancel_scheduled") {
      toast.success("已取消续费", {
        id: "checkout-cancel",
        description:
          "当前周期到期前仍可正常使用，到期后自动降为免费版，数据不会丢失。",
      });
      return;
    }
    if (checkout !== "success") return;
    const planParam = params.get("plan");
    const planLabel =
      planParam === "team" ? "团队版" : planParam === "pro" ? "专业版" : null;
    toast.success("结账已完成", {
      id: "checkout-success",
      description: planLabel
        ? `${planLabel}订阅生效可能需要几秒。若额度未更新，请刷新设置页。`
        : "订阅生效可能需要几秒。若额度未更新，请刷新页面或稍后在设置中查看。",
    });
  }, [params]);
  return null;
}
