import type { Metadata } from "next";
import "@fontsource/fraunces/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { Providers } from "@/components/providers";
export const metadata: Metadata = {
  title: { default: "卖家邮局", template: "%s · 卖家邮局" },
  description: "为每一次客户联络，准备一封好邮件。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
