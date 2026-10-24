"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { flushSync } from "react-dom";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListPagination } from "@/components/list-pagination";
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
  EmailOutboundFooterPreview,
  EmailOutboundFromPreview,
} from "@/components/email-outbound-preview";
import { isDefaultSenderName, senderNameDefault } from "@/lib/sender-name";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedEditDialog } from "@/hooks/use-unsaved-edit-dialog";
import { PlanUsageNote } from "@/features/workspace/plan-usage-note";
import {
  isQuotaExhausted,
  nextQuotaSlotText,
  type PlanUsage,
} from "@/features/workspace/plan-usage";
import {
  evaluateSendReadiness,
  type SendReadinessContext,
} from "./send-readiness";
import {
  abortCampaignDelivery,
  confirmCampaign,
  duplicateConfirmedCampaign,
  getCampaign,
  getCampaignDeliveryStatistics,
  getCampaignPreview,
  listCampaignDeliveryTasks,
  listCampaigns,
  resolveDeliveryUnknown,
  saveCampaign,
  setCampaignDeliveryPaused,
  setCampaignArchived,
  startCampaignDelivery,
} from "./actions";
import {
  campaignStatusLabels,
  campaignVariableFields,
  campaignVariableKeysFromTemplate,
  deliveryResultFilters,
  type CampaignDetail,
  type CampaignDeliveryStatistics,
  type CampaignDeliveryTaskList,
  type CampaignEditorOptions,
  type CampaignEditorTemplate,
  type CampaignList,
  type CampaignPreview,
  type CampaignStatus,
  type CampaignSummary,
  type CampaignVariableKey,
  type CampaignVariables,
  type DeliveryResultFilter,
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

const deliveryResultLabels: Record<DeliveryResultFilter, string> = {
  pending: "待发送",
  processing: "处理中",
  accepted: "已受理",
  failed: "发送失败",
  skipped: "已跳过",
  unknown: "结果未知",
  awaiting_receipt: "等待回执",
  delivered: "已送达",
  delivery_failed: "投递失败",
  hard_bounced: "硬退信",
  unsubscribed: "已退订",
  complained: "已投诉",
  opened: "已打开",
  clicked: "已点击",
};

const deliveryStatusLabels: Record<string, string> = {
  awaiting_receipt: "等待回执",
  delivered: "已送达",
  delivery_failed: "投递失败",
  hard_bounced: "硬退信",
};

const feedbackStatusLabels: Record<string, string> = {
  none: "无反馈",
  unsubscribed: "已退订",
  complained: "已投诉",
};

function rateValue(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function rateLabel(numerator: number, denominator: number) {
  const value = rateValue(numerator, denominator);
  return value === null ? "—" : `${value}%`;
}

function MetricBar({
  label,
  value,
  total,
  unavailable = false,
}: {
  label: string;
  value: number;
  total: number;
  unavailable?: boolean;
}) {
  const percentage = rateValue(value, total);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {unavailable ? "未启用" : `${value} · ${rateLabel(value, total)}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${unavailable ? 0 : (percentage ?? 0)}%` }}
        />
      </div>
    </div>
  );
}

