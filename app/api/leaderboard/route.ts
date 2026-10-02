import { dailySeed } from "@/game/rng";
import { hasDb, leaderboard } from "@/lib/db";

// Node runtime on Vercel Fluid compute: cold starts are ~0 and the Neon
// HTTP driver reuses the fetch keep-alive pool between invocations.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const seed = url.searchParams.get("seed") || dailySeed();

  if (!hasDb) {
    return Response.json(
      { seed, offline: true, rows: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const rows = await leaderboard(seed, 25);
    return Response.json(
      { seed, offline: false, rows },
      {
        headers: {
          // One shared cached copy per 10s is plenty for a nightly board and
          // keeps Neon usage near zero under a traffic spike.
          "cache-control": "public, s-maxage=10, stale-while-revalidate=50",
        },
      },
    );
  } catch (err) {
    console.error("leaderboard", err);
    return Response.json(
      { seed, offline: true, rows: [], error: "garden unreachable" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
}
