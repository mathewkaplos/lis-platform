FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lis/domain build
RUN pnpm --filter ./apps/interop build
RUN pnpm --filter ./apps/interop deploy --prod /prod/interop

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=base /prod/interop .
EXPOSE 4300 4301
CMD ["node", "dist/main.js"]
