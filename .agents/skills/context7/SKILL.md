---
name: context7
description: When to use Context7 for current library API/version docs (Drizzle, Vite, Zod, React). Not for repo search. Use when the question is "what is the current API for package X" and training data may be stale.
---

# Context7

Official **library docs** MCP. Not a second repo index. Not for searching this codebase.

## When to call

Current **library API / version** questions: Drizzle, Vite, Zod, React, Fastify, Tailwind. Mention the version when it matters.

## When not to

- Repo search (`rg` / `sg` / reading files)
- Octane product facts (use `collection-mytrion` and the code)
- Zoho / RingCentral / Render (those skills and plugins already exist)

## Turn it on (not in this repo's mcp.json)

`.cursor/mcp.json` stays **Stitch-only**. Do not commit keys.

1. Cursor Settings → MCP → install the **Context7** plugin if listed, **or**
2. Personal: `npx ctx7 setup --cursor` (OAuth; writes `~/.cursor/mcp.json`)

Remote URL if you must add it yourself (home config, env var — never a committed secret):

`https://mcp.context7.com/mcp` with header `CONTEXT7_API_KEY` from the environment.

Then: resolve library id → query docs. If the plugin is not authenticated, use the package's official docs URL and say Context7 is off.
