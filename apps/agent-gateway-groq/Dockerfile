# Octane support bot — OpenAI Responses API gateway.
# tsx runs TypeScript directly; no Claude CLI, subscription token, or local GPU is required.
FROM node:22-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9 --activate && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY prompts ./prompts

# Rolling per-chat history and monitor logs live here.
RUN mkdir -p data

CMD ["npx", "tsx", "src/index.ts"]
