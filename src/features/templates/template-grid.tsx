"use client";

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Template } from "./model";

// 连续编辑时，列表数据与操作状态未变，无须重新遍历分页中的模板卡片。
export const TemplateGrid = memo(function TemplateGrid({
  items,
  pending,
  busy,
  canEdit,
  archived,
  templateQuotaExhausted,
  onPreview,
  onEdit,
  onDuplicate,
  onArchive,
}: {
  items: Template[];
  pending: boolean;
  busy: boolean;
  canEdit: boolean;
  archived: boolean;
  templateQuotaExhausted: boolean;
  onPreview: (template: Template) => void;
  onEdit: (template: Template) => void;
  onDuplicate: (template: Template) => void;
  onArchive: (template: Template) => void;
}) {
  return (
    <div
      className="my-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy={pending}
    >
      {items.map((template) => (
        <Card key={template.id} className="flex flex-col justify-between">
          <CardContent className="flex flex-1 flex-col justify-between gap-4 pt-5">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{template.category}</Badge>
                {template.default_key && (
                  <Badge variant="outline">起步模板</Badge>
                )}
              </div>
              <h2 className="break-words line-clamp-1 text-base font-semibold">
                {template.name}
              </h2>
              <p className="hint m-0 break-words line-clamp-2 text-xs">
                {template.subject}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-1.5 border-t border-border/60 pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onPreview(template)}
              >
                预览
              </Button>
              {canEdit && (
                <>
                  {!archived && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onEdit(template)}
                    >
                      编辑
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || templateQuotaExhausted}
                    title={
                      templateQuotaExhausted
                        ? "已达套餐自定义模板上限"
                        : undefined
                    }
                    onClick={() => onDuplicate(template)}
                  >
                    复制模板
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onArchive(template)}
                  >
                    {archived ? "恢复" : "归档"}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
});
