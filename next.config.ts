import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    authInterrupts: true,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
