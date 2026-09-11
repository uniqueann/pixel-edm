import { z } from "zod";
import { csvRow } from "@/lib/csv";
import { serverClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/workspace";
import type { CampaignExportChunk } from "@/features/campaigns/model";

const campaignIdSchema = z.string().uuid();

function safeFilename(name: string, confirmedAt: string, campaignId: string) {
  const base =
    name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "campaign";
  const date = confirmedAt.slice(0, 10).replaceAll("-", "");
  return `${base}-${date}-${campaignId.slice(0, 8)}.csv`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getContext();
  if (!["admin", "editor"].includes(context.role)) {
    return new Response("没有活动导出权限", { status: 403 });
  }

  const parsedId = campaignIdSchema.safeParse((await params).id);
  if (!parsedId.success) return new Response("活动标识无效", { status: 400 });

  const db = await serverClient();
  const exportId = crypto.randomUUID();
  const input = {
    workspace_id: context.workspace.id,
    id: parsedId.data,
    export_id: exportId,
    after_position: 0,
    limit: 500,
  };
  const { data, error } = await db.rpc("get_campaign_export_chunk", {
    payload: input,
  });
  if (error) {
    const forbidden = error.code === "42501";
    return new Response(forbidden ? "没有活动导出权限" : error.message, {
      status: forbidden ? 403 : 409,
    });
  }

  const first = data as unknown as CampaignExportChunk;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            `\uFEFF${csvRow(["email", "name", "subject", "body"])}`,
          ),
        );
        let chunk = first;
        while (true) {
          for (const row of chunk.rows) {
            controller.enqueue(
              encoder.encode(
                csvRow([row.email, row.name, row.subject, row.body]),
              ),
            );
          }
          if (!chunk.has_more) break;
          const next = await db.rpc("get_campaign_export_chunk", {
            payload: { ...input, after_position: chunk.next_position },
          });
          if (next.error) throw new Error(next.error.message);
          chunk = next.data as unknown as CampaignExportChunk;
        }
        controller.close();
      } catch (streamError) {
        controller.error(streamError);
      }
    },
  });
  const filename = safeFilename(
    first.campaign_name,
    first.confirmed_at,
    parsedId.data,
  );

  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="campaign.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
