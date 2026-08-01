import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  // @lis/ui ships TS source, not a prebuilt dist -- tsc's CommonJS output
  // was prepending "use strict" before each client component's "use
  // client" directive, breaking Next's client-boundary detection (found
  // while building TASK-036). transpilePackages has Next process the
  // package's real source directly, matching shadcn/ui's own documented
  // monorepo pattern.
  transpilePackages: ["@lis/ui"],
};

export default nextConfig;
