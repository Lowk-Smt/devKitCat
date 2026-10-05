import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CATEGORY_HREF = "/#categories";

async function readSource(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("fragment links use one native anchor instead of client-side hash routing", async () => {
  const [appLink, header, footer, button] = await Promise.all([
    readSource("../src/components/ui/AppLink.tsx"),
    readSource("../src/components/layout/Header.tsx"),
    readSource("../src/components/layout/Footer.tsx"),
    readSource("../src/components/ui/Button.tsx"),
  ]);

  assert.match(
    appLink,
    /if \(href\.includes\("#"\)\)\s*\{\s*return <a href=\{href\} \{\.\.\.props\} \/>;\s*\}/,
  );
  assert.match(appLink, /return <Link href=\{href\} \{\.\.\.props\} \/>;/);
  assert.doesNotMatch(
    appLink,
    /location\.hash|history\.(?:pushState|replaceState)|router\.(?:push|replace)/,
  );

  for (const source of [header, footer, button]) {
    assert.match(source, /import \{ AppLink \} from "@\/components\/ui\/AppLink"/);
    assert.doesNotMatch(source, /import Link from "next\/link"|<Link\b/);
  }
});

test("all homepage Categories links resolve to exactly /#categories", async () => {
  const [header, footer, hero, finalCta, section] = await Promise.all([
    readSource("../src/components/layout/Header.tsx"),
    readSource("../src/components/layout/Footer.tsx"),
    readSource("../src/components/sections/Hero.tsx"),
    readSource("../src/components/sections/FinalCta.tsx"),
    readSource("../src/components/sections/CategoriesSection.tsx"),
  ]);

  const destinations = [
    header.match(/\{ href: "([^"]+)", label: "Categories" \}/)?.[1],
    footer.match(/\{ href: "([^"]+)", label: "Categories" \}/)?.[1],
    hero.match(/<Button href="([^"]+)" variant="secondary">\s*Explore Categories/)?.[1],
    finalCta.match(/<Button href="([^"]+)" variant="secondary">\s*Explore Categories/)?.[1],
  ];

  assert.deepEqual(destinations, Array(4).fill(CATEGORY_HREF));
  assert.match(section, /id="categories"/);

  for (const currentUrl of [
    "https://devkitcat.vercel.app/",
    "https://devkitcat.vercel.app/products",
    "https://devkitcat.vercel.app/#categories",
    "https://devkitcat.vercel.app/#categories#categories",
  ]) {
    const resolved = new URL(CATEGORY_HREF, currentUrl);
    assert.equal(`${resolved.pathname}${resolved.search}${resolved.hash}`, CATEGORY_HREF);
  }
});
