"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { activityLabels, type ActivityLogList } from "./model";

const roleLabels: Record<string, string> = {
  system: "系统",
  admin: "管理员",
  editor: "运营",
  viewer: "查看者",
};

export function ActivityLogs({
  data,
  filters,
}: {
  data: ActivityLogList;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function navigate(changes: Record<string, string>) {
    const params = new URLSearchParams({ ...filters, ...changes });
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
        记录客户、名单导入与模板操作；姓名和角色保留操作发生时的快照。
      </p>
      <div className="mb-4">
        <label className="mr-2 text-sm" htmlFor="audit-actor">
          操作者
        </label>
        <select
          id="audit-actor"
          className="max-w-full rounded border bg-white p-2"
          value={filters.actor ?? ""}
          onChange={(event) =>
            navigate({ actor: event.target.value, page: "1" })
          }
        >
          <option value="">全部操作者</option>
          {data.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
              {actor.id === "system" ? "" : "（历史身份）"}
            </option>
          ))}
        </select>
      </div>
      <div aria-live="polite" className="hint">
        {pending ? "正在加载…" : ""}
      </div>
      <div className="space-y-3" aria-busy={pending}>
        {data.items.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex flex-wrap items-start gap-3 pt-5">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <strong>{activityLabels[item.action] ?? item.action}</strong>
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
      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="outline"
          disabled={pending || data.page <= 1}
          onClick={() => navigate({ page: String(data.page - 1) })}
        >
          上一页
        </Button>
        <span>
          {data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))}
        </span>
        <Button
          variant="outline"
          disabled={pending || data.page * data.page_size >= data.total}
          onClick={() => navigate({ page: String(data.page + 1) })}
        >
          下一页
        </Button>
      </div>
    </>
  );
}
