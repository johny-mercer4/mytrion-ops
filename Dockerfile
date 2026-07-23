# --- Base: Node 20 + pnpm via corepack ---
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- Build: install all deps, compile TS -> dist ---
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# --- Gateway: the support bot runs from source via tsx (own lockfile, NOT a workspace pkg).
#     Full install on purpose: tsx lives in devDependencies. ---
FROM base AS gateway
WORKDIR /app/apps/agent-gateway
COPY apps/agent-gateway/package.json apps/agent-gateway/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/agent-gateway/tsconfig.json ./
COPY apps/agent-gateway/src ./src
COPY apps/agent-gateway/prompts ./prompts
COPY apps/agent-gateway/.claude ./.claude

# --- Runtime: prod deps only + compiled output ---
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./src/db/migrations
# The AI Chat widget (vendored in git) is served same-origin at /widget. The runtime stage must
# carry it explicitly — tsc emits only dist/, so without this COPY the image has no
# /app/apps/mytrion-crm/app and /widget 404s ("widget build not found"). Path matches
# widgetStatic's resolver (/app/apps/mytrion-crm/app).
COPY --from=build /app/apps/mytrion-crm/app ./apps/mytrion-crm/app
# The Telegram carrier mini-app (vendored in git) is served same-origin at /mini-app — carry it
# into runtime too (matches miniAppStatic's resolver: /app/apps/mini-app/app).
COPY --from=build /app/apps/mini-app/app ./apps/mini-app/app
# The support-bot gateway (see scripts/docker/start-prod.sh — starts only when its env is set).
COPY --from=gateway /app/apps/agent-gateway ./apps/agent-gateway
COPY scripts/docker/start-prod.sh ./start-prod.sh
EXPOSE 3001
CMD ["sh", "./start-prod.sh"]
