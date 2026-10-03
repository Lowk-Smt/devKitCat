import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ModelPreviewIssue } from "@/lib/model-preview";
import styles from "./ModelViewer.module.css";

export type ViewerStatus = "loading" | "ready" | "error";

/** Shared footprint for module loading, invalid sources, and the live viewer. */
export function ViewerFrame({
  title,
  status,
  children,
}: {
  title: string;
  status: ViewerStatus;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.viewer}
      data-status={status}
      aria-label={`${title} 3D preview`}
      role="group"
    >
      <div className={styles.header}>
        <span className={styles.heading}>
          <Icon name="3d-assets" size={16} />
          3D preview
        </span>
        <span className={styles.badge}>
          {status === "ready" ? (
            <>
              <Icon name="check" size={12} /> Interactive
            </>
          ) : status === "error" ? (
            "Unavailable"
          ) : (
            "Preparing"
          )}
        </span>
      </div>
      {children}
    </div>
  );
}

const ISSUE_MESSAGES: Record<ModelPreviewIssue, string> = {
  missing: "A model preview hasn’t been provided for this item yet.",
  unsupported: "This preview format isn’t supported. Use a GLB or GLTF model.",
  load: "We couldn’t load this model. Check your connection and try again.",
  webgl:
    "3D rendering isn’t available right now. Try again or use a browser with WebGL enabled.",
};

export function ViewerMessage({
  issue,
  onRetry,
}: {
  issue?: ModelPreviewIssue;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.message} role={issue ? "alert" : "status"}>
      <span className={issue ? styles.messageIcon : styles.loader} aria-hidden>
        {issue ? <Icon name="3d-assets" size={24} /> : null}
      </span>
      <p className={styles.messageTitle}>
        {issue ? "3D preview unavailable" : "Loading 3D preview"}
      </p>
      <p className={styles.messageText}>
        {issue
          ? ISSUE_MESSAGES[issue]
          : "Getting the model and its materials ready…"}
      </p>
      {issue && onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          <Icon name="reuse" size={16} /> Try again
        </button>
      ) : null}
    </div>
  );
}

interface ViewerControlsProps {
  ready?: boolean;
  wireframe?: boolean;
  onRotate?: (direction: number) => void;
  onZoom?: (factor: number) => void;
  onReset?: () => void;
  onWireframe?: () => void;
}

export function ViewerControls({
  ready = false,
  wireframe = false,
  onRotate,
  onZoom,
  onReset,
  onWireframe,
}: ViewerControlsProps) {
  return (
    <div
      className={styles.toolbar}
      role="group"
      aria-label="3D preview controls"
    >
      <div className={styles.navigationControls}>
        <div className={styles.controlGroup} role="group" aria-label="Rotate">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rotate left"
            title="Rotate left"
            disabled={!ready}
            onClick={() => onRotate?.(-1)}
          >
            <Icon name="rotate-left" size={18} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Rotate right"
            title="Rotate right"
            disabled={!ready}
            onClick={() => onRotate?.(1)}
          >
            <Icon name="rotate-right" size={18} />
          </button>
        </div>
        <div className={styles.controlGroup} role="group" aria-label="Zoom">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Zoom out"
            title="Zoom out"
            disabled={!ready}
            onClick={() => onZoom?.(1.2)}
          >
            <Icon name="zoom-out" size={18} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Zoom in"
            title="Zoom in"
            disabled={!ready}
            onClick={() => onZoom?.(1 / 1.2)}
          >
            <Icon name="zoom-in" size={18} />
          </button>
        </div>
      </div>
      <div className={styles.viewControls}>
        <button
          type="button"
          className={styles.textButton}
          aria-label="Reset view"
          disabled={!ready}
          onClick={onReset}
        >
          <Icon name="reuse" size={16} /> Reset
        </button>
        <button
          type="button"
          className={styles.textButton}
          aria-label="Toggle wireframe"
          aria-pressed={wireframe}
          disabled={!ready}
          onClick={onWireframe}
        >
          <Icon name="wireframe" size={16} /> Wireframe
          <span className={styles.toggleState}>{wireframe ? "On" : "Off"}</span>
        </button>
      </div>
    </div>
  );
}

export function ViewerPlaceholder({
  title,
  issue,
  onRetry,
}: {
  title: string;
  issue?: ModelPreviewIssue;
  onRetry?: () => void;
}) {
  return (
    <ViewerFrame title={title} status={issue ? "error" : "loading"}>
      <div className={styles.viewport}>
        <ViewerMessage issue={issue} onRetry={onRetry} />
      </div>
      <ViewerControls />
      <p className={styles.hint}>
        {issue
          ? "You can still explore the product details below."
          : "Drag to orbit · Scroll or pinch to zoom"}
      </p>
    </ViewerFrame>
  );
}
