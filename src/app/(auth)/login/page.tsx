import { AuthForm } from "@/components/auth-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <AuthForm
      mode="login"
      nextPath={next}
      callbackError={
        error ? "验证链接无效或已过期，请重新登录或申请验证邮件。" : undefined
      }
    />
  );
}
