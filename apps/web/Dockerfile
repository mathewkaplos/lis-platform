FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lis/domain build
RUN pnpm --filter ./apps/web build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /repo/apps/web/.next/standalone ./
COPY --from=base /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=base /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
