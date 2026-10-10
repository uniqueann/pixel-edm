export const authCookieName = "pixel-edm-auth";
export function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("请先配置 Supabase 连接信息");
  return { url, key };
}
export function siteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value) throw new Error("请配置本站回调地址");
  return new URL(value).origin;
}

/**
 * 注册、OAuth 的回调。普通注册只用精确 /auth/callback（引导页由回调默认），
 * 只有重置密码和邀请才附带 next，避免未入白名单的地址回退到共享 Site URL。
 */
export function authCallbackUrl(next?: string) {
  const callback = `${siteUrl()}/auth/callback`;
  const supportedNext =
    next === "/reset-password" ||
    (typeof next === "string" && next.startsWith("/invite/"))
      ? next
      : null;
  return supportedNext
    ? `${callback}?next=${encodeURIComponent(supportedNext)}`
    : callback;
}

/** 重置密码邮件的 redirectTo。斜杠不编码，与已验收的白名单写法一致。 */
export function passwordRecoveryRedirectUrl() {
  return `${siteUrl()}/auth/callback?next=/reset-password`;
}
