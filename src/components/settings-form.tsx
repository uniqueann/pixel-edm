"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { workspaceSettings } from "@/lib/validation";
import { saveWorkspace } from "@/app/actions";
export function SettingsForm({
  name,
  address,
  canEdit,
}: {
  name: string;
  address: string;
  canEdit: boolean;
}) {
  const [error, setError] = useState("");
  const form = useForm({
    resolver: zodResolver(workspaceSettings),
    defaultValues: { name, mailing_address: address },
  });
  return (
    <>
      <form
        className="space-y-5"
        onSubmit={form.handleSubmit(async (values) => {
          setError("");
          try {
            const result = await saveWorkspace(values);
            if (result.error) setError(result.error);
            else toast.success("工作区已保存");
          } catch {
            setError("保存失败，输入已保留，请重试。");
          }
        })}
      >
        <div className="space-y-2">
          <Label htmlFor="workspace-name">店铺 / 工作区名称</Label>
          <Input
            id="workspace-name"
            disabled={!canEdit}
            {...form.register("name")}
          />
          <p className="field-error">{form.formState.errors.name?.message}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mailing-address">发件人联系地址</Label>
          <Input
            id="mailing-address"
            disabled={!canEdit}
            placeholder="填写真实的联系地址"
            {...form.register("mailing_address")}
          />
          <p className="field-error">
            {form.formState.errors.mailing_address?.message}
          </p>
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <Button disabled={!canEdit || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "保存中…" : "保存设置"}
        </Button>
        {!canEdit && <p className="hint">仅管理员可以修改工作区设置。</p>}
      </form>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="link" className="mt-3 px-0">
            为什么需要联系地址？
          </Button>
        </DialogTrigger>
        <DialogContent className="bottom-sheet">
          <DialogHeader>
            <DialogTitle>让收件人找到你</DialogTitle>
            <DialogDescription>
              联系地址会用于后续邮件页脚。请填写店铺真实可联系的地址，发信前还需要配置并验证发件身份。
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
