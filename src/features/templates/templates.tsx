"use client";
import { PageHeader } from "@/components/page-header";
import { ListToolbar, FilterField } from "@/components/list-toolbar";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
import { EmptyState } from "@/components/empty-state";
import { ListPagination } from "@/components/list-pagination";
import {
  duplicateTemplate,
  saveTemplate,
  setTemplateArchived,
} from "./actions";
import {
  templateVariables,
  validateTemplateText,
  type Template,
  type TemplateList,
  type TemplateVariable,
} from "./model";
import { TemplatePreview } from "./template-preview";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedEditDialog } from "@/hooks/use-unsaved-edit-dialog";
import { PlanUsageNote } from "@/features/workspace/plan-usage-note";
import {
  isQuotaExhausted,
  type PlanQuota,
} from "@/features/workspace/plan-usage";
import styles from "./templates.module.css";

export function Templates({
  workspace,
  workspaceName,
  memberName,
  mailingAddress,
  senderAlias,
  senderAddress,
  canEdit,
  customTemplateQuota,
  data,
  filters,
}: {
  workspace: string;
  workspaceName: string;
  memberName: string;
  mailingAddress: string;
  senderAlias: string;
  senderAddress: string;
  canEdit: boolean;
  customTemplateQuota: PlanQuota | null;
  data: TemplateList;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const templateQuotaExhausted = isQuotaExhausted(customTemplateQuota);
  const [editing, setEditing] = useState<Template | null | undefined>();
  const [previewing, setPreviewing] = useState<Template>();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [q, setQ] = useState(filters.q ?? "");
  const [previousQuery, setPreviousQuery] = useState(filters.q ?? "");
  const [activeField, setActiveField] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const editorFormRef = useRef<HTMLFormElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const editorResizeObserver = useRef<ResizeObserver | null>(null);
  const [editorView, setEditorView] = useState<"edit" | "preview">("edit");
  const returnFocus = useRef<HTMLElement | null>(null);
  const [editBaseline, setEditBaseline] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState<Template>();
  const archived = filters.status === "archived";

  const templateEditSnapshot = useMemo(
    () => JSON.stringify({ name, category, subject, body }),
    [name, category, subject, body],
  );
  const isTemplateEditDirty =
    editing !== undefined && templateEditSnapshot !== editBaseline;

  const closeTemplateEditor = useCallback(() => setEditing(undefined), []);
  const {
    handleOpenChange: handleTemplateEditorOpenChange,
    editDialogContentProps: templateEditDialogContentProps,
    requestClose: requestCloseTemplateEditor,
    requestLeave: requestLeaveTemplateEditor,
    discardConfirm: templateDiscardConfirm,
  } = useUnsavedEditDialog({
    dirty: isTemplateEditDirty,
    onClose: closeTemplateEditor,
    busy,
  });
  const validationErrors = validateTemplateText(subject, body);
  const hasFilters = Boolean(filters.q || filters.category);
  const showInitialEmpty = !data.items.length && !hasFilters && !archived;

  useEffect(() => {
    if (!isTemplateEditDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isTemplateEditDirty]);

  const revealEditorFocus = useCallback(() => {
    const scrollArea = editorScrollRef.current;
    const focused = document.activeElement;
    if (!scrollArea || !(focused instanceof HTMLElement)) return;
    if (!scrollArea.contains(focused)) return;
    const visible = scrollArea.getBoundingClientRect();
    const field = focused.getBoundingClientRect();
    if (field.bottom > visible.bottom - 12) {
      scrollArea.scrollTop += field.bottom - visible.bottom + 12;
    } else if (field.top < visible.top + 12) {
      scrollArea.scrollTop -= visible.top + 12 - field.top;
    }
  }, []);

  const setEditorScrollArea = useCallback(
    (node: HTMLDivElement | null) => {
      editorResizeObserver.current?.disconnect();
      editorResizeObserver.current = null;
      editorScrollRef.current = node;
      // 弹窗中段独立滚动时，输入法避让应以中段可见边界为准。
      if (node) {
        const observer = new ResizeObserver(() => {
          requestAnimationFrame(revealEditorFocus);
        });
        observer.observe(node);
        editorResizeObserver.current = observer;
      }
    },
    [revealEditorFocus],
  );

  function navigate(changes: Record<string, string>) {
    const next = { ...filters, ...changes };
    Object.entries(next).forEach(([key, value]) => {
      if (!value) delete next[key];
    });
    const params = new URLSearchParams(next);
    startTransition(() => router.replace(`/templates?${params}`));
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
        router.replace(`/templates?${new URLSearchParams(next)}`),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, q, router]);

  useEffect(() => {
    if (filters.page && Number(filters.page) !== data.page) {
      const params = new URLSearchParams({
        ...filters,
        page: String(data.page),
      });
      router.replace(`/templates?${params}`);
    }
  }, [data.page, filters, router]);

  function openEditor(template: Template | null) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const nextName = template?.name ?? "";
    const nextCategory = template?.category ?? "自定义";
    const nextSubject = template?.subject ?? "";
    const nextBody = template?.body ?? "";
    setEditing(template);
    setName(nextName);
    setCategory(nextCategory);
    setSubject(nextSubject);
    setBody(nextBody);
    setError("");
    setActiveField("body");
    setEditorView("edit");
    setEditBaseline(
      JSON.stringify({
        name: nextName,
        category: nextCategory,
        subject: nextSubject,
        body: nextBody,
      }),
    );
  }

  function insertVariable(variable: TemplateVariable) {
    const token = `{{${variable}}}`;
    if (activeField === "subject") {
      const input = subjectRef.current;
      const start = input?.selectionStart ?? subject.length;
      const end = input?.selectionEnd ?? start;
      setSubject(`${subject.slice(0, start)}${token}${subject.slice(end)}`);
      requestAnimationFrame(() => {
        if (input && document.activeElement === input)
          input.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? start;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      if (textarea && document.activeElement === textarea)
        textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function duplicate(template: Template) {
    setBusy(true);
    try {
      const result = await duplicateTemplate({
        workspace_id: workspace,
        id: template.id,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("模板副本已创建");
        router.refresh();
      }
    } catch {
      toast.error("复制失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function performArchive(template: Template) {
    setBusy(true);
    try {
      const result = await setTemplateArchived({
        workspace_id: workspace,
        id: template.id,
        expected_version: template.version,
        archived: !archived,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(archived ? "模板已恢复" : "模板已归档");
        router.refresh();
      }
    } catch {
      toast.error("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function archive(template: Template) {
    if (!archived) {
      setArchiveConfirm(template);
      return;
    }
    void performArchive(template);
  }

  return (
    <>
      <PageHeader
        title="邮件模板库"
        meta={`${data.total} 套`}
        description="支持使用起步模板参考样例，或创建自定义模板；主题与正文中的动态变量将在发信时自动替换为对应信息。"
        actions={
          canEdit && !showInitialEmpty ? (
            <>
              <Button
                disabled={templateQuotaExhausted}
                onClick={() => openEditor(null)}
              >
                新建模板
              </Button>
            </>
          ) : undefined
        }
      />
      <ListToolbar role="search" aria-label="查找模板">
        <FilterField
          id="template-search"
          label="搜索模板"
          className="filter-field-search"
        >
          <Input
            id="template-search"
            aria-label="搜索模板名称或主题"
            placeholder="搜索模板名称或主题"
            value={q}
            maxLength={200}
            onChange={(event) => setQ(event.target.value)}
          />
        </FilterField>
        <FilterField id="template-status" label="显示范围">
          <select
            id="template-status"
            aria-label="模板状态"
            className="list-filter"
            value={archived ? "archived" : "active"}
            onChange={(event) =>
              navigate({ status: event.target.value, page: "1" })
            }
          >
            <option value="active">使用中的模板</option>
            <option value="archived">已归档模板</option>
          </select>
        </FilterField>
        <FilterField id="template-filter-category" label="分类">
          <select
            id="template-filter-category"
            aria-label="模板分类"
            className="list-filter"
            value={filters.category ?? ""}
            onChange={(event) =>
              navigate({ category: event.target.value, page: "1" })
            }
          >
            <option value="">全部分类</option>
            {(data.categories ?? []).map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </FilterField>
      </ListToolbar>
      {canEdit && (
        <PlanUsageNote
          label="自定义模板（起步模板不占用）"
          quota={customTemplateQuota}
          exhaustedText="无法再新建或复制模板，可归档不用的模板或升级套餐"
          testId="template-quota"
          className="mb-3"
        />
      )}
      {hasFilters && (
        <div className="active-filters" aria-label="已应用筛选">
          <span>已筛选</span>
          {filters.q && <span className="filter-chip">搜索：{filters.q}</span>}
          {filters.category && (
            <span className="filter-chip">分类：{filters.category}</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate({ q: "", category: "", page: "1" })}
          >
            清空筛选
          </Button>
        </div>
      )}
      <div aria-live="polite" className="hint mt-2">
        {pending ? "正在加载…" : !canEdit ? "当前为只读权限。" : ""}
      </div>
      {data.items.length > 0 ? (
        <div
          className="my-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy={pending}
        >
          {data.items.map((template) => (
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
                    onClick={() => setPreviewing(template)}
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
                          onClick={() => openEditor(template)}
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
                        onClick={() => duplicate(template)}
                      >
                        复制模板
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => archive(template)}
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
      ) : (
        <div className="my-4" aria-busy={pending}>
          <EmptyState
            kind={hasFilters ? "search" : "empty"}
            title={
              hasFilters
                ? "没有匹配的模板"
                : archived
                  ? "暂无已归档模板"
                  : "还没有模板"
            }
            description={
              hasFilters
                ? "请调整搜索条件，或清空筛选查看全部模板。"
                : archived
                  ? "归档的模板会保留在这里，可随时恢复。"
                  : "新建一套邮件模板，或在编辑器中参考起步样例。"
            }
          >
            {hasFilters ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ q: "", page: "1" })}
              >
                清空筛选
              </Button>
            ) : (
              canEdit &&
              !archived && (
                <Button
                  disabled={templateQuotaExhausted}
                  onClick={() => openEditor(null)}
                >
                  新建模板
                </Button>
              )
            )}
          </EmptyState>
        </div>
      )}
      <ListPagination
        page={data.page}
        pageSize={(data.page_size ?? Number(filters.page_size)) || 20}
        total={data.total}
        pending={pending}
        onPageChange={(page) => navigate({ page: String(page) })}
        onPageSizeChange={(pageSize) =>
          navigate({ page_size: String(pageSize), page: "1" })
        }
      />

      <Dialog
        open={editing !== undefined}
        onOpenChange={handleTemplateEditorOpenChange}
      >
        <DialogContent
          placement="bottom"
          className={styles.editor}
          {...templateEditDialogContentProps}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader className={styles.editorHeader}>
            <DialogTitle>{editing ? "编辑模板" : "新建模板"}</DialogTitle>
            <DialogDescription>
              编辑内容，预览核对后保存到模板库。
            </DialogDescription>
          </DialogHeader>
          <div
            className={styles.viewSwitch}
            role="group"
            aria-label="编辑器视图"
          >
            <Button
              type="button"
              variant="ghost"
              aria-pressed={editorView === "edit"}
              aria-controls="template-editor-form"
              onClick={() => {
                setEditorView("edit");
                editorScrollRef.current?.scrollTo({ top: 0 });
              }}
            >
              编辑内容
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-pressed={editorView === "preview"}
              aria-controls="template-preview-panel"
              onClick={() => {
                setEditorView("preview");
                editorScrollRef.current?.scrollTo({ top: 0 });
              }}
            >
              预览当前内容
            </Button>
          </div>
          <div
            ref={setEditorScrollArea}
            className={styles.editorBody}
            data-testid="template-editor-scroll"
            onFocusCapture={() => requestAnimationFrame(revealEditorFocus)}
          >
            <form
              id="template-editor-form"
              ref={editorFormRef}
              className={`${styles.editorForm} ${styles.editorPane}`}
              data-active={editorView === "edit"}
              aria-label="模板内容"
              onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                if (validationErrors.length) {
                  setError(validationErrors[0].message);
                  return;
                }
                setBusy(true);
                try {
                  const result = await saveTemplate({
                    workspace_id: workspace,
                    id: editing?.id,
                    expected_version: editing?.version,
                    name: name.trim(),
                    category: category.trim(),
                    subject: subject.trim(),
                    body,
                  });
                  if ("error" in result)
                    setError(result.error ?? "保存失败，请重试。");
                  else {
                    setEditing(undefined);
                    toast.success("模板已保存");
                    router.refresh();
                  }
                } catch {
                  setError("保存失败，输入已保留，请重试。");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className={styles.identityFields}>
                <div className={styles.field}>
                  <Label htmlFor="template-name">模板名称</Label>
                  <Input
                    id="template-name"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => setName((prev) => prev.trim())}
                  />
                </div>
                <div className={styles.field}>
                  <Label htmlFor="template-category">分类</Label>
                  <Input
                    id="template-category"
                    required
                    maxLength={50}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    onBlur={() => setCategory((prev) => prev.trim())}
                  />
                  {(data.categories ?? []).length > 0 && (
                    <details className={styles.categoryChoices}>
                      <summary>选择已有分类</summary>
                      <div className={styles.categorySuggestions}>
                        {(data.categories ?? []).slice(0, 5).map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            className={styles.categorySuggestion}
                            onClick={() => setCategory(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
              <div className={styles.field}>
                <Label htmlFor="template-subject">邮件主题</Label>
                <Input
                  ref={subjectRef}
                  id="template-subject"
                  required
                  maxLength={200}
                  value={subject}
                  onFocus={() => setActiveField("subject")}
                  onChange={(event) => setSubject(event.target.value)}
                  onBlur={() => setSubject((prev) => prev.trim())}
                />
              </div>
              <div className={styles.field}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="template-body">纯文本正文</Label>
                  <span className={styles.characterCount}>
                    {body.length} / 20000 字
                  </span>
                </div>
                <textarea
                  ref={bodyRef}
                  id="template-body"
                  required
                  maxLength={20000}
                  className={styles.bodyInput}
                  value={body}
                  onFocus={() => setActiveField("body")}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>
              <section className={styles.variables} aria-label="模板变量">
                <h3 className={styles.sectionTitle}>
                  插入变量到{activeField === "subject" ? "主题" : "正文"}
                </h3>
                <p className={styles.help}>
                  点击变量插入占位符。未知变量会阻止保存。
                </p>
                {[
                  { label: "客户资料 · 按收件人替换", customer: true },
                  { label: "活动信息 · 创建活动时统一填写", customer: false },
                ].map((group) => (
                  <div key={group.label} className={styles.variableGroup}>
                    <p className={styles.groupLabel}>{group.label}</p>
                    <div className={styles.variableButtons}>
                      {templateVariables
                        .filter(
                          (variable) =>
                            group.customer ===
                            (variable.key === "name" ||
                              variable.key === "email"),
                        )
                        .map((variable) => (
                          <button
                            key={variable.key}
                            type="button"
                            className={styles.variableButton}
                            title={`插入 ${variable.key === "sender_name" ? "正文署名" : variable.label}（{{${variable.key}}}）`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => insertVariable(variable.key)}
                          >
                            <span>
                              {variable.key === "sender_name"
                                ? "正文署名"
                                : variable.label}
                            </span>
                            <code>{`{{${variable.key}}}`}</code>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
                <p className={styles.help}>
                  正文署名用于邮件文字中的称呼或落款；真实发件人由发信通道配置。
                </p>
              </section>
              {validationErrors.length > 0 && (
                <div className="field-error" role="alert">
                  {validationErrors.map((item, index) => (
                    <p key={`${item.field}-${index}`}>
                      {item.field === "subject" ? "主题" : "正文"}：
                      {item.message}
                    </p>
                  ))}
                </div>
              )}
            </form>
            <section
              id="template-preview-panel"
              className={`${styles.previewPane} ${styles.editorPane}`}
              data-active={editorView === "preview"}
              aria-label="邮件预览"
            >
              <h3 className={styles.sectionTitle}>邮件预览</h3>
              <TemplatePreview
                subject={subject}
                body={body}
                workspaceName={workspaceName}
                memberName={memberName}
                mailingAddress={mailingAddress}
                senderAlias={senderAlias}
                senderAddress={senderAddress}
                onSettingsNavigate={(event) => {
                  event.preventDefault();
                  requestLeaveTemplateEditor(() => router.push("/settings"));
                }}
              />
            </section>
          </div>
          <div
            className={styles.editorFooter}
            data-testid="template-editor-footer"
          >
            <p
              className={styles.saveStatus}
              data-error={Boolean(error)}
              role={error ? "alert" : "status"}
            >
              {error ||
                (validationErrors.length
                  ? "模板变量有误，请在编辑内容中修正"
                  : busy
                    ? "正在保存模板…"
                    : isTemplateEditDirty
                      ? "有未保存的更改"
                      : "仅保存模板内容")}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={requestCloseTemplateEditor}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="template-editor-form"
              disabled={busy || validationErrors.length > 0}
              onClick={(event) => {
                if (editorView !== "preview") return;
                // 先显示编辑字段，再触发原生必填校验，保证焦点能落到字段。
                event.preventDefault();
                setEditorView("edit");
                requestAnimationFrame(() =>
                  editorFormRef.current?.requestSubmit(),
                );
              }}
            >
              {busy ? "保存中…" : "保存模板"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewing)}
        onOpenChange={(open) => !open && setPreviewing(undefined)}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{previewing?.name ?? "模板预览"}</DialogTitle>
            <DialogDescription>
              核对邮件主题、正文与系统追加的页脚。
            </DialogDescription>
          </DialogHeader>
          {previewing && (
            <TemplatePreview
              subject={previewing.subject}
              body={previewing.body}
              workspaceName={workspaceName}
              memberName={memberName}
              mailingAddress={mailingAddress}
              senderAlias={senderAlias}
              senderAddress={senderAddress}
            />
          )}
        </DialogContent>
      </Dialog>

      {templateDiscardConfirm}

      <ConfirmDialog
        open={Boolean(archiveConfirm)}
        onOpenChange={(open) => {
          if (!open) setArchiveConfirm(undefined);
        }}
        title="归档模板"
        description={
          <>归档「{archiveConfirm?.name}」？之后可以在已归档列表恢复。</>
        }
        confirmLabel="归档"
        variant="destructive"
        onConfirm={() => {
          const template = archiveConfirm;
          setArchiveConfirm(undefined);
          if (template) void performArchive(template);
        }}
      />
    </>
  );
}
