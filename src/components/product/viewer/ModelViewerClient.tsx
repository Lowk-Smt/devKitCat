"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ModelPreviewIssue } from "@/lib/model-preview";
import type { ModelViewerProps } from "./ModelViewer";
import {
  ViewerControls,
  ViewerFrame,
  ViewerMessage,
  type ViewerStatus,
} from "./ViewerChrome";
import { createModelViewer, type ModelViewerHandle } from "./model-viewer";
import styles from "./ModelViewer.module.css";

const ROTATE_STEP = Math.PI / 12;

type LoadedViewerProps = ModelViewerProps & { src: string };

/** Retry remounts one fresh scene rather than retaining a failed WebGL context. */
export function ModelViewerClient(props: LoadedViewerProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ViewerSession
      key={attempt}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ViewerSession({
  src,
  title,
  description,
  onRetry,
}: LoadedViewerProps & { onRetry: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ModelViewerHandle | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [issue, setIssue] = useState<ModelPreviewIssue>();
  const [wireframe, setWireframe] = useState(false);
  const gestureHintId = useId();
  const keyboardHintId = useId();
  const descriptionId = useId();
  const describedBy = `${gestureHintId} ${keyboardHintId}${description ? ` ${descriptionId}` : ""}`;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let active = true;
    const viewer = createModelViewer(mount, {
      src,
      title,
      describedBy,
      // Next.js can resume a cached page (React Activity) with state preserved
      // after its effects were cleaned up. Each new scene must start loading.
      onLoading: () => {
        if (!active) return;
        setStatus("loading");
        setIssue(undefined);
        setWireframe(false);
      },
      onReady: () => {
        if (active) setStatus("ready");
      },
      onError: (error) => {
        if (!active) return;
        setIssue(error);
        setStatus("error");
      },
    });
    viewerRef.current = viewer;
    return () => {
      active = false;
      viewerRef.current = null;
      viewer.dispose();
    };
  }, [src, title, describedBy]);

  function toggleWireframe() {
    const next = !wireframe;
    viewerRef.current?.setWireframe(next);
    setWireframe(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (status !== "ready" || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const viewer = viewerRef.current;
    switch (event.key.toLowerCase()) {
      case "arrowleft":
        viewer?.rotate(-ROTATE_STEP);
        break;
      case "arrowright":
        viewer?.rotate(ROTATE_STEP);
        break;
      case "arrowup":
        viewer?.rotate(0, -ROTATE_STEP);
        break;
      case "arrowdown":
        viewer?.rotate(0, ROTATE_STEP);
        break;
      case "+":
      case "=":
        viewer?.zoom(1 / 1.2);
        break;
      case "-":
      case "_":
        viewer?.zoom(1.2);
        break;
      case "r":
        viewer?.reset();
        break;
      case "w":
        toggleWireframe();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div>
      <ViewerFrame title={title} status={status}>
        <div className={styles.viewport} aria-busy={status === "loading"}>
          <div
            ref={mountRef}
            className={styles.canvasMount}
            onKeyDown={onKeyDown}
          />
          {status !== "ready" ? (
            <ViewerMessage
              issue={issue}
              onRetry={status === "error" ? onRetry : undefined}
            />
          ) : null}
        </div>
        <ViewerControls
          ready={status === "ready"}
          wireframe={wireframe}
          onRotate={(direction) =>
            viewerRef.current?.rotate(direction * ROTATE_STEP)
          }
          onZoom={(factor) => viewerRef.current?.zoom(factor)}
          onReset={() => viewerRef.current?.reset()}
          onWireframe={toggleWireframe}
        />
        <p id={gestureHintId} className={styles.hint}>
          {status === "error"
            ? "You can still explore the product details below."
            : "Drag to orbit · Scroll or pinch to zoom"}
        </p>
        <p id={keyboardHintId} className="sr-only">
          Focus the model to use arrow keys to rotate, plus or minus to zoom, R
          to reset, and W to toggle wireframe. You can also use the buttons.
        </p>
        <p className="sr-only" role="status">
          {status === "ready" ? "3D preview ready to explore." : ""}
        </p>
      </ViewerFrame>
      {description ? (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
