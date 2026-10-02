import { dailySeed } from "@/game/rng";
import { hasDb, insertFlight } from "@/lib/db";
import { validateSubmission } from "@/lib/validate";

// Node runtime on Vercel Fluid compute: cold starts are ~0 and the Neon
// HTTP driver reuses the fetch keep-alive pool between invocations.
export const dynamic = "force-dynamic";

function yesterdaySeed(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return dailySeed(d);
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // Accept yesterday too: a run started just before UTC midnight is still
  // a real flight and shouldn't be thrown away.
  const check = validateSubmission(body, [dailySeed(), yesterdaySeed()]);
  if (!check.ok) {
    return Response.json({ ok: false, error: check.error }, { status: 400 });
  }
  const f = check.value;

  if (!hasDb) {
    return Response.json({ ok: true, offline: true, rank: 1, total: 1 });
  }

  try {
    const id = crypto.randomUUID();
    const { rank, total } = await insertFlight({
      id,
      seed: f.seed,
      player: f.player,
      name: f.name,
      score: f.score,
      metres: f.metres,
      pollen: f.pollen,
      blooms: f.blooms,
      bestCombo: f.bestCombo,
      duration: f.duration,
      replay: f.replay || null,
    });
    return Response.json({ ok: true, offline: false, id, rank, total });
  } catch (err) {
    console.error("submit", err);
    return Response.json(
      { ok: true, offline: true, rank: 0, total: 0, error: "garden unreachable" },
      { status: 200 },
    );
  }
}
