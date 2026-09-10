"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCampaign, saveCampaign, setCampaignArchived } from "./actions";
import {
  campaignStatusLabels,
  campaignVariableFields,
  campaignVariableKeysFromTemplate,
  type CampaignDetail,
  type CampaignEditorOptions,
  type CampaignEditorTemplate,
  type CampaignList,
  type CampaignStatus,
  type CampaignSummary,
  type CampaignVariableKey,
  type CampaignVariables,
} from "./model";

type SelectableTemplate = CampaignEditorTemplate & { archived: boolean };

function formattedDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function statusVariant(status: CampaignStatus) {
  if (status === "failed" || status === "completed_with_errors")
    return "destructive" as const;
  if (status === "completed") return "default" as const;
  if (status === "draft") return "secondary" as const;
  return "outline" as const;
}

export function Campaigns({
  workspace,
  workspaceName,
  memberName,
  canEdit,
  data,
  editorOptions,
  filters,
}: {
  workspace: string;
  workspaceName: string;
  memberName: string;
  canEdit: boolean;
  data: CampaignList;
  editorOptions: CampaignEditorOptions;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [loadingCampaignId, setLoadingCampaignId] = useState<string>();
  const [editing, setEditing] = useState<CampaignDetail | null | undefined>();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [audienceType, setAudienceType] = useState<"all" | "tag">("all");
  const [tagId, setTagId] = useState("");
  const [variables, setVariables] = useState<CampaignVariables>({});
  const [error, setError] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const archived = filters.status === "archived";

  const templateChoices: SelectableTemplate[] = editorOptions.templates.map(
    (template) => ({
      ...template,
      archived:
        editing?.template.id === template.id &&
        Boolean(editing.template.archived_at),
    }),
  );
  if (
    editing &&
    !templateChoices.some((template) => template.id === editing.template.id)
  ) {
    templateChoices.unshift({
      id: editing.template.id,
      name: editing.template.name,
      category: editing.template.category,
      variable_keys: campaignVariableKeysFromTemplate(
        editing.template.subject,
        editing.template.body,
      ),
      archived: Boolean(editing.template.archived_at),
    });
  }
  const selectedTemplate = templateChoices.find(
    (template) => template.id === templateId,
  );
  const selectedVariableKeys = selectedTemplate?.variable_keys ?? [];

  function variablesFor(
    keys: CampaignVariableKey[],
    current: CampaignVariables,
  ) {
    const next: CampaignVariables = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        next[key] = current[key] ?? "";
      } else if (key === "store_name") {
        next[key] = workspaceName;
      } else if (key === "sender_name") {
        next[key] = memberName;
      } else {
        next[key] = "";
      }
    }
    return next;
  }

  function navigate(changes: Record<string, string>) {
    const params = new URLSearchParams({ ...filters, ...changes });
    startTransition(() => router.replace(`/campaigns?${params}`));
  }

  useEffect(() => {
    if (filters.page && Number(filters.page) !== data.page) {
      const params = new URLSearchParams({
        ...filters,
        page: String(data.page),
      });
      router.replace(`/campaigns?${params}`);
    }
  }, [data.page, filters, router]);

  function openNew() {
    if (!editorOptions.templates.length) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setEditing(null);
    setName("");
    setTemplateId("");
    setAudienceType("all");
    setTagId("");
    setVariables({});
    setError("");
  }

  async function openEditor(campaign: CampaignSummary) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setLoadingCampaignId(campaign.id);
    try {
      const result = await getCampaign({
        workspace_id: workspace,
        id: campaign.id,
      });
      if ("error" in result) {
        toast.error(result.error ?? "活动加载失败，请重试。");
        return;
      }
      const detail = result.data;
      const keys = campaignVariableKeysFromTemplate(
        detail.template.subject,
        detail.template.body,
      );
      setEditing(detail);
      setName(detail.name);
      setTemplateId(detail.template_id);
      setAudienceType(detail.audience_type);
      setTagId(detail.tag_id ?? "");
      setVariables(variablesFor(keys, detail.variables));
      setError("");
    } catch {
      toast.error("活动加载失败，请重试。");
    } finally {
      setLoadingCampaignId(undefined);
    }
  }

  async function archiveCampaign(campaign: CampaignSummary) {
    if (
      !archived &&
      !window.confirm(`归档“${campaign.name}”？之后可以在已归档列表恢复。`)
    )
      return;
    setBusy(true);
    try {
      const result = await setCampaignArchived({
        workspace_id: workspace,
        id: campaign.id,
        expected_version: campaign.version,
        archived: !archived,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(archived ? "活动草稿已恢复" : "活动草稿已归档");
        router.refresh();
      }
    } catch {
      toast.error("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-heading">
        <h1>发信活动</h1>
        <span>{data.total} 条</span>
      </div>
      <p className="hint">
        先保存活动草稿；收件人计算、预览和导出将在后续步骤完成。
      </p>
      <div className="mb-4 flex flex-wrap gap-3">
        {canEdit && (
          <Button disabled={!editorOptions.templates.length} onClick={openNew}>
            新建活动
          </Button>
        )}
        {canEdit && !editorOptions.templates.length && (
          <Button asChild variant="outline">
            <Link href="/templates">前往模板库</Link>
          </Button>
        )}
        <select
          aria-label="活动归档状态"
          className="rounded border bg-white p-2"
          value={archived ? "archived" : "active"}
          onChange={(event) =>
            navigate({ status: event.target.value, page: "1" })
          }
        >
          <option value="active">未归档活动</option>
          <option value="archived">已归档活动</option>
        </select>
      </div>
      {canEdit && !editorOptions.templates.length && (
        <p className="field-error" role="status">
          新建活动前，需要至少一套使用中的模板。
        </p>
      )}
      <div aria-live="polite" className="hint mt-2">
        {pending ? "正在加载…" : !canEdit ? "当前为只读权限。" : ""}
      </div>

      <div className="my-4 space-y-3" aria-busy={pending}>
        {data.items.map((campaign) => (
          <Card key={campaign.id} data-campaign-id={campaign.id}>
            <CardContent className="flex flex-col items-stretch gap-4 pt-5 sm:flex-row sm:items-start">
              <div className="w-full min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(campaign.status)}>
                    {campaignStatusLabels[campaign.status]}
                  </Badge>
                  <Badge variant="outline">{campaign.template_category}</Badge>
                  {campaign.template_archived && (
                    <Badge variant="destructive">模板已归档</Badge>
                  )}
                </div>
                <h2 className="break-words">{campaign.name}</h2>
                <p className="hint m-0 break-words">
                  模板：{campaign.template_name}
                </p>
                <p className="hint m-0 break-words">
                  受众：
                  {campaign.audience_type === "all"
                    ? "全部客户"
                    : `标签 · ${campaign.tag_name ?? "标签不可用"}`}
                </p>
                <p className="hint m-0 break-words">
                  {campaign.created_by_name} ·{" "}
                  {formattedDate(campaign.created_at)}
                </p>
              </div>
              {canEdit && campaign.status === "draft" && (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                  {!archived && (
                    <Button
                      variant="outline"
                      disabled={busy || Boolean(loadingCampaignId)}
                      onClick={() => openEditor(campaign)}
                    >
                      {loadingCampaignId === campaign.id ? "加载中…" : "编辑"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy || Boolean(loadingCampaignId)}
                    onClick={() => archiveCampaign(campaign)}
                  >
                    {archived ? "恢复" : "归档"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {!data.items.length && (
          <p className="py-10 text-center">
            {archived
              ? "暂无已归档活动。"
              : canEdit
                ? "还没有活动，准备第一份草稿吧。"
                : "当前工作区还没有活动。"}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
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

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(undefined);
        }}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "编辑活动草稿" : "新建活动"}</DialogTitle>
            <DialogDescription>
              草稿允许变量暂时留空；收件人数和订阅抑制将在预览阶段计算。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              setBusy(true);
              try {
                const result = await saveCampaign({
                  workspace_id: workspace,
                  id: editing?.id,
                  expected_version: editing?.version,
                  name,
                  template_id: templateId,
                  audience_type: audienceType,
                  tag_id: audienceType === "tag" ? tagId : null,
                  variables,
                });
                if ("error" in result) {
                  setError(result.error ?? "保存失败，请重试。");
                } else {
                  setEditing(undefined);
                  toast.success("活动草稿已保存");
                  router.refresh();
                }
              } catch {
                setError("保存失败，输入已保留，请重试。");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <Label htmlFor="campaign-name">活动名称</Label>
              <Input
                id="campaign-name"
                required
                maxLength={100}
                placeholder="如：九月客户问候"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="campaign-template">邮件模板</Label>
              <select
                id="campaign-template"
                required
                className="w-full rounded-md border bg-white px-3 py-2"
                value={templateId}
                onChange={(event) => {
                  const value = event.target.value;
                  setTemplateId(value);
                  const template = templateChoices.find(
                    (item) => item.id === value,
                  );
                  setVariables(
                    variablesFor(template?.variable_keys ?? [], variables),
                  );
                }}
              >
                <option value="">请选择模板</option>
                {templateChoices.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.category} · {template.name}
                    {template.archived ? "（已归档，仅保留当前引用）" : ""}
                  </option>
                ))}
              </select>
            </div>
            {selectedTemplate?.archived && (
              <p className="field-error" role="status">
                当前模板已归档。可以保留这项引用并编辑草稿，但预览或导出前需要恢复模板或改选使用中的模板。
              </p>
            )}
            <div>
              <Label htmlFor="campaign-audience">发送对象</Label>
              <select
                id="campaign-audience"
                className="w-full rounded-md border bg-white px-3 py-2"
                value={audienceType}
                onChange={(event) => {
                  const value = event.target.value as "all" | "tag";
                  setAudienceType(value);
                  if (value === "all") setTagId("");
                }}
              >
                <option value="all">全部客户</option>
                <option value="tag" disabled={!editorOptions.tags.length}>
                  按标签选择
                </option>
              </select>
              {!editorOptions.tags.length && (
                <p className="hint m-0">当前没有可选标签。</p>
              )}
            </div>
            {audienceType === "tag" && (
              <div>
                <Label htmlFor="campaign-tag">客户标签</Label>
                <select
                  id="campaign-tag"
                  required
                  className="w-full rounded-md border bg-white px-3 py-2"
                  value={tagId}
                  onChange={(event) => setTagId(event.target.value)}
                >
                  <option value="">请选择标签</option>
                  {editorOptions.tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selectedVariableKeys.length > 0 && (
              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-sm font-medium">模板活动变量</p>
                <p className="hint m-0">
                  客户姓名和邮箱会在后续按收件人替换；以下内容对本次活动统一生效。
                </p>
                {campaignVariableFields
                  .filter((field) => selectedVariableKeys.includes(field.key))
                  .map((field) => (
                    <div key={field.key}>
                      <Label htmlFor={`campaign-variable-${field.key}`}>
                        {field.label}（{`{{${field.key}}}`}）
                      </Label>
                      <Input
                        id={`campaign-variable-${field.key}`}
                        maxLength={200}
                        value={variables[field.key] ?? ""}
                        onChange={(event) =>
                          setVariables({
                            ...variables,
                            [field.key]: event.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
              </div>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={
                  busy || !templateId || (audienceType === "tag" && !tagId)
                }
              >
                {busy ? "保存中…" : "保存活动草稿"}
              </Button>
              {error.includes("重新加载") && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(undefined);
                    router.refresh();
                  }}
                >
                  重新加载
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
