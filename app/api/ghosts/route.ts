import { dailySeed } from "@/game/rng";
import { ghostsFor, hasDb } from "@/lib/db";

// Node runtime on Vercel Fluid compute: cold starts are ~0 and the Neon
// HTTP driver reuses the fetch keep-alive pool between invocations.
export const dynamic = "force-dynamic";

/**
 * The flights you'll share the sky with tonight. Each one is a few kilobytes
 * of delta-encoded positions — the entire "multiplayer netcode" is this one
 * GET, fetched once before you launch.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const seed = url.searchParams.get("seed") || dailySeed();

  if (!hasDb) return Response.json({ seed, ghosts: [] });

  try {
    const ghosts = await ghostsFor(seed, 6);
    return Response.json(
      { seed, ghosts },
      {
        headers: {
          "cache-control": "public, s-maxage=20, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    console.error("ghosts", err);
    return Response.json({ seed, ghosts: [] });
  }
}
