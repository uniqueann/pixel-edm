import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/brand";
import { LocaleToggle } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function Setup() {
  const t = await getTranslations("auth.setup");
  return (
    <main className="auth-wrap relative">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LocaleToggle />
        <ThemeToggle />
      </div>
      <Brand />
      <section className="auth-card">
        <h1>{t("title")}</h1>
        <p className="hint">{t("description")}</p>
        <p>{t("envHint")}</p>
      </section>
    </main>
  );
}
