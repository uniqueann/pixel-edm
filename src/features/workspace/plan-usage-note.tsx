import Link from "next/link";
import { settingsSectionHref } from "@/features/settings/anchors";
import { isQuotaExhausted, quotaUsageText, type PlanQuota } from "./plan-usage";

/** 操作按钮旁的套餐用量提示；达到上限时附带套餐入口。不限额的套餐不展示。 */
export function PlanUsageNote({
  label,
  quota,
  exhaustedText,
  className = "",
  testId,
}: {
  label: string;
  quota: PlanQuota | null | undefined;
  exhaustedText: string;
  className?: string;
  testId?: string;
}) {
  const usage = quotaUsageText(quota);
  if (!usage) return null;
  const exhausted = isQuotaExhausted(quota);
  return (
    <p
      className={`${exhausted ? "field-error" : "hint"} ${className}`.trim()}
      data-testid={testId}
      role={exhausted ? "status" : undefined}
    >
      {label}：{usage}
      {exhausted && (
        <>
          。{exhaustedText}{" "}
          <Link
            href={settingsSectionHref("billing")}
            className="underline underline-offset-2"
          >
            查看套餐
          </Link>
        </>
      )}
    </p>
  );
}
