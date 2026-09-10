"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { saveContact, setContactArchived } from "./actions";
import type { Contact, ContactList } from "./model";
export function Contacts({
  workspace,
  canEdit,
  data,
  filters,
}: {
  workspace: string;
  canEdit: boolean;
  data: ContactList;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const returnFocus = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const archived = filters.status === "archived";
  function navigate(changes: Record<string, string>) {
    const p = new URLSearchParams({ ...filters, ...changes });
    start(() => router.replace(`/contacts?${p}`));
  }
  const [previousQuery, setPreviousQuery] = useState(filters.q ?? "");
  if (previousQuery !== (filters.q ?? "")) {
    setPreviousQuery(filters.q ?? "");
    setQ(filters.q ?? "");
  }
  useEffect(() => {
    if (q === (filters.q ?? "")) return;
    const timer = setTimeout(() => {
      const p = new URLSearchParams({ ...filters, q, page: "1" });
      start(() => router.replace(`/contacts?${p}`));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, filters, router]);
  useEffect(() => {
    if (filters.page && Number(filters.page) !== data.page) {
      const p = new URLSearchParams({ ...filters, page: String(data.page) });
      router.replace(`/contacts?${p}`);
    }
  }, [filters, data.page, router]);
  function open(c: Contact | null) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setEditing(c);
    setEmail(c?.email ?? "");
    setName(c?.name ?? "");
    setTags(c?.tags.map((t) => t.name) ?? []);
    setTag("");
    setError("");
  }
  function addTag() {
    const value = tag.trim();
    if (!value) return;
    if (value.length > 30 || tags.length >= 20) {
      setError("标签最多 30 字，每位客户最多 20 个标签。");
      return;
    }
    if (!tags.some((t) => t.toLowerCase() === value.toLowerCase()))
      setTags([...tags, value]);
    setTag("");
  }
  async function archive(c: Contact) {
    if (
      !archived &&
      !window.confirm(`归档 ${c.email}？之后可以在已归档列表恢复。`)
    )
      return;
    setBusy(true);
    try {
      const result = await setContactArchived({
        workspace_id: workspace,
        id: c.id,
        expected_version: c.version,
        archived: !archived,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success(archived ? "客户已恢复" : "客户已归档");
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
        <h1>客户名单</h1>
        <span>{data.total} 位</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        {canEdit && <Button onClick={() => open(null)}>添加客户</Button>}
        <select
          aria-label="客户状态"
          className="rounded border bg-white p-2"
          value={archived ? "archived" : "active"}
          onChange={(e) => navigate({ status: e.target.value, page: "1" })}
        >
          <option value="active">正常客户</option>
          <option value="archived">已归档</option>
        </select>
        <select
          aria-label="标签筛选"
          className="max-w-full rounded border bg-white p-2"
          value={filters.tag ?? ""}
          onChange={(e) => navigate({ tag: e.target.value, page: "1" })}
        >
          <option value="">全部标签</option>
          {data.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <Input
        aria-label="搜索邮箱或姓名"
        placeholder="搜索邮箱或姓名"
        value={q}
        maxLength={254}
        onChange={(e) => setQ(e.target.value)}
      />
      <div aria-live="polite" className="hint mt-2">
        {pending ? "正在加载…" : !canEdit ? "当前为只读权限。" : ""}
      </div>
      <div className="my-4 space-y-3" aria-busy={pending}>
        {data.items.map((c) => (
          <Card key={c.id}>
            <CardContent className="flex flex-wrap items-center gap-3 pt-5">
              <div className="min-w-0 flex-1">
                <p className="break-all">{c.email}</p>
                <p className="hint">{c.name || "未填写姓名"}</p>
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((t) => (
                    <span
                      className="rounded-full bg-amber-50 px-2 py-1 text-xs"
                      key={t.id}
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  {!archived && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => open(c)}
                    >
                      编辑
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => archive(c)}
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
            {filters.q || filters.tag
              ? "没有匹配的客户，请调整搜索或筛选。"
              : archived
                ? "暂无已归档客户。"
                : "名单是空的，添加第一位客户吧。"}
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
          {data.page} / {Math.max(1, Math.ceil(data.total / 20))}
        </span>
        <Button
          variant="outline"
          disabled={pending || data.page * 20 >= data.total}
          onClick={() => navigate({ page: String(data.page + 1) })}
        >
          下一页
        </Button>
      </div>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(value) => {
          if (!value && !busy) setEditing(undefined);
        }}
      >
        <DialogContent
          className="bottom-sheet max-h-[85vh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? "编辑客户" : "添加客户"}</DialogTitle>
            <DialogDescription>
              维护客户资料和标签。添加客户不代表客户已同意订阅。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const all = [...tags];
                if (
                  tag.trim() &&
                  !all.some((t) => t.toLowerCase() === tag.trim().toLowerCase())
                )
                  all.push(tag.trim());
                const result = await saveContact({
                  workspace_id: workspace,
                  id: editing?.id,
                  expected_version: editing?.version,
                  email,
                  name,
                  tags: all,
                });
                if (result.error) setError(result.error);
                else {
                  setEditing(undefined);
                  toast.success("客户已保存");
                  router.refresh();
                }
              } catch {
                setError("保存失败，输入已保留，请重试。");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Label htmlFor="contact-email">邮箱</Label>
            <Input
              id="contact-email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Label htmlFor="contact-name">姓名（选填）</Label>
            <Input
              id="contact-name"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Label htmlFor="contact-tag">标签</Label>
            <div className="flex gap-2">
              <Input
                id="contact-tag"
                list="contact-tag-options"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="选择已有标签或输入新标签"
              />
              <Button type="button" variant="outline" onClick={addTag}>
                添加标签
              </Button>
            </div>
            <datalist id="contact-tag-options">
              {data.tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant="outline"
                  aria-label={`移除标签 ${t}`}
                  onClick={() => setTags(tags.filter((v) => v !== t))}
                >
                  {t} ×
                </Button>
              ))}
            </div>
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <Button disabled={busy}>{busy ? "保存中…" : "保存客户"}</Button>
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
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
