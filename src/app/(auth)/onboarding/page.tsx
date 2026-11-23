import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { serverClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { InitializeForm } from "@/components/initialize-form";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isConfigured()) redirect("/setup");
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [{ error }, t] = await Promise.all([
    searchParams,
    getTranslations("auth.onboarding"),
  ]);
  return (
    <section className="auth-card">
      <h1>{t("title")}</h1>
      <p className="hint" role="status">
        {error ? t("error") : t("initializing")}
      </p>
      <p className="hint">{t("hint")}</p>
      <InitializeForm retry={Boolean(error)} />
      <form className="mt-4" action={signOut}>
        <Button variant="ghost">{t("signOut")}</Button>
      </form>
    </section>
  );
}
