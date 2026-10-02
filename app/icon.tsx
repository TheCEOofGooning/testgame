import { ImageResponse } from "next/og";

export const size = { width: 256, height: 256 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at 50% 42%, #1a2740 0%, #05070e 70%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 190,
            height: 190,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(255,214,140,0.55) 0%, rgba(255,214,140,0) 70%)",
            display: "flex",
          }}
        />
        <div
          style={{
            width: 78,
            height: 78,
            borderRadius: 999,
            background: "linear-gradient(180deg, #fff6e0, #ffd083)",
            boxShadow: "0 0 60px rgba(255,210,130,0.9)",
            display: "flex",
          }}
        />
      </div>
    ),
    size,
  );
}
