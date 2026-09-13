import "server-only";
import { z } from "zod";
import { supabaseConfig } from "@/lib/supabase/config";

const resultSchema = z.object({
  status: z.enum(["ready", "already_suppressed", "unsubscribed"]),
  workspace_name: z.string().min(1).max(80),
  masked_email: z.string().min(3).max(254),
  already_applied: z.boolean().optional(),
  already_suppressed: z.boolean().optional(),
});

export type UnsubscribeResult = z.infer<typeof resultSchema>;
export type UnsubscribeServiceResult =
  | { ok: true; data: UnsubscribeResult }
  | { ok: false; reason: "invalid" | "unavailable" };

const tokenPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

async function callService(
  token: string,
  entrypoint?: "public_page" | "one_click",
): Promise<UnsubscribeServiceResult> {
  if (!tokenPattern.test(token) || token.length > 512)
    return { ok: false, reason: "invalid" };
  const { url, key } = supabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/edm-unsubscribe`, {
      method: entrypoint ? "POST" : "GET",
      headers: {
        apikey: key,
        "x-edm-unsubscribe-token": token,
        ...(entrypoint ? { "content-type": "application/json" } : {}),
      },
      body: entrypoint ? JSON.stringify({ entrypoint }) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (response.status === 404) return { ok: false, reason: "invalid" };
  if (!response.ok) return { ok: false, reason: "unavailable" };
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const parsed = resultSchema.safeParse(value);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "unavailable" };
}

export function inspectUnsubscribe(token: string) {
  return callService(token);
}

export function applyUnsubscribe(
  token: string,
  entrypoint: "public_page" | "one_click",
) {
  return callService(token, entrypoint);
}
