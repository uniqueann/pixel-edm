"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { initialize } from "@/app/actions";
import { Button } from "@/components/ui/button";
function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending}>
      {pending ? "正在准备工作区…" : "进入邮局"}
    </Button>
  );
}
export function InitializeForm({ retry }: { retry: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!retry) form.current?.requestSubmit();
  }, [retry]);
  return (
    <form ref={form} action={initialize}>
      <Submit />
    </form>
  );
}
