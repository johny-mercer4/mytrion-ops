---
name: llm-providers
description: LLM provider strategy for Mytrion Ops — OpenAI (models/tool-calling/SDK/prompt-caching) + Groq (LPU speed, hosted models, OpenAI-compatible baseURL, tool-calling caveats), with a verified pricing/capability table and a phased plan to add Groq for fast/cheap turns. Use when changing models, adding a provider, model routing, or cost/latency optimization in chatService/openaiClient.
---

# LLM providers (OpenAI + Groq) — skill

**TL;DR for this repo (Mytrion Ops):**
- Add **Groq via the OpenAI-compatible `baseURL`** (`https://api.groq.com/openai/v1`) using our existing `openai` SDK — **not** `groq-sdk`. `chatService` barely changes (same Chat Completions shape).
- Use **`openai/gpt-oss-120b` / `gpt-oss-20b` on Groq for the fast/cheap worker turns — NOT Llama** (every Llama model on Groq has a 2026 shutdown date; gpt-oss are the official replacements + the only Groq models with strict json_schema + prompt caching).
- **Route:** worker (tool-iteration/simple) → Groq gpt-oss; final grounded answer → OpenAI; hard reasoning → OpenAI `gpt-5.4-mini`. Cheap heuristic + Administrator override; `ChatTurnOptions.model` plumbing already exists.
- **Non-negotiable safety net:** validate tool name vs registry → strip XML/`<|python_tag|>` wrappers → retry at lower temp → **fall back the turn to OpenAI** on Groq tool-call failure. Keep RBAC re-check in `toolDispatcher` (CLAUDE.md rules 4/8/9).
- `GROQ_API_KEY` is set in `.env`. Integration is gated behind a planned `FF_GROQ_ENABLED` (default off).
- Compiled 2026-06-22 from official docs (8-agent research workflow, fact-checked vs platform.openai.com + console.groq.com). Verify volatile numbers before relying on a fine detail.

---

# Engineering Report: Adding Groq/Llama for a Fast, Cost-Optimized Agentic RAG Assistant (Mytrion Ops)

**Audience:** Service owner. **Date:** 2026-06-22. **Verdict up front:** Yes — add Groq, but **via the OpenAI-compatible `baseURL`, not `groq-sdk`**, and route to **`openai/gpt-oss-120b` / `gpt-oss-20b` (not Llama)** for the fast/cheap turns while keeping an OpenAI model on the final grounded answer and the hard tool-selection path. Llama-on-Groq is attractive on paper but is a **deprecated foundation** (every Llama model on Groq has a 2026 shutdown date) and its tool-calling is the flakiest of the options. The architecture below changes `chatService.ts` very little because Groq speaks the same Chat Completions API we already use.

---

## 1. OpenAI deep dive

### Model lineup + the cheap/fast tier
The current API generation is the **GPT-5.x family**; the GPT-4.1 family and `gpt-4o-mini` remain live and priced (reachable per-model pages) but are positioned as legacy. The cheap/fast tier you actually care about:

- **`gpt-4o-mini`** (128K ctx, $0.15/$0.60, cached $0.075) — what we run today as `models.default` (`gpt-4o-mini-2024-07-18`). Legacy, non-reasoning, good tool calling + strict structured outputs. Note it's the one model whose cached discount is still the old **50%**, not 90%.
- **`gpt-4.1-nano`** (1M ctx, $0.10/$0.40, cached $0.025) — the single cheapest general text model with a 1M window; non-reasoning; strict tools.
- **`gpt-4.1-mini`** (1M ctx, $0.40/$1.60, cached $0.10) — OpenAI's own page says it *"excels at tool calling"*; the best cheap non-reasoning workhorse for our tool loop.
- **`gpt-5-nano`** ($0.05/$0.40, cached **$0.005**) / **`gpt-5.4-nano`** ($0.20/$1.25, cached $0.02) — cheapest *reasoning-capable* models; ideal for routing/classification.
- **`gpt-5.4-mini`** ($0.75/$4.50) — our currently-defined-but-unused `models.reasoning`; mid-tier reasoning escalation target.
- **`gpt-5.4`** ($2.50/$15, 1M ctx, full tool suite) — production hard-path default.

