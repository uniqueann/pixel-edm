/** 设置页分段锚点（总览清单、发信检查等深链共用）。 */

export const SETTINGS_SECTION_IDS = {
  store: "settings-store",
  profile: "settings-profile",
  channels: "settings-channels",
  billing: "settings-billing",
  appearance: "settings-appearance",
} as const;

export type SettingsSectionKey = keyof typeof SETTINGS_SECTION_IDS;

export function settingsSectionHref(section: SettingsSectionKey) {
  return `/settings#${SETTINGS_SECTION_IDS[section]}`;
}
