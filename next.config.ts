import type { NextConfig } from "next";

/**
 * Next.js earns its place here for three things only: the API routes, the
 * generated OG image, and the Vercel deploy pipeline. The game itself is a
 * static document built by `scripts/build-client.mjs` and served from
 * /public, which is why the first load is ~23 KB instead of ~200 KB.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // the sandbox preview and Vercel previews proxy the dev server
  allowedDevOrigins: ["*.e2b.app", "*.vercel.app"],

  async rewrites() {
    return [
      { source: "/", destination: "/play.html" },
      { source: "/play", destination: "/play.html" },
    ];
  },

  async headers() {
    return [
      {
        // content-hashed bundle + subsetted fonts: cache them forever
        source: "/assets/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/play.html",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
