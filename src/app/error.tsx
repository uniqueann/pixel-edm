"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations("shell.error");
  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <h1>{t("title")}</h1>
        <p className="hint">{t("description")}</p>
        <Button onClick={reset}>{t("retry")}</Button>
        <Link className="ml-4" href="/login">
          {t("backToLogin")}
        </Link>
      </section>
    </main>
  );
}