export function Campaigns({
  workspace,
  workspaceName,
  memberName,
  mailingAddress,
  senderAlias,
  senderAddress,
  canEdit,
  canSend,
  maxRecipientsPerCampaign,
  sendReadiness,
  planUsage,
  data,
  editorOptions,
  filters,
}: {
  workspace: string;
  workspaceName: string;
  memberName: string;
  mailingAddress: string;
  senderAlias: string;
  senderAddress: string;
  canEdit: boolean;
  canSend: boolean;
  maxRecipientsPerCampaign: number;
  sendReadiness: SendReadinessContext | null;
  planUsage: PlanUsage | null;
  data: CampaignList;
  editorOptions: CampaignEditorOptions;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [listOverride, setListOverride] = useState<CampaignList | null>(null);
  const filterKey = JSON.stringify(filters);
  const [seenFilters, setSeenFilters] = useState(filterKey);
  if (seenFilters !== filterKey) {
    setSeenFilters(filterKey);
    setListOverride(null);
  } else if (
    listOverride &&
    JSON.stringify(listOverride) === JSON.stringify(data)
  ) {
    setListOverride(null);
  }
  const campaigns = listOverride ?? data;
  const [busy, setBusy] = useState(false);
  const [loadingCampaignId, setLoadingCampaignId] = useState<string>();
  const [previewing, setPreviewing] = useState<CampaignSummary>();
  const [preview, setPreview] = useState<CampaignPreview>();
  const [previewError, setPreviewError] = useState("");
  const [previewSenderName, setPreviewSenderName] = useState("");
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
  const [deliveryConfirmation, setDeliveryConfirmation] = useState<{
    campaign: CampaignSummary;
    mode: "start" | "abort";
    idempotencyKey: string;
  }>();
  const [confirmationName, setConfirmationName] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryDetails, setDeliveryDetails] = useState<CampaignSummary>();
  const [deliveryStatistics, setDeliveryStatistics] =
    useState<CampaignDeliveryStatistics>();
  const [taskList, setTaskList] = useState<CampaignDeliveryTaskList>();
  const [taskStatus, setTaskStatus] = useState<"" | DeliveryResultFilter>("");
  const [taskPage, setTaskPage] = useState(1);
  const [taskLoading, setTaskLoading] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState<
    Record<string, string>
  >({});
  const returnFocus = useRef<HTMLElement | null>(null);
  const previewRequest = useRef(0);
  const [editBaseline, setEditBaseline] = useState("");
  const [confirmPreviewOpen, setConfirmPreviewOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<CampaignSummary>();
  const archived = filters.status === "archived";
  const [q, setQ] = useState(filters.q ?? "");
  const [previousQuery, setPreviousQuery] = useState(filters.q ?? "");
  const hasFilters = Boolean(filters.q || filters.campaign_status);

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

  const campaignEditSnapshot = useMemo(
    () => JSON.stringify({ name, templateId, audienceType, tagId, variables }),
    [name, templateId, audienceType, tagId, variables],
  );
  const isCampaignEditDirty =
    editing !== undefined && campaignEditSnapshot !== editBaseline;

  const closeCampaignEditor = useCallback(() => setEditing(undefined), []);
  const {
    handleOpenChange: handleCampaignEditorOpenChange,
    editDialogContentProps: campaignEditDialogContentProps,
    requestClose: requestCloseCampaignEditor,
    discardConfirm: campaignDiscardConfirm,
  } = useUnsavedEditDialog({
    dirty: isCampaignEditDirty,
    onClose: closeCampaignEditor,
    busy,
  });

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
        next[key] = senderNameDefault(memberName);
      } else {
        next[key] = "";
      }
    }
    return next;
  }

  function navigate(changes: Record<string, string>) {
    const next = { ...filters, ...changes };
    Object.entries(next).forEach(([key, value]) => {
      if (!value) delete next[key];
    });
    const params = new URLSearchParams(next);
    startTransition(() => router.replace(`/campaigns?${params}`));
  }

  if (previousQuery !== (filters.q ?? "")) {
    setPreviousQuery(filters.q ?? "");
    setQ(filters.q ?? "");
  }

  useEffect(() => {
    if (q === (filters.q ?? "")) return;
    const timer = setTimeout(() => {
      const next: Record<string, string> = { ...filters, q, page: "1" };
      Object.entries(next).forEach(([key, value]) => {
        if (!value) delete next[key];
      });
      startTransition(() =>
        router.replace(`/campaigns?${new URLSearchParams(next)}`),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, q, router]);

  useEffect(() => {
    if (filters.page && Number(filters.page) !== campaigns.page) {
      const params = new URLSearchParams({
        ...filters,
        page: String(campaigns.page),
      });
      router.replace(`/campaigns?${params}`);
    }
  }, [campaigns.page, filters, router]);

  async function refreshCampaigns() {
    try {
      const fresh = await listCampaigns({
        status: filters.status,
        q: filters.q,
        campaign_status: filters.campaign_status,
        page: filters.page,
      });
      setListOverride(fresh);
    } catch (error) {
      unstable_rethrow(error);
    }
    startTransition(() => router.refresh());
  }

  useEffect(() => {
    if (
      !campaigns.items.some((item) =>
        ["queued", "sending", "paused"].includes(item.status),
      )
    )
      return;
    const timer = window.setInterval(() => {
      if (listOverride) {
        void listCampaigns({
          status: filters.status,
          q: filters.q,
          campaign_status: filters.campaign_status,
          page: filters.page,
        }).then((fresh) => setListOverride(fresh));
      }
      router.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [campaigns.items, filters, listOverride, router]);

  async function loadDeliveryTasks(
    campaign: CampaignSummary,
    status = taskStatus,
    page = taskPage,
  ) {
    if (!campaign.delivery) return;
    setTaskLoading(true);
    setDeliveryError("");
    try {
      const result = await listCampaignDeliveryTasks({
        workspace_id: workspace,
        run_id: campaign.delivery.id,
        result_filter: status || undefined,
        page,
      });
      if ("error" in result)
        setDeliveryError(result.error ?? "发送明细加载失败。");
      else setTaskList(result.data);
    } catch {
      setDeliveryError("发送明细加载失败，请重试。");
    } finally {
      setTaskLoading(false);
    }
  }

  function openDeliveryDetails(campaign: CampaignSummary) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setDeliveryDetails(campaign);
    setDeliveryStatistics(campaign.delivery?.statistics);
    const initialStatus =
      canSend && campaign.status === "needs_review" ? "unknown" : "";
    setTaskStatus(initialStatus);
    setTaskPage(1);
    setTaskList(undefined);
    setDeliveryError("");
    if (canSend) void loadDeliveryTasks(campaign, initialStatus, 1);
  }

  async function refreshDeliveryDetails() {
    if (!deliveryDetails?.delivery) return;
    setTaskLoading(true);
    setDeliveryError("");
    try {
      const statisticsResult = await getCampaignDeliveryStatistics({
        workspace_id: workspace,
        run_id: deliveryDetails.delivery.id,
      });
      if ("error" in statisticsResult) {
        setDeliveryError(statisticsResult.error ?? "活动统计加载失败。");
        return;
      }
      setDeliveryStatistics(statisticsResult.data);
      if (canSend)
        await loadDeliveryTasks(deliveryDetails, taskStatus, taskPage);
      router.refresh();
    } catch {
      setDeliveryError("活动统计加载失败，请重试。");
    } finally {
      setTaskLoading(false);
    }
  }

  function openDeliveryConfirmation(
    campaign: CampaignSummary,
    mode: "start" | "abort",
  ) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setConfirmationName("");
    setDeliveryError("");
    setDeliveryConfirmation({
      campaign,
      mode,
      idempotencyKey: crypto.randomUUID(),
    });
    if (mode === "start") router.refresh();
  }

  async function submitDeliveryConfirmation() {
    if (!deliveryConfirmation) return;
    const { campaign, mode, idempotencyKey } = deliveryConfirmation;
    setBusy(true);
    setDeliveryError("");
    try {
      const result =
        mode === "start"
          ? await startCampaignDelivery({
              workspace_id: workspace,
              campaign_id: campaign.id,
              expected_version: campaign.version,
              idempotency_key: idempotencyKey,
              confirmation_name: confirmationName,
            })
          : await abortCampaignDelivery({
              workspace_id: workspace,
              run_id: campaign.delivery?.id,
              expected_version: campaign.delivery?.version,
              confirmation_name: confirmationName,
            });
      if ("error" in result) {
        setDeliveryError(result.error ?? "操作失败，请重试。");
        return;
      }
      setDeliveryConfirmation(undefined);
      toast.success(
        mode === "start" ? "正式发送任务已创建" : "已放弃剩余待发送任务",
      );
      router.refresh();
    } catch {
      setDeliveryError("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeliveryPaused(campaign: CampaignSummary) {
    if (!campaign.delivery) return;
    setBusy(true);
    try {
      const paused = campaign.status !== "paused";
      const result = await setCampaignDeliveryPaused({
        workspace_id: workspace,
        run_id: campaign.delivery.id,
        expected_version: campaign.delivery.version,
        paused,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(paused ? "正式发送已暂停" : "正式发送已继续");
        router.refresh();
      }
    } catch {
      toast.error("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function resolveUnknown(
    taskId: string,
    resolution: "accepted" | "failed",
  ) {
    if (!deliveryDetails) return;
    setBusy(true);
    setDeliveryError("");
    try {
      const result = await resolveDeliveryUnknown({
        workspace_id: workspace,
        task_id: taskId,
        resolution,
        note: resolutionNotes[taskId] ?? "",
      });
      if ("error" in result) {
        setDeliveryError(result.error ?? "人工核对失败。");
        return;
      }
      toast.success("未知发送结果已核对");
      await loadDeliveryTasks(deliveryDetails, taskStatus, taskPage);
      if (deliveryDetails.delivery) {
        const statisticsResult = await getCampaignDeliveryStatistics({
          workspace_id: workspace,
          run_id: deliveryDetails.delivery.id,
        });
        if (!("error" in statisticsResult))
          setDeliveryStatistics(statisticsResult.data);
      }
      router.refresh();
    } catch {
      setDeliveryError("人工核对失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function campaignEditSnapshotFromValues(input: {
    name: string;
    templateId: string;
    audienceType: "all" | "tag";
    tagId: string;
    variables: CampaignVariables;
  }) {
    return JSON.stringify(input);
  }

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
    setEditBaseline(
      campaignEditSnapshotFromValues({
        name: "",
        templateId: "",
        audienceType: "all",
        tagId: "",
        variables: {},
      }),
    );
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
      const nextVariables = variablesFor(keys, detail.variables);
      setEditing(detail);
      setName(detail.name);
      setTemplateId(detail.template_id);
      setAudienceType(detail.audience_type);
      setTagId(detail.tag_id ?? "");
      setVariables(nextVariables);
      setError("");
      setEditBaseline(
        campaignEditSnapshotFromValues({
          name: detail.name,
          templateId: detail.template_id,
          audienceType: detail.audience_type,
          tagId: detail.tag_id ?? "",
          variables: nextVariables,
        }),
      );
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
      const [result, detail] = await Promise.all([
        getCampaignPreview({ workspace_id: workspace, id: campaign.id }),
        getCampaign({ workspace_id: workspace, id: campaign.id }).catch(
          () => undefined,
        ),
      ]);
      if (request !== previewRequest.current) return;
      setPreviewSenderName(
        detail && "data" in detail
          ? (detail.data.variables.sender_name ?? "")
          : "",
      );
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
    setPreviewSenderName("");
    void loadPreview(campaign);
  }

  async function performArchiveCampaign(campaign: CampaignSummary) {
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
        await refreshCampaigns();
      }
    } catch (error) {
      unstable_rethrow(error);
      toast.error("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function archiveCampaign(campaign: CampaignSummary) {
    if (!archived) {
      setArchiveConfirm(campaign);
      return;
    }
    void performArchiveCampaign(campaign);
  }

  async function runConfirmPreview() {
    if (!previewing || !preview || !preview.validation.valid) return;
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
      toast.success(
        `活动已确认，已锁定 ${result.data.recipient_count} 位收件人`,
      );
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

  const activeStatistics =
    deliveryStatistics ?? deliveryDetails?.delivery?.statistics;
  const confirmQuotaExhausted = isQuotaExhausted(
    planUsage?.confirmedCampaignsThisMonth,
  );
  const startReadiness =
    deliveryConfirmation?.mode === "start" && sendReadiness
      ? evaluateSendReadiness(
          sendReadiness,
          deliveryConfirmation.campaign.recipient_count ?? 0,
        )
      : null;

  return (
    <>
      <div className="section-heading">
        <h1>发信活动</h1>
        <span>{campaigns.total} 条</span>
      </div>
      <p className="hint">
        草稿预览按当前最新的客户订阅和退订状态实时计算；确认后将锁定收件名单，管理员可创建正式发送任务。
      </p>
      <div className="list-toolbar">
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
          className="list-filter"
          value={archived ? "archived" : "active"}
          onChange={(event) =>
            navigate({ status: event.target.value, page: "1" })
          }
        >
          <option value="active">未归档活动</option>
          <option value="archived">已归档活动</option>
        </select>
        <select
          aria-label="活动状态"
          className="list-filter"
          value={filters.campaign_status ?? ""}
          onChange={(event) =>
            navigate({ campaign_status: event.target.value, page: "1" })
          }
        >
          <option value="">全部活动状态</option>
          {Object.entries(campaignStatusLabels).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <Input
        className="list-search"
        aria-label="搜索活动名称"
        placeholder="搜索活动名称"
        value={q}
        maxLength={200}
        onChange={(event) => setQ(event.target.value)}
      />
      {hasFilters && (
        <div className="active-filters" aria-label="已应用筛选">
          <span>已筛选</span>
          {filters.q && <span className="filter-chip">搜索：{filters.q}</span>}
          {filters.campaign_status && (
            <span className="filter-chip">
              状态：
              {campaignStatusLabels[
                filters.campaign_status as CampaignStatus
              ] ?? filters.campaign_status}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate({ q: "", campaign_status: "", page: "1" })}
          >
            清空筛选
          </Button>
        </div>
      )}
      {canEdit && !editorOptions.templates.length && (
        <p className="field-error" role="status">
          新建活动前，需要至少一套使用中的模板。
        </p>
      )}
      {canSend && (
        <p className="hint mt-2" data-testid="campaign-send-limits">
          当前套餐单个活动最多发送{" "}
          {maxRecipientsPerCampaign.toLocaleString("zh-CN")} 位收件人
          {sendReadiness?.quota
            ? `；今日已用 ${sendReadiness.quota.usage_today.toLocaleString("zh-CN")} / ${sendReadiness.quota.daily_send_quota.toLocaleString("zh-CN")} 封`
            : ""}
          。
        </p>
      )}
      {canEdit && (
        <PlanUsageNote
          label="本月已确认活动名单"
          quota={planUsage?.confirmedCampaignsThisMonth}
          exhaustedText="本月无法再确认新的活动名单"
          testId="campaign-confirm-quota"
          className="mt-2"
        />
      )}
      <div aria-live="polite" className="hint mt-2">
        {pending ? "正在加载…" : !canEdit ? "当前为只读权限。" : ""}
      </div>

      <div className="my-4 space-y-3" aria-busy={pending}>
        {campaigns.items.map((campaign) => (
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
                    ? "全部已订阅客户"
                    : `标签 · ${campaign.tag_name ?? "标签不可用"}`}
                </p>
                <p className="hint m-0 break-words">
                  {campaign.created_by_name} ·{" "}
                  {formattedDate(campaign.created_at)}
                </p>
              </div>
              {canEdit &&
                (campaign.status === "draft" ||
                  [
                    "confirmed",
                    "completed",
                    "completed_with_errors",
                    "failed",
                  ].includes(campaign.status)) && (
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
                    {[
                      "confirmed",
                      "completed",
                      "completed_with_errors",
                      "failed",
                    ].includes(campaign.status) && (
                      <>
                        {canSend &&
                          !archived &&
                          campaign.status === "confirmed" && (
                            <Button
                              disabled={
                                busy ||
                                (campaign.recipient_count ?? 0) >
                                  maxRecipientsPerCampaign
                              }
                              title={
                                (campaign.recipient_count ?? 0) >
                                maxRecipientsPerCampaign
                                  ? `当前套餐单个活动最多 ${maxRecipientsPerCampaign.toLocaleString("zh-CN")} 位收件人`
                                  : undefined
                              }
                              onClick={() =>
                                openDeliveryConfirmation(campaign, "start")
                              }
                            >
                              正式发送
                            </Button>
                          )}
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
                    {["draft", "confirmed"].includes(campaign.status) && (
                      <Button
                        variant="outline"
                        disabled={busy || Boolean(loadingCampaignId)}
                        onClick={() => archiveCampaign(campaign)}
                      >
                        {archived ? "恢复" : "归档"}
                      </Button>
                    )}
                  </div>
                )}
              {campaign.delivery && (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => openDeliveryDetails(campaign)}
                  >
                    {canSend ? "统计与明细" : "查看统计"}
                  </Button>
                  {canSend &&
                    ["queued", "sending", "paused"].includes(
                      campaign.status,
                    ) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void toggleDeliveryPaused(campaign)}
                      >
                        {campaign.status === "paused" ? "继续发送" : "暂停发送"}
                      </Button>
                    )}
                  {canSend && campaign.status === "paused" && (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        openDeliveryConfirmation(campaign, "abort")
                      }
                    >
                      放弃剩余
                    </Button>
                  )}
                </div>
              )}
              {(campaign.status === "confirmed" || campaign.delivery) && (
                <div className="w-full border-t pt-3 text-sm sm:w-auto sm:min-w-48 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                  <p className="m-0 font-medium">
                    {campaign.delivery
                      ? `已受理 ${campaign.delivery.counts.accepted} / ${campaign.delivery.recipient_count}`
                      : `已锁定 ${campaign.recipient_count ?? 0} 位收件人`}
                  </p>
                  {campaign.delivery && (
                    <div className="mt-3 space-y-2">
                      <MetricBar
                        label="送达率"
                        value={campaign.delivery.statistics.counts.delivered}
                        total={campaign.delivery.statistics.counts.accepted}
                      />
                      <MetricBar
                        label="打开率"
                        value={campaign.delivery.statistics.counts.opened}
                        total={campaign.delivery.statistics.counts.delivered}
                        unavailable={
                          !campaign.delivery.statistics.tracking_enabled
                        }
                      />
                      <MetricBar
                        label="点击率"
                        value={campaign.delivery.statistics.counts.clicked}
                        total={campaign.delivery.statistics.counts.delivered}
                        unavailable={
                          !campaign.delivery.statistics.tracking_enabled
                        }
                      />
                      <p className="hint m-0">
                        等待回执{" "}
                        {campaign.delivery.statistics.counts.awaiting_receipt} ·
                        投递失败{" "}
                        {campaign.delivery.statistics.counts.delivery_failed} ·
                        硬退信{" "}
                        {campaign.delivery.statistics.counts.hard_bounced} ·
                        已退订{" "}
                        {campaign.delivery.statistics.counts.unsubscribed}
                      </p>
                    </div>
                  )}
                  <p className="hint m-0">
                    {campaign.delivery?.completed_at
                      ? `完成于 ${formattedDate(campaign.delivery.completed_at)}`
                      : campaign.confirmed_at
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
        {!campaigns.items.length && (
          <p className="py-10 text-center">
            {hasFilters
              ? "没有匹配的活动，请调整搜索或筛选。"
              : archived
                ? "暂无已归档活动。"
                : canEdit
                  ? "还没有活动，准备第一份草稿吧。"
                  : "当前工作区还没有活动。"}
          </p>
        )}
      </div>

      <ListPagination
        page={campaigns.page}
        pageSize={campaigns.page_size}
        total={campaigns.total}
        pending={pending}
        onPageChange={(page) => navigate({ page: String(page) })}
      />

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
              每次都按最新客户、标签、订阅状态与退订拦截计算；这里只展示前三封，不保存收件人数。
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
                <div className="rounded-lg border bg-card p-3">
                  <p className="hint m-0">目标客户</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.audience_count}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="hint m-0">可发送</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.eligible_count}
                  </p>
                </div>
                <div className="col-span-2 rounded-lg border bg-card p-3 sm:col-span-1">
                  <p className="hint m-0">已排除</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.excluded_count}
                  </p>
                </div>
              </div>
              <p className="hint m-0">
                排除明细：已归档 {preview.recipients.excluded.archived} 位 ·
                未订阅 {preview.recipients.excluded.not_subscribed} 位 ·
                已退订/黑名单 {preview.recipients.excluded.suppressed} 位
              </p>

              {preview.validation.valid &&
                isDefaultSenderName(previewSenderName) && (
                  <p className="field-error" role="alert">
                    落款署名仍是系统默认的“店主”，客户会在邮件结尾看到它。请点击“编辑活动”改成真实姓名或品牌名后再确认。
                  </p>
                )}

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
                      请检查活动标签、客户订阅状态以及退订/黑名单记录。
                    </p>
                  </div>
                )}

              {preview.validation.valid &&
                preview.recipients.eligible_count >
                  maxRecipientsPerCampaign && (
                  <p className="field-error" role="alert">
                    当前套餐单个活动最多确认{" "}
                    {maxRecipientsPerCampaign.toLocaleString("zh-CN")}{" "}
                    位收件人，请拆分标签后重试。
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
                    <EmailOutboundFromPreview
                      senderAlias={senderAlias}
                      senderAddress={senderAddress}
                      className="rounded-lg border bg-card p-4"
                    />
                    {preview.recipients.sample.map((item, index) => (
                      <div
                        className="min-w-0 rounded-lg border bg-card p-4"
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
                        <EmailOutboundFooterPreview
                          workspaceName={workspaceName}
                          mailingAddress={mailingAddress}
                        />
                      </div>
                    ))}
                  </div>
                )}

              <p className="hint m-0">
                计算时间：{formattedDate(preview.calculated_at)}
              </p>
            </div>
          )}

          {preview?.validation.valid &&
            preview.recipients.eligible_count > 0 && (
              <PlanUsageNote
                label="本月已确认活动名单"
                quota={planUsage?.confirmedCampaignsThisMonth}
                exhaustedText="确认名单会占用每月额度，本月已无法确认"
                testId="preview-confirm-quota"
                className="mb-3"
              />
            )}

          <div className="flex flex-wrap gap-2">
            {preview?.validation.valid &&
              preview.recipients.eligible_count > 0 &&
              preview.recipients.eligible_count <= maxRecipientsPerCampaign && (
                <Button
                  type="button"
                  disabled={busy || previewLoading || confirmQuotaExhausted}
                  onClick={() => setConfirmPreviewOpen(true)}
                >
                  {busy ? "确认中…" : "确认活动名单"}
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
                isDefaultSenderName(previewSenderName) ||
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
                  className="w-full rounded-md border bg-card px-3 py-2"
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
        open={Boolean(deliveryConfirmation)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeliveryConfirmation(undefined);
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
            <DialogTitle>
              {deliveryConfirmation?.mode === "start"
                ? "确认正式发送"
                : "确认放弃剩余任务"}
            </DialogTitle>
            <DialogDescription>
              {deliveryConfirmation?.mode === "start"
                ? `将向名单中的 ${deliveryConfirmation.campaign.recipient_count ?? 0} 位客户发送邮件。邮件发送后需等待各收件服务商投递结果。`
                : "只会跳过尚未开始的收件人；已受理、处理中及待人工核对的记录会保留。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {startReadiness && (
              <section aria-labelledby="send-readiness-title">
                <h3
                  id="send-readiness-title"
                  className="mb-2 text-sm font-medium"
                >
                  发送前检查
                </h3>
                <ul
                  className="m-0 list-none space-y-2 rounded-lg border bg-muted/30 p-3 text-sm"
                  data-testid="send-readiness"
                >
                  {startReadiness.items.map((item) => (
                    <li
                      key={item.key}
                      data-testid={`send-readiness-${item.key}`}
                      data-ok={item.ok}
                      className="flex items-start gap-2"
                    >
                      {item.ok ? (
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        />
                      ) : (
                        <X
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-destructive"
                        />
                      )}
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{item.label}</span>
                        <span className="sr-only">
                          {item.ok ? "：通过" : "：未通过"}
                        </span>
                        ：
                        <span
                          className={
                            item.ok
                              ? "text-muted-foreground"
                              : "text-destructive"
                          }
                        >
                          {item.detail}
                        </span>
                        {item.href && (
                          <>
                            {" "}
                            <Link
                              href={item.href}
                              className="underline underline-offset-2"
                            >
                              {item.linkLabel}
                            </Link>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {!startReadiness.ready && (
                  <p className="field-error mt-2" role="alert">
                    以上检查未全部通过，暂时无法创建正式发送任务。
                  </p>
                )}
              </section>
            )}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="delivery-confirmation-name">
                  输入完整活动名称“{deliveryConfirmation?.campaign.name}”确认
                </Label>
              </div>
              <Input
                id="delivery-confirmation-name"
                autoComplete="off"
                placeholder={deliveryConfirmation?.campaign.name}
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
              />
            </div>
            {deliveryError && (
              <p className="field-error" role="alert">
                {deliveryError}
              </p>
            )}
            <Button
              type="button"
              variant={
                deliveryConfirmation?.mode === "abort"
                  ? "destructive"
                  : "default"
              }
              disabled={
                busy ||
                confirmationName !== deliveryConfirmation?.campaign.name ||
                (startReadiness !== null && !startReadiness.ready)
              }
              onClick={() => void submitDeliveryConfirmation()}
            >
              {busy
                ? "处理中…"
                : deliveryConfirmation?.mode === "start"
                  ? "创建正式发送任务"
                  : "放弃剩余待发送任务"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deliveryDetails)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeliveryDetails(undefined);
            setTaskList(undefined);
            setDeliveryError("");
          }
        }}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{deliveryDetails?.name ?? "活动统计"}</DialogTitle>
            <DialogDescription>
              送达率按已受理计算；打开、点击、退订与投诉率按已送达计算，且按收件人去重。
            </DialogDescription>
          </DialogHeader>
          {activeStatistics && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "已受理", value: activeStatistics.counts.accepted },
                  {
                    label: "已送达",
                    value: activeStatistics.counts.delivered,
                    rate: rateLabel(
                      activeStatistics.counts.delivered,
                      activeStatistics.counts.accepted,
                    ),
                  },
                  {
                    label: "等待回执",
                    value: activeStatistics.counts.awaiting_receipt,
                  },
                  {
                    label: "投递失败",
                    value: activeStatistics.counts.delivery_failed,
                  },
                  {
                    label: "硬退信",
                    value: activeStatistics.counts.hard_bounced,
                  },
                  {
                    label: "已退订",
                    value: activeStatistics.counts.unsubscribed,
                    rate: rateLabel(
                      activeStatistics.counts.unsubscribed,
                      activeStatistics.counts.delivered,
                    ),
                  },
                  {
                    label: "已投诉",
                    value: activeStatistics.counts.complained,
                    rate: rateLabel(
                      activeStatistics.counts.complained,
                      activeStatistics.counts.delivered,
                    ),
                  },
                  {
                    label: "发送失败",
                    value: activeStatistics.counts.send_failed,
                  },
                ].map(({ label, value, rate }) => (
                  <div className="rounded-lg border bg-card p-3" key={label}>
                    <p className="hint m-0">{label}</p>
                    <p className="text-xl font-semibold">
                      {value}
                      {rate && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {rate}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
                <MetricBar
                  label="送达率"
                  value={activeStatistics.counts.delivered}
                  total={activeStatistics.counts.accepted}
                />
                <MetricBar
                  label="打开率"
                  value={activeStatistics.counts.opened}
                  total={activeStatistics.counts.delivered}
                  unavailable={!activeStatistics.tracking_enabled}
                />
                <MetricBar
                  label="点击率"
                  value={activeStatistics.counts.clicked}
                  total={activeStatistics.counts.delivered}
                  unavailable={!activeStatistics.tracking_enabled}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="hint m-0">
                  行为追踪：
                  {activeStatistics.tracking_enabled
                    ? `已启用 · ${activeStatistics.tracking_tag_name}`
                    : "未启用"}
                  {activeStatistics.last_event_at
                    ? ` · 最后回执 ${formattedDate(activeStatistics.last_event_at)}`
                    : " · 尚无回执"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={taskLoading}
                  onClick={() => void refreshDeliveryDetails()}
                >
                  {taskLoading ? "刷新中…" : "刷新统计"}
                </Button>
              </div>
            </div>
          )}
          {!canSend && (
            <p className="hint m-0">逐收件人发送明细仅工作区管理员可见。</p>
          )}
          {canSend && (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="delivery-task-status">结果筛选</Label>
              <select
                id="delivery-task-status"
                className="rounded-md border bg-card px-3 py-2"
                value={taskStatus}
                onChange={(event) => {
                  const value = event.target.value as typeof taskStatus;
                  setTaskStatus(value);
                  setTaskPage(1);
                  if (deliveryDetails)
                    void loadDeliveryTasks(deliveryDetails, value, 1);
                }}
              >
                <option value="">全部</option>
                {deliveryResultFilters.map((filter) => (
                  <option key={filter} value={filter}>
                    {deliveryResultLabels[filter]}
                  </option>
                ))}
              </select>
              {taskLoading && <span className="hint">加载中…</span>}
            </div>
          )}
          {deliveryError && (
            <p className="field-error" role="alert">
              {deliveryError}
            </p>
          )}
          {canSend && (
            <div className="space-y-3">
              {taskList?.items.map((task) => (
                <div className="rounded-lg border p-3" key={task.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 break-words font-medium">
                        #{task.position} · {task.name}
                      </p>
                      <p className="hint m-0 break-all">{task.email}</p>
                    </div>
                    <Badge
                      variant={
                        task.status === "failed" || task.status === "unknown"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {deliveryResultLabels[task.status]} · {task.attempt_count}{" "}
                      次
                    </Badge>
                  </div>
                  <p className="hint mt-2 mb-0">
                    回执：{deliveryStatusLabels[task.delivery_status] ?? "尚无"}{" "}
                    · 反馈：
                    {feedbackStatusLabels[task.feedback_status] ?? "尚无"}
                    {task.first_opened_at
                      ? ` · 首次打开 ${formattedDate(task.first_opened_at)}`
                      : ""}
                    {task.first_clicked_at
                      ? ` · 首次点击 ${formattedDate(task.first_clicked_at)}`
                      : ""}
                  </p>
                  {(task.error_category || task.error_code) && (
                    <p className="hint mt-2 mb-0">
                      {task.error_category ?? "-"} / {task.error_code ?? "-"}
                    </p>
                  )}
                  {task.status === "unknown" && (
                    <div className="mt-3 space-y-2">
                      <Label htmlFor={`resolution-note-${task.id}`}>
                        核对说明（10–500 字）
                      </Label>
                      <textarea
                        id={`resolution-note-${task.id}`}
                        className="min-h-20 w-full rounded-md border bg-card px-3 py-2"
                        maxLength={500}
                        placeholder="例如：在发信服务商控制台查询回执已成功投递，手工核准入库"
                        value={resolutionNotes[task.id] ?? ""}
                        onChange={(event) =>
                          setResolutionNotes({
                            ...resolutionNotes,
                            [task.id]: event.target.value,
                          })
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={
                            busy ||
                            (resolutionNotes[task.id]?.trim().length ?? 0) < 10
                          }
                          onClick={() =>
                            void resolveUnknown(task.id, "accepted")
                          }
                        >
                          标记为已送达
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            busy ||
                            (resolutionNotes[task.id]?.trim().length ?? 0) < 10
                          }
                          onClick={() => void resolveUnknown(task.id, "failed")}
                        >
                          标记为发送失败
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!taskLoading && taskList && !taskList.items.length && (
                <p className="py-6 text-center hint">
                  当前筛选下没有发送记录。
                </p>
              )}
            </div>
          )}
          {canSend && taskList && taskList.total > taskList.page_size && (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                disabled={taskLoading || taskPage <= 1}
                onClick={() => {
                  const page = taskPage - 1;
                  setTaskPage(page);
                  if (deliveryDetails)
                    void loadDeliveryTasks(deliveryDetails, taskStatus, page);
                }}
              >
                上一页
              </Button>
              <span>
                {taskPage} / {Math.ceil(taskList.total / taskList.page_size)}
              </span>
              <Button
                variant="outline"
                disabled={
                  taskLoading || taskPage * taskList.page_size >= taskList.total
                }
                onClick={() => {
                  const page = taskPage + 1;
                  setTaskPage(page);
                  if (deliveryDetails)
                    void loadDeliveryTasks(deliveryDetails, taskStatus, page);
                }}
              >
                下一页
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editing !== undefined}
        onOpenChange={handleCampaignEditorOpenChange}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[90dvh] overflow-y-auto"
          {...campaignEditDialogContentProps}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "编辑活动草稿" : "新建活动"}</DialogTitle>
            <DialogDescription>
              配置活动名称、关联模板与目标受众。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/80 bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">💡 草稿规则：</span>
            活动变量允许暂留空，受众去重与黑名单将在预览发送阶段实时计算。
          </div>
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
                  name: name.trim(),
                  template_id: templateId,
                  audience_type: audienceType,
                  tag_id: audienceType === "tag" ? tagId : null,
                  variables,
                });
                const message =
                  result &&
                  typeof result === "object" &&
                  "error" in result &&
                  typeof result.error === "string"
                    ? result.error
                    : "";
                if (message) {
                  setError(message);
                } else {
                  toast.success("活动草稿已保存");
                  flushSync(() => setEditing(undefined));
                  await refreshCampaigns();
                }
              } catch (error) {
                unstable_rethrow(error);
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
                onBlur={() => setName((prev) => prev.trim())}
              />
            </div>
            <div>
              <Label htmlFor="campaign-template">邮件模板</Label>
              <select
                id="campaign-template"
                required
                className="w-full rounded-md border bg-card px-3 py-2 pr-8 text-sm"
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
                className="w-full rounded-md border bg-card px-3 py-2 pr-8 text-sm"
                value={audienceType}
                onChange={(event) => {
                  const value = event.target.value as "all" | "tag";
                  setAudienceType(value);
                  if (value === "all") setTagId("");
                }}
              >
                <option value="all">全部已订阅客户</option>
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
                  className="w-full rounded-md border bg-card px-3 py-2 pr-8 text-sm"
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
                        onBlur={() => {
                          const val = variables[field.key];
                          if (typeof val === "string" && val !== val.trim()) {
                            setVariables({
                              ...variables,
                              [field.key]: val.trim(),
                            });
                          }
                        }}
                      />
                      {field.key === "sender_name" &&
                        (isDefaultSenderName(variables.sender_name) ||
                          !variables.sender_name?.trim()) && (
                          <p
                            className="mt-1 mb-0 text-sm text-amber-700 dark:text-amber-300"
                            role="alert"
                          >
                            {isDefaultSenderName(variables.sender_name)
                              ? "“店主”是系统默认称呼，不适合作为落款发给客户。请改成真实姓名或品牌名，或"
                              : "发件人不能为空，请填写真实署名，或"}
                            <Link
                              href="/settings"
                              className="underline underline-offset-2"
                            >
                              {isDefaultSenderName(variables.sender_name)
                                ? "前往设置真实署名"
                                : "前往设置保存常用署名"}
                            </Link>
                            。
                          </p>
                        )}
                    </div>
                  ))}
              </div>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={requestCloseCampaignEditor}
                className="w-full sm:w-auto"
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || !templateId || (audienceType === "tag" && !tagId)
                }
                className="w-full sm:w-auto"
              >
                {busy ? "保存中…" : "保存活动草稿"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {campaignDiscardConfirm}

      <ConfirmDialog
        open={confirmPreviewOpen}
        onOpenChange={setConfirmPreviewOpen}
        title="确认活动名单"
        description={
          <>
            <p className="m-0">
              将确认「{preview?.campaign.name ?? previewing?.name}
              」，锁定 {preview?.recipients.eligible_count ?? 0}{" "}
              位收件人名单。确认后不可撤回，活动草稿也无法再编辑。
            </p>
            {nextQuotaSlotText(planUsage?.confirmedCampaignsThisMonth) && (
              <p className="m-0 font-medium text-foreground">
                {nextQuotaSlotText(planUsage?.confirmedCampaignsThisMonth)}
                确认额度。
              </p>
            )}
          </>
        }
        confirmLabel="确认并锁定名单"
        variant="destructive"
        loading={busy}
        onConfirm={() => void runConfirmPreview()}
      />

      <ConfirmDialog
        open={Boolean(archiveConfirm)}
        onOpenChange={(open) => {
          if (!open) setArchiveConfirm(undefined);
        }}
        title="归档活动"
        description={
          <>归档「{archiveConfirm?.name}」？之后可以在已归档列表恢复。</>
        }
        confirmLabel="归档"
        variant="destructive"
        onConfirm={() => {
          const campaign = archiveConfirm;
          setArchiveConfirm(undefined);
          if (campaign) void performArchiveCampaign(campaign);
        }}
      />
    </>
  );
}
