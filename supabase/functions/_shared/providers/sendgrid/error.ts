import type { DeliveryFailure } from "../types.ts";

type SendGridHttpError = {
  name: "SendGridHttpError";
  status: number;
  code?: string;
};

export function sendGridHttpError(
  status: number,
  code?: string,
): SendGridHttpError {
  return { name: "SendGridHttpError", status, code };
}

function safeCode(error: unknown) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (
    candidate.name === "SendGridHttpError" &&
    typeof candidate.status === "number"
  )
    return candidate.code
      ? `HTTP_${candidate.status}_${String(candidate.code)
          .replace(/[^A-Za-z0-9._:-]/g, "_")
          .slice(0, 80)}`
      : `HTTP_${candidate.status}`;
  const source =
    typeof candidate.name === "string"
      ? candidate.name
      : typeof candidate.code === "string"
        ? candidate.code
        : typeof candidate.message === "string"
          ? candidate.message
          : "UNKNOWN";
  return source.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 100) || "UNKNOWN";
}

export function classifySendGridError(error: unknown): DeliveryFailure {
  const code = safeCode(error);
  const normalized = code.toLowerCase();
  if (
    /credential_keyring|credential_decrypt|credential_payload|credential_version|sendgrid_api_host|tracking_html|header_invalid|provider_receipt/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "configuration",
      error_code: code,
    };
  if (/http_401|http_403|unauthorized|forbidden/.test(normalized))
    return {
      status: "failed",
      error_category: "authentication",
      error_code: code,
    };
  if (
    /http_400|http_413|http_422|bad.request|invalid|configuration/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "configuration",
      error_code: code,
    };
  if (/http_429|rate|limit|too_many/.test(normalized))
    return { status: "failed", error_category: "rate_limit", error_code: code };
  if (/timeout|network|socket|connection|abort|requestaborted/.test(normalized))
    return { status: "unknown", error_category: "unknown", error_code: code };
  if (/http_5|service|unavailable|temporary/.test(normalized))
    return { status: "failed", error_category: "temporary", error_code: code };
  if (/http_4|reject|blocked|bounce|permanent/.test(normalized))
    return { status: "failed", error_category: "permanent", error_code: code };
  return { status: "failed", error_category: "unknown", error_code: code };
}
