"use client";

import Link from "next/link";
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
import type { ContactImportDetail, ContactImportHistory } from "./import-model";
import {
  formatImportTimestamp,
  importJobStatusLabels,
} from "./import-presentation";
import { ContactImportResults } from "./contact-import-results";
import { downloadImportCsv, useContactImport } from "./use-contact-import";
import styles from "./contact-importer.module.css";

export function ContactImporter(props: {
  workspace: string;
  history: ContactImportHistory;
  initialJob?: ContactImportDetail;
  initialError?: string;
  selectedId?: string;
}) {
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
  const stages = ["提供名单与授权", "预检与确认", "处理与结果"];

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
            <ArrowLeft aria-hidden="true" /> 返回客户名单
          </Link>
          <h1>导入客户名单</h1>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            downloadImportCsv("pixel-edm-客户导入模板.csv", [
              [
                "邮箱",
                "姓名",
                "标签",
                "订阅状态",
                "同意来源",
                "授权说明",
                "同意时间",
              ],
              [
                "customer@example.com",
                "示例客户",
                "VIP|老客",
                "未确认",
                "",
                "",
                "",
              ],
            ])
          }
        >
          <Download aria-hidden="true" /> 下载模板
        </Button>
      </header>

      <ol className={styles.steps} aria-label="导入步骤">
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
                ? "文件未读取"
                : failure.operation === "process"
                  ? "导入请求未完成"
                  : failure.operation === "load"
                    ? "结果未加载"
                    : failure.operation === "report"
                      ? "报告未下载"
                      : "预检未完成"}
            </strong>
            <p>{failure.message}</p>
            <p>
              {job
                ? "原任务已保留。重试会先核对任务进度，请勿重复上传。"
                : "当前输入已保留，可以修改后重试。"}
            </p>
          </div>
          <Button variant="outline" disabled={busy} onClick={retry}>
            {failure.operation === "file"
              ? "重新选择文件"
              : failure.operation === "process"
                ? "重试原任务"
                : "重试"}
          </Button>
        </div>
      )}

      {!job && (
        <Card className={styles.surface}>
          <CardHeader className={styles.sectionHeader}>
            <h2>提供名单</h2>
            <p className={styles.description}>
              每次最多 1000 行、2 MiB。预检不会写入客户资料。
            </p>
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
                <legend className="sr-only">名单内容及授权信息</legend>
                <section
                  className={styles.sourceSection}
                  aria-labelledby="source-heading"
                >
                  <h3 id="source-heading" className="sr-only">
                    名单输入区
                  </h3>
                  <div
                    className={styles.sourceSwitch}
                    role="group"
                    aria-label="名单提供方式"
                  >
                    <Button
                      type="button"
                      aria-pressed={sourceType === "paste"}
                      variant={sourceType === "paste" ? "default" : "outline"}
                      onClick={() => setSourceType("paste")}
                    >
                      粘贴
                    </Button>
                    <Button
                      type="button"
                      aria-pressed={sourceType === "csv"}
                      variant={sourceType === "csv" ? "default" : "outline"}
                      onClick={() => setSourceType("csv")}
                    >
                      CSV 文件
                    </Button>
                  </div>
                  <div className={styles.field}>
                    <Label htmlFor="import-name">
                      名单来源名称 <span className={styles.required}>必填</span>
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
                        名单内容 <span className={styles.required}>必填</span>
                      </Label>
                      <textarea
                        id="import-text"
                        required
                        className={styles.textarea}
                        placeholder={
                          "邮箱,姓名,标签\ncustomer@example.com,张三,VIP|老客"
                        }
                        value={text}
                        aria-invalid={Boolean(fieldErrors["import-text"])}
                        aria-describedby={describedBy(
                          "import-text",
                          "import-text-hint",
                        )}
                        onChange={(event) => setText(event.target.value)}
                      />
                      <p id="import-text-hint" className={styles.hint}>
                        可粘贴逗号或制表符表格；无表头时按“邮箱、姓名、标签”三列读取。
                      </p>
                      {fieldError("import-text")}
                    </div>
                  ) : (
                    <div className={styles.field}>
                      <Label htmlFor="import-file">
                        选择 CSV 文件{" "}
                        <span className={styles.required}>必填</span>
                      </Label>
                      <Input
                        ref={fileRef}
                        id="import-file"
                        aria-label="选择 CSV 文件"
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
                        UTF-8 编码，须有“邮箱”或 email 表头；每次最多 1000 行、2
                        MiB。
                      </p>
                      <p
                        id="import-file-status"
                        className={styles.fileStatus}
                        role="status"
                      >
                        {activity === "file"
                          ? "正在读取文件，请稍候…"
                          : fileName
                            ? `已读取：${fileName}`
                            : text
                              ? "已保留粘贴内容；选择文件后会替换。"
                              : "尚未选择文件。"}
                      </p>
                      {fieldError("import-text")}
                      <Label htmlFor="import-delimiter">分隔符</Label>
                      <select
                        id="import-delimiter"
                        className="list-filter"
                        value={delimiter}
                        onChange={(event) =>
                          setDelimiter(event.target.value as "" | "," | "\t")
                        }
                      >
                        <option value="">自动识别</option>
                        <option value=",">逗号</option>
                        <option value="\t">制表符</option>
                      </select>
                    </div>
                  )}
                </section>

                <section
                  className={styles.consentSection}
                  aria-labelledby="consent-heading"
                >
                  <h3 id="consent-heading">
                    <ShieldCheck aria-hidden="true" /> 授权与订阅状态
                  </h3>
                  <p className={styles.hint}>
                    导入名单不等于获得发信资格。未确认客户不能发信，已有退订、投诉、硬退信及归档保护不会自动解除。
                  </p>
                  <label className={styles.consentCheck}>
                    <input
                      type="checkbox"
                      checked={consentDeclared}
                      onChange={(event) =>
                        setConsentDeclared(event.target.checked)
                      }
                    />
                    <span>我确认名单中的客户已明确同意接收商业邮件</span>
                  </label>
                  <p className={styles.hint}>
                    此声明设置未填写订阅状态的记录；CSV
                    逐行状态优先。不声明且未填写状态的新客户以“未确认”导入。
                  </p>
                  {(consentDeclared ||
                    consentSource ||
                    consentNote ||
                    consentAt) && (
                    <div className={styles.consentFields}>
                      {!consentDeclared && (
                        <p className={styles.hint}>
                          已取消批量声明。填写过的授权信息仍会随名单提交，可在下方修改或清空；不会仅凭这些信息将未确认客户设为已订阅。
                        </p>
                      )}
                      <div className={styles.field}>
                        <Label htmlFor="consent-source">
                          同意来源{" "}
                          <span className={styles.required}>
                            {consentDeclared ? "必填" : "选填"}
                          </span>
                        </Label>
                        <Input
                          id="consent-source"
                          required={consentDeclared}
                          maxLength={100}
                          placeholder="例如：会员注册页主动勾选"
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
                          同意时间 <span className={styles.required}>选填</span>
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
                          按当前设备时区填写，不能晚于现在。
                        </p>
                        {fieldError("consent-at")}
                      </div>
                      <div className={styles.field}>
                        <Label htmlFor="consent-note">
                          授权说明{" "}
                          <span className={styles.required}>
                            {consentDeclared ? "必填" : "选填"}
                          </span>
                        </Label>
                        <textarea
                          id="consent-note"
                          className={styles.noteInput}
                          required={consentDeclared}
                          maxLength={500}
                          placeholder="例如：客户主动勾选接收促销邮件，记录可在会员后台核对"
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
                    <summary>CSV 逐行授权如何填写？</summary>
                    <p>
                      “订阅状态”列可填写未确认、已订阅、已退订、硬退信、已投诉。已订阅记录必须提供同意来源及授权说明。
                    </p>
                    <p>
                      CSV
                      包含“同意来源”“授权说明”或“同意时间”列时，各列逐行值优先；其中空值不会由批量信息补齐。未提供这些列时才使用批量信息。
                    </p>
                  </details>
                </section>
              </fieldset>
              <div className={styles.formActions}>
                <p className={styles.hint}>
                  {busy
                    ? "正在处理当前请求，请完成后再切换名单。"
                    : "下一步查看新增、更新、保护及错误记录，再决定是否导入。"}
                </p>
                <Button
                  type="submit"
                  disabled={busy || failure?.operation === "file"}
                >
                  <FileUp aria-hidden="true" />{" "}
                  {activity === "prepare" ? "正在预检…" : "预检名单"}
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
          <h2 id="import-history-heading">最近导入</h2>
          <p className={styles.hint}>
            保留最近 10 次，可继续原任务或查看结果。
          </p>
        </div>
        {!recent.length ? (
          <p className={styles.hint}>
            暂无导入记录。完成预检后，任务会出现在这里。
          </p>
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
                      {formatImportTimestamp(item.created_at)} ·{" "}
                      {item.source_type === "csv" ? "CSV 文件" : "粘贴名单"}
                    </span>
                  </span>
                  <span className={styles.historyState}>
                    <strong>
                      {job?.job.id === item.id && activity === "process"
                        ? "处理中"
                        : importJobStatusLabels[item.status]}
                    </strong>
                    <span>
                      {item.status === "prepared"
                        ? `${item.total_groups} 条待确认`
                        : `${item.processed_groups}/${item.total_groups} 条（含错误与跳过）`}{" "}
                      ·{" "}
                      {item.status === "processing"
                        ? "继续原任务"
                        : item.status === "prepared"
                          ? "查看预检"
                          : "查看结果"}
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
