import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@webtesting/db", "@webtesting/ai"],
  // esbuild ships a native binary and webpack chokes trying to bundle it.
  // It's used server-side only, to syntax-check hand-written specs.
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
