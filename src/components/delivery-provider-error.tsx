"use client";

import {
  describeDeliveryProviderError,
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
  if (!error_category?.trim() && !error_code?.trim()) return null;

  const copy = describeDeliveryProviderError({ error_category, error_code });

  return (
    <div className={className}>
      <p className="m-0 text-sm text-destructive">{copy.message}</p>
      {copy.hint ? <p className="hint mt-1 mb-0">{copy.hint}</p> : null}
      {copy.debugDetail ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            技术详情（排障）
          </summary>
          <p className="hint mt-1 mb-0 font-mono text-xs">{copy.debugDetail}</p>
        </details>
      ) : null}
    </div>
  );
}
