import type { Category } from "@/types";

/**
 * The eight product categories for the marketplace.
 * Static mock data — no backend persistence in this PR.
 */
export const categories = [
  {
    id: "systems",
    name: "Systems",
    slug: "systems",
    description: "Core gameplay and infrastructure systems, ready to drop in.",
    icon: "systems",
  },
  {
    id: "ui-kits",
    name: "UI Kits",
    slug: "ui-kits",
    description:
      "Production-quality interface kits for menus, HUDs, and overlays.",
    icon: "ui-kits",
  },
  {
    id: "3d-assets",
    name: "3D Assets",
    slug: "3d-assets",
    description: "Optimized models and props for building worlds faster.",
    icon: "3d-assets",
  },
  {
    id: "vfx",
    name: "VFX",
    slug: "vfx",
    description: "Polished effects for hits, ambience, and transitions.",
    icon: "vfx",
  },
  {
    id: "audio",
    name: "Audio",
    slug: "audio",
    description: "Sound packs and music for immersive experiences.",
    icon: "audio",
  },
  {
    id: "developer-tools",
    name: "Developer Tools",
    slug: "developer-tools",
    description: "Studio tools and utilities that speed up your workflow.",
    icon: "developer-tools",
  },
  {
    id: "templates",
    name: "Templates",
    slug: "templates",
    description: "Starter projects and scaffolds for common Roblox patterns.",
    icon: "templates",
  },
  {
    id: "complete-kits",
    name: "Complete Kits",
    slug: "complete-kits",
    description: "Full feature bundles that get a game mode started.",
    icon: "complete-kits",
  },
] as const satisfies readonly Category[];

/** Union of all category slugs, derived from the data above. */
export type CategorySlug = (typeof categories)[number]["slug"];

export function getCategoryBySlug(slug: string): Category | undefined {
  return categories.find((category) => category.slug === slug);
}
