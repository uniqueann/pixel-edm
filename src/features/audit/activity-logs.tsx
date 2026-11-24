"use client";
import { PageHeader } from "@/components/page-header";
import { ListToolbar, FilterField } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListPagination } from "@/components/list-pagination";
import { LocalDate } from "@/components/local-date";
import {
  activityFilterMeta,
  activityLabel,
  activityLabels,
  type ActivityLogList,
} from "./model";

type DynamicAuditT = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

function actionMessageKey(action: string) {
  return action.replaceAll(".", "_");
}

function localizedActivityLabel(action: string, t: DynamicAuditT) {
  const key = `actions.${actionMessageKey(action)}`;
  if (t.has(key)) return t(key);
  if (action.startsWith("contact")) return t("actions.fallback_contact");
  if (action.startsWith("campaign")) return t("actions.fallback_campaign");
  if (action.startsWith("template")) return t("actions.fallback_template");
  if (action.startsWith("delivery_")) return t("actions.fallback_delivery");
  if (action.startsWith("team.") || action.startsWith("workspace."))
    return t("actions.fallback_team");
  return t("actions.fallback_other");
}

function localizedFilterLabel(action: string, t: DynamicAuditT) {
  const meta = activityFilterMeta(action);
  if (!meta.groupLabel) return localizedActivityLabel(action, t);
  const shortKey = `shortActions.${actionMessageKey(action)}`;
  const shortLabel = t.has(shortKey)
    ? t(shortKey)
    : localizedActivityLabel(action, t);
  return t("groupFormat", {
    group: t(`groups.${meta.group}`),
    shortLabel,
  });
}

export function ActivityLogs({
  data,
  filters,
}: {
  data: ActivityLogList;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const tRaw = useTranslations("audit");
  const t = tRaw as unknown as DynamicAuditT;
  const [pending, startTransition] = useTransition();
  const hasFilters = Boolean(filters.actor || filters.action);

  function navigate(changes: Record<string, string>) {
    const next = { ...filters, ...changes };
    Object.entries(next).forEach(([key, value]) => {
      if (!value) delete next[key];
    });
    const params = new URLSearchParams(next);
    startTransition(() => router.replace(`/logs?${params}`));
  }

  useEffect(() => {
    if (filters.page && Number(filters.page) !== data.page) {
      const params = new URLSearchParams({
        ...filters,
        page: String(data.page),
      });
      router.replace(`/logs?${params}`);
    }
  }, [data.page, filters, router]);

  return (
    <>
      <PageHeader
        title={tRaw("title")}
        meta={tRaw("metaCount", { total: data.total })}
        description={
          <>
            {tRaw("description")}
            {typeof data.retention_days === "number" && data.retention_days > 0
              ? tRaw("retentionDays", { days: data.retention_days })
              : data.retention_days === null
                ? tRaw("retentionFull")
                : ""}
          </>
        }
      />
      <ListToolbar aria-label={tRaw("toolbarAriaLabel")}>
        <FilterField id="audit-actor" label={tRaw("actorLabel")}>
          <select
            id="audit-actor"
            className="list-filter max-w-full"
            value={filters.actor ?? ""}
            onChange={(event) =>
              navigate({ actor: event.target.value, page: "1" })
            }
          >
            <option value="">{tRaw("allActors")}</option>
            {data.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField id="audit-action" label={tRaw("actionLabel")}>
          <select
            id="audit-action"
            className="list-filter max-w-full"
            value={filters.action ?? ""}
            onChange={(event) =>
              navigate({ action: event.target.value, page: "1" })
            }
          >
            <option value="">{tRaw("allActions")}</option>
            {Object.keys(activityLabels).map((action) => (
              <option key={action} value={action}>
                {localizedFilterLabel(action, t)}
              </option>
            ))}
          </select>
        </FilterField>
      </ListToolbar>
      {hasFilters && (
        <div
          className="active-filters"
          aria-label={tRaw("activeFiltersAriaLabel")}
        >
          <span>{tRaw("filteredLabel")}</span>
          {filters.actor && (
            <span className="filter-chip">
              {tRaw("filterActorChip", {
                actor:
                  data.actors.find((actor) => actor.id === filters.actor)
                    ?.name ?? filters.actor,
              })}
            </span>
          )}
          {filters.action && (
            <span className="filter-chip">
              {tRaw("filterActionChip", {
                action:
                  localizedActivityLabel(filters.action, t) ||
                  activityLabel(filters.action),
              })}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate({ actor: "", action: "", page: "1" })}
          >
            {tRaw("clearFilters")}
          </Button>
        </div>
      )}
      <div aria-live="polite" className="hint">
        {pending ? tRaw("loading") : ""}
      </div>
      {data.items.length > 0 ? (
        <div className="my-4 space-y-2 md:space-y-1" aria-busy={pending}>
          <div className="hidden border-b border-border/80 px-4 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
            <div className="col-span-3">{tRaw("columns.time")}</div>
            <div className="col-span-3">{tRaw("columns.actor")}</div>
            <div className="col-span-3">{tRaw("columns.action")}</div>
            <div className="col-span-3">{tRaw("columns.target")}</div>
          </div>
          {data.items.map((item) => {
            const roleKey = `roles.${item.actor_role}`;
            return (
              <Card
                key={item.id}
                className="border-border/70 py-0 transition-colors hover:border-border hover:bg-muted/20"
              >
                <CardContent className="flex flex-wrap items-start gap-2 px-4 py-3 md:grid md:grid-cols-12 md:gap-3 md:items-center md:py-2.5">
                  <div className="md:col-span-3">
                    <LocalDate
                      value={item.created_at}
                      className="hint m-0 block whitespace-nowrap text-xs md:text-xs"
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 md:col-span-3">
                    <span className="truncate text-sm font-medium">
                      {item.actor_name}
                    </span>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {t.has(roleKey) ? t(roleKey) : item.actor_role}
                    </Badge>
                  </div>
                  <div className="md:col-span-3">
                    <strong className="block truncate text-sm font-semibold">
                      {localizedActivityLabel(item.action, t)}
                    </strong>
                  </div>
                  <div className="min-w-0 flex-1 md:col-span-3 md:flex-none">
                    <p className="m-0 truncate text-sm text-muted-foreground">
                      {item.target_label || "—"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          kind={hasFilters ? "search" : "empty"}
          title={tRaw("emptyTitle")}
          description={
            hasFilters
              ? tRaw("emptyFilteredDescription")
              : tRaw("emptyDescription")
          }
        />
      )}
      <ListPagination
        page={data.page}
        pageSize={data.page_size}
        total={data.total}
        pending={pending}
        onPageChange={(page) => navigate({ page: String(page) })}
        onPageSizeChange={(pageSize) =>
          navigate({ page_size: String(pageSize), page: "1" })
        }
      />
    </>
  );
}
