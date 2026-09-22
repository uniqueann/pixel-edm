"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { Badge } from "@/components/ui/badge";
import { ListPagination } from "@/components/list-pagination";
import { saveContact, setContactArchived, unsubscribeContact } from "./actions";
import type { Contact, ContactList } from "./model";
import { subscriptionLabels } from "./import-model";
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
  const [unsubscribing, setUnsubscribing] = useState<Contact>();
  const [unsubscribeReason, setUnsubscribeReason] = useState("");
  const archived = filters.status === "archived";
  const hasFilters = Boolean(filters.q || filters.tag || filters.subscription);
  function navigate(changes: Record<string, string>) {
    const next = { ...filters, ...changes };
    Object.entries(next).forEach(([key, value]) => {
      if (!value) delete next[key];
    });
    const p = new URLSearchParams(next);
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
      <div className="list-toolbar">
        {canEdit && <Button onClick={() => open(null)}>添加客户</Button>}
        {canEdit && (
          <Button asChild variant="outline">
            <Link href="/contacts/import">导入名单</Link>
          </Button>
        )}
        <select
          aria-label="客户状态"
          className="list-filter"
          value={archived ? "archived" : "active"}
          onChange={(e) => navigate({ status: e.target.value, page: "1" })}
        >
          <option value="active">正常客户</option>
          <option value="archived">已归档</option>
        </select>
        <select
          aria-label="订阅状态"
          className="list-filter"
          value={filters.subscription ?? ""}
          onChange={(e) =>
            navigate({ subscription: e.target.value, page: "1" })
          }
        >
          <option value="">全部订阅状态</option>
          {Object.entries(subscriptionLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="标签筛选"
          className="list-filter max-w-full"
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
        className="list-search"
        aria-label="搜索邮箱或姓名"
        placeholder="搜索邮箱或姓名"
        value={q}
        maxLength={254}
        onChange={(e) => setQ(e.target.value)}
      />
      <div aria-live="polite" className="hint mt-2">
        {pending ? "正在加载…" : !canEdit ? "当前为只读权限。" : ""}
      </div>
      {hasFilters && (
        <div className="active-filters" aria-label="已应用筛选">
          <span>已筛选</span>
          {filters.q && <span className="filter-chip">搜索：{filters.q}</span>}
          {filters.subscription && (
            <span className="filter-chip">
              {subscriptionLabels[
                filters.subscription as keyof typeof subscriptionLabels
              ] ?? filters.subscription}
            </span>
          )}
          {filters.tag && (
            <span className="filter-chip">
              标签：
              {data.tags.find((item) => item.id === filters.tag)?.name ??
                "已选标签"}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({ q: "", tag: "", subscription: "", page: "1" })
            }
          >
            清空筛选
          </Button>
        </div>
      )}
      <div className="my-4 space-y-3" aria-busy={pending}>
        {data.items.map((c) => (
          <Card key={c.id}>
            <CardContent className="flex flex-wrap items-center gap-3 pt-5">
              <div className="w-full min-w-0 flex-1 sm:w-auto">
                <p className="break-all">{c.email}</p>
                <p className="hint">{c.name || "未填写姓名"}</p>
                <Badge
                  variant={
                    c.subscription_status === "subscribed"
                      ? "default"
                      : "secondary"
                  }
                >
                  {subscriptionLabels[c.subscription_status]}
                </Badge>
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
                <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:shrink-0">
                  {!archived && (
                    <>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => open(c)}
                      >
                        编辑
                      </Button>
                      {!(
                        ["unsubscribed", "bounced", "complained"] as string[]
                      ).includes(c.subscription_status) && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setUnsubscribing(c);
                            setUnsubscribeReason("");
                          }}
                        >
                          退订
                        </Button>
                      )}
                    </>
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
            {hasFilters
              ? "没有匹配的客户，请调整搜索或筛选。"
              : archived
                ? "暂无已归档客户。"
                : "名单是空的，添加第一位客户吧。"}
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
        onOpenChange={(value) => {
          if (!value && !busy) setEditing(undefined);
        }}
      >
        <DialogContent
          placement="bottom"
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
      <Dialog
        open={Boolean(unsubscribing)}
        onOpenChange={(value) => {
          if (!value && !busy) setUnsubscribing(undefined);
        }}
      >
        <DialogContent placement="bottom" className="bottom-sheet">
          <DialogHeader>
            <DialogTitle>确认手动退订</DialogTitle>
            <DialogDescription>
              退订会写入独立抑制记录。再次导入相同邮箱也不会恢复订阅。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!unsubscribing) return;
              setBusy(true);
              const result = await unsubscribeContact({
                workspace_id: workspace,
                id: unsubscribing.id,
                expected_version: unsubscribing.version,
                reason: unsubscribeReason,
              });
              setBusy(false);
              if (result.error) return toast.error(result.error);
              setUnsubscribing(undefined);
              toast.success("客户已退订，抑制记录已保存");
              router.refresh();
            }}
          >
            <Label htmlFor="unsubscribe-reason">退订原因</Label>
            <Input
              id="unsubscribe-reason"
              required
              maxLength={500}
              value={unsubscribeReason}
              onChange={(event) => setUnsubscribeReason(event.target.value)}
            />
            <Button disabled={busy || !unsubscribeReason.trim()}>
              {busy ? "处理中…" : "确认退订"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
