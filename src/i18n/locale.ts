import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { serverClient } from "@/lib/supabase/server";
import { authCookieName, isConfigured } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isAppLocale,
  normalizeLocale,
  parseAcceptLanguage,
  type AppLocale,
} from "./config";

export type MemberRow = Database["edm"]["Tables"]["members"]["Row"];

/**
 * 请求级缓存的当前登录用户与成员记录：
 * - 无 Supabase 会话 cookie 时直接短路，未登录公开页零 DB 查询；
 * - 已登录时由 React.cache 与 getContext() 共享同一次 auth + members 查询。
 */
export const getCachedAuthMember = cache(async () => {
  if (!isConfigured()) {
    return {
      user: null,
      member: null as MemberRow | null,
      authError: null as unknown,
      memberError: null as unknown,
    };
  }
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some((item) => item.name.startsWith(authCookieName));
  if (!hasAuthCookie) {
    return {
      user: null,
      member: null as MemberRow | null,
      authError: null as unknown,
      memberError: null as unknown,
    };
  }

  const db = await serverClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user) {
    return {
      user: null,
      member: null as MemberRow | null,
      authError,
      memberError: null as unknown,
    };
  }

  const { data: member, error: memberError } = await db
    .from("members")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    user,
    member: (member as MemberRow | null) ?? null,
    authError: null as unknown,
    memberError,
  };
});

/** 读取 cookie 或 Accept-Language 协商出的客户端语言偏好（不含 DB）。 */
export async function resolveBrowserOrCookieLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const fromCookie = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  if (fromCookie) return fromCookie;

  const headerStore = await headers();
  const fromHeader = parseAcceptLanguage(headerStore.get("accept-language"));
  if (fromHeader) return fromHeader;

  return DEFAULT_LOCALE;
}

/**
 * 站点请求级语言协商（按方案 §4.3）：
 * - 登录后：members.locale → NEXT_LOCALE cookie → Accept-Language → zh-CN
 * - 未登录：NEXT_LOCALE cookie → Accept-Language → zh-CN
 */
export const resolveRequestLocale = cache(async (): Promise<AppLocale> => {
  try {
    const { member } = await getCachedAuthMember();
    if (member?.locale && isAppLocale(member.locale)) {
      return member.locale;
    }
  } catch {
    // 数据库异常时降级到 cookie / 浏览器协商，避免阻断错误页渲染。
  }
  return resolveBrowserOrCookieLocale();
});

export async function writeLocaleCookie(locale: AppLocale) {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/**
 * 登录 / 回调 / 初始化时的单一语言同步入口（方案 §4.4）：
 * - DB 有值：将 DB 偏好写入 NEXT_LOCALE cookie；
 * - DB 为 NULL：将当前 cookie / 浏览器协商结果回写 DB，并同步写入 cookie。
 */
export async function syncMemberLocaleForCurrentUser(): Promise<AppLocale> {
  const fallback = await resolveBrowserOrCookieLocale();
  if (!isConfigured()) return fallback;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return fallback;

  const { data: member } = await db
    .from("members")
    .select("locale, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member || member.status !== "active") {
    return fallback;
  }

  if (isAppLocale(member.locale)) {
    await writeLocaleCookie(member.locale);
    return member.locale;
  }

  await db.rpc("set_member_locale", { payload: { locale: fallback } });
  await writeLocaleCookie(fallback);
  return fallback;
}
