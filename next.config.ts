import type { NextConfig } from "next";

// GitHub Pages project sites are served at /<repo> on github.io, but custom domains
// (e.g. flagelladb.org) are served from the domain root. Use an empty basePath so
// assets resolve correctly on the custom domain.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  basePath,
  assetPrefix: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath
  }
};

export default nextConfig;
