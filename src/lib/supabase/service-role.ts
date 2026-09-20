import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** Webhook 等服务端任务调用 edm RPC（需 SUPABASE_SERVICE_ROLE_KEY）。 */
export function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase 服务端密钥未配置完整。");
  }
  return createClient<Database, "edm">(url, key, {
    db: { schema: "edm" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function hasServiceRoleEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
