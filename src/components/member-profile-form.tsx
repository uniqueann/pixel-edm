"use client";
import { Notice } from "@/components/ui/notice";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  isMemberSenderNameCustomized,
  memberProfile,
  senderNameDefault,
} from "@/lib/sender-name";
import { saveMemberProfile } from "@/app/actions";
import { useValidationMessage } from "@/i18n/use-resolvers";

export function MemberProfileForm({
  displayName,
  displayNameCustomized,
}: {
  displayName: string;
  displayNameCustomized?: boolean;
}) {
  const t = useTranslations("settings.profile");
  const translateValidation = useValidationMessage();

  const [error, setError] = useState("");
  const usingDefault = !isMemberSenderNameCustomized({
    display_name: displayName,
    display_name_customized: displayNameCustomized,
  });
  const form = useForm({
    mode: "onTouched",
    resolver: zodResolver(memberProfile),
    defaultValues: {
      display_name: senderNameDefault(displayName, displayNameCustomized),
    },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError("");
        try {
          const result = await saveMemberProfile(values);
          if (result.error) setError(translateValidation(result.error));
          else toast.success(t("savedToast"));
        } catch {
          setError(t("saveFailed"));
        }
      })}
    >
      {usingDefault && (
        <Notice tone="warning" role="alert">
          {t("defaultWarning")}
        </Notice>
      )}
      <div className="space-y-2">
        <Label htmlFor="member-display-name" className="block">
          {t("label")}
        </Label>
        <Input
          id="member-display-name"
          maxLength={80}
          placeholder={t("placeholder")}
          aria-describedby={`member-display-name-help${form.formState.errors.display_name ? " member-display-name-error" : ""}`}
          aria-invalid={Boolean(form.formState.errors.display_name)}
          {...form.register("display_name")}
        />
        <p id="member-display-name-help" className="hint mb-0">
          {t("help")}
        </p>
        <p id="member-display-name-error" className="field-error">
          {translateValidation(form.formState.errors.display_name?.message)}
        </p>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("saving") : t("saveButton")}
      </Button>
    </form>
  );
}
