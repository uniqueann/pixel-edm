"use client";

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

export function Templates({
  workspace,
  workspaceName,
  memberName,
  canEdit,
  data,
  filters,
}: {
  workspace: string;
  workspaceName: string;
  memberName: string;
  canEdit: boolean;
  data: TemplateList;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
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
  const archived = filters.status === "archived";
  const validationErrors = validateTemplateText(subject, body);
  const hasFilters = Boolean(filters.q || filters.category);

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
    setEditing(template);
    setName(template?.name ?? "");
    setCategory(template?.category ?? "自定义");
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setError("");
    setActiveField("body");
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

  async function archive(template: Template) {
    if (
      !archived &&
      !window.confirm(`归档“${template.name}”？之后可以在已归档列表恢复。`)
    )
      return;
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

  return (
    <>
      <div className="section-heading">
        <h1>邮件模板库</h1>
        <span>{data.total} 套</span>
      </div>
      <p className="hint">
        主题与正文均为纯文本；变量会在活动预览和发信时替换成对应信息。
      </p>
      <div className="list-toolbar">
        {canEdit && <Button onClick={() => openEditor(null)}>新建模板</Button>}
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
                      disabled={busy}
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
          <p className="py-10 text-center">
            {hasFilters
              ? "没有匹配的模板，请调整搜索或筛选。"
              : archived
                ? "暂无已归档模板。"
                : "还没有模板，新建一套开始吧。"}
          </p>
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
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(undefined);
        }}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[90vh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "编辑模板" : "新建模板"}</DialogTitle>
            <DialogDescription>
              使用纯文本主题与正文，点击变量会插入到当前光标位置。
            </DialogDescription>
          </DialogHeader>
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
                  name,
                  category,
                  subject,
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
              />
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
              />
            </div>
            <div>
              <Label htmlFor="template-body">纯文本正文</Label>
              <textarea
                ref={bodyRef}
                id="template-body"
                required
                maxLength={20000}
                className="min-h-48 w-full rounded-md border bg-white px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <Button
                    key={variable.key}
                    type="button"
                    size="sm"
                    variant="outline"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertVariable(variable.key)}
                  >
                    {`{{${variable.key}}}`}
                  </Button>
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
                  />
                </div>
              </details>
            )}
            <Button
              type="submit"
              disabled={busy || validationErrors.length > 0}
            >
              {busy ? "保存中…" : "保存模板"}
            </Button>
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
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
