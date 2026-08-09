FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lis/domain build
RUN pnpm --filter ./apps/gateway build
RUN pnpm --filter ./apps/gateway deploy --prod /prod/gateway

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=base /prod/gateway .
EXPOSE 4100
CMD ["node", "dist/main.js"]
