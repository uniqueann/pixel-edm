"use client";

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
    discardConfirm: templateDiscardConfirm,
  } = useUnsavedEditDialog({
    dirty: isTemplateEditDirty,
    onClose: closeTemplateEditor,
    busy,
  });
  const validationErrors = validateTemplateText(subject, body);
  const hasFilters = Boolean(filters.q || filters.category);
  const showInitialEmpty = !data.items.length && !hasFilters && !archived;

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
      <div className="section-heading">
        <h1>邮件模板库</h1>
        <span>{data.total} 套</span>
      </div>
      <p className="hint">
        支持使用起步模板参考样例，或创建自定义模板；主题与正文中的动态变量将在发信时自动替换为对应信息。
      </p>
      <div className="list-toolbar">
        {canEdit && !showInitialEmpty && (
          <Button
            disabled={templateQuotaExhausted}
            onClick={() => openEditor(null)}
          >
            新建模板
          </Button>
        )}
        <select
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
        <select
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
      </div>
      {canEdit && (
        <PlanUsageNote
          label="自定义模板（起步模板不占用）"
          quota={customTemplateQuota}
          exhaustedText="无法再新建或复制模板，可归档不用的模板或升级套餐"
          testId="template-quota"
          className="mb-3"
        />
      )}
      <Input
        className="list-search"
        aria-label="搜索模板名称或主题"
        placeholder="搜索模板名称或主题"
        value={q}
        maxLength={200}
        onChange={(event) => setQ(event.target.value)}
      />
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
      <div className="my-4 space-y-3" aria-busy={pending}>
        {data.items.map((template) => (
          <Card key={template.id}>
            <CardContent className="flex flex-col items-stretch gap-4 pt-5 sm:flex-row sm:items-center">
              <div className="w-full min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{template.category}</Badge>
                  {template.default_key && (
                    <Badge variant="outline">起步模板</Badge>
                  )}
                </div>
                <h2 className="break-words">{template.name}</h2>
                <p className="hint m-0 break-words">{template.subject}</p>
              </div>
              <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:shrink-0">
                <Button
                  variant="outline"
                  onClick={() => setPreviewing(template)}
                >
                  预览
                </Button>
                {canEdit && (
                  <>
                    {!archived && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => openEditor(template)}
                      >
                        编辑
                      </Button>
                    )}
                    <Button
                      variant="outline"
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
                      variant="outline"
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
        {!data.items.length && (
          <EmptyState
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
        )}
      </div>
      <ListPagination
        page={data.page}
        pageSize={20}
        total={data.total}
        pending={pending}
        onPageChange={(page) => navigate({ page: String(page) })}
      />

      <Dialog
        open={editing !== undefined}
        onOpenChange={handleTemplateEditorOpenChange}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[90vh] overflow-y-auto"
          {...templateEditDialogContentProps}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "编辑模板" : "新建模板"}</DialogTitle>
            <DialogDescription>
              维护模板名称、分类、主题与纯文本正文。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/80 bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">💡 变量说明：</span>
            在主题或正文中使用 <code>{"{{变量名}}"}</code>
            ，发信时将自动替换为客户真实资料；未知变量将在发信前拦截。
          </div>
          <form
            className="space-y-4"
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
            <div>
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
            <div>
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
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5 text-xs">
                  <span className="text-muted-foreground">常用已有分类：</span>
                  {(data.categories ?? []).slice(0, 5).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className="rounded-full border border-border/80 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground active:scale-95"
                      onClick={() => setCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
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
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="template-body">纯文本正文</Label>
                <span className="text-xs text-muted-foreground">
                  {body.length} / 20000 字
                </span>
              </div>
              <textarea
                ref={bodyRef}
                id="template-body"
                required
                maxLength={20000}
                className="min-h-48 w-full rounded-md border bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={body}
                onFocus={() => setActiveField("body")}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">
                插入变量到{activeField === "subject" ? "主题" : "正文"}
              </p>
              <div className="flex flex-wrap gap-2">
                {templateVariables.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-2xs transition hover:border-primary/50 hover:bg-muted active:scale-95"
                    title={`插入 ${variable.label}（{{${variable.key}}}）`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertVariable(variable.key)}
                  >
                    <span>{variable.label}</span>
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground">{`{{${variable.key}}}`}</code>
                  </button>
                ))}
              </div>
            </div>
            {validationErrors.length > 0 && (
              <div className="field-error" role="alert">
                {validationErrors.map((item, index) => (
                  <p key={`${item.field}-${index}`}>
                    {item.field === "subject" ? "主题" : "正文"}：{item.message}
                  </p>
                ))}
              </div>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            {(subject || body) && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">
                  预览当前内容
                </summary>
                <div className="mt-4">
                  <TemplatePreview
                    subject={subject}
                    body={body}
                    workspaceName={workspaceName}
                    memberName={memberName}
                    mailingAddress={mailingAddress}
                    senderAlias={senderAlias}
                    senderAddress={senderAddress}
                  />
                </div>
              </details>
            )}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={requestCloseTemplateEditor}
                className="w-full sm:w-auto"
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={busy || validationErrors.length > 0}
                className="w-full sm:w-auto"
              >
                {busy ? "保存中…" : "保存模板"}
              </Button>
            </div>
          </form>
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
              示例值仅用于本次预览，不会保存到模板。
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
