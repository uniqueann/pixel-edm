import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SETTINGS_SECTION_IDS } from "@/features/settings/anchors";

const sections: {
  id: string;
  labelKey: "store" | "channels" | "billing" | "appearance";
}[] = [
  { id: SETTINGS_SECTION_IDS.store, labelKey: "store" },
  { id: SETTINGS_SECTION_IDS.channels, labelKey: "channels" },
  { id: SETTINGS_SECTION_IDS.billing, labelKey: "billing" },
  { id: SETTINGS_SECTION_IDS.appearance, labelKey: "appearance" },
];

/** 设置页顶部分段锚点导航。 */
export async function SettingsSectionNav({
  showBilling,
}: {
  showBilling: boolean;
}) {
  const t = await getTranslations("settings.sectionNav");
  const items = showBilling
    ? sections
    : sections.filter((item) => item.id !== SETTINGS_SECTION_IDS.billing);
  return (
    <nav className="settings-section-nav" aria-label={t("ariaLabel")}>
      {items.map((item) => (
        <Link key={item.id} href={`#${item.id}`}>
          {t(item.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
