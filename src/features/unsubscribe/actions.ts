"use server";
import { applyUnsubscribe } from "./service";

export type UnsubscribeActionState = {
  status: "idle" | "success" | "invalid" | "unavailable";
  workspaceName?: string;
  maskedEmail?: string;
};

export async function confirmUnsubscribe(
  _previous: UnsubscribeActionState,
  formData: FormData,
): Promise<UnsubscribeActionState> {
  const token = formData.get("token");
  if (typeof token !== "string") return { status: "invalid" };
  const result = await applyUnsubscribe(token, "public_page");
  if (!result.ok) return { status: result.reason };
  return {
    status: "success",
    workspaceName: result.data.workspace_name,
    maskedEmail: result.data.masked_email,
  };
}
