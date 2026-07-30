import type { NextConfig } from "next";

const sessionClientHints = [
  {
    key: "Accept-CH",
    value: [
      "Sec-CH-UA-Full-Version-List",
      "Sec-CH-UA-Platform-Version",
      "Sec-CH-UA-Model",
      "Sec-CH-UA-Arch",
      "Sec-CH-UA-Bitness",
    ].join(", "),
  },
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/login",
        headers: sessionClientHints,
      },
      {
        source: "/api/auth/:path*",
        headers: sessionClientHints,
      },
    ];
  },
  experimental: {
    authInterrupts: true,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
