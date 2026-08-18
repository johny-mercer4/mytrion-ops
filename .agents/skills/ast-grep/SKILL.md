---
name: ast-grep
description: Structural search with ast-grep (`sg`) for TypeScript/TSX. Use when ripgrep hits too many string-similar matches or you need to find empty catch, `as unknown as`, `any` casts, or raw SQL-shaped calls in src/routes.
---

# ast-grep (optional)

Structural grep. Escalate from `rg` when the pattern is **syntax**, not a string (`catch {}` vs any `catch`, `as unknown as` vs the words in a comment).

Optional tool. If `ast-grep` is missing, say so and fall back to `rg`. Do **not** fail the repo or CI. Do **not** add ast-grep as MCP.

## Install (local / CI machines)

```bash
brew install ast-grep          # preferred on this Mac
# or: curl -fsSL https://raw.githubusercontent.com/ast-grep/ast-grep/main/scripts/install.sh | bash
ast-grep --version             # 0.45.1+ on this machine. `sg` still works but is deprecated.
```

## When to use `sg`

| Use `rg` | Escalate to `sg` |
| --- | --- |
| A unique identifier, path, or error string | A syntax shape that `rg` over-matches |
| Counting a word | Finding *empty* catches, typed casts, call shapes |

## Octane-shaped examples

Run from the repo root. `--lang ts` covers `.ts`; add `--lang tsx` for CRM.

```bash
# 1. Empty catch (hard to grep without hitting logged catches)
ast-grep --lang ts -p 'catch ($E) {}' src
ast-grep --lang tsx -p 'catch ($E) {}' apps/mytrion-crm/src

# 2. Double cast — house rule wants a justifying comment (hits in this repo)
ast-grep --lang ts -p '$X as unknown as $T' src tests

# 3. Raw SQL-ish in routes (queries belong in repos/)
ast-grep --lang ts -p 'sql`$Q`' src/routes
ast-grep --lang ts -p 'db.execute($X)' src/routes

# 4. `any` / `as any`
ast-grep --lang ts -p '$X as any' src
ast-grep --lang ts -p 'const $N: any = $V' src
```

Prefer `-p` patterns. Do not invent a project `sgconfig` unless someone asks.
