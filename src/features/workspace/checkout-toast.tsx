"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** 支付成功回跳 settings?checkout=success 时提示一次。 */
export function CheckoutSuccessToast() {
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("checkout") !== "success") return;
    const provider = params.get("provider");
    const name =
      provider === "dodo"
        ? "Dodo Payments"
        : provider === "creem"
          ? "Creem"
          : "支付";
    toast.success(`${name} 结账已完成`, {
      description:
        "订阅生效可能需要几秒。若额度未更新，请刷新页面或稍后在设置中查看。",
    });
  }, [params]);
  return null;
}
