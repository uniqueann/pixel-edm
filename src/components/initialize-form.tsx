"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { initialize } from "@/app/actions";
import { Button } from "@/components/ui/button";
function Submit({ retry }: { retry: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} className="min-h-11">
      {pending ? "正在准备工作区…" : retry ? "重试准备工作区" : "进入工作区"}
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
