"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { GalleryStage } from "@/components/product/gallery/GalleryStage";
import { GalleryThumb } from "@/components/product/gallery/GalleryThumb";
import type { GalleryItem } from "@/lib/gallery";
import styles from "./ProductGallery.module.css";

interface ProductGalleryProps {
  items: GalleryItem[];
  /** Product name, used in accessible labels. */
  title: string;
}

/**
 * Product gallery: one main preview plus thumbnails to choose between items.
 * It only knows about `GalleryItem`s — how each kind is drawn lives in
 * `GalleryStage` / `GalleryThumb`, which is where new media types plug in.
 */
export function ProductGallery({ items, title }: ProductGalleryProps) {
  const [selectedId, setSelectedId] = useState(items[0]?.id);
  const thumbsRef = useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(
    items.findIndex((item) => item.id === selectedId),
    0,
  );
  const selected = items[selectedIndex];
  if (!selected) return null;

  const hasMultiple = items.length > 1;

  function select(index: number, moveFocus = false) {
    const item = items[index];
    if (!item) return;
    setSelectedId(item.id);
    if (moveFocus) {
      thumbsRef.current
        ?.querySelectorAll<HTMLButtonElement>("button")
        [index]?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = items.length - 1;
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(selectedIndex + 1, last)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(selectedIndex - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  }

  return (
    <section className={styles.gallery} aria-label={`${title} gallery`}>
      <GalleryStage item={selected} priority={selectedIndex === 0} />

      {hasMultiple ? (
        <>
          <div
            ref={thumbsRef}
            className={styles.thumbs}
            role="group"
            aria-label="Choose a preview"
            onKeyDown={onKeyDown}
          >
            {items.map((item, index) => (
              <GalleryThumb
                key={item.id}
                item={item}
                position={index + 1}
                total={items.length}
                selected={item.id === selected.id}
                onSelect={() => select(index)}
              />
            ))}
          </div>
          <p className="sr-only" role="status">
            Showing preview {selectedIndex + 1} of {items.length}
          </p>
        </>
      ) : null}
    </section>
  );
}
