import type { Product } from "@/types";
import { filterAndSortProducts } from "@/lib/catalog";
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
    overview: [
      "ProSave wraps Roblox DataStores in a single, predictable API. Load a player's profile once, work with it in memory, and let ProSave handle saving, retries, and shutdown flushing.",
      "Session locking keeps a profile owned by one server at a time, so rapid server hops do not overwrite progress. Requests are throttled and queued to stay inside DataStore limits.",
    ],
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
    installation: [
      "Open your place in Roblox Studio and insert the ProSave ModuleScript into ServerScriptService.",
      "Copy DefaultConfig next to it and adjust the store name, retry limits, and autosave interval.",
      "Require ProSave from a server Script and load a profile when a player joins.",
      "Release the profile when the player leaves, then test in Studio with the example place file.",
    ],
    documentation: {
      summary:
        "Documentation.md covers setup, the full API surface, and how to extend the default data schema.",
      topics: [
        "Quick start",
        "Configuration reference",
        "Session locking explained",
        "Extending your data schema",
      ],
    },
    changelog: [
      {
        version: "1.4.2",
        date: "2026-08-14",
        notes:
          "Improved retry backoff and fixed cache flush ordering on shutdown.",
      },
    ],
    license: "devKitCat Standard License",
    releasedAt: "2026-03-12",
    isFeatured: true,
    isNew: false,
  },
  {
    id: "roblox-ui-starter-kit",
    title: "Roblox UI Starter Kit",
    slug: "roblox-ui-starter-kit",
    description:
      "A clean, consistent interface kit with menus, buttons, dialogs, and HUD components styled for modern Roblox experiences.",
    overview: [
      "The UI Starter Kit gives you a consistent visual foundation for menus, dialogs, and HUDs, so you spend less time on layout and more on gameplay.",
      "Every component reads from a shared theme module. Change a color, spacing value, or font once and the whole interface follows, in both light and dark variants.",
    ],
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
    installation: [
      "Open your place in Roblox Studio and import UIStarterKit.rbxm.",
      "Move the theme tokens module into ReplicatedStorage so client scripts can read it.",
      "Drag the components you need from the kit into StarterGui.",
      "Open the component reference place to see each component in context and copy usage patterns.",
    ],
    documentation: {
      summary:
        "Documentation.md lists every component, its properties, and how to customize the theme tokens.",
      topics: [
        "Importing the kit",
        "Theme tokens",
        "Component reference",
        "Responsive layout tips",
      ],
    },
    changelog: [
      {
        version: "2.1.0",
        date: "2026-07-02",
        notes: "Added dialog components and reworked the spacing scale.",
      },
    ],
    license: "devKitCat Standard License",
    releasedAt: "2026-02-20",
    isFeatured: true,
    isNew: false,
  },
  {
    id: "simulator-starter-kit",
    title: "Simulator Starter Kit",
    slug: "simulator-starter-kit",
    description:
      "A complete simulator foundation with currency, upgrades, rebirths, and shops wired together, so you can focus on your own twist.",
    overview: [
      "The Simulator Starter Kit connects the core loop most simulators share: earn currency, buy upgrades, rebirth, and repeat. The pieces are already wired together and ready to tune.",
      "The source is commented Luau organized into small modules, so you can swap in your own content, rebalance progression, and add systems without untangling the foundation.",
    ],
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
    installation: [
      "Open a new place in Roblox Studio and import SimulatorKit.rbxm.",
      "Move the server and client modules to the locations described in Documentation.md.",
      "Adjust the currency, upgrade, and rebirth values in the config modules.",
      "Press Play in Studio to test the loop, then replace the placeholder content with your own.",
    ],
    documentation: {
      summary:
        "Documentation.md walks through the project layout, each system, and how to tune progression.",
      topics: [
        "Project layout",
        "Currency and shops",
        "Upgrades and rebirths",
        "Tuning progression",
      ],
    },
    changelog: [
      {
        version: "1.2.0",
        date: "2026-09-08",
        notes: "Refactored shop controllers and documented the rebirth flow.",
      },
    ],
    license: "devKitCat Standard License",
    releasedAt: "2026-08-20",
    isFeatured: true,
    isNew: true,
  },
  {
    id: "cozy-furniture-pack",
    title: "Cozy Furniture Pack",
    slug: "cozy-furniture-pack",
    description:
      "A set of warm, stylized furniture models — sofas, shelves, tables, and decor — optimized for cozy interiors.",
    overview: [
      "Cozy Furniture Pack is a set of stylized interior pieces built for warm, lived-in spaces: sofas, shelves, tables, and small decor items.",
      "Models use low part counts and clean topology, with textures applied through organized material slots, so a furnished room stays light on performance.",
    ],
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
    includedFiles: ["CozyFurniture.rbxm", "Texture assets", "Documentation.md"],
    installation: [
      "Open your place in Roblox Studio and import CozyFurniture.rbxm.",
      "Upload the included texture assets to your own account if you want to customize them.",
      "Drag models from the imported folder into your scene and arrange them.",
      "Use the named hierarchy in the Explorer to find and swap individual pieces.",
    ],
    documentation: {
      summary:
        "Documentation.md describes the model hierarchy, material slots, and texture usage.",
      topics: ["Model hierarchy", "Material slots", "Texture usage"],
    },
    changelog: [
      {
        version: "1.0.3",
        date: "2026-06-19",
        notes: "Reduced part counts on larger pieces and fixed material slots.",
      },
    ],
    license: "devKitCat Standard License",
    releasedAt: "2026-04-10",
    isFeatured: false,
    isNew: false,
  },
  {
    id: "camping-props-pack",
    title: "Camping Props Pack",
    slug: "camping-props-pack",
    description:
      "Tents, campfires, lanterns, and outdoor props for building convincing campsites and wilderness scenes.",
    overview: [
      "Camping Props Pack covers the essentials of an outdoor scene: tents, campfires, lanterns, and the small props that make a campsite feel used.",
      "Props are tuned for performance, and fires and lanterns use emissive materials so they read well at night without extra lighting setup.",
    ],
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
    installation: [
      "Open your place in Roblox Studio and import CampingProps.rbxm.",
      "Upload the included texture assets if you want to customize them.",
      "Place tents and props in your scene using the named hierarchy in the Explorer.",
      "Adjust the emissive materials on fires and lanterns to match your lighting.",
    ],
    documentation: {
      summary:
        "Documentation.md lists every prop, its materials, and tips for lighting a campsite.",
      topics: ["Prop list", "Emissive materials", "Lighting tips"],
    },
    changelog: [
      {
        version: "1.1.0",
        date: "2026-07-25",
        notes: "Added two tent variants and improved emissive materials.",
      },
    ],
    license: "devKitCat Standard License",
    releasedAt: "2026-07-10",
    isFeatured: false,
    isNew: true,
  },
  {
    id: "vfx-starter-pack",
    title: "VFX Starter Pack",
    slug: "vfx-starter-pack",
    description:
      "Particle effects for hits, pickups, ambience, and transitions, with tunable emitters and ready-made effect modules.",
    overview: [
      "VFX Starter Pack collects the effects most games need first: hits, pickups, ambient particles, and screen transitions.",
      "Each effect ships as a tunable emitter setup with a small Luau module to trigger it, and the showcase place lets you preview everything in context before wiring it in.",
    ],
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
    installation: [
      "Open your place in Roblox Studio and import VFXStarterPack.rbxm.",
      "Place the effect modules in ReplicatedStorage so both client and server scripts can use them.",
      "Require a module and call its play function where the effect should appear.",
      "Open the showcase place to preview each effect and adjust its parameters.",
    ],
    documentation: {
      summary:
        "Documentation.md explains each effect module, its parameters, and how to manage particle budgets.",
      topics: [
        "Effect module API",
        "Tunable parameters",
        "Particle budgets",
        "Showcase place",
      ],
    },
    changelog: [
      {
        version: "1.3.1",
        date: "2026-08-30",
        notes: "Tuned emitter lifetimes and added transition presets.",
      },
    ],
    license: "devKitCat Standard License",
    releasedAt: "2026-08-05",
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

export interface RelatedProducts {
  items: MockProduct[];
  /** True when at least one item shares the product's category. */
  sameCategory: boolean;
}

/**
 * Related products for a detail page: same-category products first, topped up
 * from the rest of the catalog (featured, then newest) if there are fewer than
 * `limit`. The product itself is never included. No popularity data involved.
 */
export function getRelatedProducts(
  product: Pick<Product, "id" | "category">,
  limit = 3,
): RelatedProducts {
  const others = products.filter((item) => item.id !== product.id);
  const sameCategory = filterAndSortProducts(
    others.filter((item) => item.category === product.category),
    { query: "", category: undefined, sort: "featured" },
  );
  const rest = others
    .filter((item) => item.category !== product.category)
    .sort(
      (a, b) =>
        Number(b.isFeatured) - Number(a.isFeatured) ||
        b.releasedAt.localeCompare(a.releasedAt),
    );

  return {
    items: [...sameCategory, ...rest].slice(0, limit),
    sameCategory: sameCategory.length > 0,
  };
}
