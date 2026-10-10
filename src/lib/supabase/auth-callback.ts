/**
 * 邮件链接回调分流。
 *
 * 注册确认模板当前写死 ContentUp 的 /auth/confirm?type=email。
 * 重置密码、魔法链接、邀请、更改邮箱仍使用 ConfirmationURL（code）。
 * 模板切换后，注册（type=email，兼容 signup）和重置密码（type=recovery）
 * 会先到 ContentUp /auth/confirm，再把 token_hash 与 type 转到本站
 * /auth/callback（保留其 ?next=）。本站 verifyOtp，会话写在 EDM。
 * Google 以及仍使用 ConfirmationURL 的模板继续走 code。
 */

const tokenHashOtpTypes = ["email", "signup", "recovery"] as const;

export type TokenHashOtpType = (typeof tokenHashOtpTypes)[number];

export function isTokenHashOtpType(
  value: string | null,
): value is TokenHashOtpType {
  return tokenHashOtpTypes.some((type) => type === value);
}

/**
 * 与现有 code 回调相同：只放行重置密码和邀请路径，其余回到引导页。
 * 不以 next 接受外站地址。
 */
export function safeAuthNext(requestedNext: string | null): string {
  if (
    requestedNext === "/reset-password" ||
    (requestedNext !== null && requestedNext.startsWith("/invite/"))
  ) {
    return requestedNext;
  }
  return "/onboarding";
}

export type AuthCallbackPlan =
  | {
      kind: "otp";
      type: TokenHashOtpType;
      tokenHash: string;
      destination: string;
    }
  | { kind: "code"; code: string; destination: string }
  | { kind: "error" };

export function planAuthCallback(input: {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  next: string | null;
}): AuthCallbackPlan {
  const destination = safeAuthNext(input.next);
  const tokenHash = input.tokenHash?.trim() ?? "";
  const type = input.type?.trim() ?? "";
  if (tokenHash && isTokenHashOtpType(type)) {
    return {
      kind: "otp",
      type,
      tokenHash,
      destination: type === "recovery" ? "/reset-password" : destination,
    };
  }
  if (input.code) return { kind: "code", code: input.code, destination };
  return { kind: "error" };
}

const callbackErrorPath = "/login?error=callback";

export async function completeAuthCallback(
  plan: AuthCallbackPlan,
  auth: {
    verifyOtp: (params: {
      type: TokenHashOtpType;
      token_hash: string;
    }) => Promise<{ error: unknown }>;
    exchangeCodeForSession: (code: string) => Promise<{ error: unknown }>;
  },
): Promise<string> {
  if (plan.kind === "otp") {
    const { error } = await auth.verifyOtp({
      type: plan.type,
      token_hash: plan.tokenHash,
    });
    if (error) return callbackErrorPath;
    return plan.destination;
  }
  if (plan.kind === "code") {
    const { error } = await auth.exchangeCodeForSession(plan.code);
    if (!error) return plan.destination;
  }
  return callbackErrorPath;
}
