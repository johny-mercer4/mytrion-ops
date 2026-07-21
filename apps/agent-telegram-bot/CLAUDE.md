# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

hamroh is a Telegram bot whose "brain" is a **Claude Code subprocess**. The Python package (`hamroh/`)
is the harness: it receives Telegram messages, feeds them to the `claude` CLI as a conversation, exposes
tools over a local MCP server, and ships Claude's tool calls back out to Telegram. The bot never renders
Claude's prose directly — the user only sees what Claude sends via a `telegram_*` tool call.

Coding conventions (clean-code rules, file/function size limits, refactor passes, definition-of-done)
live in `.claude/CLAUDE.md`. Read it before writing code; it is not repeated here.

## Commands

Uses `uv`. Dev deps: `uv sync --extra dev`.

```bash
# Run the bot (needs .env, plugins.json, access.json — copy from *.example)
uv run python -m hamroh

# Tests
uv run -m pytest tests/unit                 # fast, fully mocked, no network — run anytime
uv run -m pytest tests/unit/test_access.py  # single file
uv run -m pytest -k <name>                   # single test by name
uv run -m pytest -m "e2e and smoke"          # e2e smoke (opt-in; skips without creds — see tests/e2e/README.md)
uv run -m pytest -m e2e                       # all e2e (real Telegram + real claude, costs tokens)

# Quality gates (definition-of-done, see .claude/CLAUDE.md)
uv run ruff check
uv run ruff format --check
uv run mypy hamroh
uv run lizard -C 10 -L 40 -a 4 hamroh

# Docker (production)
docker compose up -d --build                  # or: make up
docker compose logs -f hamroh                  # or: make logs
docker compose exec hamroh python -m hamroh.scripts.trace --follow   # watch Claude Code I/O
```

E2e tests reuse the app's real `TELEGRAM_BOT_TOKEN`, so a run will stop a locally-running bot to claim
the token. Only the data dir is isolated. `pytest` auto-reruns failed tests up to 3× (e2e is timing-flaky).

## Architecture — follow one message through the system

```
Telegram ──▶ dispatcher ──▶ engine ──▶ cc_worker ──▶ [claude subprocess]
                                          ▲                    │
                                          │              calls MCP tools
                                    mcp_server ◀───────────────┘
                                          │
                                    tools/ ──▶ back out to Telegram
```

The four core files (read in this order):

1. **`telegram_io/dispatcher.py`** — front door. Every inbound update passes access control (`access.py`)
   and rate limiting (`rate_limiter.py`), is persisted, then handed to `engine.submit()`.
2. **`engine/engine.py`** — the control loop and conceptual center. Debounces bursts (~1s), formats them
   as XML, ships to the worker, and decides what to do when a turn ends (`_handle_turn_result`: the
   stop/skip/heartbeat actions, dropped-text recovery, silent-stop detection).
3. **`cc_worker/worker.py`** — owns the `claude` subprocess: spawns it, writes user messages to stdin as
   stream-JSON, reads stdout events, supervises crashes/respawns.
   - `cc_worker/event_handlers.py` — parses Claude's stdout stream into a `TurnResult`. `USER_VISIBLE_TOOLS`
     and the `dropped_text` flag live here.
   - `cc_worker/spec.py` — builds the exact CLI command + `--system-prompt` for spawning Claude.
4. **`mcp_server.py`** — local HTTP MCP server that auto-loads every tool in `hamroh/tools/` and exposes
   them to the subprocess. This is how Claude "does things."

Boot sequence is `__main__.py` → `startup.py` (DB → MCP server → claude subprocess → engine + dispatcher).
`config.py` resolves all env into a `Config` object threaded everywhere.

### Two concepts that drive the design

- **Text blocks go nowhere.** Claude's plain-prose output blocks are *not* the reply — only a `telegram_*`
  tool call reaches the user. The system prompt tells the model not to write text blocks; healthy turns end
  with `text_blocks=0`.
- **`dropped_text`** is the safety net: text blocks exist AND no user-visible tool was called → the model
  "forgot to hit send." On a `stop` the engine recovers the stranded text and delivers it; on a `skip`
  (deliberate silence) it discards it as internal narration. See `docs/hamroh-high-level-architecture.md`
  for the full rationale, and `cc_schema.py` for why `ControlAction.reason` is required on stop/skip.

### Supporting subsystems

- **`tools/`** — one module per capability, all on `tools/base.py`. `tools/telegram/*` are the user-visible
  ones (send/reply/react/poll); also `tools/memory.py`, `tools/reminder.py`, `tools/browser/`, render tools.
- **`db/`** — SQLite: `database.py` runs the numbered migrations in `db/migrations/`; `messages.py`,
  `reminders.py`, `unauthorized.py` are the row stores.
- **`storage/`** — file-backed stores (memory files, attachments, instructions, skills, renders).
- **`scheduler/`** — cron-like loop firing scheduled reminders into the engine.
- **`plugins.py`** — enables/disables optional external MCP plugins and tool groups, driven by `plugins.json`.
- **`cc_worker/cc_failure_classifier.py`** — turns raw Claude/API errors into friendly user messages.

## Configuration surface (single source per concern)

These operator files are gitignored; copy from the `*.example` sibling:

- **`.env`** — secrets: `TELEGRAM_BOT_TOKEN`, `HAMROH_OWNER_ID`, `CLAUDE_CODE_OAUTH_TOKEN`, plus any
  `${VAR}` referenced by `plugins.json`. Also `HAMROH_MODEL`, `HAMROH_EFFORT`.
- **`plugins.json`** — the capability surface: which tool groups (`bash`, `code`, `subagents` — off by
  default), skills, and MCP servers (stdio or remote HTTP/SSE) are enabled.
- **`access.json`** — who can DM / use the bot in groups. Hot-reloaded, no restart. Mutated by `/allow`,
  `/deny` commands.
- **`default-reminders.json`** — git-tracked recurring reminders shipped with the bot.
- **`prompts/project.md`** — persona/rules overlay, appended to the shipped `prompts/system.md` to form
  the system prompt (`spec.py:_compose_system_prompt`).
- **`memories/`** — git-tracked markdown the bot reads/searches/writes. Survives restarts; commit to curate.

## Gotchas

- The engine handles **one turn at a time** — a long task in chat A blocks chat B until it finishes. For
  busy setups, run a separate bot per chat group.
- The bot writes memories into the checkout but never commits them. `scripts/commit-and-push.sh` commits
  everything (git-tracked only, respecting .gitignore) before `git pull` so deploys don't break; `make update`
  chains it.
- Deeper docs: `docs/documentation.md` (technical manual + security model), `docs/tools.md` (per-tool surface),
  `docs/hamroh-high-level-architecture.md` (the message-journey walkthrough).
