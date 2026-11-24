import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function Loading() {
  const t = await getTranslations("common.actions");
  return (
    <div aria-label={t("loading")} role="status" className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
      <span className="sr-only">{t("loadingWorkspace")}</span>
    </div>
  );
}
