export const DEFAULT_TEMPLATE_SEEDS = {
  welcome: {
    zhName: "欢迎新客户",
    zhCategory: "欢迎系列",
    enName: "Welcome New Customers",
  },
  abandoned_cart: {
    zhName: "弃购挽回",
    zhCategory: "弃购挽回",
    enName: "Abandoned Cart Recovery",
  },
  promotion: {
    zhName: "促销活动",
    zhCategory: "促销活动",
    enName: "Promotional Sale",
  },
  shipping: {
    zhName: "物流通知",
    zhCategory: "物流通知",
    enName: "Shipping Notification",
  },
  winback: {
    zhName: "复购唤醒",
    zhCategory: "复购唤醒",
    enName: "Win-back Reminder",
  },
  review_request: {
    zhName: "评价邀请",
    zhCategory: "评价邀请",
    enName: "Review Request",
  },
} as const;

export type DefaultTemplateKey = keyof typeof DEFAULT_TEMPLATE_SEEDS;

const DEFAULT_CATEGORY_TO_KEY: Record<string, DefaultTemplateKey> = {
  欢迎系列: "welcome",
  弃购挽回: "abandoned_cart",
  促销活动: "promotion",
  物流通知: "shipping",
  复购唤醒: "winback",
  评价邀请: "review_request",
};

export function isDefaultTemplateKey(
  value: string | null | undefined,
): value is DefaultTemplateKey {
  return Boolean(value && value in DEFAULT_TEMPLATE_SEEDS);
}

type TemplateDefaultsTranslator = (
  key: `defaults.${DefaultTemplateKey}.${"name" | "category"}`,
) => string;

const DEFAULT_NAME_TO_KEY: Record<string, DefaultTemplateKey> = {
  欢迎新客户: "welcome",
  弃购挽回: "abandoned_cart",
  促销活动: "promotion",
  物流通知: "shipping",
  复购唤醒: "winback",
  评价邀请: "review_request",
};

/**
 * 仅当预置模板名称仍等于初始默认中文值时，按当前语言本地化；
 * 用户自定义改名或自建模板始终保留原始名称。
 */
export function localizeTemplateName(
  template: { name: string; default_key: string | null },
  t: TemplateDefaultsTranslator,
): string {
  if (!isDefaultTemplateKey(template.default_key)) return template.name;
  const seed = DEFAULT_TEMPLATE_SEEDS[template.default_key];
  if (template.name !== seed.zhName) return template.name;
  return t(`defaults.${template.default_key}.name`);
}

/** 用于不含 default_key 的活动卡片/下拉选项：若名称恰好为预置模板默认中文名则本地化。 */
export function localizeTemplateNameByValue(
  name: string,
  t: TemplateDefaultsTranslator,
): string {
  const matchedKey = DEFAULT_NAME_TO_KEY[name];
  if (matchedKey) return t(`defaults.${matchedKey}.name`);
  return name;
}

/**
 * 预置模板分类展示层本地化；用于卡片、筛选下拉及已选筛选标签。
 * 下拉 value 仍保持数据库存储值以确保筛选准确命中。
 */
export function localizeTemplateCategory(
  category: string,
  t: TemplateDefaultsTranslator,
  defaultKey?: string | null,
): string {
  if (isDefaultTemplateKey(defaultKey)) {
    const seed = DEFAULT_TEMPLATE_SEEDS[defaultKey];
    if (category === seed.zhCategory) {
      return t(`defaults.${defaultKey}.category`);
    }
    return category;
  }
  const matchedKey = DEFAULT_CATEGORY_TO_KEY[category];
  if (matchedKey) {
    return t(`defaults.${matchedKey}.category`);
  }
  return category;
}

/**
 * 英文模式下搜索预置模板英文展示名时，映射到其数据库中文默认名用于补查。
 * 仅当恰好命中单一预置模板英文名时返回对应中文名，避免扩大无关结果。
 */
export function resolveStarterSearchAlias(query: string): string | null {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return null;
  const matches = Object.values(DEFAULT_TEMPLATE_SEEDS).filter((seed) =>
    seed.enName.toLowerCase().includes(normalized),
  );
  if (matches.length !== 1) return null;
  return matches[0].zhName;
}
