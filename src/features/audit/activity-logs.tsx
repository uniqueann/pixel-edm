"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListPagination } from "@/components/list-pagination";
import { activityLabel, activityLabels, type ActivityLogList } from "./model";

const roleLabels: Record<string, string> = {
  system: "系统",
  admin: "管理员",
  editor: "运营",
  viewer: "查看者",
};

function formatActionFilterLabel(action: string, label: string) {
  if (action.startsWith("template.")) {
    return `模板 · ${label.replace("模板", "")}`;
  }
  if (action.startsWith("contact.")) {
    return `客户 · ${label.replace("客户", "")}`;
  }
  if (action.startsWith("campaign.")) {
    return `活动 · ${label.replace("活动", "")}`;
  }
  if (action.startsWith("delivery_channel.")) {
    return `通道 · ${label.replace("发信通道", "").replace("发信", "")}`;
  }
  return label;
}

export function ActivityLogs({
  data,
  filters,
}: {
  data: ActivityLogList;
  filters: Record<string, string>;
}) {
  const router = useRouter();
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
      <div className="section-heading">
        <h1>操作记录</h1>
        <span>{data.total} 条</span>
      </div>
      <p className="hint">
        记录工作区内的关键操作动态，展示操作人、操作内容及发生时间。
        {typeof data.retention_days === "number" && data.retention_days > 0
          ? ` 当前套餐仅展示近 ${data.retention_days} 天。`
          : data.retention_days === null
            ? " 团队版展示完整历史。"
            : ""}
      </p>
      <div className="list-toolbar">
        <label className="mr-2 text-sm" htmlFor="audit-actor">
          操作者
        </label>
        <select
          id="audit-actor"
          className="list-filter max-w-full"
          value={filters.actor ?? ""}
          onChange={(event) =>
            navigate({ actor: event.target.value, page: "1" })
          }
        >
          <option value="">全部操作者</option>
          {data.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>
        <label className="mr-2 text-sm" htmlFor="audit-action">
          操作类型
        </label>
        <select
          id="audit-action"
          className="list-filter max-w-full"
          value={filters.action ?? ""}
          onChange={(event) =>
            navigate({ action: event.target.value, page: "1" })
          }
        >
          <option value="">全部操作</option>
          {Object.entries(activityLabels).map(([action, label]) => (
            <option key={action} value={action}>
              {formatActionFilterLabel(action, label)}
            </option>
          ))}
        </select>
      </div>
      {hasFilters && (
        <div className="active-filters" aria-label="已应用筛选">
          <span>已筛选</span>
          {filters.actor && (
            <span className="filter-chip">
              操作者：
              {data.actors.find((actor) => actor.id === filters.actor)?.name ??
                filters.actor}
            </span>
          )}
          {filters.action && (
            <span className="filter-chip">
              操作：{activityLabel(filters.action)}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate({ actor: "", action: "", page: "1" })}
          >
            清空筛选
          </Button>
        </div>
      )}
      <div aria-live="polite" className="hint">
        {pending ? "正在加载…" : ""}
      </div>
      {data.items.length > 0 ? (
        <div className="my-4 space-y-2 md:space-y-1" aria-busy={pending}>
          <div className="hidden border-b border-border/80 px-4 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
            <div className="col-span-3">操作时间</div>
            <div className="col-span-3">操作人 / 角色</div>
            <div className="col-span-3">操作动作</div>
            <div className="col-span-3">目标对象 / 说明</div>
          </div>
          {data.items.map((item) => (
            <Card
              key={item.id}
              className="border-border/70 py-0 transition-colors hover:border-border hover:bg-muted/20"
            >
              <CardContent className="flex flex-wrap items-start gap-2 px-4 py-3 md:grid md:grid-cols-12 md:gap-3 md:items-center md:py-2.5">
                <div className="md:col-span-3">
                  <time
                    className="hint m-0 block whitespace-nowrap text-xs md:text-xs"
                    dateTime={item.created_at}
                  >
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Shanghai",
                    }).format(new Date(item.created_at))}
                  </time>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 md:col-span-3">
                  <span className="truncate text-sm font-medium">
                    {item.actor_name}
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {roleLabels[item.actor_role] ?? item.actor_role}
                  </Badge>
                </div>
                <div className="md:col-span-3">
                  <strong className="block truncate text-sm font-semibold">
                    {activityLabel(item.action)}
                  </strong>
                </div>
                <div className="min-w-0 flex-1 md:col-span-3 md:flex-none">
                  <p className="m-0 truncate text-sm text-muted-foreground">
                    {item.target_label || "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center">暂无匹配的操作记录。</p>
      )}
      <ListPagination
        page={data.page}
        pageSize={data.page_size}
        total={data.total}
        pending={pending}
        onPageChange={(page) => navigate({ page: String(page) })}
      />
    </>
  );
}
