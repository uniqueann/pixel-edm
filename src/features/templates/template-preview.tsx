"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  renderTemplate,
  templateVariables,
  type TemplateValues,
} from "./model";

export function TemplatePreview({
  subject,
  body,
  workspaceName,
  memberName,
}: {
  subject: string;
  body: string;
  workspaceName: string;
  memberName: string;
}) {
  const [values, setValues] = useState<TemplateValues>({
    name: "Anna",
    email: "anna@example.com",
    store_name: workspaceName,
    sender_name: memberName,
    discount: "10%",
    product: "Canvas Tote",
    order_number: "#1001",
  });
  const rendered = useMemo(
    () => renderTemplate(subject, body, values),
    [subject, body, values],
  );

  async function copyPreview() {
    if (rendered.missing.length) return;
    try {
      await navigator.clipboard.writeText(
        `主题：${rendered.subject}\n\n${rendered.body}`,
      );
      toast.success("完整预览已复制");
    } catch {
      toast.error("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-medium">预览变量</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {templateVariables.map((variable) => (
            <div key={variable.key}>
              <Label htmlFor={`preview-${variable.key}`}>
                {variable.label}
              </Label>
              <Input
                id={`preview-${variable.key}`}
                value={values[variable.key]}
                maxLength={200}
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
      </div>
      <div className="rounded-lg border bg-white p-4">
        <p className="mb-2 text-xs text-muted-foreground">邮件主题</p>
        <p className="break-words font-medium">{rendered.subject}</p>
        <div className="my-4 border-t" />
        <p className="mb-2 text-xs text-muted-foreground">纯文本正文</p>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">
          {rendered.body}
        </pre>
      </div>
      {rendered.missing.length > 0 && (
        <p className="field-error" role="alert">
          请补充预览值：{rendered.missing.join("、")}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={rendered.missing.length > 0}
        onClick={copyPreview}
      >
        复制完整预览
      </Button>
    </div>
  );
}
