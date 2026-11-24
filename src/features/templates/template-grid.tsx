"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Template } from "./model";
import { localizeTemplateCategory, localizeTemplateName } from "./localization";

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
  const t = useTranslations("templates");
  return (
    <div
      className="my-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy={pending}
    >
      {items.map((template) => {
        const displayName = localizeTemplateName(template, t);
        const displayCategory = localizeTemplateCategory(
          template.category,
          t,
          template.default_key,
        );
        return (
          <Card key={template.id} className="flex flex-col justify-between">
            <CardContent className="flex flex-1 flex-col justify-between gap-4 pt-5">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{displayCategory}</Badge>
                  {template.default_key && (
                    <Badge variant="outline">{t("card.starterBadge")}</Badge>
                  )}
                </div>
                <h2 className="break-words line-clamp-1 text-base font-semibold">
                  {displayName}
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
                  {t("card.preview")}
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
                        {t("card.edit")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || templateQuotaExhausted}
                      title={
                        templateQuotaExhausted
                          ? t("quota.duplicateDisabledTitle")
                          : undefined
                      }
                      onClick={() => onDuplicate(template)}
                    >
                      {t("card.duplicate")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onArchive(template)}
                    >
                      {archived ? t("card.restore") : t("card.archive")}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
});
