FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lis/domain build
# TASK-031: apps/web/auth/secret.ts requiredEnv()s SESSION_SECRET at module
# load, and `next build` imports every route module to collect page data --
# same "next build actually executes top-level code" reasoning as pr.yml's
# equivalent env block. Build-time-only: this value is never baked into a
# runtime artifact (no NEXT_PUBLIC_ prefix, nothing client-side reads it) --
# the real value is set again at container start via docker-compose's own
# SESSION_SECRET (infra/docker-compose.staging.yml).
ARG SESSION_SECRET
ENV SESSION_SECRET=${SESSION_SECRET}
RUN pnpm --filter ./apps/web build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /repo/apps/web/.next/standalone ./
COPY --from=base /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=base /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
