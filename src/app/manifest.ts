import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Foodtopia — Shared Food Inventory",
    short_name: "Foodtopia",
    description:
      "Photograph groceries, keep a shared inventory, and cook from what you have.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f3e9",
    theme_color: "#f7f3e9",
    categories: ["food", "lifestyle", "utilities"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
