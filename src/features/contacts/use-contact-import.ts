"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useUnsavedEditDialog } from "@/hooks/use-unsaved-edit-dialog";
import { csvCell } from "@/lib/csv";
import {
  confirmContactImport,
  exportContactImport,
  getContactImport,
  prepareContactImport,
  processContactImportBatch,
} from "./import-actions";
import { parseImportText } from "./import-parser";
import {
  countDedupedValidEmails,
  dedupeImportMessages,
  type ContactImportDetail,
  type ContactImportHistory,
} from "./import-model";
import { importResultLabels } from "./import-presentation";

type Activity = "file" | "prepare" | "process" | "page" | "report" | "load";
type Failure = {
  operation: Activity;
  message: string;
  id?: string;
  page?: number;
  confirm?: boolean;
  locateError?: boolean;
};

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
    ? error.message
    : fallback;
}

export function downloadImportCsv(name: string, rows: unknown[][]) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useContactImport({
  workspace,
  history,
  initialJob,
  initialError,
  selectedId,
}: {
  workspace: string;
  history: ContactImportHistory;
  initialJob?: ContactImportDetail;
  initialError?: string;
  selectedId?: string;
}) {
  const router = useRouter();
  const [sourceType, setSourceType] = useState<"paste" | "csv">("paste");
  const [sourceName, setSourceName] = useState("手动导入");
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState<"" | "," | "\t">("");
  const [consentDeclared, setConsentDeclared] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [consentNote, setConsentNote] = useState("");
  const [consentAt, setConsentAt] = useState("");
  const [fileName, setFileName] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [job, setJob] = useState(initialJob);
  const [recent, setRecent] = useState(history);
  const [draftJobId, setDraftJobId] = useState<string>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [failure, setFailure] = useState<Failure | null>(
    initialError
      ? { operation: "load", message: initialError, id: selectedId }
      : null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [emailCounts, setEmailCounts] = useState<Record<string, number>>({});
  const incomingSelection = `${selectedId ?? "new"}:${initialJob?.page ?? 1}`;
  const [routeSelection, setRouteSelection] = useState(incomingSelection);
  const active = useRef<Activity | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const allowLeave = useRef(false);
  const busy = activity !== null;
  // 批处理会刷新服务端页面；同一任务刷新不能重新挂载并丢失正在执行的互斥锁。
  if (routeSelection !== incomingSelection) {
    setRouteSelection(incomingSelection);
    if (
      !busy &&
      (selectedId !== job?.job.id ||
        (initialJob && initialJob.page !== job?.page))
    ) {
      setJob(initialJob);
      setRecent(history);
      setDraftJobId(undefined);
      setWarnings([]);
      setFailure(
        initialError
          ? { operation: "load", message: initialError, id: selectedId }
          : null,
      );
    }
  }
  const dirty =
    !job &&
    Boolean(
      text ||
      sourceName !== "手动导入" ||
      fileName ||
      consentDeclared ||
      consentSource ||
      consentNote ||
      consentAt ||
      delimiter,
    );

  const resetDraft = useCallback(() => {
    setSourceType("paste");
    setSourceName("手动导入");
    setText("");
    setDelimiter("");
    setConsentDeclared(false);
    setConsentSource("");
    setConsentNote("");
    setConsentAt("");
    setFileName("");
    setWarnings([]);
    setDraftJobId(undefined);
    setFieldErrors({});
    setFailure(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);
  const { requestLeave, discardConfirm } = useUnsavedEditDialog({
    dirty,
    busy,
    onClose: resetDraft,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!dirty && !busy) return;
    // 同页历史导航会复用组件；新一轮编辑或处理不能沿用上一次的离开豁免。
    allowLeave.current = false;
    const warn = (event: BeforeUnloadEvent) => {
      if (allowLeave.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (href: string) => {
      if (active.current) return;
      requestLeave(() => {
        allowLeave.current = true;
        router.push(href);
      });
    };
    const interceptLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const destination = new URL(anchor.href, location.href);
      if (
        destination.origin !== location.origin ||
        (destination.pathname === location.pathname &&
          destination.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      leave(destination.pathname + destination.search + destination.hash);
    };
    // 后退时先恢复当前地址及 Next 历史状态，确认放弃后才执行目标导航。
    const currentUrl = location.href;
    const currentState = window.history.state;
    const interceptBack = (event: PopStateEvent) => {
      if (allowLeave.current) return;
      const destination = location.pathname + location.search + location.hash;
      event.stopImmediatePropagation();
      window.history.pushState(currentState, "", currentUrl);
      leave(destination);
    };
    const interceptTraversal = (event: NavigateEvent) => {
      if (
        allowLeave.current ||
        event.navigationType !== "traverse" ||
        !event.cancelable ||
        event.hashChange
      )
        return;
      const destination = new URL(event.destination.url);
      if (destination.origin !== location.origin) return;
      event.preventDefault();
      leave(destination.pathname + destination.search + destination.hash);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", interceptLink, true);
    window.addEventListener("popstate", interceptBack, true);
    window.navigation?.addEventListener("navigate", interceptTraversal);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", interceptLink, true);
      window.removeEventListener("popstate", interceptBack, true);
      window.navigation?.removeEventListener("navigate", interceptTraversal);
    };
  }, [dirty, busy, requestLeave, router]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const reveal = () => {
      const field = document.activeElement;
      if (
        !(field instanceof HTMLElement) ||
        !field.closest("[data-contact-import]")
      )
        return;
      const bottom =
        (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0);
      if (field.getBoundingClientRect().bottom > bottom - 16)
        field.scrollIntoView({ block: "center" });
    };
    viewport?.addEventListener("resize", reveal);
    window.addEventListener("resize", reveal);
    return () => {
      viewport?.removeEventListener("resize", reveal);
      window.removeEventListener("resize", reveal);
    };
  }, []);

  function begin(next: Activity) {
    if (active.current) return null;
    active.current = next;
    setActivity(next);
    setFailure(null);
    return ++generation.current;
  }
  function isCurrent(token: number) {
    return mounted.current && generation.current === token;
  }
  function finish(token: number) {
    if (!isCurrent(token)) return;
    active.current = null;
    setActivity(null);
  }
  function showFailure(value: Failure, token: number) {
    if (!isCurrent(token)) return;
    setFailure(value);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  function applyJob(detail: ContactImportDetail, focus = false) {
    setJob(detail);
    setRecent((items) =>
      [detail.job, ...items.filter((item) => item.id !== detail.job.id)]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 10),
    );
    if (focus) requestAnimationFrame(() => resultRef.current?.focus());
  }
  function updateAddress(id?: string, page = 1) {
    const params = new URLSearchParams();
    if (new URL(window.location.href).searchParams.get("guide") === "contacts")
      params.set("guide", "contacts");
    if (id) params.set("id", id);
    if (page > 1 && id) params.set("page", String(page));
    window.history.replaceState(
      null,
      "",
      `/contacts/import${params.size ? `?${params}` : ""}`,
    );
  }

  async function readFile(file: File) {
    const token = begin("file");
    if (token === null) return;
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("CSV 文件不能超过 2 MiB，请缩小后重新选择。");
      const content = await file.text();
      if (!isCurrent(token)) return;
      setText(content);
      setFileName(file.name);
      setSourceName(file.name.slice(0, 200));
      setFieldErrors({});
      setWarnings([]);
    } catch (error) {
      showFailure(
        {
          operation: "file",
          message: failureMessage(
            error,
            "文件读取失败，原有名单已保留，请重新选择文件。",
          ),
        },
        token,
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      finish(token);
    }
  }

  async function prepare() {
    if (active.current) return;
    const errors: Record<string, string> = {};
    if (!sourceName.trim()) errors["import-name"] = "请填写名单来源名称。";
    if (!text.trim())
      errors["import-text"] = "请粘贴名单，或选择含数据的 CSV 文件。";
    if (consentDeclared && !consentSource.trim())
      errors["consent-source"] = "请填写客户明确同意接收商业邮件的来源。";
    if (consentDeclared && !consentNote.trim())
      errors["consent-note"] = "请填写可核对的授权说明。";
    if (
      consentAt &&
      (!Number.isFinite(Date.parse(consentAt)) ||
        Date.parse(consentAt) > Date.now())
    )
      errors["consent-at"] = "请填写有效且不晚于当前时间的同意时间。";
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0];
      document
        .getElementById(
          first === "import-text" && sourceType === "csv"
            ? "import-file"
            : first,
        )
        ?.focus();
      return;
    }
    const token = begin("prepare");
    if (token === null) return;
    try {
      const parsed = parseImportText(text, { sourceType, delimiter });
      setWarnings(parsed.warnings);
      const result = await prepareContactImport({
        workspace_id: workspace,
        source_type: sourceType,
        source_name: sourceName,
        consent_declared: consentDeclared,
        consent_source: consentSource,
        consent_note: consentNote,
        consent_at: consentAt ? new Date(consentAt).toISOString() : "",
        rows: parsed.rows,
      });
      if (!isCurrent(token)) return;
      if ("error" in result) throw new Error(result.error);
      applyJob(result.data, true);
      setDraftJobId(result.data.job.id);
      updateAddress(result.data.job.id);
    } catch (error) {
      showFailure(
        {
          operation: "prepare",
          message: failureMessage(
            error,
            "预检请求未完成，输入已保留，请检查网络后重试。",
          ),
        },
        token,
      );
    } finally {
      finish(token);
    }
  }

  async function process(id: string, confirm = false, refresh = false) {
    const token = begin("process");
    if (token === null) return;
    try {
      let current = job;
      if (refresh || !confirm) {
        const latest = await getContactImport({ workspace_id: workspace, id });
        if (!isCurrent(token)) return;
        if ("error" in latest) throw new Error(latest.error);
        current = latest.data;
        applyJob(current);
      }
      if (confirm && current?.job.status === "prepared") {
        const confirmed = await confirmContactImport({
          workspace_id: workspace,
          id,
        });
        if (!isCurrent(token)) return;
        if ("error" in confirmed) throw new Error(confirmed.error);
        current = confirmed.data;
        applyJob(current);
      }
      for (
        let batch = 0;
        batch < 10 && current?.job.status === "processing";
        batch++
      ) {
        if (!isCurrent(token)) return;
        const result = await processContactImportBatch({
          workspace_id: workspace,
          id,
        });
        if (!isCurrent(token)) return;
        if ("error" in result) throw new Error(result.error);
        current = result.data;
        applyJob(current);
      }
      if (current?.job.status === "completed")
        toast.success("名单处理完成，请核对结果与订阅状态");
    } catch (error) {
      showFailure(
        {
          operation: "process",
          id,
          confirm,
          message: failureMessage(
            error,
            "请求未完成。请检查网络后继续原任务，已提交的记录会保留。",
          ),
        },
        token,
      );
    } finally {
      finish(token);
    }
  }

  async function loadJob(id: string, page = 1, locateError = false) {
    const token = begin("load");
    if (token === null) return;
    try {
      if (locateError) {
        const report = await exportContactImport({
          workspace_id: workspace,
          id,
        });
        if (!isCurrent(token)) return;
        if ("error" in report) throw new Error(report.error);
        const index = report.data.findIndex((row) => row.result === "error");
        page = index < 0 ? 1 : Math.floor(index / 50) + 1;
      }
      const result = await getContactImport({
        workspace_id: workspace,
        id,
        page,
      });
      if (!isCurrent(token)) return;
      if ("error" in result) throw new Error(result.error);
      applyJob(result.data, true);
      updateAddress(id, page);
    } catch (error) {
      showFailure(
        {
          operation: "load",
          id,
          page,
          locateError,
          message: failureMessage(
            error,
            "结果加载失败，当前任务和页码已保留，请检查网络后重试。",
          ),
        },
        token,
      );
    } finally {
      finish(token);
    }
  }

  async function downloadReport() {
    if (!job) return;
    const id = job.job.id;
    const token = begin("report");
    if (token === null) return;
    try {
      const result = await exportContactImport({ workspace_id: workspace, id });
      if (!isCurrent(token)) return;
      if ("error" in result) throw new Error(result.error);
      downloadImportCsv(`名单导入报告-${id}.csv`, [
        ["来源行", "邮箱", "处理结果", "说明"],
        ...result.data.map((row) => [
          row.source_rows.join("|"),
          row.email,
          importResultLabels[row.result] ?? row.result,
          dedupeImportMessages(row.message),
        ]),
      ]);
    } catch (error) {
      showFailure(
        {
          operation: "report",
          message: failureMessage(error, "报告下载失败，请检查网络后重试。"),
        },
        token,
      );
    } finally {
      finish(token);
    }
  }

  const countJobId = job?.job.id;
  const rowTotal = job?.row_total ?? 0;
  useEffect(() => {
    if (!countJobId || rowTotal <= 50) return;
    let cancelled = false;
    void exportContactImport({ workspace_id: workspace, id: countJobId })
      .then((result) => {
        if (cancelled || !("data" in result) || !result.data) return;
        setEmailCounts((values) => ({
          ...values,
          [countJobId]: countDedupedValidEmails(result.data),
        }));
      })
      .catch(() => {
        /* 统计不可用时不显示推算数字，不影响原任务。 */
      });
    return () => {
      cancelled = true;
    };
  }, [countJobId, rowTotal, workspace]);

  const validEmails = !job
    ? null
    : job.rows.length >= job.row_total
      ? countDedupedValidEmails(job.rows)
      : (emailCounts[job.job.id] ?? null);

  function startNew() {
    if (active.current) return;
    requestLeave(() => {
      setJob(undefined);
      updateAddress();
      requestAnimationFrame(() =>
        document.getElementById("import-name")?.focus(),
      );
    });
  }
  function editDraft() {
    if (active.current || !job || job.job.id !== draftJobId) return;
    setJob(undefined);
    setFailure(null);
    setWarnings([]);
    updateAddress();
    requestAnimationFrame(() =>
      document.getElementById("import-text")?.focus(),
    );
  }
  function retry() {
    if (!failure) return;
    if (failure.operation === "prepare") void prepare();
    else if (failure.operation === "process" && failure.id)
      void process(failure.id, failure.confirm, true);
    else if (failure.operation === "load" && failure.id)
      void loadJob(failure.id, failure.page, failure.locateError);
    else if (failure.operation === "report") void downloadReport();
    else fileRef.current?.click();
  }

  function changeSourceType(next: "paste" | "csv") {
    if (active.current) return;
    setSourceType(next);
    if (next === "paste") setDelimiter("");
    setFailure(null);
    setFieldErrors({});
  }

  return {
    sourceType,
    setSourceType: changeSourceType,
    sourceName,
    setSourceName,
    text,
    setText,
    delimiter,
    setDelimiter,
    consentDeclared,
    setConsentDeclared,
    consentSource,
    setConsentSource,
    consentNote,
    setConsentNote,
    consentAt,
    setConsentAt,
    fileName,
    warnings,
    job,
    recent,
    activity,
    busy,
    failure,
    fieldErrors,
    validEmails,
    fileRef,
    resultRef,
    errorRef,
    discardConfirm,
    requestLeave,
    resetDraft,
    canEdit: job?.job.status === "prepared" && draftJobId === job.job.id,
    prepare,
    readFile,
    process,
    loadJob,
    downloadReport,
    startNew,
    editDraft,
    retry,
  };
}
