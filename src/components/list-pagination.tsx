import { Button } from "@/components/ui/button";

export function ListPagination({
  page,
  pageSize,
  total,
  pending = false,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  pending?: boolean;
  onPageChange: (page: number) => void;
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
        disabled={pending || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        上一页
      </Button>
      <span>
        第 {firstItem}–{lastItem} 条，共 {total} 条
        <span className="list-pagination-pages">
          （{page} / {pageCount}）
        </span>
      </span>
      <Button
        variant="outline"
        disabled={pending || page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
      </Button>
    </nav>
  );
}
