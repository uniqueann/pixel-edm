"use client";
import { PageHeader } from "@/components/page-header";
import { ListToolbar, FilterField } from "@/components/list-toolbar";

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
import { useLocale, useTranslations } from "next-intl";
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  Info,
  Pencil,
  Plus,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
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
import { DeliveryProviderErrorBlock } from "@/components/delivery-provider-error";
import { useUnsavedEditDialog } from "@/hooks/use-unsaved-edit-dialog";
import { PlanUsageNote } from "@/features/workspace/plan-usage-note";
import {
  isQuotaExhausted,
  type PlanUsage,
} from "@/features/workspace/plan-usage";
import {
  localizeTemplateCategory,
  localizeTemplateNameByValue,
} from "@/features/templates/localization";
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
import styles from "./campaigns.module.css";
import { DEFAULT_LOCALE, normalizeLocale } from "@/i18n/config";
import { formatBusinessDateTime, formatNumber } from "@/i18n/format";
import { useErrorMessage } from "@/i18n/use-resolvers";

type SelectableTemplate = CampaignEditorTemplate & { archived: boolean };

const ALL_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  "draft",
  "confirmed",
  "queued",
  "sending",
  "paused",
  "needs_review",
  "completed",
  "completed_with_errors",
  "failed",
];

const KNOWN_DELIVERY_STATUSES = new Set([
  "awaiting_receipt",
  "delivered",
  "delivery_failed",
  "hard_bounced",
]);

const KNOWN_FEEDBACK_STATUSES = new Set(["none", "unsubscribed", "complained"]);

const KNOWN_CHANNEL_PROVIDERS = new Set([
  "aliyun_directmail",
  "amazon_ses",
  "sendgrid",
]);

function exportFilenameFromDisposition(
  header: string | null,
  fallback: string,
) {
  if (!header) return fallback;
  const utf8Match = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }
  const plainMatch = /filename="([^"]+)"/i.exec(header);
  return plainMatch?.[1] ?? fallback;
}

