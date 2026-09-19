function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return json({ error: "工作进程配置不完整" }, 500);
  // 兼容旧 cron 或人工调用；实际领取与分发统一由新 worker 完成。
  return fetch(`${supabaseUrl}/functions/v1/edm-delivery-worker`, {
    method: request.method,
    headers: {
      "content-type": "application/json",
      "x-edm-worker-token": request.headers.get("x-edm-worker-token") ?? "",
    },
    body: request.method === "POST" ? await request.text() : undefined,
    redirect: "error",
  });
});
