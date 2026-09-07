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
  // world-class-final-assessment-2026-09 §9: baseline HTTP security headers
  // -- previously nothing set these anywhere in the stack. No
  // Content-Security-Policy here yet, deliberately: a wrong CSP silently
  // breaks hydration/inline scripts, and this repo's current low-memory
  // dev environment can't reliably build+browser-verify one in this pass
  // (tsc/pnpm have been OOM-crashing) -- landing the safe, low-risk headers
  // now rather than risk shipping an unverified CSP that breaks the app.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

// FEAT-048 (ADR-0043): points at i18n/request.ts, which resolves the locale
// from a cookie -- no `[locale]` URL segment, so this plugin never touches
// routing/middleware (proxy.ts is untouched by this feature).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
