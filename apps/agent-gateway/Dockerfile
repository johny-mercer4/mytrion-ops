# Octane support bot v2 — Claude Agent SDK gateway.
# tsx runs the TypeScript directly (no build step); deps come from pnpm-lock.yaml so the
# container matches the Mac dev install exactly. The SDK bundles its own Claude CLI, so the
# only runtime requirement is Node >= 18.
FROM node:22-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9 --activate && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY prompts ./prompts
# Skills are discovered from .claude/skills under the cwd (settingSources: ['project']).
COPY .claude ./.claude

# data/sessions.json — per-chat resumable session ids; mounted as a volume in compose so a
# container rebuild does not amnesia the group conversations.
RUN mkdir -p data

CMD ["npx", "tsx", "src/index.ts"]
