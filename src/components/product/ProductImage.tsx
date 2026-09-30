"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import styles from "./ProductImage.module.css";

interface ProductImageProps {
  src: string;
  alt: string;
  /** Rendered instead of the image if it fails to load. */
  fallback: ReactNode;
  /** Responsive `sizes` hint for the image. */
  sizes: string;
  priority?: boolean;
}

type LoadState = { src: string; status: "loaded" | "error" };

/**
 * Product image with a loading skeleton and a graceful failure state.
 * Falls back to the provided placeholder artwork when the image can't load.
 */
export function ProductImage({
  src,
  alt,
  fallback,
  sizes,
  priority = false,
}: ProductImageProps) {
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  // Only trust the recorded state if it belongs to the current `src`.
  const status = loadState?.src === src ? loadState.status : "loading";

  if (status === "error") return <>{fallback}</>;

  return (
    <div className={styles.frame} data-status={status}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className={styles.image}
        onLoad={() => setLoadState({ src, status: "loaded" })}
        onError={() => setLoadState({ src, status: "error" })}
      />
    </div>
  );
}
