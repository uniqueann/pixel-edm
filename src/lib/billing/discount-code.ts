/** 规范化共享支付渠道优惠码，使用两个渠道都能接受的格式。 */
export function normalizeCheckoutDiscountCode(
  value: FormDataEntryValue | null,
) {
  if (typeof value !== "string") return "";

  const code = value.trim().toUpperCase();
  if (!code) return "";
  if (!/^[A-Z0-9]{1,14}$/.test(code)) {
    throw new Error("优惠码格式无效：仅支持 1-14 位大写字母或数字。");
  }
  return code;
}
