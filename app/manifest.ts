import type { MetadataRoute } from "next";

/**
 * PWA manifest. Renders to /manifest.webmanifest at build time. Lets users
 * install the dashboard to their phone home screen via Safari "Add to Home
 * Screen" or Chrome "Install App". Once installed, opens fullscreen with
 * no browser chrome — looks/feels like a native app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Colour Craft — Production",
    short_name: "CC Production",
    description:
      "Production schedule and pipeline for Colour Craft Painting (Richmond / Delta).",
    start_url: "/production",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#FAF7F2", // CC cream — matches icon background
    theme_color: "#0F2D4A", // CC navy — status bar tint
    icons: [
      {
        src: "/icons/cc-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/cc-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/cc-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["business", "productivity"],
  };
}
