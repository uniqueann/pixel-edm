"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileUp,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocalDate } from "@/components/local-date";
import type { ContactImportDetail, ContactImportHistory } from "./import-model";
import { ContactImportResults } from "./contact-import-results";
import { downloadImportCsv, useContactImport } from "./use-contact-import";
import styles from "./contact-importer.module.css";

const KNOWN_JOB_STATUSES = new Set([
  "completed",
  "prepared",
  "processing",
  "failed",
]);

export function ContactImporter(props: {
  workspace: string;
  history: ContactImportHistory;
  initialJob?: ContactImportDetail;
  initialError?: string;
  selectedId?: string;
}) {
  const t = useTranslations("contacts.import");
  const {
    activity,
    busy,
    canEdit,
    consentAt,
    consentDeclared,
    consentNote,
    consentSource,
    delimiter,
    discardConfirm,
    downloadReport,
    editDraft,
    errorRef,
    failure,
    fieldErrors,
    fileName,
    fileRef,
    job,
    loadJob,
    prepare,
    process,
    readFile,
    recent,
    requestLeave,
    resultRef,
    retry,
    setConsentAt,
    setConsentDeclared,
    setConsentNote,
    setConsentSource,
    setDelimiter,
    setSourceName,
    setSourceType,
    setText,
    sourceName,
    sourceType,
    startNew,
    text,
    validEmails,
    warnings,
  } = useContactImport(props);
  const stage = !job ? 0 : job.job.status === "prepared" ? 1 : 2;
  const stages = [t("stages.provide"), t("stages.preview"), t("stages.result")];

  function fieldError(id: string) {
    return fieldErrors[id] ? (
      <p id={`${id}-error`} className={styles.fieldError} role="alert">
        {fieldErrors[id]}
      </p>
    ) : null;
  }
  function describedBy(id: string, hint?: string) {
    return (
      [hint, fieldErrors[id] ? `${id}-error` : null]
        .filter(Boolean)
        .join(" ") || undefined
    );
  }

  return (
    <div className={styles.importer} data-contact-import>
      <header className={styles.header}>
        <div>
          <Link
            className={styles.backLink}
            href="/contacts"
            aria-disabled={busy || undefined}
          >
            <ArrowLeft aria-hidden="true" /> {t("backToContacts")}
          </Link>
          <h1>{t("title")}</h1>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            downloadImportCsv(t("templateFilename"), [
              [
                t("templateHeaders.email"),
                t("templateHeaders.name"),
                t("templateHeaders.tags"),
                t("templateHeaders.subscriptionStatus"),
                t("templateHeaders.consentSource"),
                t("templateHeaders.consentNote"),
                t("templateHeaders.consentAt"),
              ],
              [
                "customer@example.com",
                t("templateSample.name"),
                t("templateSample.tags"),
                t("templateSample.status"),
                "",
                "",
                "",
              ],
            ])
          }
        >
          <Download aria-hidden="true" /> {t("downloadTemplate")}
        </Button>
      </header>

      <ol className={styles.steps} aria-label={t("stepsAria")}>
        {stages.map((label, index) => (
          <li
            key={label}
            aria-current={index === stage ? "step" : undefined}
            data-complete={index < stage || undefined}
          >
            <span className={styles.stepNumber} aria-hidden="true">
              {index + 1}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {failure && (
        <div
          className={styles.failure}
          role="alert"
          ref={errorRef}
          tabIndex={-1}
        >
          <div>
            <strong>
              {failure.operation === "file"
                ? t("failure.file")
                : failure.operation === "process"
                  ? t("failure.process")
                  : failure.operation === "load"
                    ? t("failure.load")
                    : failure.operation === "report"
                      ? t("failure.report")
                      : t("failure.prepare")}
            </strong>
            <p>{failure.message}</p>
            <p>{job ? t("failure.keepJob") : t("failure.keepInput")}</p>
          </div>
          <Button variant="outline" disabled={busy} onClick={retry}>
            {failure.operation === "file"
              ? t("failure.reselectFile")
              : failure.operation === "process"
                ? t("failure.retryJob")
                : t("failure.retry")}
          </Button>
        </div>
      )}

      {!job && (
        <Card className={styles.surface}>
          <CardHeader className={styles.sectionHeader}>
            <h2>{t("form.sectionTitle")}</h2>
            <p className={styles.description}>{t("form.sectionDescription")}</p>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void prepare();
              }}
            >
              <fieldset disabled={busy} className={styles.inputLayout}>
                <legend className="sr-only">{t("form.legend")}</legend>
                <section
                  className={styles.sourceSection}
                  aria-labelledby="source-heading"
                >
                  <h3 id="source-heading" className="sr-only">
                    {t("form.sourceHeading")}
                  </h3>
                  <div
                    className={styles.sourceSwitch}
                    role="group"
                    aria-label={t("form.sourceSwitchAria")}
                  >
                    <Button
                      type="button"
                      aria-pressed={sourceType === "paste"}
                      variant={sourceType === "paste" ? "default" : "outline"}
                      onClick={() => setSourceType("paste")}
                    >
                      {t("form.pasteTab")}
                    </Button>
                    <Button
                      type="button"
                      aria-pressed={sourceType === "csv"}
                      variant={sourceType === "csv" ? "default" : "outline"}
                      onClick={() => setSourceType("csv")}
                    >
                      {t("form.csvTab")}
                    </Button>
                  </div>
                  <div className={styles.field}>
                    <Label htmlFor="import-name">
                      {t("form.sourceNameLabel")}{" "}
                      <span className={styles.required}>
                        {t("form.required")}
                      </span>
                    </Label>
                    <Input
                      id="import-name"
                      required
                      maxLength={200}
                      value={sourceName}
                      aria-invalid={Boolean(fieldErrors["import-name"])}
                      aria-describedby={describedBy("import-name")}
                      onChange={(event) => setSourceName(event.target.value)}
                    />
                    {fieldError("import-name")}
                  </div>
                  {sourceType === "paste" ? (
                    <div className={styles.field}>
                      <Label htmlFor="import-text">
                        {t("form.textLabel")}{" "}
                        <span className={styles.required}>
                          {t("form.required")}
                        </span>
                      </Label>
                      <textarea
                        id="import-text"
                        required
                        className={styles.textarea}
                        placeholder={t("form.textPlaceholder")}
                        value={text}
                        aria-invalid={Boolean(fieldErrors["import-text"])}
                        aria-describedby={describedBy(
                          "import-text",
                          "import-text-hint",
                        )}
                        onChange={(event) => setText(event.target.value)}
                      />
                      <p id="import-text-hint" className={styles.hint}>
                        {t("form.textHint")}
                      </p>
                      {fieldError("import-text")}
                    </div>
                  ) : (
                    <div className={styles.field}>
                      <Label htmlFor="import-file">
                        {t("form.fileLabel")}{" "}
                        <span className={styles.required}>
                          {t("form.required")}
                        </span>
                      </Label>
                      <Input
                        ref={fileRef}
                        id="import-file"
                        aria-label={t("form.fileLabel")}
                        type="file"
                        accept=".csv,text/csv"
                        aria-describedby={describedBy(
                          "import-text",
                          "import-file-hint import-file-status",
                        )}
                        aria-invalid={Boolean(fieldErrors["import-text"])}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void readFile(file);
                        }}
                      />
                      <p id="import-file-hint" className={styles.hint}>
                        {t("form.fileHint")}
                      </p>
                      <p
                        id="import-file-status"
                        className={styles.fileStatus}
                        role="status"
                      >
                        {activity === "file"
                          ? t("form.fileReading")
                          : fileName
                            ? t("form.fileLoaded", { name: fileName })
                            : text
                              ? t("form.fileKeepPaste")
                              : t("form.fileEmpty")}
                      </p>
                      {fieldError("import-text")}
                      <Label htmlFor="import-delimiter">
                        {t("form.delimiterLabel")}
                      </Label>
                      <select
                        id="import-delimiter"
                        className="list-filter"
                        value={delimiter}
                        onChange={(event) =>
                          setDelimiter(event.target.value as "" | "," | "\t")
                        }
                      >
                        <option value="">{t("form.delimiterAuto")}</option>
                        <option value=",">{t("form.delimiterComma")}</option>
                        <option value="\t">{t("form.delimiterTab")}</option>
                      </select>
                    </div>
                  )}
                </section>

                <section
                  className={styles.consentSection}
                  aria-labelledby="consent-heading"
                >
                  <h3 id="consent-heading">
                    <ShieldCheck aria-hidden="true" />{" "}
                    {t("form.consentHeading")}
                  </h3>
                  <p className={styles.hint}>{t("form.consentLead")}</p>
                  <label className={styles.consentCheck}>
                    <input
                      type="checkbox"
                      checked={consentDeclared}
                      onChange={(event) =>
                        setConsentDeclared(event.target.checked)
                      }
                    />
                    <span>{t("form.consentCheckbox")}</span>
                  </label>
                  <p className={styles.hint}>{t("form.consentCheckboxHint")}</p>
                  {(consentDeclared ||
                    consentSource ||
                    consentNote ||
                    consentAt) && (
                    <div className={styles.consentFields}>
                      {!consentDeclared && (
                        <p className={styles.hint}>
                          {t("form.consentUncheckedHint")}
                        </p>
                      )}
                      <div className={styles.field}>
                        <Label htmlFor="consent-source">
                          {t("form.consentSourceLabel")}{" "}
                          <span className={styles.required}>
                            {consentDeclared
                              ? t("form.required")
                              : t("form.optional")}
                          </span>
                        </Label>
                        <Input
                          id="consent-source"
                          required={consentDeclared}
                          maxLength={100}
                          placeholder={t("form.consentSourcePlaceholder")}
                          value={consentSource}
                          aria-invalid={Boolean(fieldErrors["consent-source"])}
                          aria-describedby={describedBy("consent-source")}
                          onChange={(event) =>
                            setConsentSource(event.target.value)
                          }
                        />
                        {fieldError("consent-source")}
                      </div>
                      <div className={styles.field}>
                        <Label htmlFor="consent-at">
                          {t("form.consentAtLabel")}{" "}
                          <span className={styles.required}>
                            {t("form.optional")}
                          </span>
                        </Label>
                        <Input
                          id="consent-at"
                          type="datetime-local"
                          value={consentAt}
                          aria-invalid={Boolean(fieldErrors["consent-at"])}
                          aria-describedby={describedBy(
                            "consent-at",
                            "consent-at-hint",
                          )}
                          onChange={(event) => setConsentAt(event.target.value)}
                        />
                        <p id="consent-at-hint" className={styles.hint}>
                          {t("form.consentAtHint")}
                        </p>
                        {fieldError("consent-at")}
                      </div>
                      <div className={styles.field}>
                        <Label htmlFor="consent-note">
                          {t("form.consentNoteLabel")}{" "}
                          <span className={styles.required}>
                            {consentDeclared
                              ? t("form.required")
                              : t("form.optional")}
                          </span>
                        </Label>
                        <textarea
                          id="consent-note"
                          className={styles.noteInput}
                          required={consentDeclared}
                          maxLength={500}
                          placeholder={t("form.consentNotePlaceholder")}
                          value={consentNote}
                          aria-invalid={Boolean(fieldErrors["consent-note"])}
                          aria-describedby={describedBy("consent-note")}
                          onChange={(event) =>
                            setConsentNote(event.target.value)
                          }
                        />
                        {fieldError("consent-note")}
                      </div>
                    </div>
                  )}
                  <details className={styles.help}>
                    <summary>{t("form.csvHelpSummary")}</summary>
                    <p>{t("form.csvHelpLine1")}</p>
                    <p>{t("form.csvHelpLine2")}</p>
                  </details>
                </section>
              </fieldset>
              <div className={styles.formActions}>
                <p className={styles.hint}>
                  {busy ? t("form.busyHint") : t("form.nextHint")}
                </p>
                <Button
                  type="submit"
                  disabled={busy || failure?.operation === "file"}
                >
                  <FileUp aria-hidden="true" />{" "}
                  {activity === "prepare"
                    ? t("form.preparing")
                    : t("form.prepareButton")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!!warnings.length && (
        <div className={styles.warnings} role="status">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      {job && (
        <ContactImportResults
          detail={job}
          headingRef={resultRef}
          validEmails={validEmails}
          busy={busy}
          activity={activity}
          canEdit={canEdit}
          onEdit={editDraft}
          onNew={startNew}
          onProcess={(confirm) => void process(job.job.id, confirm)}
          onDownload={() => void downloadReport()}
          onPage={(page) => void loadJob(job.job.id, page)}
          onLocateError={() => void loadJob(job.job.id, 1, true)}
        />
      )}

      <section
        className={styles.history}
        aria-labelledby="import-history-heading"
      >
        <div className={styles.historyHeading}>
          <h2 id="import-history-heading">{t("history.title")}</h2>
          <p className={styles.hint}>{t("history.description")}</p>
        </div>
        {!recent.length ? (
          <p className={styles.hint}>{t("history.empty")}</p>
        ) : (
          <ul>
            {recent.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.historyItem}
                  disabled={busy}
                  aria-current={job?.job.id === item.id ? "true" : undefined}
                  onClick={() => requestLeave(() => void loadJob(item.id))}
                >
                  <span className={styles.historyName}>
                    {item.source_name}
                    <span className={styles.hint}>
                      <LocalDate value={item.created_at} /> ·{" "}
                      {item.source_type === "csv"
                        ? t("history.typeCsv")
                        : t("history.typePaste")}
                    </span>
                  </span>
                  <span className={styles.historyState}>
                    <strong>
                      {job?.job.id === item.id && activity === "process"
                        ? t("history.processingNow")
                        : KNOWN_JOB_STATUSES.has(item.status)
                          ? t(`jobStatus.${item.status as "completed"}`)
                          : item.status}
                    </strong>
                    <span>
                      {item.status === "prepared"
                        ? t("history.pendingConfirmCount", {
                            count: item.total_groups,
                          })
                        : t("history.processedCount", {
                            processed: item.processed_groups,
                            total: item.total_groups,
                          })}{" "}
                      ·{" "}
                      {item.status === "processing"
                        ? t("history.actionContinue")
                        : item.status === "prepared"
                          ? t("history.actionPreview")
                          : t("history.actionResult")}
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {discardConfirm}
    </div>
  );
}
