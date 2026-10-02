"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { getModelSourceIssue } from "@/lib/model-preview";
import { ViewerPlaceholder } from "./ViewerChrome";

export interface ModelViewerProps {
  /** Public/static GLB or GLTF URL. No product-specific logic in the viewer. */
  src?: string;
  title: string;
  description?: string;
}

const ClientViewer = dynamic(
  () =>
    import("./ModelViewerClient").then((module) => module.ModelViewerClient),
  {
    ssr: false,
    loading: () => <ViewerPlaceholder title="Product" />,
  },
);

/** A failed viewer chunk/runtime must not take down the product page. */
class ViewerBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <ViewerPlaceholder
        title={this.props.title}
        issue="load"
        onRetry={() => window.location.reload()}
      />
    ) : (
      this.props.children
    );
  }
}

/** Lightweight entry point: no WebGL during SSR or on image-only pages. */
export function ModelViewer(props: ModelViewerProps) {
  const src = props.src?.trim();
  const issue = getModelSourceIssue(src);
  if (issue) return <ViewerPlaceholder title={props.title} issue={issue} />;

  return (
    <ViewerBoundary
      key={JSON.stringify([src, props.title, props.description])}
      title={props.title}
    >
      <ClientViewer {...props} src={src!} />
    </ViewerBoundary>
  );
}
