/** 将 Supabase Auth 错误码映射为面向用户的中文文案。 */
export function mapAuthError(error: unknown): {
  message: string;
  canResendVerification: boolean;
} {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";

  switch (code) {
    case "invalid_credentials":
      return {
        message: "邮箱或密码不正确，请检查后重试。",
        canResendVerification: false,
      };
    case "email_not_confirmed":
      return {
        message: "邮箱尚未验证，请先完成验证后再登录。",
        canResendVerification: true,
      };
    case "over_request_rate_limit":
      return {
        message: "操作过于频繁，请稍后再试。",
        canResendVerification: false,
      };
    default:
      return {
        message: "操作未完成，请检查输入或稍后重试。",
        canResendVerification: false,
      };
  }
}
