import type { DeliveryFailure } from "../types.ts";

function safeCode(error: unknown) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    statusCode?: unknown;
  };
  const source =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.name === "string"
        ? candidate.name
        : typeof candidate.statusCode === "number"
          ? `HTTP_${candidate.statusCode}`
          : "UNKNOWN";
  return source.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 100) || "UNKNOWN";
}

export function classifyDirectMailError(error: unknown): DeliveryFailure {
  const code = safeCode(error);
  const normalized = code.toLowerCase();
  if (
    /invalidaccesskey|signature|forbidden|unauthorized|authentication/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "authentication",
      error_code: code,
    };
  if (
    /account|sender|mailfrom|domain|reply|parameter|invalid.*address|credential|keyring|region|unsubscribe|site_url|tag|trace|tracking/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "configuration",
      error_code: code,
    };
  if (/throttl|ratelimit|quota|frequency/.test(normalized))
    return { status: "failed", error_category: "rate_limit", error_code: code };
  if (/timeout|network|socket|connection|abort/.test(normalized))
    return { status: "unknown", error_category: "unknown", error_code: code };
  if (/internal|serviceunavailable|temporar|http_5/.test(normalized))
    return { status: "failed", error_category: "temporary", error_code: code };
  if (/invalid|rejected|denied|unsupported/.test(normalized))
    return { status: "failed", error_category: "permanent", error_code: code };
  return { status: "failed", error_category: "unknown", error_code: code };
}
