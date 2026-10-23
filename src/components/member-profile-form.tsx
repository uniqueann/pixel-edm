"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  isDefaultSenderName,
  memberProfile,
  senderNameDefault,
} from "@/lib/sender-name";
import { saveMemberProfile } from "@/app/actions";

export function MemberProfileForm({ displayName }: { displayName: string }) {
  const [error, setError] = useState("");
  const usingDefault = isDefaultSenderName(displayName);
  const form = useForm({
    mode: "onTouched",
    resolver: zodResolver(memberProfile),
    defaultValues: { display_name: senderNameDefault(displayName) },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError("");
        try {
          const result = await saveMemberProfile(values);
          if (result.error) setError(result.error);
          else toast.success("对外署名已保存");
        } catch {
          setError("保存失败，输入已保留，请重试。");
        }
      })}
    >
      {usingDefault && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        >
          你还在使用系统默认称呼“店主”。收到邮件的海外客户会在落款处看到它，请先填写真实署名。
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="member-display-name">
          我的对外署名（{"{{sender_name}}"}）
        </Label>
        <Input
          id="member-display-name"
          maxLength={80}
          placeholder="例：Anna Chen 或 Canvas Studio Team"
          aria-describedby="member-display-name-help"
          aria-invalid={Boolean(form.formState.errors.display_name)}
          {...form.register("display_name")}
        />
        <p id="member-display-name-help" className="hint mb-0">
          会作为邮件落款（模板里的 {"{{sender_name}}"}
          ）出现在发给客户的邮件中，也会显示在团队成员列表和操作记录里。建议填写客户能认出的姓名或品牌名，面向海外客户时可用英文。只影响之后新建或重新编辑的活动，已保存的活动内容不会被改动。
        </p>
        <p className="field-error">
          {form.formState.errors.display_name?.message}
        </p>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "保存中…" : "保存署名"}
      </Button>
    </form>
  );
}
