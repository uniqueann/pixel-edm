"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { unstable_rethrow, useRouter } from "next/navigation";
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
import {
  listContacts,
  saveContact,
  setContactArchived,
  unsubscribeContact,
} from "./actions";
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
  const [listOverride, setListOverride] = useState<ContactList | null>(null);
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
  const shown = listOverride ?? data;
  const [q, setQ] = useState(filters.q ?? "");
  const returnFocus = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [consentDeclared, setConsentDeclared] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [consentNote, setConsentNote] = useState("");
  const [consentAt, setConsentAt] = useState("");
  const [unsubscribing, setUnsubscribing] = useState<Contact>();
  const [unsubscribeReason, setUnsubscribeReason] = useState("");
  const archived = filters.status === "archived";
  const canDeclareConsent =
    !editing || editing.subscription_status === "unconfirmed";
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
    if (filters.page && Number(filters.page) !== shown.page) {
      const p = new URLSearchParams({ ...filters, page: String(shown.page) });
      router.replace(`/contacts?${p}`);
    }
  }, [filters, shown.page, router]);
  async function refreshContacts() {
    try {
      const fresh = await listContacts({
        q: filters.q,
        tag: filters.tag,
        status: filters.status,
        subscription: filters.subscription,
        page: filters.page,
      });
      setListOverride(fresh);
    } catch (error) {
      unstable_rethrow(error);
    }
    start(() => router.refresh());
  }
  function open(c: Contact | null) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setEditing(c);
    setEmail(c?.email ?? "");
    setName(c?.name ?? "");
    setTags(c?.tags.map((t) => t.name) ?? []);
    setTag("");
    setConsentDeclared(false);
    setConsentSource("");
    setConsentNote("");
    setConsentAt("");
    setError("");
  }
  function parseTagsInput(text: string): string[] {
    return text
      .split(/[,，;；\n\t]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  function addTag(inputTag?: string) {
    const source = inputTag ?? tag;
    const incoming = parseTagsInput(source);
    if (!incoming.length) return;
    const nextTags = [...tags];
    let hasError = false;
    for (const item of incoming) {
      if (item.length > 30) {
        setError("单个标签最多 30 字。");
        hasError = true;
        break;
      }
      if (nextTags.length >= 20) {
        setError("每位客户最多 20 个标签。");
        hasError = true;
        break;
      }
      if (!nextTags.some((t) => t.toLowerCase() === item.toLowerCase())) {
        nextTags.push(item);
      }
    }
    setTags(nextTags);
    if (!hasError) {
      setError("");
      setTag("");
    }
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
        await refreshContacts();
      }
    } catch (error) {
      unstable_rethrow(error);
      toast.error("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <h1>客户名单</h1>
        <span>{shown.total} 位</span>
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
          <option value="active">有效客户</option>
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
          {shown.tags.map((t) => (
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
              {shown.tags.find((item) => item.id === filters.tag)?.name ??
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
        {shown.items.map((c) => (
          <Card key={c.id}>
            <CardContent className="flex flex-wrap items-center gap-3 pt-5">
              <div className="w-full min-w-0 flex-1 sm:w-auto">
                <p className="break-all">{c.email}</p>
                <p className="hint">{c.name || "未填写姓名"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={
                      c.subscription_status === "subscribed"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {subscriptionLabels[c.subscription_status]}
                  </Badge>
                  {c.tags
                    .filter((t) => Boolean(t.name?.trim()))
                    .map((t) => (
                      <span
                        className="rounded-full border border-amber-200/70 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300"
                        key={t.id}
                      >
                        {t.name.trim()}
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
        {!shown.items.length && (
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
        page={shown.page}
        pageSize={20}
        total={shown.total}
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
              维护客户邮箱、姓名与分类标签。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/80 bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              💡 订阅合规提示：
            </span>
            未声明已获得同意的客户为「未确认」，不能用于发送活动，以保障发信信誉。
            {editing && (
              <>
                {" "}
                当前状态：
                <span className="font-medium text-foreground">
                  {subscriptionLabels[editing.subscription_status]}
                </span>
                {editing.subscription_status === "subscribed" &&
                  editing.consent_source && (
                    <>（同意来源：{editing.consent_source}）</>
                  )}
                。
              </>
            )}
          </div>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const all = [...tags];
                if (tag.trim()) {
                  const incoming = parseTagsInput(tag);
                  for (const item of incoming) {
                    if (
                      item.length <= 30 &&
                      all.length < 20 &&
                      !all.some((t) => t.toLowerCase() === item.toLowerCase())
                    ) {
                      all.push(item);
                    }
                  }
                }
                const result = await saveContact({
                  workspace_id: workspace,
                  id: editing?.id,
                  expected_version: editing?.version,
                  email: email.trim(),
                  name: name.trim(),
                  tags: all,
                  ...(canDeclareConsent && consentDeclared
                    ? {
                        consent_declared: true,
                        consent_source: consentSource,
                        consent_note: consentNote,
                        ...(consentAt
                          ? { consent_at: new Date(consentAt).toISOString() }
                          : {}),
                      }
                    : {}),
                });
                if (result.error) setError(result.error);
                else {
                  toast.success("客户已保存");
                  flushSync(() => setEditing(undefined));
                  await refreshContacts();
                }
              } catch (error) {
                unstable_rethrow(error);
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
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmail((prev) => prev.trim())}
            />
            <Label htmlFor="contact-name">姓名（选填）</Label>
            <Input
              id="contact-name"
              maxLength={100}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setName((prev) => prev.trim())}
            />
            <div className="flex items-center justify-between">
              <Label htmlFor="contact-tag">标签</Label>
              <span className="text-xs text-muted-foreground">
                已添加 {tags.length}/20
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                id="contact-tag"
                list="contact-tag-options"
                value={tag}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/[,，;；\n]/.test(val)) {
                    addTag(val);
                  } else {
                    setTag(val);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="输入标签（支持逗号或回车快速添加）"
              />
              <Button type="button" variant="outline" onClick={() => addTag()}>
                添加标签
              </Button>
            </div>
            <datalist id="contact-tag-options">
              {shown.tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            {shown.tags.filter(
              (st) =>
                !tags.some((t) => t.toLowerCase() === st.name.toLowerCase()),
            ).length > 0 &&
              tags.length < 20 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                  <span className="text-muted-foreground">
                    快捷添加已有标签：
                  </span>
                  {shown.tags
                    .filter(
                      (st) =>
                        !tags.some(
                          (t) => t.toLowerCase() === st.name.toLowerCase(),
                        ),
                    )
                    .slice(0, 6)
                    .map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        className="rounded-full border border-border/80 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground active:scale-95"
                        onClick={() => addTag(st.name)}
                      >
                        + {st.name}
                      </button>
                    ))}
                </div>
              )}
            {tags.length > 0 && (
              <div
                className="flex flex-wrap gap-1.5 pt-0.5"
                aria-label="已选标签列表"
              >
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 hover:text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50 active:scale-95"
                    aria-label={`移除标签 ${t}`}
                    onClick={() => setTags(tags.filter((v) => v !== t))}
                  >
                    <span>{t}</span>
                    <span
                      aria-hidden="true"
                      className="font-bold text-amber-700/80 dark:text-amber-400"
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
            )}
            {canDeclareConsent && (
              <div className="rounded-lg border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={consentDeclared}
                    onChange={(e) => setConsentDeclared(e.target.checked)}
                  />
                  我确认该客户已明确同意接收商业邮件
                </label>
                <p className="hint mt-2">
                  勾选后客户将变为「已订阅」并可用于发送，来源与说明会作为订阅证据留痕。不勾选则保持「未确认」。
                </p>
                {consentDeclared && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="contact-consent-source">同意来源</Label>
                      <Input
                        id="contact-consent-source"
                        required
                        maxLength={100}
                        placeholder="例如：独立站结账勾选、展会名片"
                        value={consentSource}
                        onChange={(e) => setConsentSource(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="contact-consent-at">
                        同意时间（选填）
                      </Label>
                      <Input
                        id="contact-consent-at"
                        type="datetime-local"
                        value={consentAt}
                        onChange={(e) => setConsentAt(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="contact-consent-note">授权说明</Label>
                      <Input
                        id="contact-consent-note"
                        required
                        maxLength={500}
                        placeholder="例如：客户在结账页主动勾选接收促销邮件"
                        value={consentNote}
                        onChange={(e) => setConsentNote(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(undefined)}
                className="w-full sm:w-auto"
              >
                取消
              </Button>
              <Button disabled={busy} className="w-full sm:w-auto">
                {busy ? "保存中…" : "保存客户"}
              </Button>
            </div>
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
              手动退订后，系统将把该邮箱加入防打扰名单，后续重新导入名单也不会向其发信。
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
              toast.success("客户已成功退订");
              await refreshContacts();
              flushSync(() => setUnsubscribing(undefined));
            }}
          >
            <Label htmlFor="unsubscribe-reason">退订原因</Label>
            <Input
              id="unsubscribe-reason"
              required
              maxLength={500}
              placeholder="如：客户要求退订、邮箱失效等"
              value={unsubscribeReason}
              onChange={(event) => setUnsubscribeReason(event.target.value)}
            />
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="hint self-center">快捷填入：</span>
              {["客户主动要求退订", "邮箱地址失效", "业务合作终止"].map(
                (quickReason) => (
                  <Button
                    key={quickReason}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setUnsubscribeReason(quickReason)}
                  >
                    {quickReason}
                  </Button>
                ),
              )}
            </div>
            <Button disabled={busy || !unsubscribeReason.trim()}>
              {busy ? "处理中…" : "确认退订"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
