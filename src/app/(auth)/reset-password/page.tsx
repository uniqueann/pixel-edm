import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.modes.reset");
  return { title: t("title") };
}

export default function Page() {
  return <AuthForm mode="reset" />;
}
