import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookieName, supabaseConfig } from "./config";
import type { Database } from "./database.types";
export async function serverClient() {
  const jar = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient<Database, "edm">(url, key, {
    db: { schema: "edm" },
    cookieOptions: { name: authCookieName },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* 服务端组件不能写 Cookie，刷新由代理处理。 */
        }
      },
    },
  });
}
