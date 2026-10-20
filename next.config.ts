import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a verification build run next to `next dev` without clobbering its .next folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
