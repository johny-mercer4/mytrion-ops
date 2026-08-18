# MCP allowlist (Horizon)

`.cursor/mcp.json` is the **team contract** for custom servers: only Stitch, key via `STITCH_API_KEY`. No secrets in git.

**Intended belt (do not add the rest of the marketplace):**

| Server | How it is provided |
| --- | --- |
| Render | Cursor plugin (`https://mcp.render.com/mcp`) — do not re-declare here (duplicates) |
| Notion | Cursor plugin (`https://mcp.notion.com/mcp`) — same |
| Figma | Cursor plugin (`https://mcp.figma.com/mcp`) — same |
| AccessLint | Cursor plugin |
| cursor-app-control | Cursor built-in |
| cursor-ide-browser | Cursor built-in / browser MCP, if enabled |
| Stitch | this `mcp.json` |

Zoho / dbt probes are `pnpm` scripts (`zoho:mcp-probe`, `dbt:smoke`), not MCP servers.

This file **adds** servers. It cannot deny extras in `~/.cursor/mcp.json` or other plugins. Blocking those needs Cursor Team Settings → MCP Allowlist.

CISA (Jun 2026): treat MCP tool execution as high-risk; least privilege; do not feed user-plugin output into privileged backends.