async function downloadCampaignRecipientCsv(
  campaignId: string,
  fallbackError: string,
) {
  const response = await fetch(`/campaigns/${campaignId}/export`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    toast.error(message || fallbackError);
    return;
  }
  const blob = await response.blob();
  const filename = exportFilenameFromDisposition(
    response.headers.get("Content-Disposition"),
    "campaign.csv",
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function statusVariant(status: CampaignStatus) {
  if (status === "failed" || status === "completed_with_errors")
    return "destructive" as const;
  if (status === "completed") return "success" as const;
  if (["confirmed", "paused", "needs_review"].includes(status))
    return "warning" as const;
  if (["sending", "queued", "draft"].includes(status))
    return "secondary" as const;
  return "outline" as const;
}

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
  unavailableLabel,
}: {
  label: string;
  value: number;
  total: number;
  unavailable?: boolean;
  unavailableLabel: string;
}) {
  const percentage = rateValue(value, total);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {unavailable
            ? unavailableLabel
            : `${value} · ${rateLabel(value, total)}`}
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
  initialExportError = null,
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
  initialExportError?: string | null;
}) {
  const t = useTranslations("campaigns");
  const tTemplates = useTranslations("templates");
  const tChannels = useTranslations("channels");
  const tCommon = useTranslations("common");
  const locale = normalizeLocale(useLocale()) ?? DEFAULT_LOCALE;
  const resolveError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const formattedDate = (value: string) =>
    formatBusinessDateTime(value, locale);
  const statusLabel = (status: string) =>
    ALL_CAMPAIGN_STATUSES.includes(status as CampaignStatus)
      ? t(`statuses.${status as CampaignStatus}`)
      : status;

  useEffect(() => {
    if (!initialExportError) return;
    toast.error(initialExportError, { id: "campaign-export-error" });
    const params = new URLSearchParams(filters);
    router.replace(
      params.size ? `/campaigns?${params.toString()}` : "/campaigns",
      { scroll: false },
    );
  }, [filters, initialExportError, router]);
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
  const showInitialEmpty = !campaigns.items.length && !hasFilters && !archived;

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

  const closeCampaignEditor = useCallback(
    () => setEditing(undefined),
    [setEditing],
  );
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
    const pageDiffers = Boolean(
      filters.page && Number(filters.page) !== campaigns.page,
    );
    const sizeDiffers = Boolean(
      filters.page_size && Number(filters.page_size) !== campaigns.page_size,
    );
    if (!pageDiffers && !sizeDiffers) return;
    const params = new URLSearchParams({
      ...filters,
      page: String(campaigns.page),
      ...(sizeDiffers ? { page_size: String(campaigns.page_size) } : {}),
    });
    router.replace(`/campaigns?${params}`);
  }, [campaigns.page, campaigns.page_size, filters, router]);

  const campaignListQuery = useCallback(
    () => ({
      status: filters.status,
      q: filters.q,
      campaign_status: filters.campaign_status,
      page: filters.page,
      page_size: filters.page_size,
    }),
    [filters],
  );

  async function refreshCampaigns() {
    try {
      const fresh = await listCampaigns(campaignListQuery());
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
        void listCampaigns(campaignListQuery()).then((fresh) =>
          setListOverride(fresh),
        );
      }
      router.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [campaigns.items, campaignListQuery, listOverride, router]);

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
        setDeliveryError(resolveError(result) || t("toast.tasksLoadFailed"));
      else setTaskList(result.data);
    } catch {
      setDeliveryError(t("toast.tasksLoadFailed"));
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
        setDeliveryError(
          resolveError(statisticsResult) || t("toast.statsLoadFailed"),
        );
        return;
      }
      setDeliveryStatistics(statisticsResult.data);
      if (canSend)
        await loadDeliveryTasks(deliveryDetails, taskStatus, taskPage);
      router.refresh();
    } catch {
      setDeliveryError(t("toast.statsLoadFailed"));
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
        setDeliveryError(resolveError(result) || t("toast.actionFailed"));
        return;
      }
      setDeliveryConfirmation(undefined);
      toast.success(
        mode === "start"
          ? t("toast.deliveryStarted")
          : t("toast.deliveryAborted"),
      );
      router.refresh();
    } catch {
      setDeliveryError(t("toast.actionFailed"));
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
      if ("error" in result) toast.error(resolveError(result));
      else {
        toast.success(
          paused ? t("toast.deliveryPaused") : t("toast.deliveryResumed"),
        );
        router.refresh();
      }
    } catch {
      toast.error(t("toast.actionFailed"));
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
        setDeliveryError(resolveError(result) || t("toast.resolveFailed"));
        return;
      }
      toast.success(t("toast.unknownResolved"));
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
      setDeliveryError(t("toast.resolveFailed"));
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
        toast.error(resolveError(result) || t("toast.campaignLoadFailed"));
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
      toast.error(t("toast.campaignLoadFailed"));
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
      setPreviewSenderName("data" in result ? result.senderName : "");
      if ("error" in result) {
        setPreview(undefined);
        setPreviewError(resolveError(result) || t("toast.previewFailed"));
      } else {
        setPreview(result.data);
      }
    } catch {
      if (request === previewRequest.current) {
        setPreview(undefined);
        setPreviewError(t("toast.previewFailed"));
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
      if ("error" in result) toast.error(resolveError(result));
      else {
        toast.success(archived ? t("toast.restored") : t("toast.archived"));
        await refreshCampaigns();
      }
    } catch (error) {
      unstable_rethrow(error);
      toast.error(t("toast.actionFailed"));
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
        setPreviewError(resolveError(result) || t("toast.confirmFailed"));
        return;
      }
      previewRequest.current += 1;
      setPreviewing(undefined);
      setPreview(undefined);
      toast.success(
        t("toast.confirmed", { count: result.data.recipient_count }),
      );
      router.refresh();
    } catch {
      setPreviewError(t("toast.confirmFailed"));
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
        const message = resolveError(result) || t("toast.duplicateFailed");
        setDuplicateError(message);
        if (!campaign.template_archived) toast.error(message);
        return;
      }
      setDuplicateSource(undefined);
      setDuplicateTemplateId("");
      toast.success(t("toast.duplicated"));
      router.refresh();
    } catch {
      setDuplicateError(t("toast.duplicateFailed"));
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
  const confirmQuota = planUsage?.confirmedCampaignsThisMonth ?? null;
  const confirmQuotaExhausted = isQuotaExhausted(confirmQuota);
  const nextConfirmSlot =
    confirmQuota && confirmQuota.max !== null
      ? {
          next: Math.min(confirmQuota.used + 1, confirmQuota.max),
          max: confirmQuota.max,
        }
      : null;

  const startReadiness =
    deliveryConfirmation?.mode === "start" && sendReadiness
      ? evaluateSendReadiness(
          sendReadiness,
          deliveryConfirmation.campaign.recipient_count ?? 0,
          {
            channelName: (channel) =>
              channel.provider && KNOWN_CHANNEL_PROVIDERS.has(channel.provider)
                ? tChannels(
                    `providers.${channel.provider as "aliyun_directmail"}.name`,
                  )
                : channel.display_name,
            channelLabel: t("readiness.channelLabel"),
            channelMissing: t("readiness.channelMissing"),
            channelVerified: (channelName) =>
              t("readiness.channelVerified", { name: channelName }),
            channelMissingCredential: (channelName) =>
              t("readiness.channelMissingCredential", { name: channelName }),
            channelNotVerified: (channelName, status) =>
              t("readiness.channelNotVerified", { name: channelName, status }),
            channelStatusLabel: (status) => {
              if (status === "incomplete")
                return t("readiness.channelStatusIncomplete");
              if (status === "configured")
                return t("readiness.channelStatusConfigured");
              if (status === "error") return t("readiness.channelStatusError");
              if (status === "disconnected")
                return t("readiness.channelStatusDisconnected");
              return t("readiness.channelStatusDefault");
            },
            goToChannels: t("readiness.goToChannels"),
            senderLabel: t("readiness.senderLabel"),
            senderMissing: t("readiness.senderMissing"),
            footerLabel: t("readiness.footerLabel"),
            footerMissing: t("readiness.footerMissing"),
            goToStore: t("readiness.goToStore"),
            quotaLabel: t("readiness.quotaLabel"),
            quotaOk: (used, limit, remaining, reset) =>
              t("readiness.quotaOk", { used, limit, remaining, reset }),
            quotaInsufficient: (used, limit, remaining, needed, reset) =>
              t("readiness.quotaInsufficient", {
                used,
                limit,
                remaining,
                needed,
                reset,
              }),
            quotaUnavailable: t("readiness.quotaUnavailable"),
            quotaResetNote: (timezone) =>
              timezone === "Asia/Shanghai"
                ? t("readiness.quotaResetBeijing")
                : t("readiness.quotaResetNextDay"),
            viewPlan: t("readiness.viewPlan"),
            recipientsLabel: t("readiness.recipientsLabel"),
            recipientsEmpty: t("readiness.recipientsEmpty"),
            recipientsOk: (count, max) =>
              t("readiness.recipientsOk", { count, max }),
            recipientsExceeded: (count, max) =>
              t("readiness.recipientsExceeded", { count, max }),
          },
        )
      : null;

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={t("metaCount", { count: campaigns.total })}
        description={t("description")}
        actions={
          canEdit && !showInitialEmpty ? (
            <>
              {!editorOptions.templates.length && (
                <Button asChild variant="outline">
                  <Link href="/templates">{t("actions.goToTemplates")}</Link>
                </Button>
              )}
              <Button
                disabled={!editorOptions.templates.length}
                onClick={openNew}
              >
                <Plus aria-hidden="true" />
                {t("actions.newCampaign")}
              </Button>
            </>
          ) : undefined
        }
      />
      <ListToolbar
        className={styles.toolbar}
        role="search"
        aria-label={t("toolbar.ariaLabel")}
      >
        <FilterField
          id="campaign-search"
          label={t("toolbar.searchLabel")}
          className={styles.searchField}
        >
          <div className={styles.searchInput}>
            <Search aria-hidden="true" size={17} />
            <Input
              id="campaign-search"
              aria-label={t("toolbar.searchPlaceholder")}
              placeholder={t("toolbar.searchPlaceholder")}
              value={q}
              maxLength={200}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
        </FilterField>
        <FilterField
          id="campaign-archive-filter"
          label={t("toolbar.archiveLabel")}
        >
          <select
            id="campaign-archive-filter"
            aria-label={t("toolbar.archiveAria")}
            className="list-filter"
            value={archived ? "archived" : "active"}
            onChange={(event) =>
              navigate({ status: event.target.value, page: "1" })
            }
          >
            <option value="active">{t("toolbar.archiveActive")}</option>
            <option value="archived">{t("toolbar.archiveArchived")}</option>
          </select>
        </FilterField>
        <FilterField
          id="campaign-status-filter"
          label={t("toolbar.statusLabel")}
        >
          <select
            id="campaign-status-filter"
            aria-label={t("toolbar.statusLabel")}
            className="list-filter"
            value={filters.campaign_status ?? ""}
            onChange={(event) =>
              navigate({ campaign_status: event.target.value, page: "1" })
            }
          >
            <option value="">{t("toolbar.allStatuses")}</option>
            {ALL_CAMPAIGN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </select>
        </FilterField>
      </ListToolbar>
      {hasFilters && (
        <div
          className={`active-filters ${styles.activeFilters}`}
          aria-label={t("filters.ariaLabel")}
        >
          <span>{t("filters.applied")}</span>
          {filters.q && (
            <span className="filter-chip">
              {t("filters.queryChip", { query: filters.q })}
            </span>
          )}
          {filters.campaign_status && (
            <span className="filter-chip">
              {t("filters.statusChip", {
                status: statusLabel(filters.campaign_status),
              })}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate({ q: "", campaign_status: "", page: "1" })}
          >
            {t("filters.clear")}
          </Button>
        </div>
      )}
      {canEdit && !editorOptions.templates.length && (
        <p className="guidance-note" role="status">
          {t("notices.needActiveTemplate")}
        </p>
      )}
      <div className={styles.usageNotes}>
        {canSend && (
          <p className={styles.sendLimits} data-testid="campaign-send-limits">
            <Send aria-hidden="true" size={14} />
            <span>
              {sendReadiness?.quota
                ? t("notices.sendLimitsWithQuota", {
                    max: formatNumber(maxRecipientsPerCampaign, locale),
                    used: formatNumber(sendReadiness.quota.usage_today, locale),
                    daily: formatNumber(
                      sendReadiness.quota.daily_send_quota,
                      locale,
                    ),
                  })
                : t("notices.sendLimitsBase", {
                    max: formatNumber(maxRecipientsPerCampaign, locale),
                  })}
            </span>
          </p>
        )}
        {canEdit && (
          <PlanUsageNote
            label={t("notices.confirmQuotaLabel")}
            quota={confirmQuota}
            exhaustedText={t("notices.confirmQuotaExhausted")}
            testId="campaign-confirm-quota"
            className={styles.confirmQuota}
          />
        )}
        {!canEdit && <p className={styles.readOnly}>{t("notices.readOnly")}</p>}
      </div>
      <div role="status" className="sr-only">
        {pending ? t("notices.loading") : ""}
      </div>

      <div className={styles.campaignList} aria-busy={pending}>
        {campaigns.items.map((campaign) => (
          <Card
            key={campaign.id}
            data-campaign-id={campaign.id}
            className={styles.campaignCard}
          >
            <CardContent className={styles.campaignContent}>
              <div className={styles.campaignIdentity}>
                <div className={styles.campaignBadges}>
                  <Badge
                    variant={statusVariant(campaign.status)}
                    data-status={campaign.status}
                  >
                    {t(`statuses.${campaign.status}`)}
                  </Badge>
                  <span className={styles.category}>
                    {localizeTemplateCategory(
                      campaign.template_category,
                      tTemplates,
                    )}
                  </span>
                  {campaign.template_archived && (
                    <Badge variant="destructive">
                      {t("card.templateArchivedBadge")}
                    </Badge>
                  )}
                </div>
                <h2 className={styles.campaignName}>{campaign.name}</h2>
                <div className={styles.campaignMeta}>
                  <p>
                    <FileText aria-hidden="true" size={14} />
                    <span>
                      {t("card.templateLabel", {
                        name: localizeTemplateNameByValue(
                          campaign.template_name,
                          tTemplates,
                        ),
                      })}
                    </span>
                  </p>
                  <p>
                    <Users aria-hidden="true" size={14} />
                    <span>
                      {campaign.audience_type === "all"
                        ? t("card.audienceAll")
                        : t("card.audienceTag", {
                            tag: campaign.tag_name ?? t("card.tagUnavailable"),
                          })}
                    </span>
                  </p>
                </div>
                <p className={styles.campaignDate}>
                  {campaign.created_by_name} ·{" "}
                  <time dateTime={campaign.created_at}>
                    {formattedDate(campaign.created_at)}
                  </time>
                </p>
              </div>
              {(campaign.status === "confirmed" || campaign.delivery) && (
                <div className={styles.deliverySummary}>
                  <p className="m-0 font-medium">
                    {campaign.delivery
                      ? t("card.acceptedSummary", {
                          accepted: campaign.delivery.counts.accepted,
                          total: campaign.delivery.recipient_count,
                        })
                      : t("card.lockedSummary", {
                          count: campaign.recipient_count ?? 0,
                        })}
                  </p>
                  {campaign.delivery && (
                    <div className={styles.deliveryMetrics}>
                      <MetricBar
                        label={t("card.metricDeliveryRate")}
                        value={campaign.delivery.statistics.counts.delivered}
                        total={campaign.delivery.statistics.counts.accepted}
                        unavailableLabel={t("card.metricUnavailable")}
                      />
                      <MetricBar
                        label={t("card.metricOpenRate")}
                        value={campaign.delivery.statistics.counts.opened}
                        total={campaign.delivery.statistics.counts.delivered}
                        unavailable={
                          !campaign.delivery.statistics.tracking_enabled
                        }
                        unavailableLabel={t("card.metricUnavailable")}
                      />
                      <MetricBar
                        label={t("card.metricClickRate")}
                        value={campaign.delivery.statistics.counts.clicked}
                        total={campaign.delivery.statistics.counts.delivered}
                        unavailable={
                          !campaign.delivery.statistics.tracking_enabled
                        }
                        unavailableLabel={t("card.metricUnavailable")}
                      />
                      <p className={styles.receiptSummary}>
                        {t("card.receiptSummary", {
                          awaiting:
                            campaign.delivery.statistics.counts
                              .awaiting_receipt,
                          failed:
                            campaign.delivery.statistics.counts.delivery_failed,
                          bounced:
                            campaign.delivery.statistics.counts.hard_bounced,
                          unsubscribed:
                            campaign.delivery.statistics.counts.unsubscribed,
                        })}
                      </p>
                    </div>
                  )}
                  <p className={styles.deliveryDate}>
                    {campaign.delivery?.completed_at
                      ? t("card.completedAt", {
                          date: formattedDate(campaign.delivery.completed_at),
                        })
                      : campaign.confirmed_at
                        ? formattedDate(campaign.confirmed_at)
                        : t("card.confirmTimeUnavailable")}
                  </p>
                  <p className={styles.deliveryDate}>
                    {t("card.confirmedByMeta", {
                      name:
                        campaign.confirmed_by_name ??
                        t("card.workspaceMemberFallback"),
                      version: campaign.snapshot_template_version ?? "-",
                    })}
                  </p>
                </div>
              )}
              <div className={styles.campaignActions}>
                {campaign.delivery && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => openDeliveryDetails(campaign)}
                    >
                      <BarChart3 aria-hidden="true" />
                      {canSend
                        ? t("actions.statsAndDetails")
                        : t("actions.viewStats")}
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
                          {campaign.status === "paused"
                            ? t("actions.resumeSend")
                            : t("actions.pauseSend")}
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
                        {t("actions.abortRemaining")}
                      </Button>
                    )}
                  </>
                )}
                {canEdit &&
                  (campaign.status === "draft" ||
                    [
                      "confirmed",
                      "completed",
                      "completed_with_errors",
                      "failed",
                    ].includes(campaign.status)) && (
                    <>
                      {!archived && campaign.status === "draft" && (
                        <>
                          <Button
                            variant="secondary"
                            disabled={busy || Boolean(loadingCampaignId)}
                            onClick={() => openPreview(campaign)}
                          >
                            <Eye aria-hidden="true" />
                            {t("actions.preview")}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || Boolean(loadingCampaignId)}
                            onClick={() => openEditor(campaign)}
                          >
                            <Pencil aria-hidden="true" />
                            {loadingCampaignId === campaign.id
                              ? tCommon("actions.loading")
                              : t("actions.edit")}
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
                                    ? t("notices.sendMaxRecipientsTitle", {
                                        max: formatNumber(
                                          maxRecipientsPerCampaign,
                                          locale,
                                        ),
                                      })
                                    : undefined
                                }
                                onClick={() =>
                                  openDeliveryConfirmation(campaign, "start")
                                }
                              >
                                <Send aria-hidden="true" />
                                {t("actions.sendFormal")}
                              </Button>
                            )}
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              void downloadCampaignRecipientCsv(
                                campaign.id,
                                t("toast.exportFailed"),
                              )
                            }
                          >
                            <Download aria-hidden="true" />
                            {t("actions.exportCsv")}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => openDuplicate(campaign)}
                          >
                            <Copy aria-hidden="true" />
                            {t("actions.duplicateDraft")}
                          </Button>
                        </>
                      )}
                      {["draft", "confirmed"].includes(campaign.status) && (
                        <Button
                          variant="ghost"
                          className={styles.archiveAction}
                          disabled={busy || Boolean(loadingCampaignId)}
                          onClick={() => archiveCampaign(campaign)}
                        >
                          {archived ? (
                            <ArchiveRestore aria-hidden="true" />
                          ) : (
                            <Archive aria-hidden="true" />
                          )}
                          {archived
                            ? t("actions.restore")
                            : t("actions.archive")}
                        </Button>
                      )}
                    </>
                  )}
              </div>
            </CardContent>
          </Card>
        ))}
        {!campaigns.items.length && (
          <EmptyState
            kind={hasFilters ? "search" : "empty"}
            title={
              hasFilters
                ? t("empty.searchTitle")
                : archived
                  ? t("empty.archivedTitle")
                  : canEdit
                    ? t("empty.initialEditorTitle")
                    : t("empty.initialViewerTitle")
            }
            description={
              hasFilters
                ? t("empty.searchDescription")
                : archived
                  ? t("empty.archivedDescription")
                  : canEdit
                    ? t("empty.initialEditorDescription")
                    : t("empty.initialViewerDescription")
            }
          >
            {hasFilters ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate({ q: "", campaign_status: "", page: "1" })
                }
              >
                {t("filters.clear")}
              </Button>
            ) : (
              canEdit &&
              !archived && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    disabled={!editorOptions.templates.length}
                    onClick={openNew}
                  >
                    <Plus aria-hidden="true" />
                    {t("actions.newCampaign")}
                  </Button>
                  {!editorOptions.templates.length && (
                    <Button asChild variant="outline">
                      <Link href="/templates">
                        {t("actions.goToTemplates")}
                      </Link>
                    </Button>
                  )}
                </div>
              )
            )}
          </EmptyState>
        )}
      </div>

      <ListPagination
        page={campaigns.page}
        pageSize={campaigns.page_size}
        total={campaigns.total}
        pending={pending}
        onPageChange={(page) => navigate({ page: String(page) })}
        onPageSizeChange={(pageSize) =>
          navigate({ page_size: String(pageSize), page: "1" })
        }
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
            <DialogTitle>
              {preview?.campaign.name ?? t("preview.fallbackTitle")}
            </DialogTitle>
            <DialogDescription>{t("preview.description")}</DialogDescription>
          </DialogHeader>

          {previewLoading && (
            <p className="py-8 text-center" role="status">
              {t("preview.calculating")}
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
                  <p className="hint m-0">{t("preview.metricAudience")}</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.audience_count}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="hint m-0">{t("preview.metricEligible")}</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.eligible_count}
                  </p>
                </div>
                <div className="col-span-2 rounded-lg border bg-card p-3 sm:col-span-1">
                  <p className="hint m-0">{t("preview.metricExcluded")}</p>
                  <p className="text-xl font-semibold">
                    {preview.recipients.excluded_count}
                  </p>
                </div>
              </div>
              <p className="hint m-0">
                {t("preview.excludedBreakdown", {
                  archived: preview.recipients.excluded.archived,
                  notSubscribed: preview.recipients.excluded.not_subscribed,
                  suppressed: preview.recipients.excluded.suppressed,
                })}
              </p>

              {preview.validation.valid &&
                isDefaultSenderName(previewSenderName) && (
                  <p className="field-error" role="alert">
                    {t("preview.defaultSenderWarning")}
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
                    <p className="font-medium">
                      {t("preview.noEligibleTitle")}
                    </p>
                    <p className="hint m-0">
                      {t("preview.noEligibleDescription")}
                    </p>
                  </div>
                )}

              {preview.validation.valid &&
                preview.recipients.eligible_count >
                  maxRecipientsPerCampaign && (
                  <p className="field-error" role="alert">
                    {t("preview.exceedsMaxRecipients", {
                      max: formatNumber(maxRecipientsPerCampaign, locale),
                    })}
                  </p>
                )}

              {preview.validation.valid &&
                preview.recipients.sample.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">
                        {t("preview.sampleHeading", {
                          count: preview.recipients.sample.length,
                        })}
                      </h3>
                      <span className="hint">
                        {t("preview.templateVersion", {
                          version: preview.template.version,
                        })}
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
                          {t("preview.sampleItemTitle", {
                            index: index + 1,
                            name: item.name,
                          })}
                        </p>
                        <p className="hint m-0 break-all">
                          {t("preview.sampleRecipient", { email: item.email })}
                        </p>
                        <p className="mt-3 break-words font-medium">
                          {t("preview.sampleSubject", {
                            subject: item.subject,
                          })}
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
                {t("preview.calculatedAt", {
                  date: formattedDate(preview.calculated_at),
                })}
              </p>
            </div>
          )}

          {preview?.validation.valid &&
            preview.recipients.eligible_count > 0 && (
              <PlanUsageNote
                label={t("notices.confirmQuotaLabel")}
                quota={confirmQuota}
                exhaustedText={t("preview.confirmQuotaExhausted")}
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
                  {busy ? t("preview.confirming") : t("preview.confirmAction")}
                </Button>
              )}
            <Button
              type="button"
              variant="outline"
              disabled={previewLoading || !previewing}
              onClick={() => previewing && void loadPreview(previewing)}
            >
              {previewLoading
                ? t("preview.recalculating")
                : t("preview.recalculate")}
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
                  {t("preview.editCampaign")}
                </Button>
              )}
            {preview?.validation.blockers.some(
              (blocker) => blocker.code === "template_archived",
            ) && (
              <Button asChild type="button" variant="outline">
                <Link href="/templates?status=archived">
                  {t("actions.goToTemplates")}
                </Link>
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
            <DialogTitle>{t("duplicate.title")}</DialogTitle>
            <DialogDescription>{t("duplicate.description")}</DialogDescription>
          </DialogHeader>
          {editorOptions.templates.length ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="duplicate-campaign-template">
                  {t("duplicate.templateLabel")}
                </Label>
                <select
                  id="duplicate-campaign-template"
                  className="list-filter w-full"
                  value={duplicateTemplateId}
                  onChange={(event) =>
                    setDuplicateTemplateId(event.target.value)
                  }
                >
                  <option value="">{t("duplicate.selectPlaceholder")}</option>
                  {editorOptions.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {localizeTemplateCategory(template.category, tTemplates)}{" "}
                      · {localizeTemplateNameByValue(template.name, tTemplates)}
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
                {busy ? t("duplicate.duplicating") : t("duplicate.createDraft")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="field-error">{t("duplicate.noActiveTemplates")}</p>
              <Button asChild variant="outline">
                <Link href="/templates">{t("actions.goToTemplates")}</Link>
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
                ? t("deliveryConfirm.startTitle")
                : t("deliveryConfirm.abortTitle")}
            </DialogTitle>
            <DialogDescription>
              {deliveryConfirmation?.mode === "start"
                ? t("deliveryConfirm.startDescription", {
                    count: deliveryConfirmation.campaign.recipient_count ?? 0,
                  })
                : t("deliveryConfirm.abortDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {startReadiness && (
              <section aria-labelledby="send-readiness-title">
                <h3
                  id="send-readiness-title"
                  className="mb-2 text-sm font-medium"
                >
                  {t("deliveryConfirm.readinessTitle")}
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
                          {item.ok
                            ? t("deliveryConfirm.readinessPassedSr")
                            : t("deliveryConfirm.readinessFailedSr")}
                        </span>
                        {t("deliveryConfirm.readinessSeparator")}
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
                    {t("deliveryConfirm.readinessBlocked")}
                  </p>
                )}
              </section>
            )}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="delivery-confirmation-name">
                  {t("deliveryConfirm.confirmNameLabel", {
                    name: deliveryConfirmation?.campaign.name ?? "",
                  })}
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
                ? t("deliveryConfirm.processing")
                : deliveryConfirmation?.mode === "start"
                  ? t("deliveryConfirm.startAction")
                  : t("deliveryConfirm.abortAction")}
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
            <DialogTitle>
              {deliveryDetails?.name ?? t("deliveryDetails.fallbackTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("deliveryDetails.description")}
            </DialogDescription>
          </DialogHeader>
          {activeStatistics && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  {
                    key: "accepted",
                    label: t("deliveryDetails.statAccepted"),
                    value: activeStatistics.counts.accepted,
                  },
                  {
                    key: "delivered",
                    label: t("deliveryDetails.statDelivered"),
                    value: activeStatistics.counts.delivered,
                    rate: rateLabel(
                      activeStatistics.counts.delivered,
                      activeStatistics.counts.accepted,
                    ),
                  },
                  {
                    key: "awaiting",
                    label: t("deliveryDetails.statAwaiting"),
                    value: activeStatistics.counts.awaiting_receipt,
                  },
                  {
                    key: "delivery_failed",
                    label: t("deliveryDetails.statDeliveryFailed"),
                    value: activeStatistics.counts.delivery_failed,
                  },
                  {
                    key: "hard_bounced",
                    label: t("deliveryDetails.statHardBounced"),
                    value: activeStatistics.counts.hard_bounced,
                  },
                  {
                    key: "unsubscribed",
                    label: t("deliveryDetails.statUnsubscribed"),
                    value: activeStatistics.counts.unsubscribed,
                    rate: rateLabel(
                      activeStatistics.counts.unsubscribed,
                      activeStatistics.counts.delivered,
                    ),
                  },
                  {
                    key: "complained",
                    label: t("deliveryDetails.statComplained"),
                    value: activeStatistics.counts.complained,
                    rate: rateLabel(
                      activeStatistics.counts.complained,
                      activeStatistics.counts.delivered,
                    ),
                  },
                  {
                    key: "send_failed",
                    label: t("deliveryDetails.statSendFailed"),
                    value: activeStatistics.counts.send_failed,
                  },
                ].map(({ key, label, value, rate }) => (
                  <div className="rounded-lg border bg-card p-3" key={key}>
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
                  label={t("card.metricDeliveryRate")}
                  value={activeStatistics.counts.delivered}
                  total={activeStatistics.counts.accepted}
                  unavailableLabel={t("card.metricUnavailable")}
                />
                <MetricBar
                  label={t("card.metricOpenRate")}
                  value={activeStatistics.counts.opened}
                  total={activeStatistics.counts.delivered}
                  unavailable={!activeStatistics.tracking_enabled}
                  unavailableLabel={t("card.metricUnavailable")}
                />
                <MetricBar
                  label={t("card.metricClickRate")}
                  value={activeStatistics.counts.clicked}
                  total={activeStatistics.counts.delivered}
                  unavailable={!activeStatistics.tracking_enabled}
                  unavailableLabel={t("card.metricUnavailable")}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="hint m-0">
                  {t("deliveryDetails.trackingPrefix")}
                  {activeStatistics.tracking_enabled
                    ? t("deliveryDetails.trackingEnabledWithTag", {
                        tag: activeStatistics.tracking_tag_name ?? "",
                      })
                    : t("deliveryDetails.trackingDisabled")}
                  {activeStatistics.last_event_at
                    ? t("deliveryDetails.lastReceiptAt", {
                        date: formattedDate(activeStatistics.last_event_at),
                      })
                    : t("deliveryDetails.noReceiptYet")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={taskLoading}
                  onClick={() => void refreshDeliveryDetails()}
                >
                  {taskLoading
                    ? t("deliveryDetails.refreshing")
                    : t("deliveryDetails.refreshStats")}
                </Button>
              </div>
            </div>
          )}
          {!canSend && (
            <p className="hint m-0">{t("deliveryDetails.adminOnlyTasks")}</p>
          )}
          {canSend && (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="delivery-task-status">
                {t("deliveryDetails.resultFilterLabel")}
              </Label>
              <select
                id="delivery-task-status"
                className="list-filter"
                value={taskStatus}
                onChange={(event) => {
                  const value = event.target.value as typeof taskStatus;
                  setTaskStatus(value);
                  setTaskPage(1);
                  if (deliveryDetails)
                    void loadDeliveryTasks(deliveryDetails, value, 1);
                }}
              >
                <option value="">{t("deliveryDetails.resultFilterAll")}</option>
                {deliveryResultFilters.map((filter) => (
                  <option key={filter} value={filter}>
                    {t(`deliveryResults.${filter}`)}
                  </option>
                ))}
              </select>
              {taskLoading && (
                <span className="hint">{tCommon("actions.loading")}</span>
              )}
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
                      {t("deliveryDetails.attemptBadge", {
                        status: t(`deliveryResults.${task.status}`),
                        count: task.attempt_count,
                      })}
                    </Badge>
                  </div>
                  <p className="hint mt-2 mb-0">
                    {t("deliveryDetails.taskMeta", {
                      delivery: KNOWN_DELIVERY_STATUSES.has(
                        task.delivery_status,
                      )
                        ? t(
                            `deliveryStatuses.${task.delivery_status as "delivered"}`,
                          )
                        : t("deliveryStatuses.none"),
                      feedback: KNOWN_FEEDBACK_STATUSES.has(
                        task.feedback_status,
                      )
                        ? t(
                            `feedbackStatuses.${task.feedback_status as "none"}`,
                          )
                        : t("feedbackStatuses.empty"),
                    })}
                    {task.first_opened_at
                      ? t("deliveryDetails.firstOpened", {
                          date: formattedDate(task.first_opened_at),
                        })
                      : ""}
                    {task.first_clicked_at
                      ? t("deliveryDetails.firstClicked", {
                          date: formattedDate(task.first_clicked_at),
                        })
                      : ""}
                  </p>
                  {(task.error_category || task.error_code) && (
                    <DeliveryProviderErrorBlock
                      className="mt-2"
                      error_category={task.error_category}
                      error_code={task.error_code}
                    />
                  )}
                  {task.status === "unknown" && (
                    <div className="mt-3 space-y-2">
                      <Label htmlFor={`resolution-note-${task.id}`}>
                        {t("deliveryDetails.resolutionNoteLabel")}
                      </Label>
                      <textarea
                        id={`resolution-note-${task.id}`}
                        className="min-h-20 w-full rounded-md border bg-card px-3 py-2"
                        maxLength={500}
                        placeholder={t(
                          "deliveryDetails.resolutionNotePlaceholder",
                        )}
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
                          {t("deliveryDetails.markDelivered")}
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
                          {t("deliveryDetails.markFailed")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!taskLoading && taskList && !taskList.items.length && (
                <p className="py-6 text-center hint">
                  {t("deliveryDetails.noMatchingTasks")}
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
                {tCommon("pagination.previous")}
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
                {tCommon("pagination.next")}
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
          className={`bottom-sheet ${styles.editor}`}
          {...campaignEditDialogContentProps}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader className={styles.editorHeader}>
            <DialogTitle>
              {editing ? t("editor.editTitle") : t("editor.createTitle")}
            </DialogTitle>
            <DialogDescription>{t("editor.description")}</DialogDescription>
          </DialogHeader>
          <div className={styles.draftNote}>
            <Info aria-hidden="true" size={16} />
            <p>
              <span className="font-medium text-foreground">
                {t("editor.draftRuleTitle")}
              </span>
              {t("editor.draftRuleBody")}
            </p>
          </div>
          <form
            className={styles.editorForm}
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
                const hasError =
                  result &&
                  typeof result === "object" &&
                  "error" in result &&
                  typeof result.error === "string" &&
                  result.error.length > 0;
                if (hasError) {
                  setError(resolveError(result));
                } else {
                  toast.success(t("toast.draftSaved"));
                  flushSync(() => setEditing(undefined));
                  await refreshCampaigns();
                }
              } catch (error) {
                unstable_rethrow(error);
                setError(t("editor.saveFailedKeepInput"));
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset className={styles.editorSection}>
              <legend>{t("editor.sectionInfo")}</legend>
              <div className={styles.editorFields}>
                <div className={styles.fullWidthField}>
                  <Label htmlFor="campaign-name">{t("editor.nameLabel")}</Label>
                  <Input
                    id="campaign-name"
                    required
                    maxLength={100}
                    placeholder={t("editor.namePlaceholder")}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => setName((prev) => prev.trim())}
                  />
                </div>
                <div>
                  <Label htmlFor="campaign-template">
                    {t("editor.templateLabel")}
                  </Label>
                  <select
                    id="campaign-template"
                    required
                    className="list-filter w-full"
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
                    <option value="">{t("editor.templatePlaceholder")}</option>
                    {templateChoices.map((template) => (
                      <option key={template.id} value={template.id}>
                        {localizeTemplateCategory(
                          template.category,
                          tTemplates,
                        )}{" "}
                        ·{" "}
                        {localizeTemplateNameByValue(template.name, tTemplates)}
                        {template.archived
                          ? t("editor.templateArchivedSuffix")
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedTemplate?.archived && (
                  <p
                    className={`field-error ${styles.fullWidthField}`}
                    role="status"
                  >
                    {t("editor.archivedTemplateWarning")}
                  </p>
                )}
                <div>
                  <Label htmlFor="campaign-audience">
                    {t("editor.audienceLabel")}
                  </Label>
                  <select
                    id="campaign-audience"
                    className="list-filter w-full"
                    value={audienceType}
                    onChange={(event) => {
                      const value = event.target.value as "all" | "tag";
                      setAudienceType(value);
                      if (value === "all") setTagId("");
                    }}
                  >
                    <option value="all">{t("editor.audienceAll")}</option>
                    <option value="tag" disabled={!editorOptions.tags.length}>
                      {t("editor.audienceTag")}
                    </option>
                  </select>
                  {!editorOptions.tags.length && (
                    <p className="hint m-0">{t("editor.noTagsHint")}</p>
                  )}
                </div>
                {audienceType === "tag" && (
                  <div className={styles.fullWidthField}>
                    <Label htmlFor="campaign-tag">{t("editor.tagLabel")}</Label>
                    <select
                      id="campaign-tag"
                      required
                      className="list-filter w-full"
                      value={tagId}
                      onChange={(event) => setTagId(event.target.value)}
                    >
                      <option value="">{t("editor.tagPlaceholder")}</option>
                      {editorOptions.tags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </fieldset>
            {selectedVariableKeys.length > 0 && (
              <fieldset className={styles.editorSection}>
                <legend>{t("editor.sectionVariables")}</legend>
                <p className={styles.sectionHint}>
                  {t("editor.variablesHint")}
                </p>
                <div className={styles.editorFields}>
                  {campaignVariableFields
                    .filter((field) => selectedVariableKeys.includes(field.key))
                    .map((field) => (
                      <div key={field.key}>
                        <Label htmlFor={`campaign-variable-${field.key}`}>
                          {t(`variables.${field.key}`)}
                          <code
                            className={styles.variableKey}
                          >{`{{${field.key}}}`}</code>
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
                                ? t("editor.defaultSenderPrefix")
                                : t("editor.emptySenderPrefix")}
                              <Link
                                href="/settings"
                                className="underline underline-offset-2"
                              >
                                {isDefaultSenderName(variables.sender_name)
                                  ? t("editor.defaultSenderLink")
                                  : t("editor.emptySenderLink")}
                              </Link>
                              {t("editor.senderHintSuffix")}
                            </p>
                          )}
                      </div>
                    ))}
                </div>
              </fieldset>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className={styles.editorFooter}>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={requestCloseCampaignEditor}
              >
                {tCommon("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || !templateId || (audienceType === "tag" && !tagId)
                }
              >
                {busy ? t("editor.saving") : t("editor.saveButton")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {campaignDiscardConfirm}

      <ConfirmDialog
        open={confirmPreviewOpen}
        onOpenChange={setConfirmPreviewOpen}
        title={t("confirmDialog.title")}
        description={
          <>
            <p className="m-0">
              {t("confirmDialog.description", {
                name: preview?.campaign.name ?? previewing?.name ?? "",
                count: preview?.recipients.eligible_count ?? 0,
              })}
            </p>
            {nextConfirmSlot && (
              <p className="m-0 font-medium text-foreground">
                {t("confirmDialog.nextQuotaSlot", nextConfirmSlot)}
              </p>
            )}
          </>
        }
        confirmLabel={t("confirmDialog.confirmButton")}
        variant="destructive"
        loading={busy}
        onConfirm={() => void runConfirmPreview()}
      />

      <ConfirmDialog
        open={Boolean(archiveConfirm)}
        onOpenChange={(open) => {
          if (!open) setArchiveConfirm(undefined);
        }}
        title={t("archiveConfirm.title")}
        description={t("archiveConfirm.description", {
          name: archiveConfirm?.name ?? "",
        })}
        confirmLabel={t("archiveConfirm.confirmButton")}
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
