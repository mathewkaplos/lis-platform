FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lis/domain build
RUN pnpm --filter ./apps/api build
RUN pnpm --filter ./apps/api deploy --prod /prod/api

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=base /prod/api .
EXPOSE 4000
CMD ["node", "dist/main.js"]
