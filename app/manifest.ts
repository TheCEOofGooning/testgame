import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MOTHLIGHT",
    short_name: "MOTHLIGHT",
    description: "Guide the light. The moth will follow. A new night garden every day.",
    start_url: "/",
    display: "fullscreen",
    orientation: "any",
    background_color: "#04060c",
    theme_color: "#04060c",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icon", sizes: "256x256", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
