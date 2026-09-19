import type { DeliveryFailure } from "../types.ts";

function safeCode(error: unknown) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const source =
    typeof candidate.name === "string"
      ? candidate.name
      : typeof candidate.code === "string"
        ? candidate.code
        : typeof candidate.$metadata?.httpStatusCode === "number"
          ? `HTTP_${candidate.$metadata.httpStatusCode}`
          : "UNKNOWN";
  return source.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 100) || "UNKNOWN";
}

export function classifySesError(error: unknown): DeliveryFailure {
  const code = safeCode(error);
  const normalized = code.toLowerCase();
  if (
    /credential|unrecognizedclient|invalidsignature|accessdenied|unauthorized|expiredtoken/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "authentication",
      error_code: code,
    };
  if (
    /mailfromdomainnotverified|notfound|badrequest|sendingpaused|accountsuspended|configuration|region/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "configuration",
      error_code: code,
    };
  if (/toomanyrequests|limitexceeded|throttl|quota/.test(normalized))
    return { status: "failed", error_category: "rate_limit", error_code: code };
  if (/timeout|network|socket|connection|abort|requestaborted/.test(normalized))
    return { status: "unknown", error_category: "unknown", error_code: code };
  if (/serviceunavailable|internal|temporar|http_5/.test(normalized))
    return { status: "failed", error_category: "temporary", error_code: code };
  if (/messagerejected|rejected|invalid|unsupported/.test(normalized))
    return { status: "failed", error_category: "permanent", error_code: code };
  return { status: "failed", error_category: "unknown", error_code: code };
}
