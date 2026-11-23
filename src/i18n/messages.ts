import type { AppLocale, MessageNamespace } from "./config";

export type MessagesMap = Record<MessageNamespace, Record<string, unknown>>;

/** 按 locale 加载全部 16 个 namespace JSON。 */
export async function loadMessages(locale: AppLocale): Promise<MessagesMap> {
  const [
    common,
    shell,
    auth,
    dashboard,
    settings,
    team,
    campaigns,
    contacts,
    templates,
    channels,
    billing,
    audit,
    help,
    unsubscribe,
    errors,
    validation,
  ] = await Promise.all([
    import(`../../messages/${locale}/common.json`).then((m) => m.default),
    import(`../../messages/${locale}/shell.json`).then((m) => m.default),
    import(`../../messages/${locale}/auth.json`).then((m) => m.default),
    import(`../../messages/${locale}/dashboard.json`).then((m) => m.default),
    import(`../../messages/${locale}/settings.json`).then((m) => m.default),
    import(`../../messages/${locale}/team.json`).then((m) => m.default),
    import(`../../messages/${locale}/campaigns.json`).then((m) => m.default),
    import(`../../messages/${locale}/contacts.json`).then((m) => m.default),
    import(`../../messages/${locale}/templates.json`).then((m) => m.default),
    import(`../../messages/${locale}/channels.json`).then((m) => m.default),
    import(`../../messages/${locale}/billing.json`).then((m) => m.default),
    import(`../../messages/${locale}/audit.json`).then((m) => m.default),
    import(`../../messages/${locale}/help.json`).then((m) => m.default),
    import(`../../messages/${locale}/unsubscribe.json`).then((m) => m.default),
    import(`../../messages/${locale}/errors.json`).then((m) => m.default),
    import(`../../messages/${locale}/validation.json`).then((m) => m.default),
  ]);

  return {
    common,
    shell,
    auth,
    dashboard,
    settings,
    team,
    campaigns,
    contacts,
    templates,
    channels,
    billing,
    audit,
    help,
    unsubscribe,
    errors,
    validation,
  };
}

/** 裁剪出指定 namespace 子集，用于按路由向 NextIntlClientProvider 下发最小文案包。 */
export function pickMessages(
  messages: Record<string, unknown>,
  namespaces: readonly MessageNamespace[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const ns of namespaces) {
    if (ns in messages) {
      picked[ns] = messages[ns];
    }
  }
  return picked;
}
