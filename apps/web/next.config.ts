import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` both write to .next by default, so building
  // while a dev server is up overwrites the chunks that server is handing to
  // the browser. The page still renders — it is server-rendered — but React
  // can't hydrate, so nothing on it responds to a click. Builds therefore get
  // their own directory (see the `build` script).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@webtesting/db", "@webtesting/ai"],
  // esbuild ships a native binary and webpack chokes trying to bundle it.
  // It's used server-side only, to syntax-check hand-written specs.
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
