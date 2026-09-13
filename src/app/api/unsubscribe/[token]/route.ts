import { applyUnsubscribe } from "@/features/unsubscribe/service";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

export async function GET(
  request: Request,
  context: RouteContext<"/api/unsubscribe/[token]">,
) {
  const { token } = await context.params;
  const confirmationUrl = new URL(
    `/unsubscribe/${encodeURIComponent(token)}`,
    request.url,
  );
  return new Response(null, {
    status: 307,
    headers: { ...headers, location: confirmationUrl.toString() },
  });
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/unsubscribe/[token]">,
) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded"))
    return new Response("请求格式无效", { status: 400, headers });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 256)
    return new Response("请求格式无效", { status: 400, headers });
  const body = await request.text();
  if (body.length > 256)
    return new Response("请求格式无效", { status: 400, headers });
  const fields = new URLSearchParams(body);
  if (fields.get("List-Unsubscribe") !== "One-Click")
    return new Response("请求格式无效", { status: 400, headers });
  const { token } = await context.params;
  const result = await applyUnsubscribe(token, "one_click");
  if (!result.ok)
    return new Response(
      result.reason === "invalid" ? "退订链接无效" : "暂时无法处理",
      {
        status: result.reason === "invalid" ? 404 : 503,
        headers,
      },
    );
  return new Response("", { status: 200, headers });
}
