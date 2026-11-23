"use client";

import { useTranslations } from "next-intl";
import {
  classifyDeliveryProviderError,
  type DeliveryProviderErrorInput,
} from "@/lib/delivery-provider-error";

type DeliveryProviderErrorBlockProps = DeliveryProviderErrorInput & {
  className?: string;
};

/** 列表/卡片内展示友好说明，原始 category/code 折叠在「技术详情」中。 */
export function DeliveryProviderErrorBlock({
  error_category,
  error_code,
  className,
}: DeliveryProviderErrorBlockProps) {
  const t = useTranslations("common.providerErrors");
  if (!error_category?.trim() && !error_code?.trim()) return null;

  const { key, debugDetail } = classifyDeliveryProviderError({
    error_category,
    error_code,
  });

  return (
    <div className={className}>
      <p className="m-0 text-sm text-destructive">{t(`${key}.message`)}</p>
      <p className="hint mt-1 mb-0">{t(`${key}.hint`)}</p>
      {debugDetail ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t("technicalDetails")}
          </summary>
          <p className="hint mt-1 mb-0 font-mono text-xs">{debugDetail}</p>
        </details>
      ) : null}
    </div>
  );
}
