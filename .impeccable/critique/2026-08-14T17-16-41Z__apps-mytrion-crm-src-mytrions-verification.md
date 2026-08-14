---
target: apps/mytrion-crm/src/mytrions/verification
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-08-14T17-16-41Z
slug: apps-mytrion-crm-src-mytrions-verification
---
Method: dual-agent (A: 1242fc13-e34e-4cd3-af91-669a1363927a · B: 8ee589af-2241-4b42-acb2-f88963178eb0)

CONTEXT_STALE: no PRODUCT.md, DESIGN.md, or surface brief. Code is design authority. Not repaired.

Evidence: source + CSS. Detector CLI clean (exit 0). Browser overlay skipped (no Puppeteer / injectable browser MCP). Vite was listening on :5173 / :5175.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons and first-run pills; progress strip added |
| 2 | Match System / Real World | 3 | Carrier-credit language; some backend nouns remain |
| 3 | User Control and Freedom | 3 | Approve/Reject now confirm; Transfer is copy not a dead button |
| 4 | Consistency and Standards | 3 | Horizon vf-* system; owner chips no longer duplicated |
| 5 | Error Prevention | 3 | Footer confirm for credit decisions |
| 6 | Recognition Rather Than Recall | 3 | Summary pills filter; first-run vs claim still learned |
| 7 | Flexibility and Efficiency | 2 | Export + clickable counts; no next-case keyboard path |
| 8 | Aesthetic and Minimalist Design | 3 | Closed chips quieter; modal status soup reduced |
| 9 | Error Recovery | 3 | Banners, retry, last-known row |
| 10 | Help and Documentation | 2 | Inline first-run notes; no task help for desk handoff |
| **Total** | | **28/40** | **Good** |

## Design Specificity Verdict

**LLM assessment**: Product-authored Decision Desk language inside Horizon glass. Not category-interchangeable.

**Deterministic scan**: 0 findings on `apps/mytrion-crm/src/mytrions/verification` and related tabs.

**Visual overlays**: none. Browser visualization skipped.

## Overall Impression

Operate surface is ready to scan a queue, open a case, and start first-run without claiming. Remaining load is density, not a broken world.

## What's Working

1. Horizon tokens, skeleton aggregators, last-known modal row.
2. First-run vs claim copy on the queue bar and auto group.
3. Table/card swap at 640px and actionable empty states.

## Priority Issues

### [P1] Modal IA still long
Why: Pipeline + Plaid + files still one scroll after the progress strip.
Fix: Left as-is this pass (refinement, not a collapse redesign).

### [P2] No next-case accelerator
Why: Power agents return to the table after close.
Fix: Out of scope for this ship.

## Persona Red Flags

**Alex**: No next-case / bulk first-run.
**Sam**: Long tab order through stages remains.
**Casey**: Filter wrap on narrow viewports remains.

## Minor Observations

Tickets tab soon-state is honest. Inbox now deep-links when `sourceUrl` carries a case id.
