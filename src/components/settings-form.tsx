"use client";
import { Notice } from "@/components/ui/notice";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
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
import { mailingAddressProblemCode } from "@/lib/mailing-address";
import { saveWorkspace } from "@/app/actions";
import { useValidationMessage } from "@/i18n/use-resolvers";

export function SettingsForm({
  name,
  address,
  canEdit,
}: {
  name: string;
  address: string;
  canEdit: boolean;
}) {
  const t = useTranslations("settings.store");
  const translateValidation = useValidationMessage();

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
  const savedAddressProblemCode = address.trim()
    ? mailingAddressProblemCode(address)
    : null;
  const savedAddressProblem = savedAddressProblemCode
    ? translateValidation(savedAddressProblemCode)
    : null;
  const previewAddressInvalid =
    mailingAddressProblemCode(previewAddress) !== null;

  return (
    <>
      <form
        className="space-y-5"
        onSubmit={form.handleSubmit(async (values) => {
          setError("");
          try {
            const result = await saveWorkspace(values);
            if (result.error) setError(translateValidation(result.error));
            else toast.success(t("savedToast"));
          } catch {
            setError(t("saveFailed"));
          }
        })}
      >
        <div className="space-y-2">
          <Label htmlFor="workspace-name">{t("nameLabel")}</Label>
          <Input
            id="workspace-name"
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={
              form.formState.errors.name ? "workspace-name-error" : undefined
            }
            disabled={!canEdit}
            {...form.register("name")}
          />
          <p id="workspace-name-error" className="field-error">
            {translateValidation(form.formState.errors.name?.message)}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mailing-address">{t("addressLabel")}</Label>
          {savedAddressProblem && (
            <Notice tone="warning" role="alert">
              {t("savedAddressInvalid", { problem: savedAddressProblem })}
              {!canEdit && ` ${t("contactAdminToFix")}`}
            </Notice>
          )}
          <Input
            id="mailing-address"
            disabled={!canEdit}
            placeholder={t("addressPlaceholder")}
            aria-describedby={`mailing-address-help${form.formState.errors.mailing_address ? " mailing-address-error" : ""}`}
            aria-invalid={Boolean(form.formState.errors.mailing_address)}
            {...form.register("mailing_address")}
          />
          <p id="mailing-address-help" className="hint mb-0">
            {t("addressHelp")}
          </p>
          <p id="mailing-address-error" className="field-error">
            {translateValidation(
              form.formState.errors.mailing_address?.message,
            )}
          </p>
          <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed">
            <p className="mb-1 font-medium">{t("footerPreviewTitle")}</p>
            <div
              data-testid="footer-preview"
              className="font-mono break-words whitespace-pre-wrap text-muted-foreground"
            >
              {"—\n"}
              {previewName?.trim() || t("footerPreviewStorePlaceholder")}
              {"\nContact address / 联系地址: "}
              <span className={previewAddressInvalid ? "text-destructive" : ""}>
                {previewAddress?.trim() || t("footerPreviewAddressPlaceholder")}
              </span>
              {`\nUnsubscribe / 退订: ${t("footerPreviewUnsubscribe")}`}
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <Button disabled={!canEdit || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t("saving") : t("saveButton")}
        </Button>
        {!canEdit && <p className="hint">{t("adminOnlyHint")}</p>}
      </form>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="link"
            className="mt-3 h-auto max-w-full whitespace-normal px-0 text-left"
          >
            {t("whyAddressTrigger")}
          </Button>
        </DialogTrigger>
        <DialogContent placement="bottom" className="bottom-sheet">
          <DialogHeader>
            <DialogTitle>{t("whyAddressTitle")}</DialogTitle>
            <DialogDescription>{t("whyAddressDescription")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
