import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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

// FEAT-048 (ADR-0043): points at i18n/request.ts, which resolves the locale
// from a cookie -- no `[locale]` URL segment, so this plugin never touches
// routing/middleware (proxy.ts is untouched by this feature).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
