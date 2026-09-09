import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div aria-label="加载中" role="status" className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
      <span className="sr-only">正在加载工作区</span>
    </div>
  );
}