All listed chat models support function/tool calling **and** strict JSON-schema structured outputs. Sources: [gpt-4o-mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [gpt-4.1-mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [gpt-5-nano](https://developers.openai.com/api/docs/models/gpt-5-nano), [pricing](https://developers.openai.com/api/docs/pricing).

### Tool/function calling — Chat Completions vs Responses API
Two surfaces. **We use Chat Completions today** (`client.chat.completions.create`, `messages`, `tool_calls[]`, `{role:'tool', tool_call_id, content}`). OpenAI now recommends the **Responses API** for new projects (`input` + `instructions`, typed `output[]` items, `previous_response_id` server-side state, internal-tagged tools with **strict mode on by default**), citing *"40–80% improvement in cache utilization"* ([migrate-to-responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)). Chat Completions *"remains supported"* with no deprecation date; the Assistants API sunsets **2026-08-26**.

- `tool_choice`: `auto` (default) / `required` / `none` / named tool / `allowed_tools` subset.
- **Parallel tool calls** default-on; `parallel_tool_calls:false` forces ≤1.
- Reliability guidance: keep *"fewer than 20 functions"* available per turn (we have ~5 — well within budget).

Source: [function-calling](https://developers.openai.com/api/docs/guides/function-calling).

### Strict structured outputs
`strict:true` + `additionalProperties:false` on every object + **all** properties in `required` (model optional via `["string","null"]` union) + object root. Guarantees schema adherence with no retries. **Structured Outputs ≠ JSON mode** (`json_object` only guarantees valid JSON). First request with a new schema pays a compile latency; identical schemas after are cached. Source: [structured-outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

### Prompt caching
**Automatic**, no code change, on prompts **≥1,024 tokens**, exact-**prefix** match (hash of ~first 256 tokens for routing). Cacheable: messages, images, **tool definitions, and structured-output schemas**. TTL 5–10 min idle (up to 1h; extended to 24h on gpt-5.5+). Discount is **~90% (10% of input)** on the 5.x family — e.g. gpt-5.4 $2.50→$0.25 — *except* gpt-4o-mini which is still 50% ($0.15→$0.075). Lever: **static first (system + tools), variable last (RAG chunks + user turn)**; set a stable `prompt_cache_key`. Source: [prompt-caching](https://developers.openai.com/api/docs/guides/prompt-caching).

### Node SDK patterns
`openai` npm v6.x, Node 20+, auto-reads `OPENAI_API_KEY` (we pin `^4.65.0` — see §6). Key point for us: **the SDK accepts a `baseURL` constructor option**, which is the entire mechanism for pointing the same client at Groq. The `runTools()` auto-loop exists but we deliberately don't use it — our `toolDispatcher` must stay in the loop for RBAC (CLAUDE.md rule 4) and audit (rule 8).

---

## 2. Groq deep dive

### What it is
Groq runs a purpose-built **LPU** (Language Processing Unit): on-chip SRAM as primary weight store, deterministic statically-scheduled execution (no branch prediction/caches), tensor-parallel across many chips. Because autoregressive inference is **memory-bandwidth-bound**, this yields very high, low-variance token throughput — Groq cites >1,600 tok/s peak; independently ~276 tok/s on Llama-3.3-70B. Sources: [the-groq-lpu-explained](https://groq.com/blog/the-groq-lpu-explained), [inside-the-lpu](https://groq.com/blog/inside-the-lpu-deconstructing-groq-speed).

### Hosted models, pricing, speed (all USD/1M; TPS = Groq published)
| Model | Ctx | In | Out | Cached | TPS | Notes |
|---|---|---|---|---|---|---|
| `llama-3.1-8b-instant` | 131K | $0.05 | $0.08 | n/a | ~840 | **shuts down 2026-08-16** |
| `llama-3.3-70b-versatile` | 131K | $0.59 | $0.79 | n/a | ~394 | **2026-08-16**; XML-tag-wrapping flakiness |
| `meta-llama/llama-4-scout-17b-...` | 131K | $0.11 | $0.34 | n/a | ~594 | only multimodal Llama; 8K out cap; **2026-07-17** |
| `meta-llama/llama-4-maverick-...` | — | — | — | — | — | **REMOVED 2026-03-09** |
| `openai/gpt-oss-20b` | 131K | $0.075 | $0.30 | $0.0375 | ~1000 | **strict json_schema** ✓; no parallel tools |
| `openai/gpt-oss-120b` | 131K | $0.15 | $0.60 | $0.075 | ~500 | **strict json_schema** ✓; no parallel tools |
| `qwen/qwen3-32b` | 131K | $0.29 | $0.59 | n/a | ~662 | parallel tools; best-effort schema; not deprecated |
| `qwen/qwen3.6-27b` | 131K | $0.60 | $3.00 | n/a | ~500 | named Llama replacement; high out price |

Sources: [groq.com/pricing](https://groq.com/pricing), [console.groq.com/docs/models](https://console.groq.com/docs/models), [deprecations](https://console.groq.com/docs/deprecations).

### Tool calling + structured outputs (and the caveats that matter for us)
*"All models hosted on Groq support tool use."* OpenAI-standard `tools`/`tool_choice` shape. **Three hard caveats:**
1. **`gpt-oss` models do NOT support parallel tool calls** (one call/turn); Llama-4/3.3/Qwen3 do. ([tool-use/overview](https://console.groq.com/docs/tool-use/overview))
2. **Strict structured outputs (`json_schema`, `strict:true`) is supported only on `gpt-oss-20b`/`gpt-oss-120b`** — and **cannot be combined with `tools` in the same request** (*"Streaming and tool use are not currently supported with Structured Outputs"*). You pick per call. ([structured-outputs](https://console.groq.com/docs/structured-outputs))
3. **Reliability is model-dependent.** Documented + community failure modes: malformed-JSON arg-parse failures on gpt-oss; `llama-3.3-70b` emitting JSON wrapped in XML-ish function tags; under-calling without `tool_choice:"required"`; over-calling non-existent tools even with `required`. Mitigation per docs: `temperature` 0.0–0.5, lower it on a failed call. ([local-tool-calling](https://console.groq.com/docs/tool-use/local-tool-calling), community 406/592/427.)

### SDK + OpenAI-compatibility
Native `groq-sdk` exists (reads `GROQ_API_KEY`, 2 retries, 60s timeout). But Groq is *"mostly compatible with OpenAI's client libraries"* at **base URL `https://api.groq.com/openai/v1`** — so our existing `openai` SDK works unchanged. Incompatibilities (return 400): `logprobs`, `top_logprobs`, `logit_bias`, `messages[].name`; `N` must be 1; `temperature:0` silently coerced to `1e-8`. Streaming, `stop`, structured outputs all work. Sources: [console.groq.com/docs/openai](https://console.groq.com/docs/openai), [text-chat](https://console.groq.com/docs/text-chat).

### Pricing extras + rate limits
- **Prompt caching:** automatic, **50% off** cached input, 2h idle TTL, cached tokens don't pre-count against limits. **Officially listed only for gpt-oss models** — do NOT assume Llama gets caching. ([prompt-caching](https://console.groq.com/docs/prompt-caching))
- **Batch API:** 50% off, separate quota pool, 24h–7d window (Developer plan).
- **Rate limits:** per-**organization** (extra keys don't multiply quota), dimensions RPM/RPD/TPM/TPD/ITPM/OTPM; 429 on exceed with `retry-after` + `x-ratelimit-*` headers. Free vs Developer tiers; exact numbers are personalized at `console.groq.com/settings/limits` (third-party "10x / 1000 RPM" figures are UNCONFIRMED). ([rate-limits](https://console.groq.com/docs/rate-limits))

---

## 3. Llama assessment

**Versions:** Llama 3.1 (8B/70B/405B; 128K; 8 langs; text-only), Llama 3.3 70B (text-only), Llama 4 Scout (17B active/109B total MoE, multimodal, theoretical 10M ctx but Groq serves 131K) and Maverick (removed). No Llama 5 exists publicly. **405B — the only genuinely strong Llama tool-caller — is NOT hosted on Groq.**

**Tool-calling quality:** BFCL (directional, stale): 405B ~88.5%, 70B ~84.8%, **8B ~76.1%**. The models you'd actually run on Groq are mid-tier callers — fine for a small, well-described toolset; materially weaker as tool count/disambiguation rises. Plus the XML-wrapping and arg-parse glitches above.

**Where Llama-on-Groq shines:** latency-critical, high-volume, narrow steps — query rewriting, intent classification/routing, field extraction, and **RAG synthesis over already-retrieved chunks**. At $0.05/$0.08, 8B is ~3× cheaper input than 4o-mini and ~40× cheaper than GPT-4.1.

**Where a frontier model is safer:** (a) tool/argument selection with overlapping tools (we already have knowledge + Zoho People + 3 servercrm proxies, and that set will grow); (b) adherence to long layered constraints (our RBAC/tenant/read-only system rules); (c) strict structured output without retries; (d) **the final user-facing grounded answer**, where hallucination risk is highest.

**The decisive factor:** every Groq-Llama model is deprecated (Scout 2026-07-17; 3.3-70B and 3.1-8B 2026-08-16; Maverick already gone), with `openai/gpt-oss-*` and `qwen3.6-27b` as the **official replacements**. For a service meant to run past Q3 2026, **do not build new integrations on Groq-Llama. Use `gpt-oss-120b`/`gpt-oss-20b`** — same speed/cost class, strict schema support, no shutdown, and they're the only Groq models with documented prompt caching.

---

## 4. Verified comparison table

| Provider | API model ID | Context | Input $/1M | Output $/1M | Cached-in $/1M | Approx speed | Tool-calling | Structured outputs | Best-for |
|---|---|---|---|---|---|---|---|---|---|
| OpenAI | `gpt-4o-mini` | 128K | $0.15 | $0.60 | $0.075 | Fast (legacy) | Good | Yes (strict) | Legacy cheap baseline (what we run today) |
| OpenAI | `gpt-4.1-mini` | 1,047,576 | $0.40 | $1.60 | $0.10 | Fast | Strict ("excels at tool calling") | Yes (strict) | Cheap 1M-ctx non-reasoning workhorse |
| OpenAI | `gpt-4.1-nano` | 1,047,576 | $0.10 | $0.40 | $0.025 | Fastest 4.1 | Good | Yes (strict) | Cheapest 1M-ctx general model *(confirmed-by-report)* |
| OpenAI | `gpt-5-nano` | 400K | $0.05 | $0.40 | $0.005 | Fastest GPT-5 | Good | Yes (strict) | Cheapest reasoning-capable; routing/classification |
| OpenAI | `gpt-5-mini` | 400K | $0.25 | $2.00 | $0.025 | Fast | Good/strict | Yes (strict) | Cheap reasoning for well-defined tasks |
| OpenAI | `gpt-5.4-nano` | 400K | $0.20 | $1.25 | $0.02 | Fastest 5.x | Good | Yes (strict) | OpenAI-recommended cheapest current reasoning model |
| OpenAI | `gpt-5.4-mini` | 400K | $0.75 | $4.50 | $0.075 | Fast | Strict | Yes (strict) | Mid-tier reasoning escalation target |
| OpenAI | `gpt-5.4` | 1M | $2.50 | $15.00 | $0.25 | Medium | Strict (full suite) | Yes (strict) | Production hard-path default |
| OpenAI | `o4-mini` | 200K | $1.10 | $4.40 | $0.275 | Medium | Good | Yes (strict) | Classic o-series reasoner (mostly superseded) |
| Groq | `llama-3.1-8b-instant` | 131,072 | $0.05 | $0.08 | n/a | ~840 tok/s | Good (parallel) | JSON mode only | Ultra-cheap worker — **shuts down 2026-08-16** |
| Groq | `llama-3.3-70b-versatile` | 131,072 | $0.59 | $0.79 | n/a | ~394 tok/s | Good (parallel; flaky XML-tag wrapping) | JSON mode only | Best Groq-Llama follower — **2026-08-16** |
| Groq | `meta-llama/llama-4-scout-17b-16e-instruct` | 131,072 | $0.11 | $0.34 | n/a | ~594 tok/s | Good (parallel) | json_schema best-effort | Only multimodal Llama; 8K out — **2026-07-17** |
| Groq | `meta-llama/llama-4-maverick-17b-128e-instruct` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **REMOVED 2026-03-09** |
| Groq | `openai/gpt-oss-20b` | 131,072 | $0.075 | $0.30 | $0.0375 | ~1,000 tok/s | Good, **no parallel**; arg-parse failures | **strict json_schema** ✓ | Cheap strict-schema worker; Llama-8B successor |
| Groq | `openai/gpt-oss-120b` | 131,072 | $0.15 | $0.60 | $0.075 | ~500 tok/s | Good, **no parallel**; arg-parse failures | **strict json_schema** ✓ | Groq's Llama-4/3.3 replacement; strict outputs |
| Groq | `qwen/qwen3-32b` | 131,072 | $0.29 | $0.59 | n/a | ~662 tok/s | Good (parallel) | json_schema best-effort | Mid-tier parallel tool-caller, not deprecated |
| Groq | `qwen/qwen3.6-27b` | 131,072 | $0.60 | $3.00 | n/a | ~500 tok/s | Good (parallel) | best-effort | Named Llama replacement; high output price |
| Groq | `moonshotai/kimi-k2-instruct-0905` | n/a | $1.00 | $3.00 | $0.50 | UNCONFIRMED | Flaky (community reports) | UNCONFIRMED | Larger model; **GA status UNCONFIRMED** |

Notes: OpenAI cached discount is ~90% on 5.x (gpt-4o-mini is the 50% exception). Groq cached = flat 50%, gpt-oss only. `gpt-4.1-nano` row carried from source report, not re-fetched this session.

---

## 5. Recommendation for Mytrion Ops

### (a) Provider strategy — OpenAI-compatible `baseURL`, not `groq-sdk`
Groq's Chat Completions endpoint is wire-compatible with the `openai` SDK we already use, and our entire loop is Chat-Completions-shaped (`messages`, `tool_calls[]`, `{role:'tool'}`, streaming deltas). **Adding `groq-sdk` would force a second client type, a second streaming-delta accumulator, and a second mock in tests — for zero capability gain.** Instead:

- Introduce a tiny **provider abstraction**: a `getClient(provider)` that returns an `OpenAI` instance constructed with the Groq `baseURL` + `GROQ_API_KEY` when `provider==='groq'`, else the default OpenAI client. Same `OpenAI` type flows through `chatService` unchanged.
- A **model-router module** owns "which provider+model for this turn role" so `chatService` never hardcodes a model.
- Avoid the three Groq incompatibilities in our params: we don't send `logprobs`/`logit_bias`/`name`/`N`; just ensure any future `temperature` is `>0`.

This keeps `chatService.ts` edits to ~3 lines (resolve provider+model per turn, pick the right client).

### (b) Model routing for our always-on-RAG + tool-calling loop
Three roles, decided by a cheap heuristic with an Administrator override:

| Role | Job | Model | Why |
|---|---|---|---|
| **worker** (tool-selection / simple turns / intermediate iterations) | pick + call tools, simple replies | **Groq `gpt-oss-120b`** (fallback `gpt-oss-20b`) | ~500–1000 tok/s, $0.15/$0.60, strict-schema capable, not deprecated |
| **answer** (final grounded RAG answer the user reads) | synthesize cited answer | **OpenAI `gpt-4o-mini`** today → migrate to **`gpt-4.1-mini`** | lowest hallucination risk on the user-facing turn; instruction adherence on our citation rules |
| **reasoning** (hard / ambiguous / multi-tool disambiguation) | escalation | **OpenAI `gpt-5.4-mini`** (already defined, unused) | reasoning tokens for the genuinely hard ~10–20% |

**How to decide:** start with a **rule heuristic** (<1ms): default the loop's tool-iteration turns to **worker**; the **final** turn (no tool calls returned → the answer turn) runs on **answer**; escalate to **reasoning** on a trigger (tool-call/JSON parse failure, repeated empty tool results, or an explicit hard-query flag). Expose a **per-turn `opts.model`/`opts.modelRole` override** (the plumbing already exists — `ChatTurnOptions.model` flows to both `runChatTurn` and `streamChatTurn`) and an **env default + Administrator config** so the owner can dial the worker model up to OpenAI globally without a deploy. Keep escalation **under ~40%** of turns or cascade overhead erodes savings.

**Caching seam:** caches are per-provider/per-model. A turn that runs worker on Groq then answer on OpenAI pays two cold prefixes. That's acceptable because the *bulk iterations* stay on one Groq model within the turn, and the OpenAI answer turn still benefits from OpenAI's cache of the (stable) system+tools prefix across turns/users.

### (c) Tool-calling reliability with Llama/gpt-oss + mitigation
Real risks: malformed JSON args, XML-tag-wrapped JSON (Llama-3.3), under/over-calling, calling non-existent tools, no parallel tools on gpt-oss. Mitigations to build in:
1. **Validate tool name against the registry** before dispatch (we already map `__`↔`.`; add an explicit "unknown tool" guard that returns a tool error message instead of throwing).
2. **Defensive arg parsing** — we already `JSON.parse` in a try/catch and feed the error back; **extend it to strip XML-ish `<function>…</function>` / `<|python_tag|>` wrappers** before parsing.
3. **`tool_choice` policy:** on Groq workers, prefer explicit behavior over `auto` to fight under-calling, but keep `auto` for the answer turn.
4. **Retry-then-fallback:** on a tool-call parse failure or a 400 from Groq, **retry once at lower temperature; on second failure, fall back the whole turn to OpenAI `gpt-4o-mini`.** This is the single most important safety net.
5. Don't combine `json_schema` strict outputs with `tools` on Groq — our loop uses `tools` (no `response_format`), so we're already compliant; keep it that way.

### (d) Expected cost + latency impact
- **Cost:** moving the worker/tool-iteration turns from `gpt-4o-mini` ($0.15/$0.60) to Groq `gpt-oss-120b` ($0.15/$0.60) is **roughly cost-neutral on price** but **gpt-oss-20b ($0.075/$0.30) halves it**; routing the easy ~90% of traffic to Groq workers and reserving OpenAI for the answer+hard path tracks the cascade literature's **50–80% blended savings** on tail-heavy traffic. The biggest single win is **prompt caching** (below), independent of provider.
- **Latency:** Groq's ~500–1000 tok/s vs OpenAI's tens of tok/s makes the *intermediate* tool-iteration turns (up to 6/turn today) feel near-instant, and TTFT variance drops. Net perceived latency improves most on multi-iteration tool turns; the final OpenAI answer turn stays at OpenAI speed. TTFT scales with input size — see (e).

### (e) Prompt-caching + token-budget wins available to us specifically
Our `buildTurnMessages` ordering is **almost optimal already** (system prompt → optional userName system block → RAG grounding → history) but has two cache-busters:
1. **The per-user `userName` system block sits at prefix position ~1**, before history — on OpenAI it partially fragments the cache *per user*. Move it **after** the stable system+tools prefix (or fold the name into the last user turn) so all users share the cached system+tools prefix and get the OpenAI **90% discount** (4.1-mini $0.40→$0.10) and Groq gpt-oss **50% discount**.
2. **RAG passages change every turn** — they're correctly placed after the static prefix, but they're injected as a system block *before* history; that's fine (variable content after static), just ensure tool definitions + system prompt are **byte-stable** (they are; `buildTools` is deterministic from the registry). Add a stable **`prompt_cache_key`** per tenant on OpenAI calls.
3. **Token budget:** we retrieve `DEFAULT_RETRIEVAL_K=6` chunks every turn — keep it tight; TTFT scales with input. With `MAX_TOOL_ITERATIONS=6`, each turn can replay the full prefix up to 6×, so caching the system+tools prefix is **high-leverage** (it's read 5–6× per turn). `gpt-oss-20b` cached input at **$0.0375** makes the repeated iterations almost free.

---

## 6. Phased integration plan (with exact repo touchpoints)

### Phase 0 — SDK + env groundwork
- **`package.json`:** bump `openai` from `^4.65.0` to `^6.x` (current SDK; `baseURL` works on v4 too, but v6 is the supported line). Re-run `pnpm lint && typecheck && test`. *(No `groq-sdk` dependency — by design.)*
- **`src/config/env.ts`:** add Groq vars beside the OpenAI block (lines ~34–40):
  - `GROQ_API_KEY: z.string().default('')`
  - `GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1')`
  - `GROQ_MODEL_WORKER: z.string().default('openai/gpt-oss-120b')`
  - `GROQ_MODEL_WORKER_FALLBACK: z.string().default('openai/gpt-oss-20b')`
  - `FF_GROQ_ENABLED: flag('0')` (off by default; flip per environment)
  - Add `GROQ_API_KEY` to `assertRuntimeSecrets()` only when `FF_GROQ_ENABLED`.
- **`.env.example`:** document the new vars.
- **`src/config/constants.ts` `MODEL_PRICING`:** add Groq rows so `costTracker` attributes Groq spend (`'openai/gpt-oss-120b': {input:0.15,output:0.60}`, `'openai/gpt-oss-20b':{input:0.075,output:0.30}`, plus qwen if used). Note `baseModel()` strips date suffixes only — Groq IDs have none, so they match directly.

### Phase 1 — provider abstraction in `openaiClient.ts`
Touchpoint: **`src/modules/llm/openaiClient.ts`** (currently a single lazy client + `models` object).
- Add a **second lazy client** `getGroq()` → `new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: env.GROQ_BASE_URL, maxRetries: 2 })`.
- Add `getClient(provider: 'openai' | 'groq'): OpenAI`.
- Keep `getOpenAI()` and `setOpenAIClient()` exactly as-is so the existing chat test mock (`vi.mock('.../openaiClient.js', () => ({ getOpenAI: () => ({chat:{completions:{create}}}), models }))`) keeps working; add a parallel `setGroqClient()` stub setter.

### Phase 2 — model-router module
New file **`src/modules/llm/modelRouter.ts`**:
- `type ModelRole = 'worker' | 'answer' | 'reasoning'`.
- `resolve(role, opts): { provider, model }` reading env defaults + `FF_GROQ_ENABLED` + any per-turn override. When Groq disabled, every role resolves to an OpenAI model (so the system degrades to today's behavior).
- Extend the `models` export in `openaiClient.ts` to include `worker` (Groq) alongside `default`/`reasoning`/`embedding`.

### Phase 3 — wire into the chat loop
Touchpoint: **`src/modules/chat/chatService.ts`** — both `runChatTurn` (~line 201) and `streamChatTurn` (~line 321), where `const model = opts.model ?? models.default`.
- Replace with a per-iteration resolve: **iterations that will run tools → `worker` (Groq)**; the **answer turn → `answer` (OpenAI)**. Simplest correct shape: resolve `worker` for iterations `< last` and re-resolve `answer` for the turn that produces final content. Pass the resolved `{provider, model}` into `client = getClient(provider)` (replacing the single `getOpenAI()` at lines 202/322).
- `recordUsage(ctx, model, …)` already takes `model` — pass the resolved model so cost attribution is correct per provider.
- Extend **`ChatTurnOptions`** (~line 40) with optional `modelRole`/explicit `model` (the `model` field already exists and flows from routes) for per-turn Administrator override.

### Phase 4 — reliability guard + fallback
Touchpoint: **`runToolCall`** (~line 122) and the loop body.
- In `runToolCall`, before `JSON.parse`, **strip XML/`<|python_tag|>` wrappers**; on parse failure return the existing tool-error message (already implemented) — no throw.
- Add a **registry-name guard**: if `fromOpenAiToolName(name)` isn't in `toolRegistry`, return a tool-error ("unknown tool") instead of dispatching.
- Wrap the `client.chat.completions.create` call (lines 211 / 339): on a Groq 400 or empty/garbled tool-call, **retry once at lower temperature, then fall back to `getClient('openai')` with `models.default` for that turn**. Log + audit the fallback (extend the existing `auditFromContext` detail with `provider`/`fellBack`).
- The streaming accumulator in `streamCompletion` (~line 266) is already provider-agnostic (standard delta shape) — no change beyond passing the chosen client.

### Tests to add (Vitest; mirror `tests/unit/chat.test.ts` mock style)
1. **`modelRouter.test.ts`** — role→provider/model resolution; `FF_GROQ_ENABLED=0` forces all-OpenAI; per-turn override wins.
2. **`chat.test.ts` additions** — extend the `openaiClient` mock to expose `getClient`/`getGroq`; assert worker iterations call the Groq client and the answer turn calls the OpenAI client; assert `recordUsage` gets the right model id.
3. **Fallback test** — Groq `create` throws/returns malformed args → loop retries then dispatches to the OpenAI client; final answer still returned; audit `detail.fellBack === true`.
4. **Arg-sanitizer unit test** — XML-tag-wrapped JSON and `<|python_tag|>` payloads parse correctly; truly-invalid JSON still yields the graceful tool-error.
5. **Cost attribution test** — Groq model ids resolve in `MODEL_PRICING` (no silent $0).
6. **RBAC regression (must stay green):** confirm `dispatchTool` still re-checks RBAC for Groq-originated tool calls — provider change must not bypass the gate (CLAUDE.md rules 4, 8, 9).

**Rollout:** ship behind `FF_GROQ_ENABLED=0`; enable in a staging tenant first; watch the per-tenant cost rollup + tool-failure/fallback audit rate; then enable in production. Per CLAUDE.md, append a dated `WORKING_NOTES.md` entry and use `feat:` commits on the `build` branch (PR to `main`).

---

### Key code touchpoints (absolute paths)
- `/Users/user/Desktop/mytrion-ops/src/modules/llm/openaiClient.ts` — add `getGroq()`/`getClient()`, extend `models`.
- `/Users/user/Desktop/mytrion-ops/src/modules/llm/modelRouter.ts` — **new** router module.
- `/Users/user/Desktop/mytrion-ops/src/modules/chat/chatService.ts` — per-iteration provider/model resolution (lines ~201, ~321), `runToolCall` sanitizer + registry guard (~122), create-call retry/fallback (~211, ~339), `ChatTurnOptions` (~40).
- `/Users/user/Desktop/mytrion-ops/src/config/env.ts` — `GROQ_*` vars + `FF_GROQ_ENABLED` (~34–40, `assertRuntimeSecrets` ~171).
- `/Users/user/Desktop/mytrion-ops/src/config/constants.ts` — `MODEL_PRICING` Groq rows (~35).
- `/Users/user/Desktop/mytrion-ops/src/modules/llm/costTracker.ts` — no change needed (model-keyed already).
- `/Users/user/Desktop/mytrion-ops/src/modules/llm/promptBuilder.ts` + `buildTurnMessages` (chatService ~101) — move the per-user `userName` block out of the cached prefix.
- `/Users/user/Desktop/mytrion-ops/tests/unit/chat.test.ts` — extend mocks; add fallback/routing assertions.

**Bottom line:** Groq buys real speed and cost headroom for the high-volume tool/worker turns, and the OpenAI-compatible `baseURL` makes it a near-drop-in. Spend the integration effort on `gpt-oss-120b/20b` (not Llama), keep an OpenAI model on the final grounded answer and the hard path, and make the validate-retry-fallback-to-OpenAI guard non-negotiable — that's what converts Groq's flakier tool-calling into a safe optimization rather than a reliability regression.
