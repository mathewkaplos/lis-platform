FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lis/domain build
# TASK-040 (FEAT-011): same gap as @lis/domain above, now hitting @lis/sdk --
# apps/web's lib/api-client.ts imports it for the first time. Missing this
# step is what broke the real staging deploy (Deploy to Staging, runs
# 30756859631/30757028776) -- a local `docker build` here without a
# .dockerignore (now added) falsely "verified" clean, because host-local
# packages/sdk/dist/ leaked into the build context via `COPY . .` and
# papered over the Dockerfile never building it itself. CI's own clean
# checkout has no such leftover dist/, which is exactly why it caught this
# and a contaminated local build didn't.
RUN pnpm --filter @lis/sdk build
# TASK-031: apps/web/auth/secret.ts requiredEnv()s SESSION_SECRET at module
# load, and `next build` imports every route module to collect page data --
# same "next build actually executes top-level code" reasoning as pr.yml's
# equivalent env block. Scoped to this one RUN (not `ENV`) so the value
# never persists as an image-layer environment variable, even transiently --
# the real value is set again at container start via docker-compose's own
# SESSION_SECRET (infra/docker-compose.staging.yml).
ARG SESSION_SECRET
RUN SESSION_SECRET="${SESSION_SECRET}" pnpm --filter ./apps/web build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /repo/apps/web/.next/standalone ./
COPY --from=base /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=base /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
