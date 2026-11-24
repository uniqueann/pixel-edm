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
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  type TemplateValidationError,
  type TemplateVariable,
} from "./model";
import { localizeTemplateCategory, localizeTemplateName } from "./localization";
import { TemplatePreview } from "./template-preview";
import { TemplateGrid } from "./template-grid";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedEditDialog } from "@/hooks/use-unsaved-edit-dialog";
import { PlanUsageNote } from "@/features/workspace/plan-usage-note";
import {
  isQuotaExhausted,
  type PlanQuota,
} from "@/features/workspace/plan-usage";
import { useErrorMessage, useValidationMessage } from "@/i18n/use-resolvers";
import styles from "./templates.module.css";

function encodeValidationError(item: TemplateValidationError) {
  if (!item.params || Object.keys(item.params).length === 0) return item.code;
  return `${item.code}?${new URLSearchParams(item.params).toString()}`;
}

export function Templates({
  workspace,
  workspaceName,
  memberName,
  memberDisplayNameCustomized,
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
  memberDisplayNameCustomized?: boolean;
  mailingAddress: string;
  senderAlias: string;
  senderAddress: string;
  canEdit: boolean;
  customTemplateQuota: PlanQuota | null;
  data: TemplateList;
  filters: Record<string, string>;
}) {
  const t = useTranslations("templates");
  const tCommon = useTranslations("common");
  const resolveValidation = useValidationMessage();
  const resolveError = useErrorMessage();
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
    const body = editorScrollRef.current;
    const scrollArea = body?.closest("[data-dialog-reflow]")
      ? body.closest<HTMLElement>("[data-dialog-scroll-viewport]")
      : body;
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

  const defaultCustomCategory = t("defaults.customCategory");

  const openEditor = useCallback(
    (template: Template | null) => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      const nextName = template?.name ?? "";
      const nextCategory = template?.category ?? defaultCustomCategory;
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
    },
    [defaultCustomCategory, setEditorView],
  );

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

  const duplicate = useCallback(
    async (template: Template) => {
      setBusy(true);
      try {
        const result = await duplicateTemplate({
          workspace_id: workspace,
          id: template.id,
        });
        if ("error" in result) toast.error(resolveError(result));
        else {
          toast.success(t("toast.duplicated"));
          router.refresh();
        }
      } catch {
        toast.error(t("toast.duplicateFailed"));
      } finally {
        setBusy(false);
      }
    },
    [resolveError, router, t, workspace],
  );

  const performArchive = useCallback(
    async (template: Template) => {
      setBusy(true);
      try {
        const result = await setTemplateArchived({
          workspace_id: workspace,
          id: template.id,
          expected_version: template.version,
          archived: !archived,
        });
        if ("error" in result) toast.error(resolveError(result));
        else {
          toast.success(archived ? t("toast.restored") : t("toast.archived"));
          router.refresh();
        }
      } catch {
        toast.error(t("toast.actionFailed"));
      } finally {
        setBusy(false);
      }
    },
    [archived, resolveError, router, t, workspace],
  );

  const archive = useCallback(
    (template: Template) => {
      if (!archived) {
        setArchiveConfirm(template);
        return;
      }
      void performArchive(template);
    },
    [archived, performArchive, setArchiveConfirm],
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={t("metaCount", { count: data.total })}
        description={t("description")}
        actions={
          canEdit && !showInitialEmpty ? (
            <>
              <Button
                disabled={templateQuotaExhausted}
                onClick={() => openEditor(null)}
              >
                {t("newTemplate")}
              </Button>
            </>
          ) : undefined
        }
      />
      <ListToolbar role="search" aria-label={t("search.toolbarAria")}>
        <FilterField
          id="template-search"
          label={t("search.label")}
          className="filter-field-search"
        >
          <Input
            id="template-search"
            aria-label={t("search.placeholder")}
            placeholder={t("search.placeholder")}
            value={q}
            maxLength={200}
            onChange={(event) => setQ(event.target.value)}
          />
        </FilterField>
        <FilterField id="template-status" label={t("search.statusLabel")}>
          <select
            id="template-status"
            aria-label={t("search.statusAria")}
            className="list-filter"
            value={archived ? "archived" : "active"}
            onChange={(event) =>
              navigate({ status: event.target.value, page: "1" })
            }
          >
            <option value="active">{t("search.statusActive")}</option>
            <option value="archived">{t("search.statusArchived")}</option>
          </select>
        </FilterField>
        <FilterField
          id="template-filter-category"
          label={t("search.categoryLabel")}
        >
          <select
            id="template-filter-category"
            aria-label={t("search.categoryAria")}
            className="list-filter"
            value={filters.category ?? ""}
            onChange={(event) =>
              navigate({ category: event.target.value, page: "1" })
            }
          >
            <option value="">{t("search.allCategories")}</option>
            {(data.categories ?? []).map((cat) => (
              <option key={cat} value={cat}>
                {localizeTemplateCategory(cat, t)}
              </option>
            ))}
          </select>
        </FilterField>
      </ListToolbar>
      {canEdit && (
        <PlanUsageNote
          label={t("quota.label")}
          quota={customTemplateQuota}
          exhaustedText={t("quota.exhausted")}
          testId="template-quota"
          className="mb-3"
        />
      )}
      {hasFilters && (
        <div className="active-filters" aria-label={t("filters.ariaLabel")}>
          <span>{t("filters.applied")}</span>
          {filters.q && (
            <span className="filter-chip">
              {t("filters.queryChip", { query: filters.q })}
            </span>
          )}
          {filters.category && (
            <span className="filter-chip">
              {t("filters.categoryChip", {
                category: localizeTemplateCategory(filters.category, t),
              })}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate({ q: "", category: "", page: "1" })}
          >
            {t("filters.clear")}
          </Button>
        </div>
      )}
      <div aria-live="polite" className="hint mt-2">
        {pending ? t("status.loading") : !canEdit ? t("status.readOnly") : ""}
      </div>
      {data.items.length > 0 ? (
        <TemplateGrid
          items={data.items}
          pending={pending}
          busy={busy}
          canEdit={canEdit}
          archived={archived}
          templateQuotaExhausted={templateQuotaExhausted}
          onPreview={setPreviewing}
          onEdit={openEditor}
          onDuplicate={duplicate}
          onArchive={archive}
        />
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
                onClick={() => navigate({ q: "", category: "", page: "1" })}
              >
                {t("filters.clear")}
              </Button>
            ) : (
              canEdit &&
              !archived && (
                <Button
                  disabled={templateQuotaExhausted}
                  onClick={() => openEditor(null)}
                >
                  {t("newTemplate")}
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
          <div className={styles.editorViewport} data-dialog-scroll-viewport>
            <DialogHeader
              className={styles.editorHeader}
              data-dialog-scroll-chrome
            >
              <DialogTitle>
                {editing ? t("editor.editTitle") : t("editor.createTitle")}
              </DialogTitle>
              <DialogDescription>{t("editor.description")}</DialogDescription>
            </DialogHeader>
            <div
              className={styles.viewSwitch}
              role="group"
              aria-label={t("editor.viewSwitchAria")}
              data-dialog-scroll-chrome
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
                {t("editor.editTab")}
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
                {t("editor.previewTab")}
              </Button>
            </div>
            <div
              ref={setEditorScrollArea}
              className={styles.editorBody}
              data-testid="template-editor-scroll"
              data-dialog-scroll-body
              onFocusCapture={() => requestAnimationFrame(revealEditorFocus)}
            >
              <form
                id="template-editor-form"
                ref={editorFormRef}
                className={`${styles.editorForm} ${styles.editorPane}`}
                data-active={editorView === "edit"}
                aria-label={t("editor.formAria")}
                onSubmit={async (event) => {
                  event.preventDefault();
                  setError("");
                  if (validationErrors.length) {
                    setError(
                      resolveValidation(
                        encodeValidationError(validationErrors[0]),
                        validationErrors[0].message,
                      ),
                    );
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
                    if ("error" in result) {
                      const resolved =
                        "validationCode" in result && result.validationCode
                          ? resolveValidation(
                              result.validationCode,
                              result.error ?? t("editor.saveFailed"),
                            )
                          : resolveError(result);
                      setError(resolved || t("editor.saveFailed"));
                    } else {
                      setEditing(undefined);
                      toast.success(t("toast.saved"));
                      router.refresh();
                    }
                  } catch {
                    setError(t("editor.saveFailedKeepInput"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className={styles.identityFields}>
                  <div className={styles.field}>
                    <Label htmlFor="template-name">
                      {t("editor.nameLabel")}
                    </Label>
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
                    <Label htmlFor="template-category">
                      {t("editor.categoryLabel")}
                    </Label>
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
                        <summary>{t("editor.existingCategories")}</summary>
                        <div className={styles.categorySuggestions}>
                          {(data.categories ?? []).slice(0, 5).map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              className={styles.categorySuggestion}
                              onClick={() => setCategory(cat)}
                            >
                              {localizeTemplateCategory(cat, t)}
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
                <div className={styles.field}>
                  <Label htmlFor="template-subject">
                    {t("editor.subjectLabel")}
                  </Label>
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
                    <Label htmlFor="template-body">
                      {t("editor.bodyLabel")}
                    </Label>
                    <span className={styles.characterCount}>
                      {t("editor.charCount", { count: body.length })}
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
                <section
                  className={styles.variables}
                  aria-label={t("editor.variablesAria")}
                >
                  <h3 className={styles.sectionTitle}>
                    {activeField === "subject"
                      ? t("editor.insertToSubject")
                      : t("editor.insertToBody")}
                  </h3>
                  <p className={styles.help}>{t("editor.variablesHelp")}</p>
                  {[
                    { label: t("editor.groupCustomer"), customer: true },
                    { label: t("editor.groupCampaign"), customer: false },
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
                          .map((variable) => {
                            const label = t(`variables.${variable.key}`);
                            return (
                              <button
                                key={variable.key}
                                type="button"
                                className={styles.variableButton}
                                title={t("editor.insertVariableTitle", {
                                  label,
                                  key: variable.key,
                                })}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => insertVariable(variable.key)}
                              >
                                <span>{label}</span>
                                <code>{`{{${variable.key}}}`}</code>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                  <p className={styles.help}>{t("editor.senderNameHelp")}</p>
                </section>
                {validationErrors.length > 0 && (
                  <div className="field-error" role="alert">
                    {validationErrors.map((item, index) => (
                      <p key={`${item.field}-${index}`}>
                        {t("editor.fieldError", {
                          field:
                            item.field === "subject"
                              ? t("editor.fieldSubject")
                              : t("editor.fieldBody"),
                          message: resolveValidation(
                            encodeValidationError(item),
                            item.message,
                          ),
                        })}
                      </p>
                    ))}
                  </div>
                )}
              </form>
              <section
                id="template-preview-panel"
                className={`${styles.previewPane} ${styles.editorPane}`}
                data-active={editorView === "preview"}
                aria-label={t("editor.previewSectionTitle")}
              >
                <h3 className={styles.sectionTitle}>
                  {t("editor.previewSectionTitle")}
                </h3>
                <TemplatePreview
                  subject={subject}
                  body={body}
                  workspaceName={workspaceName}
                  memberName={memberName}
                  memberDisplayNameCustomized={memberDisplayNameCustomized}
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
          </div>
          <div
            className={styles.editorFooter}
            data-testid="template-editor-footer"
            data-dialog-scroll-chrome
          >
            <p
              className={styles.saveStatus}
              data-error={Boolean(error)}
              role={error ? "alert" : "status"}
            >
              {error ||
                (validationErrors.length
                  ? t("editor.statusInvalid")
                  : busy
                    ? t("editor.statusSaving")
                    : isTemplateEditDirty
                      ? t("editor.statusDirty")
                      : t("editor.statusClean"))}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={requestCloseTemplateEditor}
            >
              {tCommon("actions.cancel")}
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
              {busy ? t("editor.savingButton") : t("editor.saveButton")}
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
            <DialogTitle>
              {previewing
                ? localizeTemplateName(previewing, t)
                : t("preview.dialogFallbackTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("preview.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          {previewing && (
            <TemplatePreview
              subject={previewing.subject}
              body={previewing.body}
              workspaceName={workspaceName}
              memberName={memberName}
              memberDisplayNameCustomized={memberDisplayNameCustomized}
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
        title={t("archiveConfirm.title")}
        description={t("archiveConfirm.description", {
          name: archiveConfirm ? localizeTemplateName(archiveConfirm, t) : "",
        })}
        confirmLabel={t("archiveConfirm.confirm")}
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
