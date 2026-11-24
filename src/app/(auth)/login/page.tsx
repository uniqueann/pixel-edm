import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.modes.login");
  return { title: t("submit") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [{ error, next }, t] = await Promise.all([
    searchParams,
    getTranslations("auth"),
  ]);
  return (
    <AuthForm
      mode="login"
      nextPath={next}
      callbackError={error ? t("callbackError") : undefined}
    />
  );
}
