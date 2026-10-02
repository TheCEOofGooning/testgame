import type { Metadata, Viewport } from "next";

/**
 * This layout only exists to satisfy the App Router for the API routes and
 * the generated image routes. The game page itself is a hand-built static
 * document (`public/play.html`) and never passes through React.
 */

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "MOTHLIGHT",
  description: "Guide the light. The moth will follow.",
};

export const viewport: Viewport = { themeColor: "#04060c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
