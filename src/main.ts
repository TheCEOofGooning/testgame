import { boot } from "./ui";

/**
 * Entry point. The markup is already on screen by the time this runs, so
 * there is nothing to render — just behaviour to attach.
 */
try {
  boot();
} catch (err) {
  console.error("MOTHLIGHT failed to start", err);
  const fallback = document.getElementById("boot-error");
  if (fallback) fallback.hidden = false;
}
