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
import { flushSync } from "react-dom";
import { unstable_rethrow, useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
import { EmptyState } from "@/components/empty-state";
import { ListPagination } from "@/components/list-pagination";
import {
  listContacts,
  saveContact,
  setContactArchived,
  unsubscribeContact,
} from "./actions";
import type { Contact, ContactList } from "./model";
import { subscriptionStatuses, type SubscriptionStatus } from "./import-model";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedEditDialog } from "@/hooks/use-unsaved-edit-dialog";
import { PlanUsageNote } from "@/features/workspace/plan-usage-note";
import {
  isQuotaExhausted,
  type PlanQuota,
} from "@/features/workspace/plan-usage";
import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from "@/i18n/config";
import { formatBusinessDateTime } from "@/i18n/format";
import { useErrorMessage, useValidationMessage } from "@/i18n/use-resolvers";

function formatConsentTimestamp(
  value: string | null,
  locale: AppLocale,
  emptyLabel: string,
) {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatBusinessDateTime(date, locale);
}

export function Contacts({
  workspace,
  canEdit,
  contactQuota,
  data,
  filters,
}: {
  workspace: string;
  canEdit: boolean;
  contactQuota: PlanQuota | null;
  data: ContactList;
  filters: Record<string, string>;
}) {
  const t = useTranslations("contacts");
  const tCommon = useTranslations("common");
  const locale = normalizeLocale(useLocale()) ?? DEFAULT_LOCALE;
  const resolveValidation = useValidationMessage();
  const resolveError = useErrorMessage();
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
  const [editBaseline, setEditBaseline] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState<Contact>();
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
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
  const showInitialEmpty = !shown.items.length && !hasFilters && !archived;

  const subscriptionLabel = (status: string) =>
    subscriptionStatuses.includes(status as SubscriptionStatus)
      ? t(`subscription.${status as SubscriptionStatus}`)
      : status;

  const resolveActionFailure = (result: {
    error?: string;
    errorCode?: string;
    errorPayload?: {
      code: string;
      params?: Record<string, string | number>;
      message?: string;
    };
  }) => {
    if (result.errorCode?.startsWith("validation.")) {
      return resolveValidation(result.errorCode, result.error);
    }
    return resolveError(result);
  };

  const contactEditSnapshot = useMemo(
    () =>
      JSON.stringify({
        email,
        name,
        tags: [...tags].sort(),
        consentDeclared,
        consentSource,
        consentNote,
        consentAt,
      }),
    [email, name, tags, consentDeclared, consentSource, consentNote, consentAt],
  );
  const isContactEditDirty =
    editing !== undefined && contactEditSnapshot !== editBaseline;

  const closeContactEditor = useCallback(
    () => setEditing(undefined),
    [setEditing],
  );
  const {
    handleOpenChange: handleContactEditorOpenChange,
    editDialogContentProps: contactEditDialogContentProps,
    requestClose: requestCloseContactEditor,
    discardConfirm: contactDiscardConfirm,
  } = useUnsavedEditDialog({
    dirty: isContactEditDirty,
    onClose: closeContactEditor,
    busy,
  });
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
        page_size: filters.page_size,
      });
      setListOverride(fresh);
    } catch (error) {
      unstable_rethrow(error);
    }
    start(() => router.refresh());
  }
  function contactSnapshotFromValues(input: {
    email: string;
    name: string;
    tags: string[];
    consentDeclared: boolean;
    consentSource: string;
    consentNote: string;
    consentAt: string;
  }) {
    return JSON.stringify({
      ...input,
      tags: [...input.tags].sort(),
    });
  }

  function open(c: Contact | null) {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const nextEmail = c?.email ?? "";
    const nextName = c?.name ?? "";
    const nextTags = c?.tags.map((item) => item.name) ?? [];
    setEditing(c);
    setEmail(nextEmail);
    setName(nextName);
    setTags(nextTags);
    setTag("");
    setConsentDeclared(false);
    setConsentSource("");
    setConsentNote("");
    setConsentAt("");
    setError("");
    setErrorCode("");
    setEditBaseline(
      contactSnapshotFromValues({
        email: nextEmail,
        name: nextName,
        tags: nextTags,
        consentDeclared: false,
        consentSource: "",
        consentNote: "",
        consentAt: "",
      }),
    );
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
        setError(t("editor.tagTooLong"));
        hasError = true;
        break;
      }
      if (nextTags.length >= 20) {
        setError(t("editor.tagsLimitReached"));
        hasError = true;
        break;
      }
      if (
        !nextTags.some((value) => value.toLowerCase() === item.toLowerCase())
      ) {
        nextTags.push(item);
      }
    }
    setTags(nextTags);
    if (!hasError) {
      setError("");
      setTag("");
    }
  }
  async function performArchive(c: Contact) {
    setBusy(true);
    try {
      const result = await setContactArchived({
        workspace_id: workspace,
        id: c.id,
        expected_version: c.version,
        archived: !archived,
      });
      if (result.error) toast.error(resolveActionFailure(result));
      else {
        toast.success(archived ? t("toast.restored") : t("toast.archived"));
        await refreshContacts();
      }
    } catch (error) {
      unstable_rethrow(error);
      toast.error(t("toast.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  function archive(c: Contact) {
    if (!archived) {
      setArchiveConfirm(c);
      return;
    }
    void performArchive(c);
  }
  return (
    <>
      <PageHeader
        title={t("title")}
        meta={t("metaCount", { count: shown.total })}
        actions={
          canEdit && !showInitialEmpty ? (
            <>
              <Button
                disabled={isQuotaExhausted(contactQuota)}
                onClick={() => open(null)}
              >
                {t("actions.addContact")}
              </Button>
              <Button asChild variant="outline">
                <Link href="/contacts/import">{t("actions.importList")}</Link>
              </Button>
            </>
          ) : undefined
        }
      />
      <ListToolbar role="search" aria-label={t("toolbar.ariaLabel")}>
        <FilterField
          id="contact-search"
          label={t("toolbar.searchLabel")}
          className="filter-field-search"
        >
          <Input
            id="contact-search"
            aria-label={t("toolbar.searchPlaceholder")}
            placeholder={t("toolbar.searchPlaceholder")}
            value={q}
            maxLength={254}
            onChange={(event) => setQ(event.target.value)}
          />
        </FilterField>
        <FilterField id="contact-status" label={t("toolbar.statusLabel")}>
          <select
            id="contact-status"
            aria-label={t("toolbar.statusAria")}
            className="list-filter"
            value={archived ? "archived" : "active"}
            onChange={(e) => navigate({ status: e.target.value, page: "1" })}
          >
            <option value="active">{t("toolbar.statusActive")}</option>
            <option value="archived">{t("toolbar.statusArchived")}</option>
          </select>
        </FilterField>
        <FilterField
          id="contact-subscription"
          label={t("toolbar.subscriptionLabel")}
        >
          <select
            id="contact-subscription"
            aria-label={t("toolbar.subscriptionLabel")}
            className="list-filter"
            value={filters.subscription ?? ""}
            onChange={(e) =>
              navigate({ subscription: e.target.value, page: "1" })
            }
          >
            <option value="">{t("toolbar.allSubscriptions")}</option>
            {subscriptionStatuses.map((value) => (
              <option key={value} value={value}>
                {t(`subscription.${value}`)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField id="contact-filter-tag" label={t("toolbar.tagLabel")}>
          <select
            id="contact-filter-tag"
            aria-label={t("toolbar.tagAria")}
            className="list-filter max-w-full"
            value={filters.tag ?? ""}
            onChange={(e) => navigate({ tag: e.target.value, page: "1" })}
          >
            <option value="">{t("toolbar.allTags")}</option>
            {shown.tags.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </FilterField>
      </ListToolbar>
      {canEdit && (
        <PlanUsageNote
          label={t("quota.label")}
          quota={contactQuota}
          exhaustedText={t("quota.exhausted")}
          testId="contact-quota"
          className="mb-3"
        />
      )}
      <div aria-live="polite" className="hint mt-2">
        {pending ? t("status.loading") : !canEdit ? t("status.readOnly") : ""}
      </div>
      {hasFilters && (
        <div className="active-filters" aria-label={t("filters.ariaLabel")}>
          <span>{t("filters.applied")}</span>
          {filters.q && (
            <span className="filter-chip">
              {t("filters.queryChip", { query: filters.q })}
            </span>
          )}
          {filters.subscription && (
            <span className="filter-chip">
              {subscriptionLabel(filters.subscription)}
            </span>
          )}
          {filters.tag && (
            <span className="filter-chip">
              {t("filters.tagChip", {
                tag:
                  shown.tags.find((item) => item.id === filters.tag)?.name ??
                  t("filters.selectedTagFallback"),
              })}
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
            {t("filters.clear")}
          </Button>
        </div>
      )}
      {shown.items.length > 0 ? (
        <div className="my-4 space-y-2 md:space-y-1.5" aria-busy={pending}>
          <div className="hidden border-b border-border/80 px-4 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
            <div className="col-span-4">{t("table.emailAndName")}</div>
            <div className="col-span-2">{t("table.subscription")}</div>
            <div className="col-span-3">{t("table.tags")}</div>
            <div className="col-span-3 text-right">{t("table.actions")}</div>
          </div>
          {shown.items.map((c) => (
            <Card
              key={c.id}
              className="border-border/70 py-0 transition-colors hover:border-border hover:bg-muted/20"
            >
              <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3 md:grid md:grid-cols-12 md:gap-3 md:py-2.5">
                <div className="w-full min-w-0 flex-1 sm:w-auto md:col-span-4">
                  <p className="truncate text-sm font-medium break-all md:mb-0.5">
                    {c.email}
                  </p>
                  <p className="hint m-0 truncate text-xs">
                    {c.name || t("table.unnamed")}
                  </p>
                </div>
                <div className="flex items-center md:col-span-2">
                  <Badge
                    variant={
                      c.subscription_status === "subscribed"
                        ? "success"
                        : c.subscription_status === "unconfirmed"
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {subscriptionLabel(c.subscription_status)}
                  </Badge>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1 md:col-span-3">
                  {c.tags
                    .filter((item) => Boolean(item.name?.trim()))
                    .map((item) => (
                      <span className="filter-chip text-xs" key={item.id}>
                        {item.name.trim()}
                      </span>
                    ))}
                </div>
                {canEdit && (
                  <div className="flex w-full flex-wrap justify-end gap-1.5 sm:w-auto sm:shrink-0 md:col-span-3 md:w-auto">
                    {!archived && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => open(c)}
                        >
                          {t("actions.edit")}
                        </Button>
                        {!(
                          ["unsubscribed", "bounced", "complained"] as string[]
                        ).includes(c.subscription_status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setUnsubscribing(c);
                              setUnsubscribeReason("");
                            }}
                          >
                            {t("actions.unsubscribe")}
                          </Button>
                        )}
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => archive(c)}
                    >
                      {archived ? t("actions.restore") : t("actions.archive")}
                    </Button>
                  </div>
                )}
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
                ? t("empty.searchTitle")
                : archived
                  ? t("empty.archivedTitle")
                  : t("empty.initialTitle")
            }
            description={
              hasFilters
                ? t("empty.searchDescription")
                : archived
                  ? t("empty.archivedDescription")
                  : t("empty.initialDescription")
            }
          >
            {hasFilters ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate({
                    q: "",
                    subscription: "",
                    tag: "",
                    page: "1",
                  })
                }
              >
                {t("filters.clear")}
              </Button>
            ) : (
              canEdit &&
              !archived && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    disabled={isQuotaExhausted(contactQuota)}
                    onClick={() => open(null)}
                  >
                    {t("actions.addContact")}
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/contacts/import">
                      {t("actions.importList")}
                    </Link>
                  </Button>
                </div>
              )
            )}
          </EmptyState>
        </div>
      )}
      <ListPagination
        page={shown.page}
        pageSize={(shown.page_size ?? Number(filters.page_size)) || 20}
        total={shown.total}
        pending={pending}
        onPageChange={(page) => navigate({ page: String(page) })}
        onPageSizeChange={(pageSize) =>
          navigate({ page_size: String(pageSize), page: "1" })
        }
      />
      <Dialog
        open={editing !== undefined}
        onOpenChange={handleContactEditorOpenChange}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[85vh] overflow-y-auto"
          {...contactEditDialogContentProps}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editor.editTitle") : t("editor.createTitle")}
            </DialogTitle>
            <DialogDescription>{t("editor.description")}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <section
              className="contact-subscription-summary"
              aria-label={t("editor.consentSummaryAria")}
            >
              <dl>
                <div>
                  <dt>{t("editor.subscriptionLabel")}</dt>
                  <dd>{subscriptionLabel(editing.subscription_status)}</dd>
                </div>
                <div>
                  <dt>{t("editor.consentSourceLabel")}</dt>
                  <dd>{editing.consent_source?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt>{t("editor.consentAtLabel")}</dt>
                  <dd>
                    {formatConsentTimestamp(
                      editing.consent_at,
                      locale,
                      t("editor.consentAtEmpty"),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("editor.consentNoteLabel")}</dt>
                  <dd>{editing.consent_note?.trim() || "—"}</dd>
                </div>
              </dl>
            </section>
          ) : (
            <div className="rounded-lg border border-border/80 bg-muted/40 p-2.5 text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                {t("editor.complianceTitle")}
              </span>
              {t("editor.complianceBody")}
            </div>
          )}
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setErrorCode("");
              try {
                const all = [...tags];
                if (tag.trim()) {
                  const incoming = parseTagsInput(tag);
                  for (const item of incoming) {
                    if (
                      item.length <= 30 &&
                      all.length < 20 &&
                      !all.some(
                        (value) => value.toLowerCase() === item.toLowerCase(),
                      )
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
                if (result.error) {
                  setError(resolveActionFailure(result));
                  setErrorCode(result.errorCode ?? "");
                } else {
                  toast.success(t("toast.saved"));
                  flushSync(() => setEditing(undefined));
                  await refreshContacts();
                }
              } catch (error) {
                unstable_rethrow(error);
                setError(t("editor.saveFailedKeepInput"));
                setErrorCode("errors.common.saveFailed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Label htmlFor="contact-email">{t("editor.emailLabel")}</Label>
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
            <Label htmlFor="contact-name">{t("editor.nameLabel")}</Label>
            <Input
              id="contact-name"
              maxLength={100}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setName((prev) => prev.trim())}
            />
            <div className="flex items-center justify-between">
              <Label htmlFor="contact-tag">{t("editor.tagsLabel")}</Label>
              <span className="text-xs text-muted-foreground">
                {t("editor.tagsCounter", { count: tags.length })}
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
                placeholder={t("editor.tagPlaceholder")}
              />
              <Button type="button" variant="outline" onClick={() => addTag()}>
                {t("editor.addTagButton")}
              </Button>
            </div>
            <datalist id="contact-tag-options">
              {shown.tags.map((item) => (
                <option key={item.id} value={item.name} />
              ))}
            </datalist>
            {shown.tags.filter(
              (st) =>
                !tags.some(
                  (value) => value.toLowerCase() === st.name.toLowerCase(),
                ),
            ).length > 0 &&
              tags.length < 20 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                  <span className="text-muted-foreground">
                    {t("editor.quickAddTags")}
                  </span>
                  {shown.tags
                    .filter(
                      (st) =>
                        !tags.some(
                          (value) =>
                            value.toLowerCase() === st.name.toLowerCase(),
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
                aria-label={t("editor.selectedTagsAria")}
              >
                {tags.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 hover:text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50 active:scale-95"
                    aria-label={t("editor.removeTagAria", { tag: item })}
                    onClick={() => setTags(tags.filter((v) => v !== item))}
                  >
                    <span>{item}</span>
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
                  {t("editor.consentCheckbox")}
                </label>
                <p className="hint mt-2">{t("editor.consentCheckboxHint")}</p>
                {consentDeclared && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="contact-consent-source">
                        {t("editor.consentSourceLabel")}
                      </Label>
                      <Input
                        id="contact-consent-source"
                        required
                        maxLength={100}
                        placeholder={t("editor.consentSourcePlaceholder")}
                        value={consentSource}
                        onChange={(e) => setConsentSource(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="contact-consent-at">
                        {t("editor.consentAtOptional")}
                      </Label>
                      <Input
                        id="contact-consent-at"
                        type="datetime-local"
                        value={consentAt}
                        onChange={(e) => setConsentAt(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="contact-consent-note">
                        {t("editor.consentNoteLabel")}
                      </Label>
                      <Input
                        id="contact-consent-note"
                        required
                        maxLength={500}
                        placeholder={t("editor.consentNotePlaceholder")}
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
                onClick={requestCloseContactEditor}
                className="w-full sm:w-auto"
              >
                {tCommon("actions.cancel")}
              </Button>
              <Button disabled={busy} className="w-full sm:w-auto">
                {busy ? t("editor.savingButton") : t("editor.saveButton")}
              </Button>
            </div>
            {errorCode === "errors.db.versionConflict" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(undefined);
                  router.refresh();
                }}
              >
                {tCommon("actions.reload")}
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
            <DialogTitle>{t("unsubscribeDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("unsubscribeDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!unsubscribing) return;
              setBusy(true);
              try {
                const result = await unsubscribeContact({
                  workspace_id: workspace,
                  id: unsubscribing.id,
                  expected_version: unsubscribing.version,
                  reason: unsubscribeReason,
                });
                if (result.error) {
                  toast.error(resolveActionFailure(result));
                  return;
                }
                toast.success(t("toast.unsubscribed"));
                await refreshContacts();
                flushSync(() => setUnsubscribing(undefined));
              } catch (error) {
                unstable_rethrow(error);
                toast.error(t("toast.unsubscribeFailed"));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Label htmlFor="unsubscribe-reason">
              {t("unsubscribeDialog.reasonLabel")}
            </Label>
            <Input
              id="unsubscribe-reason"
              required
              maxLength={500}
              placeholder={t("unsubscribeDialog.reasonPlaceholder")}
              value={unsubscribeReason}
              onChange={(event) => setUnsubscribeReason(event.target.value)}
            />
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="hint self-center">
                {t("unsubscribeDialog.quickFill")}
              </span>
              {(["requested", "invalidEmail", "ended"] as const).map((key) => {
                const quickReason = t(`unsubscribeDialog.quickReasons.${key}`);
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setUnsubscribeReason(quickReason)}
                  >
                    {quickReason}
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="w-full sm:w-auto"
                onClick={() => setUnsubscribing(undefined)}
              >
                {tCommon("actions.cancel")}
              </Button>
              <Button
                disabled={busy || !unsubscribeReason.trim()}
                className="w-full sm:w-auto"
              >
                {busy
                  ? t("unsubscribeDialog.processing")
                  : t("unsubscribeDialog.confirm")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {contactDiscardConfirm}

      <ConfirmDialog
        open={Boolean(archiveConfirm)}
        onOpenChange={(open) => {
          if (!open) setArchiveConfirm(undefined);
        }}
        title={t("archiveConfirm.title")}
        description={t("archiveConfirm.description", {
          email: archiveConfirm?.email ?? "",
        })}
        confirmLabel={t("archiveConfirm.confirm")}
        variant="destructive"
        onConfirm={() => {
          const contact = archiveConfirm;
          setArchiveConfirm(undefined);
          if (contact) void performArchive(contact);
        }}
      />
    </>
  );
}
