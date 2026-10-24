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
  if (total === 0) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="列表分页"
      className="list-pagination"
      data-busy={pending ? "true" : undefined}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={pending || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        上一页
      </Button>
      <div className="list-pagination-summary flex flex-wrap items-center justify-center gap-2 text-center">
        <span>
          第 {firstItem}–{lastItem} 条，共 {total} 条
          <span className="list-pagination-pages">
            （{page} / {pageCount}）
          </span>
        </span>
        {onPageSizeChange && (
          <select
            aria-label="每页显示条数"
            className="list-filter h-7 rounded border border-input bg-background px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            value={pageSize}
            disabled={pending}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} 条/页
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
        下一页
      </Button>
    </nav>
  );
}
