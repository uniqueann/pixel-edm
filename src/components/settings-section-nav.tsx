import Link from "next/link";
import { SETTINGS_SECTION_IDS } from "@/features/settings/anchors";

const sections: { id: string; label: string }[] = [
  { id: SETTINGS_SECTION_IDS.store, label: "店铺信息" },
  { id: SETTINGS_SECTION_IDS.channels, label: "发信通道" },
  { id: SETTINGS_SECTION_IDS.billing, label: "套餐" },
  { id: SETTINGS_SECTION_IDS.appearance, label: "外观" },
];

/** 设置页顶部分段锚点导航。 */
export function SettingsSectionNav({ showBilling }: { showBilling: boolean }) {
  const items = showBilling
    ? sections
    : sections.filter((item) => item.id !== SETTINGS_SECTION_IDS.billing);
  return (
    <nav className="settings-section-nav" aria-label="设置分区">
      {items.map((item) => (
        <Link key={item.id} href={`#${item.id}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
