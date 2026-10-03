/** Kept free of Three.js so invalid sources don't load the WebGL bundle. */
export type ModelPreviewIssue = "missing" | "unsupported" | "load" | "webgl";

/** Accept local paths or HTTP(S) GLB/GLTF URLs, including query strings. */
export function getModelSourceIssue(
  src: string | undefined,
): "missing" | "unsupported" | null {
  if (!src?.trim()) return "missing";

  try {
    const url = new URL(src.trim(), "https://devkitcat.invalid/");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !/\.(glb|gltf)$/i.test(url.pathname)
    ) {
      return "unsupported";
    }
    return null;
  } catch {
    return "unsupported";
  }
}
