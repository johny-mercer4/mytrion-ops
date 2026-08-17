---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's
observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

> **Provenance.** These are a community distillation of Karpathy's observations, not text he
> authored. Source: [`forrestchang/andrej-karpathy-skills`](https://github.com/forrestchang/andrej-karpathy-skills),
> MIT licensed, reproduced verbatim below. The "In this repo" notes at the end are ours.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant
clarification.

---

## In this repo

Where these meet Octane's own rules, both apply — they do not conflict, but two are worth spelling
out because this codebase has house conventions that could be mistaken for violations.

- **"No abstractions for single-use code" vs. the repo's layering.** `repos/` and `ToolManifest` are
  not speculative abstractions; they are the tenant-isolation and RBAC boundaries (hard rules 2-4).
  Routing a query through a repo is the minimum that solves the problem here.
- **"Match existing style" beats your taste, including comment density.** This codebase comments the
  *why*, often at length. Match that; do not strip it, and do not add it where the neighbours have
  none.
- **Verification is not optional here.** Rule 9 and `pnpm lint && pnpm typecheck && pnpm test` are
  the repo's own "loop until verified". jsdom does no layout, so for UI work the loop closes with
  `pnpm audit:mobile` / `audit:shots`, not with a green suite.
- **Surgical means the diff too.** A rebuilt `apps/*/app/` bundle is a required part of a UI change
  (see AGENTS.md), not adjacent churn.
