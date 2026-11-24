"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

export function ListPagination({
  page,
  pageSize,
  total,
  pending = false,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  pending?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const t = useTranslations("common.pagination");
  if (total === 0) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="list-pagination"
      data-busy={pending ? "true" : undefined}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={pending || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {t("previous")}
      </Button>
      <div className="list-pagination-summary flex flex-wrap items-center justify-center gap-2 text-center">
        <span>
          {t("summary", { first: firstItem, last: lastItem, total })}
          <span className="list-pagination-pages">
            {t("pages", { page, pageCount })}
          </span>
        </span>
        {onPageSizeChange && (
          <select
            aria-label={t("pageSizeAriaLabel")}
            className="list-filter list-filter-compact text-xs"
            value={pageSize}
            disabled={pending}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {t("perPage", { size })}
              </option>
            ))}
          </select>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        {t("next")}
      </Button>
    </nav>
  );
}
