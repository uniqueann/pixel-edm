import { NextRequest, NextResponse } from "next/server";
import {
  completeAuthCallback,
  planAuthCallback,
} from "@/lib/supabase/auth-callback";
import { siteUrl } from "@/lib/supabase/config";
import { serverClient } from "@/lib/supabase/server";
import { syncMemberLocaleForCurrentUser } from "@/i18n/locale";

export async function GET(request: NextRequest) {
  const plan = planAuthCallback({
    code: request.nextUrl.searchParams.get("code"),
    tokenHash: request.nextUrl.searchParams.get("token_hash"),
    type: request.nextUrl.searchParams.get("type"),
    next: request.nextUrl.searchParams.get("next"),
  });
  const path = await completeAuthCallback(plan, {
    async verifyOtp(params) {
      return (await serverClient()).auth.verifyOtp(params);
    },
    async exchangeCodeForSession(code) {
      return (await serverClient()).auth.exchangeCodeForSession(code);
    },
  });
  if (path !== "/login?error=callback") {
    await syncMemberLocaleForCurrentUser().catch(() => {});
  }
  return NextResponse.redirect(new URL(path, siteUrl()));
}
