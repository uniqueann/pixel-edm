"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type ComponentProps } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmailOutboundFooterPreview,
  EmailOutboundFromPreview,
  formatOutboundFromLine,
  outboundFooterPlainText,
} from "@/components/email-outbound-preview";
import { isDefaultSenderName, senderNameDefault } from "@/lib/sender-name";
import {
  renderTemplate,
  templateVariables,
  type TemplateValues,
} from "./model";
import styles from "./templates.module.css";

export function TemplatePreview({
  subject,
  body,
  workspaceName,
  memberName,
  mailingAddress,
  senderAlias,
  senderAddress,
  onSettingsNavigate,
}: {
  subject: string;
  body: string;
  workspaceName: string;
  memberName: string;
  mailingAddress: string;
  senderAlias: string;
  senderAddress: string;
  onSettingsNavigate?: ComponentProps<typeof Link>["onNavigate"];
}) {
  const [values, setValues] = useState<TemplateValues>({
    name: "Anna",
    email: "anna@example.com",
    store_name: workspaceName,
    sender_name: senderNameDefault(memberName),
    discount: "10%",
    product: "Canvas Tote",
    order_number: "#1001",
  });
  const rendered = useMemo(
    () => renderTemplate(subject, body, values),
    [subject, body, values],
  );
  const previewId = useId();
  const sampleControlsRef = useRef<HTMLDetailsElement>(null);
  const usedKeys = new Set(
    Array.from(`${subject}\n${body}`.matchAll(/{{([\s\S]*?)}}/g), (match) =>
      match[1].trim(),
    ),
  );
  const usedVariables = templateVariables.filter((variable) =>
    usedKeys.has(variable.key),
  );
  const primaryVariables = templateVariables.filter(
    (variable) =>
      usedKeys.has(variable.key) ||
      (variable.key === "email" && usedKeys.has("name")),
  );
  const otherVariables = templateVariables.filter(
    (variable) => !primaryVariables.includes(variable),
  );

  function sampleFields(
    variables: readonly (typeof templateVariables)[number][],
  ) {
    return (
      <div className={styles.sampleFields}>
        {variables.map((variable) => (
          <div key={variable.key} className={styles.field}>
            <Label htmlFor={`${previewId}-${variable.key}`}>
              {variable.key === "sender_name" ? "正文署名" : variable.label}
              <code>{`{{${variable.key}}}`}</code>
            </Label>
            <Input
              id={`${previewId}-${variable.key}`}
              value={values[variable.key]}
              maxLength={200}
              aria-describedby={`${previewId}-boundary`}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [variable.key]: event.target.value,
                }))
              }
            />
          </div>
        ))}
      </div>
    );
  }

  async function copyPreview() {
    if (rendered.missing.length) return;
    const fromLine = formatOutboundFromLine(senderAlias, senderAddress);
    const bodyWithFooter = outboundFooterPlainText({
      body: rendered.body,
      workspaceName,
      mailingAddress,
    });
    try {
      await navigator.clipboard.writeText(
        `${fromLine ? `发件人：${fromLine}\n\n` : ""}主题：${rendered.subject}\n\n${bodyWithFooter}`,
      );
      toast.success("完整预览已复制");
    } catch {
      toast.error("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  return (
    <div className={styles.preview}>
      <p
        id={`${previewId}-boundary`}
        className={styles.previewNote}
        role="note"
      >
        示例值仅用于本次预览，不会保存到模板。
      </p>
      <details ref={sampleControlsRef} className={styles.sampleControls}>
        <summary>
          <span>调整预览示例值 · 模板使用 {usedVariables.length} 项</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={styles.sampleGroups}>
          {primaryVariables.length ? (
            [
              { label: "客户资料 · 按收件人替换", customer: true },
              { label: "活动信息 · 创建活动时统一填写", customer: false },
            ].map((group) => {
              const fields = primaryVariables.filter(
                (variable) =>
                  group.customer ===
                  (variable.key === "name" || variable.key === "email"),
              );
              return fields.length ? (
                <div key={group.label} className={styles.variableGroup}>
                  <p className={styles.groupLabel}>{group.label}</p>
                  {sampleFields(fields)}
                  {group.customer && usedKeys.has("name") && (
                    <p className={styles.help}>
                      客户姓名留空时，使用邮箱中 @ 前的内容。
                    </p>
                  )}
                </div>
              ) : null;
            })
          ) : (
            <p className={styles.help}>当前主题和正文未使用变量。</p>
          )}
          {otherVariables.length > 0 && (
            <details className={styles.otherSamples}>
              <summary>未使用的示例值（{otherVariables.length} 项）</summary>
              {sampleFields(otherVariables)}
            </details>
          )}
        </div>
      </details>
      {rendered.missing.length > 0 && (
        <div className={styles.previewValidation} role="alert">
          <p>
            预览待补充：
            {rendered.missing
              .map((key) =>
                key === "sender_name"
                  ? "正文署名"
                  : (templateVariables.find((variable) => variable.key === key)
                      ?.label ?? key),
              )
              .join("、")}
          </p>
          <Button
            type="button"
            variant="link"
            className={styles.copyButton}
            onClick={() => {
              if (sampleControlsRef.current)
                sampleControlsRef.current.open = true;
              document
                .getElementById(`${previewId}-${rendered.missing[0]}`)
                ?.focus();
            }}
          >
            补充示例值
          </Button>
        </div>
      )}
      <div className={styles.mail}>
        <EmailOutboundFromPreview
          senderAlias={senderAlias}
          senderAddress={senderAddress}
          onSettingsNavigate={onSettingsNavigate}
          className="mb-4"
        />
        <p className={styles.mailLabel}>邮件主题</p>
        <p className={styles.mailSubject}>
          {rendered.subject || "填写主题后在此预览"}
        </p>
        <div className="my-4 border-t" />
        <p className={styles.mailLabel}>纯文本正文（含系统页脚）</p>
        <pre className={styles.mailBody}>
          {rendered.body || "填写正文后在此预览。"}
        </pre>
        <EmailOutboundFooterPreview
          workspaceName={workspaceName}
          mailingAddress={mailingAddress}
          onSettingsNavigate={onSettingsNavigate}
        />
      </div>
      {isDefaultSenderName(memberName) && usedKeys.has("sender_name") && (
        <p className={styles.previewNote} role="note">
          对外署名仍是默认的“店主”。设置真实署名后，新建预览和活动可自动预填。
          <Link
            href="/settings"
            onNavigate={onSettingsNavigate}
            className="underline underline-offset-2"
          >
            前往设置真实署名
          </Link>
          。
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className={styles.copyButton}
        disabled={rendered.missing.length > 0}
        onClick={copyPreview}
      >
        <Copy size={16} aria-hidden="true" />
        复制完整预览
      </Button>
    </div>
  );
}
