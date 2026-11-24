import { getRequestConfig } from "next-intl/server";
import { resolveRequestLocale } from "./locale";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  const messages = await loadMessages(locale);
  return {
    locale,
    messages,
  };
});
