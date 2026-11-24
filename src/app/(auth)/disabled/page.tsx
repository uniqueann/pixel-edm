import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.disabled");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("auth.disabled");
  return (
    <section className="auth-card">
      <h1>{t("title")}</h1>
      <p className="hint">{t("description")}</p>
      <form action={signOut}>
        <Button>{t("signOut")}</Button>
      </form>
    </section>
  );
}
