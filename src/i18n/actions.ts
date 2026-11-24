"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { isAppLocale, type AppLocale } from "./config";
import { syncMemberLocaleForCurrentUser, writeLocaleCookie } from "./locale";

/** 主动切换界面语言：始终写 cookie，已登录成员同时持久化到 edm.members.locale。 */
export async function setUserLocale(input: unknown) {
  if (!isAppLocale(input)) {
    return { ok: false as const, errorCode: "errors.common.unknown" };
  }
  const locale: AppLocale = input;
  await writeLocaleCookie(locale);

  if (isConfigured()) {
    try {
      const db = await serverClient();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (user) {
        const { error } = await db.rpc("set_member_locale", {
          payload: { locale },
        });
        // 刚注册未初始化 member 或账号停用时忽略 DB 写入失败，保留 cookie 生效。
        if (error && error.code !== "42501") {
          console.error("[pixel-edm] set_member_locale failed", error.message);
        }
      }
    } catch {
      // 网络或环境未就绪时仍以 cookie 为准，不阻断切换体验。
    }
  }

  revalidatePath("/", "layout");
  return { ok: true as const, locale };
}

/** 客户端密码登录 / 注册直登成功后调用，同步 DB 与 NEXT_LOCALE cookie。 */
export async function syncMemberLocale() {
  try {
    const locale = await syncMemberLocaleForCurrentUser();
    revalidatePath("/", "layout");
    return { ok: true as const, locale };
  } catch {
    return { ok: false as const };
  }
}
