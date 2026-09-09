"use client";
import { createBrowserClient } from "@supabase/ssr";
import { authCookieName, supabaseConfig } from "./config";
import type { Database } from "./database.types";
export function browserClient() {
  const { url, key } = supabaseConfig();
  return createBrowserClient<Database, "edm">(url, key, {
    db: { schema: "edm" },
    cookieOptions: { name: authCookieName },
  });
}
