import type { NextConfig } from "next";
const privateLinkHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/unsubscribe/:path*", headers: privateLinkHeaders },
      { source: "/api/unsubscribe/:path*", headers: privateLinkHeaders },
    ];
  },
};
export default config;
