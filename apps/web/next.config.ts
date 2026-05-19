import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@webtesting/db", "@webtesting/ai"],
};

export default nextConfig;
