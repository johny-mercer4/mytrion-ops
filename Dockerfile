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
EXPOSE 3001
CMD ["node", "dist/server.js"]
