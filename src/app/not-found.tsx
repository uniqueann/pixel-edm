import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function Page() {
  const t = await getTranslations("shell.notFound");
  return (
    <main className="auth-wrap">
      <h1>{t("title")}</h1>
      <Link href="/dashboard">{t("backToApp")}</Link>
    </main>
  );
}
