import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the remote development preview to load Next.js dev assets.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
