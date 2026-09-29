import type { Product } from "@/types";
import type { CategorySlug } from "./categories";

interface MockProduct extends Omit<Product, "category"> {
  category: CategorySlug;
}

/**
 * Mock product catalog for the foundation release.
 * Local/static data only — no backend persistence in this PR.
 */
export const products: MockProduct[] = [
  {
    id: "prosave",
    title: "ProSave — DataStore System",
    slug: "prosave",
    description:
      "A production-ready data layer for Roblox with session locking, automatic retries, and request throttling so player progress stays safe.",
    category: "systems",
    price: 14.99,
    images: [],
    type: "system",
    version: "1.4.2",
    features: [
      "Session locking to prevent data conflicts across servers",
      "Automatic retries with exponential backoff",
      "Configurable caching to reduce DataStore requests",
      "Ordered data store support for leaderboards",
      "Clear extension points for your own data schemas",
    ],
    requirements: [
      "Roblox Studio (current release)",
      "Luau",
      "Basic understanding of ModuleScripts",
    ],
    includedFiles: [
      "ProSave (ModuleScript)",
      "DefaultConfig (ModuleScript)",
      "Example place file",
      "Documentation.md",
    ],
    changelog: [
      {
        version: "1.4.2",
        date: "2026-08-14",
        notes: "Improved retry backoff and fixed cache flush ordering on shutdown.",
      },
    ],
    license: "devKitCat Standard License",
    isFeatured: true,
    isNew: false,
  },
  {
    id: "roblox-ui-starter-kit",
    title: "Roblox UI Starter Kit",
    slug: "roblox-ui-starter-kit",
    description:
      "A clean, consistent interface kit with menus, buttons, dialogs, and HUD components styled for modern Roblox experiences.",
    category: "ui-kits",
    price: 9.99,
    images: [],
    type: "ui-kit",
    version: "2.1.0",
    features: [
      "Ready-to-use menus, buttons, dialogs, and HUD components",
      "Design tokens for color, spacing, and typography",
      "Responsive layouts that scale across screen sizes",
      "Light and dark theme variants",
    ],
    requirements: [
      "Roblox Studio (current release)",
      "No external plugins required",
    ],
    includedFiles: [
      "UIStarterKit.rbxm",
      "Theme tokens module",
      "Component reference place",
      "Documentation.md",
    ],
    changelog: [
      {
        version: "2.1.0",
        date: "2026-07-02",
        notes: "Added dialog components and reworked the spacing scale.",
      },
    ],
    license: "devKitCat Standard License",
    isFeatured: true,
    isNew: false,
  },
  {
    id: "simulator-starter-kit",
    title: "Simulator Starter Kit",
    slug: "simulator-starter-kit",
    description:
      "A complete simulator foundation with currency, upgrades, rebirths, and shops wired together, so you can focus on your own twist.",
    category: "complete-kits",
    price: 19.99,
    images: [],
    type: "starter-kit",
    version: "1.2.0",
    features: [
      "Currency, shop, and progression systems wired together",
      "Upgrade and rebirth loops ready to tune",
      "Data-ready controllers with clear extension points",
      "Clean, commented Luau source throughout",
    ],
    requirements: [
      "Roblox Studio (current release)",
      "Luau",
      "Familiarity with basic game loops",
    ],
    includedFiles: [
      "SimulatorKit.rbxm",
      "Source modules (Luau)",
      "Example place file",
      "Documentation.md",
    ],
    changelog: [
      {
        version: "1.2.0",
        date: "2026-09-08",
        notes: "Refactored shop controllers and documented the rebirth flow.",
      },
    ],
    license: "devKitCat Standard License",
    isFeatured: true,
    isNew: true,
  },
  {
    id: "cozy-furniture-pack",
    title: "Cozy Furniture Pack",
    slug: "cozy-furniture-pack",
    description:
      "A set of warm, stylized furniture models — sofas, shelves, tables, and decor — optimized for cozy interiors.",
    category: "3d-assets",
    price: 7.99,
    images: [],
    type: "model-pack",
    version: "1.0.3",
    features: [
      "Stylized sofas, tables, shelves, and decor pieces",
      "Low-poly models with clean topology",
      "PBR textures included",
      "Named and organized model hierarchy",
    ],
    requirements: ["Roblox Studio (current release)"],
    includedFiles: [
      "CozyFurniture.rbxm",
      "Texture assets",
      "Documentation.md",
    ],
    changelog: [
      {
        version: "1.0.3",
        date: "2026-06-19",
        notes: "Reduced part counts on larger pieces and fixed material slots.",
      },
    ],
    license: "devKitCat Standard License",
    isFeatured: false,
    isNew: false,
  },
  {
    id: "camping-props-pack",
    title: "Camping Props Pack",
    slug: "camping-props-pack",
    description:
      "Tents, campfires, lanterns, and outdoor props for building convincing campsites and wilderness scenes.",
    category: "3d-assets",
    price: 6.99,
    images: [],
    type: "model-pack",
    version: "1.1.0",
    features: [
      "Tents, campfires, lanterns, and campsite props",
      "Low-poly props tuned for performance",
      "Emissive materials for fires and lanterns",
      "Named and organized model hierarchy",
    ],
    requirements: ["Roblox Studio (current release)"],
    includedFiles: ["CampingProps.rbxm", "Texture assets", "Documentation.md"],
    changelog: [
      {
        version: "1.1.0",
        date: "2026-07-25",
        notes: "Added two tent variants and improved emissive materials.",
      },
    ],
    license: "devKitCat Standard License",
    isFeatured: false,
    isNew: true,
  },
  {
    id: "vfx-starter-pack",
    title: "VFX Starter Pack",
    slug: "vfx-starter-pack",
    description:
      "Particle effects for hits, pickups, ambience, and transitions, with tunable emitters and ready-made effect modules.",
    category: "vfx",
    price: 8.99,
    images: [],
    type: "vfx-pack",
    version: "1.3.1",
    features: [
      "Hit, pickup, ambience, and transition presets",
      "Effect modules with tunable parameters",
      "Optimized particle budgets for gameplay scenes",
      "Showcase place with every effect in context",
    ],
    requirements: [
      "Roblox Studio (current release)",
      "Basic Luau to wire effects into gameplay",
    ],
    includedFiles: [
      "VFXStarterPack.rbxm",
      "Effect modules (Luau)",
      "Showcase place",
      "Documentation.md",
    ],
    changelog: [
      {
        version: "1.3.1",
        date: "2026-08-30",
        notes: "Tuned emitter lifetimes and added transition presets.",
      },
    ],
    license: "devKitCat Standard License",
    isFeatured: false,
    isNew: true,
  },
];

export function getFeaturedProducts(): MockProduct[] {
  return products.filter((product) => product.isFeatured);
}

export function getProductsByCategory(slug: string): MockProduct[] {
  return products.filter((product) => product.category === slug);
}

export function getProductBySlug(slug: string): MockProduct | undefined {
  return products.find((product) => product.slug === slug);
}
