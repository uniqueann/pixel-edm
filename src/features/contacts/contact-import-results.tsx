"use client";

import Link from "next/link";
import type { Ref } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Play,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ListPagination } from "@/components/list-pagination";
import {
  dedupeImportMessages,
  subscriptionStatuses,
  type ContactImportDetail,
  type SubscriptionStatus,
} from "./import-model";
import { displayedImportResult } from "./import-presentation";
import styles from "./contact-importer.module.css";

const KNOWN_RESULT_KEYS = new Set([
  "new",
  "update",
  "unchanged",
  "archived_skipped",
  "suppressed_protected",
  "suppressed",
  "error",
  "pending",
  "created",
  "updated",
]);

const EXPLANATION_RESULT_KEYS = new Set([
  "archived_skipped",
  "suppressed_protected",
  "suppressed",
  "unchanged",
]);

export function ContactImportResults({
  detail,
  headingRef,
  validEmails,
  busy,
  activity,
  canEdit,
  onEdit,
  onNew,
  onProcess,
  onDownload,
  onPage,
  onLocateError,
}: {
  detail: ContactImportDetail;
  headingRef: Ref<HTMLHeadingElement>;
  validEmails: number | null;
  busy: boolean;
  activity: string | null;
  canEdit: boolean;
  onEdit: () => void;
  onNew: () => void;
  onProcess: (confirm: boolean) => void;
  onDownload: () => void;
  onPage: (page: number) => void;
  onLocateError: () => void;
}) {
  const tContacts = useTranslations("contacts");
  const t = useTranslations("contacts.import.results");
  const { job, rows } = detail;
  const preview = job.status === "prepared";
  const completed = job.status === "completed";
  const processing = job.status === "processing";
  const active = activity === "process";
  const summary = job.summary;
  const kept =
    (summary.unchanged ?? 0) +
    (summary.archived_skipped ?? 0) +
    (summary.suppressed_protected ?? 0);
  const hasErrors = (summary.error ?? 0) > 0;
  const title = preview
    ? t("titlePreview")
    : completed
      ? t("titleCompleted")
      : processing
        ? active
          ? t("titleProcessing")
          : t("titleResume")
        : t("titleFailed");
  const decision = [
    {
      key: "create",
      label: preview ? t("metricWillCreate") : t("metricCreated"),
      count: summary[preview ? "new" : "created"] ?? 0,
      isError: false,
    },
    {
      key: "update",
      label: preview ? t("metricWillUpdate") : t("metricUpdated"),
      count: summary[preview ? "update" : "updated"] ?? 0,
      isError: false,
    },
    {
      key: "kept",
      label: t("metricKept"),
      count: kept,
      isError: false,
    },
    {
      key: "error",
      label: t("metricError"),
      count: summary.error ?? 0,
      isError: true,
    },
  ];
  const sep = t("listSeparator");

  return (
    <Card className={styles.surface} aria-busy={busy}>
      <CardHeader className={styles.sectionHeader}>
        <div className={styles.resultTitle}>
          {completed && (
            <CheckCircle2 className={styles.completedIcon} aria-hidden="true" />
          )}
          <h2 ref={headingRef} tabIndex={-1}>
            {title}
          </h2>
        </div>
        <p className={styles.sourceName}>{job.source_name}</p>
        <p className={styles.description}>
          {preview
            ? t("descPreview")
            : completed
              ? t("descCompleted")
              : processing
                ? active
                  ? t("descProcessing")
                  : t("descResume")
                : t("descFailed")}
        </p>
      </CardHeader>
      <CardContent className={styles.resultContent}>
        <dl className={styles.sourceCounts} aria-label={t("countsAria")}>
          <div>
            <dt>{t("sourceRows")}</dt>
            <dd>{job.total_source_rows}</dd>
          </div>
          <div>
            <dt>{t("dedupedEmails")}</dt>
            <dd>{validEmails ?? t("unavailable")}</dd>
          </div>
          <div>
            <dt>{t("groupsCount")}</dt>
            <dd>{job.total_groups}</dd>
          </div>
        </dl>
        <p className={styles.hint}>{t("countsHint")}</p>

        <dl
          className={styles.decision}
          aria-label={
            preview ? t("summaryPreviewAria") : t("summaryActualAria")
          }
        >
          {decision.map((item) => (
            <div
              key={item.key}
              data-error={(item.isError && item.count > 0) || undefined}
            >
              <dt>{item.label}</dt>
              <dd>{item.count}</dd>
            </div>
          ))}
        </dl>
        {!!summary.suppressed && (
          <p className={styles.hint}>
            {preview
              ? t("suppressedPreviewNote", { count: summary.suppressed })
              : t("suppressedActualNote", { count: summary.suppressed })}
          </p>
        )}
        <p className={styles.hint}>{t("keptHint")}</p>

        {!preview && (
          <div className={styles.progress} role="status" aria-live="polite">
            <span>
              {t("progressText", {
                processed: job.processed_groups,
                total: job.total_groups,
              })}
            </span>
            <progress
              aria-label={t("progressAria")}
              max={job.total_groups}
              value={job.processed_groups}
            />
          </div>
        )}

        <div className={styles.resultActions}>
          <div className={styles.primaryActions}>
            {preview && (
              <Button disabled={busy} onClick={() => onProcess(true)}>
                <Play aria-hidden="true" />
                {active ? t("confirming") : t("confirmStart")}
              </Button>
            )}
            {processing && (
              <Button disabled={busy} onClick={() => onProcess(false)}>
                <RotateCw aria-hidden="true" />
                {active ? t("continuing") : t("continueImport")}
              </Button>
            )}
            {completed && (
              <Button asChild>
                <Link href="/contacts">
                  <ArrowLeft aria-hidden="true" />
                  {t("viewContacts")}
                </Link>
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" disabled={busy} onClick={onEdit}>
                {t("backToEdit")}
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={onDownload}>
              <Download aria-hidden="true" />
              {activity === "report"
                ? t("downloading")
                : preview
                  ? t("downloadPreviewReport")
                  : t("downloadReport")}
            </Button>
          </div>
          <Button variant="ghost" disabled={busy} onClick={onNew}>
            {completed ? t("importAnother") : t("newImport")}
          </Button>
        </div>
        {canEdit && <p className={styles.hint}>{t("editDraftHint")}</p>}
        {!canEdit && preview && (
          <p className={styles.hint}>{t("savedPreviewHint")}</p>
        )}
        {busy && (
          <p className={styles.hint} role="status">
            {t("busyHint")}
          </p>
        )}

        <div className={styles.protectionNote}>
          <strong>{t("protectionTitle")}</strong>
          <p>{t("protectionLine1")}</p>
          <p>{t("protectionLine2")}</p>
        </div>

        <div className={styles.resultToolbar}>
          <h3>{t("reviewHeading")}</h3>
          {hasErrors && (
            <Button variant="outline" disabled={busy} onClick={onLocateError}>
              {t("locateFirstError")}
            </Button>
          )}
        </div>
        {hasErrors && (
          <p className={styles.hint}>
            {canEdit ? t("errorHintCanEdit") : t("errorHintReadOnly")}
          </p>
        )}

        <div className={styles.tableRegion}>
          <table className={styles.resultTable} aria-label={t("tableAria")}>
            <thead>
              <tr>
                <th scope="col">{t("colEmailAndRow")}</th>
                <th scope="col">{t("colResult")}</th>
                <th scope="col">{t("colStatusAndTags")}</th>
                <th scope="col">{t("colReason")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const result = displayedImportResult(row);
                const fallbackExplanation = EXPLANATION_RESULT_KEYS.has(result)
                  ? t(`explanations.${result as "unchanged"}`)
                  : "";
                const message =
                  dedupeImportMessages(row.message) || fallbackExplanation;
                const requestedStatusLabel = subscriptionStatuses.includes(
                  row.requested_status as SubscriptionStatus,
                )
                  ? tContacts(
                      `subscription.${row.requested_status as SubscriptionStatus}`,
                    )
                  : row.requested_status;
                return (
                  <tr key={row.item_no} data-result={result}>
                    <th scope="row" className={styles.emailCell}>
                      <span>{row.email || t("missingEmail")}</span>
                      <small>
                        {t("sourceRowPrefix", {
                          rows: row.source_rows.join(sep),
                        })}
                      </small>
                    </th>
                    <td className={styles.resultCell}>
                      <span
                        className={styles.resultBadge}
                        data-error={result === "error" || undefined}
                      >
                        {KNOWN_RESULT_KEYS.has(result)
                          ? t(`labels.${result as "error"}`)
                          : result}
                      </span>
                      {processing && (
                        <small>
                          {row.result === "pending"
                            ? t("rowPendingNote")
                            : t("rowProcessedNote")}
                        </small>
                      )}
                    </td>
                    <td className={styles.detailsCell}>
                      <span>
                        {t("requestedStatus", { status: requestedStatusLabel })}
                      </span>
                      {row.tags.length > 0 && (
                        <span className={styles.tags}>
                          {row.tags.join(sep)}
                        </span>
                      )}
                    </td>
                    <td
                      className={styles.reasonCell}
                      data-error={result === "error" || undefined}
                    >
                      {message || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {detail.row_total > 50 && (
          <div className={styles.pagination}>
            <ListPagination
              page={detail.page}
              pageSize={50}
              total={detail.row_total}
              pending={busy}
              onPageChange={onPage}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
