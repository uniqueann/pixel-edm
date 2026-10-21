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
      <div className="space-y-3" aria-busy={pending}>
        {data.items.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex flex-wrap items-start gap-3 pt-5">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <strong>{activityLabel(item.action)}</strong>
                  <Badge variant="secondary">
                    {roleLabels[item.actor_role] ?? item.actor_role}
                  </Badge>
                </div>
                <p className="break-words">
                  {item.actor_name}
                  {item.target_label ? ` · ${item.target_label}` : ""}
                </p>
                <time className="hint m-0 block" dateTime={item.created_at}>
                  {new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Shanghai",
                  }).format(new Date(item.created_at))}
                </time>
              </div>
            </CardContent>
          </Card>
        ))}
        {!data.items.length && (
          <p className="py-10 text-center">暂无匹配的操作记录。</p>
        )}
      </div>
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
