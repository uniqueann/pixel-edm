import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/config";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next =
    request.nextUrl.searchParams.get("next") === "/reset-password"
      ? "/reset-password"
      : "/onboarding";
  if (code) {
    const { error } = await (
      await serverClient()
    ).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, siteUrl()));
  }
  return NextResponse.redirect(new URL("/login?error=callback", siteUrl()));
}
