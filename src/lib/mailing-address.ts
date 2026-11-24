// 邮件页脚实体地址的质量检查：前端表单、Server Action 与总览就绪判断共用。
// 只做“明显不是地址”的启发式拦截，宁可放过少数可疑值，也不要误伤真实地址。

const MIN_COMPACT_LENGTH = 8;

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /contact\s*info(rmation)?/,
  /\bsenders?('s)?\b/,
  /\byour\s+(physical\s+|mailing\s+|postal\s+|street\s+)?address\b/,
  /\baddress\s+(here|goes\s+here)\b/,
  /\b(placeholder|lorem\s+ipsum|example|tbd|todo|n\/a)\b/,
  /联系方式|联系信息|发件人(的)?(联系)?(地址|信息)/,
  /(你|您)的(联系|实体|邮寄)?地址/,
  /请(填写|输入)|填写真实|待(填写|补充|定)|占位|示例|暂无/,
  /某某|[xX×]{2,}\s*[省市区县镇乡村路街道巷弄号楼室]/,
];

const EMAIL_ONLY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_ONLY = /^(https?:\/\/|www\.)\S+$/i;
const HAS_LETTER_OR_CJK = /[a-z\u3400-\u9fff]/i;

export type MailingAddressProblemCode =
  | "validation.mailingAddressRequired"
  | "validation.mailingAddressNoEmail"
  | "validation.mailingAddressNoUrl"
  | "validation.mailingAddressPlaceholder"
  | "validation.mailingAddressNoNumbersOnly"
  | "validation.mailingAddressTooShort";

const MAILING_ADDRESS_ZH_MESSAGES: Record<MailingAddressProblemCode, string> = {
  "validation.mailingAddressRequired": "请填写邮件页脚实体地址",
  "validation.mailingAddressNoEmail":
    "邮箱不能代替实体地址，请填写街道和门牌号",
  "validation.mailingAddressNoUrl": "网址不能代替实体地址，请填写街道和门牌号",
  "validation.mailingAddressPlaceholder":
    "这看起来是占位文本，请填写可以收信的真实地址（如街道、门牌号、城市）",
  "validation.mailingAddressNoNumbersOnly":
    "不能只填电话或数字，请填写街道和门牌号",
  "validation.mailingAddressTooShort": "地址过短，请至少写到街道和门牌号",
};

/** 返回结构化错误码；地址可用时返回 null。 */
export function mailingAddressProblemCode(
  raw: string | null | undefined,
): MailingAddressProblemCode | null {
  const value = (raw ?? "").trim();
  if (!value) return "validation.mailingAddressRequired";
  if (EMAIL_ONLY.test(value)) return "validation.mailingAddressNoEmail";
  if (URL_ONLY.test(value)) return "validation.mailingAddressNoUrl";
  const normalized = value.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized)))
    return "validation.mailingAddressPlaceholder";
  if (!HAS_LETTER_OR_CJK.test(value))
    return "validation.mailingAddressNoNumbersOnly";
  if (value.replace(/\s+/g, "").length < MIN_COMPACT_LENGTH)
    return "validation.mailingAddressTooShort";
  return null;
}

/** 返回中文问题描述；地址可用时返回 null。 */
export function mailingAddressProblem(raw: string | null | undefined) {
  const code = mailingAddressProblemCode(raw);
  return code ? MAILING_ADDRESS_ZH_MESSAGES[code] : null;
}
