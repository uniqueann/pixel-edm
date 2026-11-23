"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { initialize } from "@/app/actions";
import { Button } from "@/components/ui/button";

function Submit({ retry }: { retry: boolean }) {
  const { pending } = useFormStatus();
  const t = useTranslations("auth.onboarding");
  return (
    <Button disabled={pending} className="min-h-11">
      {pending
        ? t("submitPending")
        : retry
          ? t("submitRetry")
          : t("submitEnter")}
    </Button>
  );
}

export function InitializeForm({ retry }: { retry: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    if (!retry && !submitted.current) {
      submitted.current = true;
      form.current?.requestSubmit();
    }
  }, [retry]);
  return (
    <form ref={form} action={initialize}>
      <Submit retry={retry} />
    </form>
  );
}
