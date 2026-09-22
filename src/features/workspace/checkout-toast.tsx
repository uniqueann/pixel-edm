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
          description: `${planLabel}在服务器上尚未配置 Creem/Dodo 商品 ID（CREEM_EDM_* / DODO_EDM_*）。请在 Vercel 填入 Team 四变量并重新部署；详见 docs/p11-team-billing-setup.md。`,
        });
      } else {
        toast.error("结账未完成", {
          description:
            params.get("msg") ?? "请稍后重试，或联系管理员检查支付配置。",
        });
      }
      return;
    }
    if (checkout === "cancel_scheduled") {
      toast.success("已取消续费", {
        description:
          "当前周期结束前权益保持不变，到期后降为免费版。客户和成员不会被删除。",
      });
      return;
    }
    if (checkout !== "success") return;
    const provider = params.get("provider");
    const planParam = params.get("plan");
    const planLabel =
      planParam === "team" ? "团队版" : planParam === "pro" ? "专业版" : null;
    const name =
      provider === "dodo"
        ? "Dodo Payments"
        : provider === "creem"
          ? "Creem"
          : "支付";
    toast.success(`${name} 结账已完成`, {
      description: planLabel
        ? `${planLabel}订阅生效可能需要几秒。若额度未更新，请刷新设置页。`
        : "订阅生效可能需要几秒。若额度未更新，请刷新页面或稍后在设置中查看。",
    });
  }, [params]);
  return null;
}
