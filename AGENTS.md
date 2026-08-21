# AGENTS.md — index for Codex / non-Claude agents

Codex and other non-Claude agents should **read `CLAUDE.md` as the rulebook**. This file is an
index, not a second copy of those rules.

## Where to go

| Need | Open |
| --- | --- |
| Hard rules, git, migrations, vendored UI builds | `CLAUDE.md` |
| Repo topology, Mytrion inventory, current state | `ONBOARDING.md` |
| Design system (glass = chrome only; Space Grotesk / Space Mono) | `docs/design/` |
| Product facts (Collection, Sales, CS, Billing, HR, Admin, Verification) | `.claude/skills/<name>-mytrion/` |
| CRM `ds/` component conventions | `apps/mytrion-crm/src/ds/CONVENTIONS.md` |

Workspace product skills are mirrored to `.cursor/skills/` and `.agents/skills/`. `.agents/` is
gitignored — `git add -f` skill updates like the Zoho mirrors.

Optional tooling: `ast-grep` (not MCP), `context7` (library docs plugin — not this repo's
`mcp.json`), `render-logs` (Octane Render map). UI verify: `.cursor/rules/ui-verify.mdc`.

## Scratch notes

`WORKING_NOTES.md` is **local scratch only** (gitignored). Never load it wholesale. Ask in
ONBOARDING, the product skill, or the PR instead.
