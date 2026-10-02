import { ImageResponse } from "next/og";
import { dailySeed } from "@/game/rng";

export const alt = "MOTHLIGHT — guide the light, the moth will follow";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card. Regenerated each night so a link always shows the
 *  current garden's number — the thing that makes people click. */
export default async function OpenGraphImage() {
  const seed = dailySeed();
  const [y, m, d] = seed.split("-").map(Number);
  const night =
    Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000) + 1;
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(170deg, #0d1a2b 0%, #070b16 55%, #140f1e 100%)",
          position: "relative",
          fontFamily: "serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 760,
            height: 760,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(255,213,138,0.26) 0%, rgba(255,213,138,0.07) 38%, rgba(255,213,138,0) 68%)",
            top: -120,
            left: 220,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 180,
            background:
              "linear-gradient(to top, rgba(255,160,90,0.34), rgba(255,160,90,0))",
            display: "flex",
          }}
        />

        <div
          style={{
            fontSize: 94,
            letterSpacing: 18,
            color: "#ffe9bd",
            display: "flex",
          }}
        >
          MOTHLIGHT
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 34,
            fontStyle: "italic",
            color: "#9fb4d6",
            display: "flex",
          }}
        >
          Guide the light. The moth will follow.
        </div>

        <div
          style={{
            marginTop: 54,
            display: "flex",
            gap: 18,
            alignItems: "center",
            padding: "16px 34px",
            borderRadius: 999,
            border: "1px solid rgba(255,220,160,0.28)",
            background: "rgba(255,220,160,0.07)",
            color: "#ffd98a",
            fontSize: 28,
            letterSpacing: 2,
          }}
        >
          <span style={{ display: "flex" }}>NIGHT {night}</span>
          <span style={{ display: "flex", opacity: 0.4 }}>·</span>
          <span style={{ display: "flex" }}>{date.toUpperCase()}</span>
        </div>

        <div
          style={{
            marginTop: 44,
            fontSize: 24,
            color: "#7e92b4",
            display: "flex",
          }}
        >
          one garden a night · the same for everyone · no download
        </div>
      </div>
    ),
    size,
  );
}
