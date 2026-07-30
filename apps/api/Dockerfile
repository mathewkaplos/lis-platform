FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lis/domain build
# TASK-030 (FEAT-008): apps/api is the first-ever consumer of a workspace
# package's real exports (@lis/db) — @lis/db's package.json points
# types/main at dist/, so building apps/api needs it built first, not just
# installed. Mirrors pr.yml's equivalent step (added same task, same reason);
# this Dockerfile is a separate build path (deploy-staging.yml) that pr.yml's
# fix never covered, which is why PR Checks passed on #177 but the Docker
# build here still failed.
RUN pnpm --filter @lis/db build
RUN pnpm --filter ./apps/api build
RUN pnpm --filter ./apps/api deploy --prod /prod/api

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=base /prod/api .
EXPOSE 4000
CMD ["node", "dist/main.js"]
