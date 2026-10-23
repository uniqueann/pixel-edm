"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { mailingAddressProblem } from "@/lib/mailing-address";
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
    mode: "onTouched",
    resolver: zodResolver(workspaceSettings),
    defaultValues: { name, mailing_address: address },
  });
  const [previewName, previewAddress] = useWatch({
    control: form.control,
    name: ["name", "mailing_address"],
  });
  const savedAddressProblem = address.trim()
    ? mailingAddressProblem(address)
    : null;
  const previewAddressInvalid = mailingAddressProblem(previewAddress) !== null;
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
          <Label htmlFor="mailing-address">邮件页脚实体地址</Label>
          {savedAddressProblem && (
            <div
              role="alert"
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
            >
              {`当前保存的页脚地址无法通过校验：${savedAddressProblem}。修正前，营销邮件页脚仍会原样显示这段文字。`}
              {!canEdit && "请联系工作区管理员修正。"}
            </div>
          )}
          <Input
            id="mailing-address"
            disabled={!canEdit}
            placeholder="例：上海市徐汇区漕溪北路 88 号 12 楼，中国"
            aria-describedby="mailing-address-help"
            aria-invalid={Boolean(form.formState.errors.mailing_address)}
            {...form.register("mailing_address")}
          />
          <p id="mailing-address-help" className="hint mb-0">
            会显示在每一封营销邮件的页脚。请填写收件人可以寄信的真实地址（街道、门牌号、城市、国家），可用中文或英文，如
            “88 Caoxi North Rd, Xuhui, Shanghai,
            China”。不要填写邮箱、电话或“联系方式”这类占位文字。
          </p>
          <p className="field-error">
            {form.formState.errors.mailing_address?.message}
          </p>
          <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed">
            <p className="mb-1 font-medium">页脚预览</p>
            <div
              data-testid="footer-preview"
              className="font-mono break-words whitespace-pre-wrap text-muted-foreground"
            >
              {"—\n"}
              {previewName?.trim() || "（店铺 / 工作区名称）"}
              {"\nContact address / 联系地址: "}
              <span className={previewAddressInvalid ? "text-destructive" : ""}>
                {previewAddress?.trim() || "（未填写）"}
              </span>
              {"\nUnsubscribe / 退订: （发送时自动生成退订链接）"}
            </div>
          </div>
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
            为什么需要实体地址？
          </Button>
        </DialogTrigger>
        <DialogContent placement="bottom" className="bottom-sheet">
          <DialogHeader>
            <DialogTitle>为什么需要邮件页脚实体地址？</DialogTitle>
            <DialogDescription>
              根据国际反垃圾邮件法规（如
              CAN-SPAM），营销邮件页脚必须包含有效的实体邮寄地址。这里填写的地址会原样附在每一封营销邮件末尾，可以是办公地址、店铺地址或邮政信箱，不能用邮箱、电话或占位文字代替。
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
