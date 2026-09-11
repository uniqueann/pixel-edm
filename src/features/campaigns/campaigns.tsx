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
import {
  confirmCampaign,
  duplicateConfirmedCampaign,
  getCampaign,
  getCampaignPreview,
  saveCampaign,
  setCampaignArchived,
} from "./actions";
import {
  campaignStatusLabels,
  campaignVariableFields,
  campaignVariableKeysFromTemplate,
  type CampaignDetail,
  type CampaignEditorOptions,
  type CampaignEditorTemplate,
  type CampaignList,
  type CampaignPreview,
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
  if (status === "confirmed" || status === "completed")
    return "default" as const;
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
  const [previewing, setPreviewing] = useState<CampaignSummary>();
  const [preview, setPreview] = useState<CampaignPreview>();
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editing, setEditing] = useState<CampaignDetail | null | undefined>();
  const [duplicateSource, setDuplicateSource] = useState<CampaignSummary>();
  const [duplicateTemplateId, setDuplicateTemplateId] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [audienceType, setAudienceType] = useState<"all" | "tag">("all");
  const [tagId, setTagId] = useState("");
  const [variables, setVariables] = useState<CampaignVariables>({});
  const [error, setError] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const previewRequest = useRef(0);
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

  async function openEditor(
    campaign: CampaignSummary,
    preserveReturnFocus = false,
  ) {
    if (!preserveReturnFocus)
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

  async function loadPreview(campaign: CampaignSummary) {
    const request = ++previewRequest.current;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const result = await getCampaignPreview({
        workspace_id: workspace,
        id: campaign.id,
      });
      if (request !== previewRequest.current) return;
      if ("error" in result) {
        setPreview(undefined);
        setPreviewError(result.error ?? "活动预览失败，请重试。");
      } else {
        setPreview(result.data);
      }
    } catch {
      if (request === previewRequest.current) {
        setPreview(undefined);
        setPreviewError("活动预览失败，请重试。");
      }
    } finally {
      if (request === previewRequest.current) setPreviewLoading(false);
    }
  }

  function openPreview(campaign: CampaignSummary) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setPreviewing(campaign);
    setPreview(undefined);
    setPreviewError("");
    void loadPreview(campaign);
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
        toast.success(archived ? "活动已恢复" : "活动已归档");
        router.refresh();
      }
    } catch {
      toast.error("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPreview() {
    if (!previewing || !preview || !preview.validation.valid) return;
    if (
      !window.confirm(
        `确认“${preview.campaign.name}”并冻结 ${preview.recipients.eligible_count} 位收件人？确认后不可撤回或编辑。`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await confirmCampaign({
        workspace_id: workspace,
        id: previewing.id,
        expected_campaign_version: preview.campaign.version,
        expected_template_version: preview.template.version,
      });
      if ("error" in result) {
        setPreviewError(result.error ?? "活动确认失败，请重新预览。");
        return;
      }
      previewRequest.current += 1;
      setPreviewing(undefined);
      setPreview(undefined);
      toast.success(`活动已确认，冻结 ${result.data.recipient_count} 位收件人`);
      router.refresh();
    } catch {
      setPreviewError("活动确认失败，请重新预览后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function duplicateCampaign(
    campaign: CampaignSummary,
    replacementTemplateId?: string,
  ) {
    setBusy(true);
    setDuplicateError("");
    try {
      const result = await duplicateConfirmedCampaign({
        workspace_id: workspace,
        id: campaign.id,
        template_id: replacementTemplateId || undefined,
      });
      if ("error" in result) {
        setDuplicateError(result.error ?? "活动复制失败，请重试。");
        if (!campaign.template_archived) toast.error(result.error);
        return;
      }
      setDuplicateSource(undefined);
      setDuplicateTemplateId("");
      toast.success("已复制为新的活动草稿");
      router.refresh();
    } catch {
      setDuplicateError("活动复制失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function openDuplicate(campaign: CampaignSummary) {
    if (!campaign.template_archived) {
      void duplicateCampaign(campaign);
      return;
    }
    returnFocus.current = document.activeElement as HTMLElement | null;
    setDuplicateSource(campaign);
    setDuplicateTemplateId("");
    setDuplicateError("");
  }

  return (
    <>
      <div className="section-heading">
        <h1>发信活动</h1>
        <span>{data.total} 条</span>
      </div>
      <p className="hint">
        收件人和前三封预览会按最新订阅与抑制状态动态计算；CSV
        导出将在后续步骤完成。
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
              {canEdit &&
                (campaign.status === "draft" ||
                  campaign.status === "confirmed") && (
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                    {!archived && campaign.status === "draft" && (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy || Boolean(loadingCampaignId)}
                          onClick={() => openPreview(campaign)}
                        >
                          预览
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || Boolean(loadingCampaignId)}
                          onClick={() => openEditor(campaign)}
                        >
                          {loadingCampaignId === campaign.id
                            ? "加载中…"
                            : "编辑"}
                        </Button>
                      </>
                    )}
                    {campaign.status === "confirmed" && (
                      <>
                        <Button asChild variant="outline">
                          <a href={`/campaigns/${campaign.id}/export`}>
                            下载 CSV
                          </a>
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => openDuplicate(campaign)}
                        >
                          复制为草稿
                        </Button>
                      </>
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
              {campaign.status === "confirmed" && (
                <div className="w-full border-t pt-3 text-sm sm:w-auto sm:min-w-48 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                  <p className="m-0 font-medium">
                    冻结 {campaign.recipient_count ?? 0} 位收件人
                  </p>
                  <p className="hint m-0">
                    {campaign.confirmed_at
                      ? formattedDate(campaign.confirmed_at)
                      : "确认时间不可用"}
                  </p>
                  <p className="hint m-0">
                    {campaign.confirmed_by_name ?? "工作区成员"} · 模板版本{" "}
                    {campaign.snapshot_template_version ?? "-"}
                  </p>
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
        open={Boolean(previewing)}
        onOpenChange={(open) => {
          if (!open) {
            previewRequest.current += 1;
            setPreviewing(undefined);
            setPreview(undefined);
            setPreviewError("");
            setPreviewLoading(false);
          }
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
            <DialogTitle>{preview?.campaign.name ?? "活动预览"}</DialogTitle>
            <DialogDescription>
              每次都按最新客户、标签、订阅和抑制状态计算；这里只展示前三封，不保存收件人数。
            </DialogDescription>
          </DialogHeader>

          {previewLoading && (
            <p className="py-8 text-center" role="status">
              正在计算可发送客户和预览内容…
            </p>
          )}
          {previewError && (
            <p className="field-error" role="alert">
              {previewError}
            </p>
          )}
          {preview && !previewLoading && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-white p-3">
                  <p className="hint m-0">目标客户</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.audience_count}
                  </p>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <p className="hint m-0">可发送</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.eligible_count}
                  </p>
                </div>
                <div className="col-span-2 rounded-lg border bg-white p-3 sm:col-span-1">
                  <p className="hint m-0">已排除</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.excluded_count}
                  </p>
                </div>
              </div>
              <p className="hint m-0">
                排除明细：归档 {preview.recipients.excluded.archived} 位 ·
                未订阅 {preview.recipients.excluded.not_subscribed} 位 · 受抑制{" "}
                {preview.recipients.excluded.suppressed} 位
              </p>

              {preview.validation.blockers.map((blocker) => (
                <p className="field-error" role="alert" key={blocker.code}>
                  {blocker.message}
                </p>
              ))}

              {preview.validation.valid &&
                preview.recipients.eligible_count === 0 && (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="font-medium">当前没有可发送客户</p>
                    <p className="hint m-0">
                      请检查活动标签、客户订阅状态和抑制记录。
                    </p>
                  </div>
                )}

              {preview.validation.valid &&
                preview.recipients.eligible_count > 10000 && (
                  <p className="field-error" role="alert">
                    单个活动最多确认 10000 位收件人，请拆分标签后重试。
                  </p>
                )}

              {preview.validation.valid &&
                preview.recipients.sample.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">
                        前 {preview.recipients.sample.length} 封邮件
                      </h3>
                      <span className="hint">
                        模板版本 {preview.template.version}
                      </span>
                    </div>
                    {preview.recipients.sample.map((item, index) => (
                      <div
                        className="min-w-0 rounded-lg border bg-white p-4"
                        key={item.contact_id}
                      >
                        <p className="mb-1 break-words font-medium">
                          第 {index + 1} 封 · {item.name}
                        </p>
                        <p className="hint m-0 break-all">
                          收件人：{item.email}
                        </p>
                        <p className="mt-3 break-words font-medium">
                          主题：{item.subject}
                        </p>
                        <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm leading-7">
                          {item.body}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}

              <p className="hint m-0">
                计算时间：{formattedDate(preview.calculated_at)}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {preview?.validation.valid &&
              preview.recipients.eligible_count > 0 &&
              preview.recipients.eligible_count <= 10000 && (
                <Button
                  type="button"
                  disabled={busy || previewLoading}
                  onClick={() => void confirmPreview()}
                >
                  {busy ? "确认中…" : "确认并冻结活动"}
                </Button>
              )}
            <Button
              type="button"
              variant="outline"
              disabled={previewLoading || !previewing}
              onClick={() => previewing && void loadPreview(previewing)}
            >
              {previewLoading ? "计算中…" : "重新计算"}
            </Button>
            {previewing &&
              (previewError ||
                preview?.validation.blockers.some(
                  (blocker) => blocker.code === "missing_variables",
                )) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const campaign = previewing;
                    previewRequest.current += 1;
                    setPreviewing(undefined);
                    void openEditor(campaign, true);
                  }}
                >
                  编辑活动
                </Button>
              )}
            {preview?.validation.blockers.some(
              (blocker) => blocker.code === "template_archived",
            ) && (
              <Button asChild type="button" variant="outline">
                <Link href="/templates?status=archived">前往模板库</Link>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(duplicateSource)}
        onOpenChange={(open) => {
          if (!open && !busy) setDuplicateSource(undefined);
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
            <DialogTitle>复制为活动草稿</DialogTitle>
            <DialogDescription>
              原模板已归档，请选择一套使用中的模板。受众规则和活动变量会从确认快照复制。
            </DialogDescription>
          </DialogHeader>
          {editorOptions.templates.length ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="duplicate-campaign-template">邮件模板</Label>
                <select
                  id="duplicate-campaign-template"
                  className="w-full rounded-md border bg-white px-3 py-2"
                  value={duplicateTemplateId}
                  onChange={(event) =>
                    setDuplicateTemplateId(event.target.value)
                  }
                >
                  <option value="">请选择模板</option>
                  {editorOptions.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.category} · {template.name}
                    </option>
                  ))}
                </select>
              </div>
              {duplicateError && (
                <p className="field-error" role="alert">
                  {duplicateError}
                </p>
              )}
              <Button
                type="button"
                disabled={busy || !duplicateTemplateId}
                onClick={() =>
                  duplicateSource &&
                  void duplicateCampaign(duplicateSource, duplicateTemplateId)
                }
              >
                {busy ? "复制中…" : "创建活动草稿"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="field-error">当前没有使用中的模板。</p>
              <Button asChild variant="outline">
                <Link href="/templates">前往模板库</Link>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
