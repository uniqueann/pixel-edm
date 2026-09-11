"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Download, FileUp, Play, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { csvCell } from "@/lib/csv";
import {
  confirmContactImport,
  exportContactImport,
  getContactImport,
  prepareContactImport,
  processContactImportBatch,
} from "./import-actions";
import { parseImportText } from "./import-parser";
import type { ContactImportDetail, ContactImportHistory } from "./import-model";

const resultLabels: Record<string, string> = {
  new: "将新增",
  update: "将更新",
  unchanged: "无变化",
  archived_skipped: "归档跳过",
  suppressed_protected: "抑制保护",
  suppressed: "写入抑制",
  error: "错误",
  pending: "待处理",
  created: "已新增",
  updated: "已更新",
};

function downloadCsv(name: string, rows: unknown[][]) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ContactImporter({
  workspace,
  history,
  initialJob,
}: {
  workspace: string;
  history: ContactImportHistory;
  initialJob?: ContactImportDetail;
}) {
  const [sourceType, setSourceType] = useState<"paste" | "csv">("paste");
  const [sourceName, setSourceName] = useState("手动导入");
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState<"" | "," | "\t">("");
  const [consentDeclared, setConsentDeclared] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [consentNote, setConsentNote] = useState("");
  const [consentAt, setConsentAt] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [job, setJob] = useState(initialJob);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function prepare() {
    setBusy(true);
    try {
      const parsed = parseImportText(text, { sourceType, delimiter });
      setWarnings(parsed.warnings);
      const result = await prepareContactImport({
        workspace_id: workspace,
        source_type: sourceType,
        source_name: sourceName,
        consent_declared: consentDeclared,
        consent_source: consentSource,
        consent_note: consentNote,
        consent_at: consentAt ? new Date(consentAt).toISOString() : "",
        rows: parsed.rows,
      });
      if ("error" in result) throw new Error(result.error);
      setJob(result.data);
      window.history.replaceState(
        null,
        "",
        `/contacts/import?id=${result.data.job.id}`,
      );
      toast.success("预检完成，请确认结果后开始导入");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "预检失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function process(jobId: string, confirm = false) {
    setBusy(true);
    try {
      let current = job;
      if (confirm) {
        const confirmed = await confirmContactImport({
          workspace_id: workspace,
          id: jobId,
        });
        if ("error" in confirmed) throw new Error(confirmed.error);
        current = confirmed.data;
        setJob(current);
      }
      for (
        let batch = 0;
        batch < 10 && current?.job.status === "processing";
        batch++
      ) {
        const result = await processContactImportBatch({
          workspace_id: workspace,
          id: jobId,
        });
        if ("error" in result) throw new Error(result.error);
        current = result.data;
        setJob(current);
      }
      if (current?.job.status === "completed") toast.success("名单导入完成");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "导入中断，可稍后继续。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changePage(page: number) {
    if (!job) return;
    setBusy(true);
    const result = await getContactImport({
      workspace_id: workspace,
      id: job.job.id,
      page,
    });
    setBusy(false);
    if ("error" in result) return toast.error(result.error);
    setJob(result.data);
    window.history.replaceState(
      null,
      "",
      `/contacts/import?id=${job.job.id}&page=${page}`,
    );
  }

  async function downloadReport() {
    if (!job) return;
    const result = await exportContactImport({
      workspace_id: workspace,
      id: job.job.id,
    });
    if ("error" in result) return toast.error(result.error);
    downloadCsv(`名单导入报告-${job.job.id}.csv`, [
      ["来源行", "邮箱", "处理结果", "说明"],
      ...result.data.map((row) => [
        row.source_rows.join("|"),
        row.email,
        resultLabels[row.result] ?? row.result,
        row.message,
      ]),
    ]);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            className="hint inline-flex items-center gap-1"
            href="/contacts"
          >
            <ArrowLeft className="size-3" /> 返回客户名单
          </Link>
          <h1>导入客户名单</h1>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv("pixel-edm-客户导入模板.csv", [
              [
                "邮箱",
                "姓名",
                "标签",
                "订阅状态",
                "同意来源",
                "同意证据说明",
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
          <Download /> 下载模板
        </Button>
      </div>

      {!job && (
        <Card>
          <CardHeader>
            <CardTitle>1. 提供名单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={sourceType === "paste" ? "default" : "outline"}
                onClick={() => setSourceType("paste")}
              >
                粘贴
              </Button>
              <Button
                variant={sourceType === "csv" ? "default" : "outline"}
                onClick={() => setSourceType("csv")}
              >
                CSV 文件
              </Button>
            </div>
            <div>
              <Label htmlFor="import-name">名单来源名称</Label>
              <Input
                id="import-name"
                maxLength={200}
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
              />
            </div>
            {sourceType === "paste" ? (
              <div>
                <Label htmlFor="import-text">名单内容</Label>
                <textarea
                  id="import-text"
                  className="mt-2 min-h-48 w-full rounded-md border bg-white p-3 font-mono text-sm"
                  placeholder={
                    "邮箱,姓名,标签\ncustomer@example.com,张三,VIP|老客"
                  }
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <p className="hint mt-1">
                  可粘贴带表头的逗号/制表符表格，也可按“邮箱、姓名、标签”三列粘贴。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  ref={fileRef}
                  aria-label="选择 CSV 文件"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024)
                      return toast.error("CSV 文件不能超过 2 MiB");
                    setSourceName(file.name);
                    setText(await file.text());
                  }}
                />
                <label className="flex items-center gap-2 text-sm">
                  分隔符
                  <select
                    className="rounded border bg-white p-2"
                    value={delimiter}
                    onChange={(event) =>
                      setDelimiter(event.target.value as "" | "," | "\t")
                    }
                  >
                    <option value="">自动识别</option>
                    <option value=",">逗号</option>
                    <option value="\t">制表符</option>
                  </select>
                </label>
              </div>
            )}
            <div className="rounded-lg border p-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={consentDeclared}
                  onChange={(event) => setConsentDeclared(event.target.checked)}
                />
                我确认名单中的未指定状态客户已提供可核验的订阅同意
              </label>
              <p className="hint mt-2">
                不勾选时，新客户默认为“未确认”，不能用于后续发送。已退订、硬退信和投诉始终优先。
              </p>
              {consentDeclared && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="consent-source">同意来源</Label>
                    <Input
                      id="consent-source"
                      required
                      maxLength={100}
                      value={consentSource}
                      onChange={(event) => setConsentSource(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="consent-at">同意时间（选填）</Label>
                    <Input
                      id="consent-at"
                      type="datetime-local"
                      value={consentAt}
                      onChange={(event) => setConsentAt(event.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="consent-note">证据说明</Label>
                    <Input
                      id="consent-note"
                      required
                      maxLength={500}
                      value={consentNote}
                      onChange={(event) => setConsentNote(event.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
            <Button
              disabled={busy || !text.trim() || !sourceName.trim()}
              onClick={prepare}
            >
              <FileUp /> {busy ? "正在预检…" : "预检名单"}
            </Button>
          </CardContent>
        </Card>
      )}

      {warnings.map((warning) => (
        <p className="field-error" key={warning}>
          {warning}
        </p>
      ))}

      {job && (
        <Card>
          <CardHeader>
            <CardTitle>
              2. {job.job.status === "prepared" ? "确认预检结果" : "导入结果"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg bg-muted p-3">
                <span className="hint">源数据行</span>
                <strong className="block text-xl">
                  {job.job.total_source_rows}
                </strong>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <span className="hint">去重后</span>
                <strong className="block text-xl">
                  {job.job.total_groups}
                </strong>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <span className="hint">已处理</span>
                <strong className="block text-xl">
                  {job.job.processed_groups}
                </strong>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <span className="hint">错误</span>
                <strong className="block text-xl">
                  {job.job.summary.error ?? 0}
                </strong>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">来源行</th>
                    <th className="p-2">邮箱</th>
                    <th className="p-2">状态</th>
                    <th className="p-2">标签</th>
                    <th className="p-2">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.map((row) => (
                    <tr className="border-b" key={row.item_no}>
                      <td className="p-2">{row.source_rows.join(", ")}</td>
                      <td className="max-w-64 break-all p-2">{row.email}</td>
                      <td className="p-2">
                        {resultLabels[
                          row.result === "pending"
                            ? row.preview_result
                            : row.result
                        ] ?? row.result}
                      </td>
                      <td className="p-2">{row.tags.join("、")}</td>
                      <td className="p-2 text-destructive">{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {job.job.status === "prepared" && (
                <Button
                  disabled={busy}
                  onClick={() => process(job.job.id, true)}
                >
                  <Play /> {busy ? "导入中…" : "确认并开始导入"}
                </Button>
              )}
              {job.job.status === "processing" && (
                <Button disabled={busy} onClick={() => process(job.job.id)}>
                  <RotateCw /> {busy ? "继续处理中…" : "继续导入"}
                </Button>
              )}
              <Button variant="outline" onClick={downloadReport}>
                <Download /> 下载报告
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setJob(undefined);
                  window.history.replaceState(null, "", "/contacts/import");
                }}
              >
                新建导入
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                disabled={busy || job.page <= 1}
                onClick={() => changePage(job.page - 1)}
              >
                上一页
              </Button>
              <span>
                {job.page} / {Math.max(1, Math.ceil(job.row_total / 50))}
              </span>
              <Button
                variant="outline"
                disabled={busy || job.page * 50 >= job.row_total}
                onClick={() => changePage(job.page + 1)}
              >
                下一页
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>最近导入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.map((item) => (
            <Link
              className="flex justify-between gap-3 rounded border p-3 text-sm hover:bg-muted"
              href={`/contacts/import?id=${item.id}`}
              key={item.id}
            >
              <span className="min-w-0 truncate">{item.source_name}</span>
              <span>
                {item.processed_groups}/{item.total_groups} ·{" "}
                {item.status === "completed"
                  ? "已完成"
                  : item.status === "prepared"
                    ? "待确认"
                    : "处理中"}
              </span>
            </Link>
          ))}
          {!history.length && <p className="hint">暂无导入记录。</p>}
        </CardContent>
      </Card>
    </div>
  );
}
