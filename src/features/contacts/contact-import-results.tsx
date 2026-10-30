"use client";

import Link from "next/link";
import type { Ref } from "react";
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
  subscriptionLabels,
  type ContactImportDetail,
} from "./import-model";
import {
  displayedImportResult,
  importResultLabels,
  importRowExplanation,
} from "./import-presentation";
import styles from "./contact-importer.module.css";

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
    ? "确认预检结果"
    : completed
      ? "名单处理完成"
      : processing
        ? active
          ? "正在导入名单"
          : "继续未完成的导入"
        : "导入未完成";
  const decision = [
    [preview ? "将新增" : "已新增", summary[preview ? "new" : "created"] ?? 0],
    [
      preview ? "将更新" : "已更新",
      summary[preview ? "update" : "updated"] ?? 0,
    ],
    ["跳过或保留", kept],
    ["错误", summary.error ?? 0],
  ] as const;

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
            ? "尚未写入客户资料。核对处理结果后，再确认导入。"
            : completed
              ? "本次处理已结束，请核对错误及受保护记录。"
              : processing
                ? active
                  ? "正在分批处理，请完成当前请求后再切换任务。"
                  : "进度保存在原任务中。继续导入只处理剩余记录，无须重新上传。"
                : "此任务目前不能继续，请下载报告，核对原名单后新建导入。"}
        </p>
      </CardHeader>
      <CardContent className={styles.resultContent}>
        <dl className={styles.sourceCounts} aria-label="名单计数">
          <div>
            <dt>源数据行</dt>
            <dd>{job.total_source_rows}</dd>
          </div>
          <div>
            <dt>去重后邮箱数</dt>
            <dd>{validEmails ?? "暂不可用"}</dd>
          </div>
          <div>
            <dt>处理记录</dt>
            <dd>{job.total_groups}</dd>
          </div>
        </dl>
        <p className={styles.hint}>
          邮箱数只统计格式有效的不同地址；错误行单独保留，记录数可能不同。不代表可发信人数。
        </p>

        <dl
          className={styles.decision}
          aria-label={preview ? "预检处理摘要" : "实际处理摘要"}
        >
          {decision.map(([label, count]) => (
            <div
              key={label}
              data-error={(label === "错误" && count > 0) || undefined}
            >
              <dt>{label}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        {!!summary.suppressed && (
          <p className={styles.hint}>
            {preview ? "将有" : "本次有"} {summary.suppressed}{" "}
            条记录加入防打扰名单，不会发信。
          </p>
        )}
        <p className={styles.hint}>
          “跳过或保留”包括无变化、归档跳过及保留防打扰状态；受保护客户的资料仍可能按现有规则补全。
        </p>

        {!preview && (
          <div className={styles.progress} role="status" aria-live="polite">
            <span>
              已处理 {job.processed_groups} / {job.total_groups}{" "}
              条（含错误与跳过）
            </span>
            <progress
              aria-label="名单处理进度"
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
                {active ? "正在确认…" : "确认并开始导入"}
              </Button>
            )}
            {processing && (
              <Button disabled={busy} onClick={() => onProcess(false)}>
                <RotateCw aria-hidden="true" />
                {active ? "继续处理中…" : "继续导入"}
              </Button>
            )}
            {completed && (
              <Button asChild>
                <Link href="/contacts">
                  <ArrowLeft aria-hidden="true" />
                  查看客户名单
                </Link>
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" disabled={busy} onClick={onEdit}>
                返回修改
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={onDownload}>
              <Download aria-hidden="true" />
              {activity === "report"
                ? "正在下载…"
                : preview
                  ? "下载预检报告"
                  : "下载报告"}
            </Button>
          </div>
          <Button variant="ghost" disabled={busy} onClick={onNew}>
            {completed ? "导入另一份名单" : "新建导入"}
          </Button>
        </div>
        {canEdit && (
          <p className={styles.hint}>
            返回修改会保留本次输入；重新预检会生成新任务，原预检记录仍保留。新建导入会清空本次输入。
          </p>
        )}
        {!canEdit && preview && (
          <p className={styles.hint}>
            这是已保存的预检任务。原始文件未保存在页面中，请按来源行修正原名单后新建导入。
          </p>
        )}
        {busy && (
          <p className={styles.hint} role="status">
            正在完成当前请求，暂时无法新建、翻页或切换历史任务。
          </p>
        )}

        <div className={styles.protectionNote}>
          <strong>名单处理结果与发信资格分别核对</strong>
          <p>
            未确认客户不能发信；已有退订、投诉、硬退信和归档保护不会因导入自动解除。发送时仍会检查客户当前状态和发信条件。
          </p>
          <p>
            下表“导入状态”是本次请求的订阅状态。“未确认”不会把已有订阅客户自动降级；退订、投诉和硬退信按保护规则执行，最终状态请到客户名单核对。
          </p>
        </div>

        <div className={styles.resultToolbar}>
          <h3>逐条核对</h3>
          {hasErrors && (
            <Button variant="outline" disabled={busy} onClick={onLocateError}>
              定位首个错误
            </Button>
          )}
        </div>
        {hasErrors && (
          <p className={styles.hint}>
            错误记录不写入客户资料；有效记录仍按既有规则处理。可根据来源行修正原名单
            {canEdit ? "，或返回修改后重新预检" : "后新建导入"}。
          </p>
        )}

        <div className={styles.tableRegion}>
          <table className={styles.resultTable} aria-label="名单逐条处理结果">
            <thead>
              <tr>
                <th scope="col">邮箱与来源行</th>
                <th scope="col">处理结果</th>
                <th scope="col">导入状态与标签</th>
                <th scope="col">原因与说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const result = displayedImportResult(row);
                const message =
                  dedupeImportMessages(row.message) ||
                  importRowExplanation(row);
                return (
                  <tr key={row.item_no} data-result={result}>
                    <th scope="row" className={styles.emailCell}>
                      <span>{row.email || "未填写邮箱"}</span>
                      <small>来源行 {row.source_rows.join("、")}</small>
                    </th>
                    <td className={styles.resultCell}>
                      <span
                        className={styles.resultBadge}
                        data-error={result === "error" || undefined}
                      >
                        {importResultLabels[result] ?? result}
                      </span>
                      {processing && (
                        <small>
                          {row.result === "pending"
                            ? "待处理，以上为预检判断"
                            : "已处理"}
                        </small>
                      )}
                    </td>
                    <td className={styles.detailsCell}>
                      <span>
                        导入状态：{subscriptionLabels[row.requested_status]}
                      </span>
                      {row.tags.length > 0 && (
                        <span className={styles.tags}>
                          {row.tags.join("、")}
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
