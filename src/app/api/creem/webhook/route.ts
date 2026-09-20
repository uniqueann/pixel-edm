import { NextRequest } from "next/server";
import { Webhook } from "@creem_io/nextjs";
import { getCreemWebhookSecret } from "@/lib/billing/creem";
import {
  handleCreemGrantAccess,
  handleCreemRevokeAccess,
} from "@/lib/billing/creem-webhook";
import { hasServiceRoleEnv } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

function createEdmCreemWebhookHandler() {
  return Webhook({
    webhookSecret: getCreemWebhookSecret(),
    onGrantAccess: async (context) => {
      await handleCreemGrantAccess(context);
    },
    onRevokeAccess: async (context) => {
      await handleCreemRevokeAccess(context);
    },
    onSubscriptionPastDue: async (context) => {
      await handleCreemGrantAccess(context);
    },
    onSubscriptionCanceled: async (context) => {
      await handleCreemRevokeAccess(context);
    },
    onSubscriptionUnpaid: async (context) => {
      await handleCreemRevokeAccess(context);
    },
  });
}

export async function POST(request: NextRequest) {
  if (!hasServiceRoleEnv()) {
    return new Response("Supabase 服务端密钥未配置。", { status: 500 });
  }
  const handler = createEdmCreemWebhookHandler();
  return handler(request);
}
