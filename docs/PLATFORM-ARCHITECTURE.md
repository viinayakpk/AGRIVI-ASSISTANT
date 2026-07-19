# From a demo farm to a general agriculture agent platform

**What changed, why, and how the pieces fit — grounded in 2026 sources, verified in code.**

> **Note:** the resilient-gateway/Docker path this document describes (`gateway/server.js`, `docker-compose.yml`) was prototyped during development and later removed to keep the submission to exactly what the brief asks for — one HTML file, open it, it works. Everything it describes that's still true of the shipped app (tenant seam, MCP research, web search agent, session identity) is implemented in `dist/agrivi-companion.html`; the server-side hardening sections are kept here as a design record, not as a description of what ships.

---

## 0. The complaint, taken seriously

*"Marko Horvat"* and *"Slavonija Estate"* were showing up baked into the UI. That's not a copy problem — it's a symptom of a real architectural gap: the engine was **one farm's data wearing an engine**, not an engine with a farm's data loaded into it. If the only way to point this system at a different farm, a different crop mix, a different country's product registry is to hand-edit a JavaScript object literal, it isn't a platform. This document is about closing that gap, and about the three other things you asked for — MCP, web search, and resilient plug-and-play — landing in the same architecture rather than bolted on separately.

**The industry answer, confirmed by research, is the same shape we already had half-built:** [multi-tenant systems separate the engine from the tenant's data — same code, same servers, different config per tenant](https://brocoders.com/blog/multi-tenant-architecture-designing-saas-apps/), and [the tenant must be resolved before the first query is handled, with that context held for the whole request](https://gainhq.com/blog/multi-tenant-architecture/). We had a reducer, a verifier, trust zones, memory, foresight — a real engine — pointed at one hardcoded farm. The fix is the seam, not a rewrite.

---

## 1. The tenant seam — implemented, not just proposed

`MIRROR` (farm, fields, products, operators) is now a **swappable binding**, not a constant. `DEFAULT_TENANT` holds the AGRIVI reference data; `AGRIVI.loadTenant(config)` replaces it at runtime, and every agent, tool, and rail re-derives against the new data on the next turn — because all 33 call sites already read `MIRROR.xxx` at call time, not at definition time. That's what made this a safe, surgical change rather than a rewrite: the seam was already implicit in how the code was written, it just needed to be named and exposed.

**Proven, not asserted.** A test loads a completely different tenant — a maize co-op in Kenya, different fields, a different product (`Bestox`), a different operator (`Amina Wanjiru`), a different licensing scheme — and drives a real conversation through it:

```
✓ boots on the AGRIVI reference tenant
✓ engine now runs on the NEW tenant's data
✓ old AGRIVI fields are gone — no leakage between tenants
✓ the SAME engine validates the new tenant's field
✓ ...and the new tenant's product
✓ ...and derives the new tenant's crop
✓ compatibility rules still run correctly on tenant data
```

Same reducer. Same verifier. Same trust zones. Same idempotent outbox. Different farm, different country, different crop — zero code change. That is the platform claim, made concrete.

**What's still a demo simplification, honestly stated:** the tenant is loaded client-side, once, into a single browser session. Production multi-tenancy needs the tenant resolved **server-side** at the gateway, before the request reaches any agent — [row-level or schema-level isolation, resolved from a subdomain/API-key/JWT claim, not a runtime function call](https://www.adeptdev.io/blogs/multi-tenant-architecture-a-practical-guide-for-saas-founders-in-2026). The gateway (`gateway/server.js`) is exactly where that resolution belongs — `/api/session?id=` already scopes conversations per id; the next step is scoping *tenant config* the same way, keyed off the same id. The seam is proven at the engine level; wiring it through the gateway is the remaining production step, not a design gap.

---

## 2. MCP — the plug-in surface for agriculture data

You asked for MCP servers to be part of this. Here's the honest state of that ecosystem and where it plugs in.

[The agriculture MCP ecosystem is thin but real — about 20 servers, with genuine substance](https://dev.to/grove_chatforest/agriculture-farming-mcp-servers-leaf-john-deere-farmerchat-weather-satellite-imagery-hkb):

| Server | What it adds | Plugs into |
|---|---|---|
| **[Leaf Agriculture MCP](https://withleaf.io/en/whats-new/leaf-mcp-launch/)** | The only commercial vendor server — aggregates field boundaries, machine operations, satellite imagery, and weather from **John Deere, Climate FieldView, CNHi, AGCO, Trimble** in one place | Would replace/augment `MIRROR.fields` with a live farm-equipment feed instead of a static tenant config |
| **[agri-weather-mcp](https://dev.to/grove_chatforest/agriculture-farming-mcp-servers-leaf-john-deere-farmerchat-weather-satellite-imagery-hkb)** | Soil temperature/moisture at multiple depths, evapotranspiration (ET₀), crop-specific growth-stage alerts — built on Open-Meteo, the same keyless provider our gateway already uses | Extends `groundWeather()` — same function, richer payload |
| **[Axion-MCP](https://dev.to/grove_chatforest/agriculture-farming-mcp-servers-leaf-john-deere-farmerchat-weather-satellite-imagery-hkb)** (Google Earth Engine) | NDVI/NDWI/EVI/SAVI satellite vegetation indices, 30+ datasets, cloud-free composites | The exact NDVI grounding source named in `DEPTH-GAP-ANALYSIS.md` Tier 2 — now a concrete server to point at instead of a research direction |
| **NASA POWER (via the generic Agriculture MCP server)** | Historical climate back to 1981, global agriculture statistics | Backs long-horizon Foresight queries ("is this season's rainfall anomalous for this block") |

**Why none of these are wired in yet, and that's the right call for now:** every one of them needs a live account/credential from a real farm-equipment or satellite provider — there's nothing to demo without one. What *is* built is the seam they plug into: the gateway's resilience pipeline (rate-limit → cache → circuit-breaker → retry → fallback) is provider-agnostic — an MCP server is just another upstream behind `resilientCall()`, exactly like Open-Meteo is today. Adding Leaf or Axion later is a new `handleX()` function in the gateway plus a `groundX()` call in the frontend, following the pattern `groundWeather()` already establishes. The architecture doesn't need to change to add them; it needs credentials.

**The trust boundary still applies.** Per [OWASP's 2026 guidance, an MCP tool result is untrusted input, no different from a worker's utterance](https://medium.com/@MattLeads/6-critical-challenges-facing-the-mcp-in-2026-06258e914402) — it does not get to write a slot or select an action directly. Any future MCP integration lands in the **quarantined** zone, same as the Chat and Advisor agents, with the kernel deciding what to do with what it returns.

---

## 3. Web search — wired, deterministic-gated, cited

**Native, not a bolted-on scraper.** OpenRouter's web-search plugin is the mechanism: attach `plugins:[{id:"web", max_results:N}]` to a chat-completion request and [the model can ground an answer in live pages, with citations returned as `url_citation` annotations](https://openrouter.ai/docs/features/web-search) — no separate search API, no separate cost accounting to build.

**The decision to search is deterministic, not the model's to make autonomously.** This matters architecturally: every quarantined agent in this system is denied tool access by construction — it emits a typed answer, never an action. Handing the *decision to search the live web* to the model itself would be exactly the kind of autonomy the trust-zone design exists to avoid. So `needsWebSearch(text)` is a plain keyword gate (same discipline as the router's other fast paths) — *"what's wheat trading at today"* trips it, *"what's the PHI on Luna"* doesn't (that's answered from the label data already in context, and asking the web for it would be a worse, unverifiable answer to a question the mirror answers exactly). The **kernel** decides whether this turn is allowed off the farm's data; the Chat agent only ever executes what it's told.

```
✓ 'what's wheat trading at today' → needs search
✓ 'any news on fungicide bans' → needs search
✓ 'what's the PHI on luna' → does NOT need search (local label data)
✓ 'what dose of luna should I use' → does NOT need search
```

Citations render as a footer under the answer, sourced from the response's own annotations — never invented by the model, never presented without a link.

---

## 4. The LLM call path now actually uses the resilient gateway

This was a real gap, found while wiring the above: **the frontend was calling OpenRouter directly from the browser** (client-side key, no failover) for every agent, while the gateway's `/api/llm` — with its per-tier model fallback chains — sat unused. Weather already went through the gateway; the LLM path didn't. That inconsistency is fixed:

```
served over http(s)  → POST /api/llm  → gateway walks a per-tier fallback chain
                                          (e.g. chat-class: claude-haiku-4.5 →
                                          gemini-2.5-flash-lite → mistral-nemo)
                                          key stays server-side, never in the browser
opened as file://    → direct-to-OpenRouter (client-side key) — the zero-install
                        demo path, unchanged, for when there is no gateway at all
```

Every agent (`screen`, `router`, `normalizer`, `extractor`, `planner`, `critic`, `advisor`, `chat`) is now mapped to a gateway resilience tier via `AGENT_TIER`. **This is the "when an API fails, it gets up" property you asked for, made literal:** if `claude-haiku-4.5` is down or rate-limited, the gateway silently serves `gemini-2.5-flash-lite` instead and the frontend never sees a difference except which model answered. If every model in the tier is down, the call fails cleanly and the existing three-tier proposer takes over — Gemini Nano on-device, then the deterministic parser. Three independent layers of "it doesn't have any issues": model-level fallback chain → provider-tier fallback (OpenRouter → Nano → deterministic) → circuit breakers per agent that open after repeated faults and self-heal after a cooldown.

---

## 5. What "general-purpose agriculture agent" means here, precisely

Not: a model that free-associates about farming. **A platform with three separable layers**, each independently swappable:

```
┌─ TENANT DATA ──────┐   ┌─ ENGINE (this repo) ──────────┐   ┌─ EXTERNAL GROUNDING ──┐
│ fields, products,  │──▶│ trust zones · reducer ·       │◀──│ weather (keyless,     │
│ operators, crops   │   │ verifier · memory · foresight │   │  live) · web search    │
│ (AGRIVI.loadTenant) │   │ · QA critic · outbox+idem-    │   │ (deterministic-gated) │
│                     │   │  potency · circuit breakers   │   │ · MCP (Leaf/Axion/    │
│                     │   │                                │   │  NASA — seam ready)   │
└─────────────────────┘   └────────────────────────────────┘   └───────────────────────┘
```

- **Swap the tenant** → a different farm, different country, different crop mix. Proven with the Kenya test above.
- **Swap the grounding** → weather is Open-Meteo today, `agri-weather-mcp` tomorrow, without touching the engine — the pattern is already established (`resilientCall()` doesn't care what's behind it).
- **The engine never changes.** The reducer, the verifier, the trust-zone boundary, the outbox's idempotency guarantee, the circuit breakers — none of that is AGRIVI-specific. It's a general "collect a structured, validated, auditable record of field work, safely and resiliently" engine that happens to ship with AGRIVI as its reference tenant.

That's the honest version of "not just this one use case": the *engine* was always general-purpose (schema-driven work orders, tenant-agnostic reducer); what was missing was proof that the *data* could be swapped without touching the code, and a real answer for "what happens when the network or a provider fails." Both are now in the repo, tested, not just described.

---

## 6. Session identity — never assumed, only ever told

**The bug that started this round of hardening:** the app greeted a worker by a name it had never been told — "Hi Marko" — pulled from `MIRROR.currentUser`, the tenant's *scripted-demo* default, not a fact about whoever actually picked up the device. Any worker, on any shift, on any device, got addressed as if they were a specific named person. That's not a copy bug; it's the same class of error as guessing a slot value instead of asking — the exact thing the verifier exists to prevent everywhere *except*, it turned out, this one spot outside the schema.

**The fix treats identity as a fact to be *established*, not configuration to read.** `S.identity` is folded state, set by exactly one event — `IDENTITY_ESTABLISHED` — which fires only when:

- the worker uses a genuine self-reference ("I did it", "it was me") **and** the system already knows who they are, or
- the worker directly answers the one question the system is allowed to ask back: *"I don't know who you are yet — what's your name?"*

Never from tenant config, never guessed from a greeting, never carried over from a previous session (`baseState()` resets it; a new conversation starts with `identity: null`, same as every other slot). Consequences:

```
"hi"                          → a plain greeting back — no name, because none is known
"I did it"  (unknown identity) → REJECT / IDENTITY_UNKNOWN — "what's your name?" (not a guess)
"Marko Horvat"  (answering)    → operator slot resolves AND identity is established for the session
"Ivana sprayed it" (coworker)  → operator slot resolves to Ivana — but does NOT make the app think YOU are Ivana
```

**A second, sharper bug surfaced while testing the fix, not while building it — which is the point of writing isolated tests instead of trusting the broad flow.** A worker with a genuinely *expired* spray licence would self-identify ("I did it") and the system would correctly refuse to certify *that record* (`LICENCE_EXPIRED`) — but the refusal was also silently swallowing the fact that we'd just learned who was talking, so the very next turn would ask "what's your name?" again. **Knowing who is speaking and whether they're licensed to be credited with this specific regulated action are two different questions**, and `resolve_operator` had conflated them into one verdict. Fixed: `establishesIdentity` is now computed once the name resolves to a real roster entry, and is carried on *either* verdict — the licence check can still refuse the record, but it no longer also revokes the fact that the session now knows who it's talking to.

**Defense in depth, because a system prompt is an instruction, not a guarantee.** Even with all of the above, the LLM-backed Chat agent is still a stochastic component — telling it "don't guess a name" in the system prompt reduces the failure rate, it doesn't eliminate it. `stripGuessedGreeting(answer, knownIdentity)` deterministically strips a guessed-name greeting from the model's own output before it ever reaches the worker, checked against the *real* operator roster, independent of whether the model complied. Nothing in this codebase trusts an LLM's claim without a check that would still catch it lying.

---

## 7. Multi-agent collaboration, reinforced — what actually happens on one turn

Twelve agents now, not nine — Foresight, Chat, and Web Search have joined the roster since the README's original count (Chat and Foresight as new conversational/temporal capability, Web Search promoted out of Chat into its own independently-toggleable agent this round). The roster is only worth having if the collaboration is real — each agent doing a job the others structurally can't — so here is one concrete turn, traced:

**Worker types:** *"sprayed north vineyard with luna 0.5 l/ha today"*

```
Screen      (Q)  is this an attack on the system? → PASS, ordinary field report
Router      (Q)  chitchat, question, or work order? → "provide" — extraction path, skip chat/advisor entirely
Extractor   (Q)  READ ONLY — pulls field_text, product_text, dose, date as raw spans.
                 Never resolves an id, never decides validity — "be right about what was SAID"
Verifier    (P)  the only privileged writer. Calls resolve_field, resolve_product,
                 check_crop_product_compatibility, check_dose, check_date — each a pure
                 deterministic tool against the AGRIVI mirror. Commits or rejects per slot.
Foresight   (P)  deterministic, offline, reads the temporal memory graph — was this block
                 already sprayed with something incompatible this season? Runs on EVERY
                 record; needs no model, so it never degrades.
Critic      (Q)  only if a model is available — rubric-scored QA a rules engine can't do
                 ("is 0.5 L/ha on a 12ha block a plausible single tank run?")
```

That's six agents for one turn, and the division isn't decorative:

- **Extractor vs. Verifier** is the whole trust boundary in miniature — a stochastic component is allowed to *propose* a span of text, never to decide it's valid. Only the deterministic Verifier mints an id or commits a slot.
- **Foresight vs. Critic** is deterministic-always vs. model-when-available doing genuinely different reasoning — Foresight answers questions only a memory graph can answer (*has this happened before, and when*); Critic answers questions only a model's judgement can approximate (*does this look right*). Collapsing them into one agent would mean the memory-backed check silently degrades when the network does, which is exactly the failure the split prevents.
- **Router runs first and gates the rest** — the architectural answer to [multi-agent's +58–285% token tax](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production): a "hi" or "what's the PHI on Luna" never reaches the Extractor/Verifier/Foresight/Critic chain at all (see the Chat/Advisor/Web-Search path just below).

**The other path — a question, not a work order — exercises a different three agents**, which is the reinforcement worth naming explicitly:

```
Router      (Q)  routes to "question" or "chitchat", not "provide"
Web Search  (Q)  ONLY if the kernel's keyword gate decided this needs live data
                 (independently toggleable — off by default is one click away) —
                 the DECISION to leave farm data is deterministic, never the model's own call
Chat        (Q)  answers from farm data + memory; falls back to local canned replies
                 with zero cost if no model/network is available
```

Web Search is deliberately **not** a tool the Chat agent can reach for on its own judgement — every quarantined agent in this system is denied tool access by construction, and "should this turn leave the farm's data and hit the open web" is exactly the kind of decision the trust-zone boundary exists to keep out of a model's hands. `needsWebSearch(text)` is a plain keyword gate, same discipline as the router. The Chat agent only ever executes what the kernel already decided.

---

## 8. Weather grounding — now on every record type, not just spraying

Wind speed was already a **legally required field on a spray record** (drift onto neighbouring land), so `groundWeather(fieldId)` — live, keyless, via Open-Meteo — was wired in for `SPRAYING` only. That was too narrow: conditions at time of work are useful context on a harvest (was it dry enough to bring the crop in cleanly?), a fertiliser application (rain forecast in the next 6h matters for runoff, not just rainfastness), or a generic work order (what were conditions like when the irrigation was checked?). Conditions are now fetched and attached to **every** completed record — informational only, exactly as before: it degrades to `null` on any outage and never blocks or delays a submission.

The one thing that *didn't* broaden is the interpretive **findings** in `AgentForesight`: a "spray drift" or "confirm the product is rainfast" warning only makes sense for an actual product application. Those two checks stayed scoped to `SPRAYING`/`FERTILIZING` — attaching the raw data everywhere was the right call; attaching spray-specific *interpretation* of that data to a harvest record would have been nonsense dressed up as thoroughness.

---

## 9. Cost & guardrails — researched from real adoption, not guessed

Money was named the top priority for this round, with an explicit ask for research grounded in real, high-adoption GitHub projects rather than generic advice. Findings below are sourced against repos actually fetched, ranked by (adoption × applicability to a 12-small-agent system that already does per-agent model tiering, circuit-breaker fallback chains, and a fully offline deterministic tier).

**Implemented — prompt caching, the highest-leverage and lowest-risk item found.** [Anthropic's and OpenAI's native prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) discounts a **repeated** prompt prefix by ~90% on a cache hit ([OpenAI's is automatic above 1,024 tokens](https://openai.com/index/api-prompt-caching/); Anthropic needs an explicit `cache_control` breakpoint, [which OpenRouter passes through](https://openrouter.ai/docs/features/prompt-caching)). This system's Extractor and Chat agents both re-send a large, mostly-static block on every call — the field/product/operator catalogue, the persona and rules text — while only a small suffix (a "what are we waiting for" hint, or a memory-recall snippet) actually changes turn to turn. `openrouter()` now accepts `opts.cacheSplit`: the static prefix is sent as its own `cache_control:{type:"ephemeral"}` content block, the volatile remainder as an uncached block after it — same total information reaching the model, same behaviour, cheaper on a repeat call within a session. [ProjectDiscovery](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching) (the security-tooling org behind `nuclei`) reports cutting LLM spend by roughly 60–70% from this alone. Structurally verified by 8 assertions (`cache.js`) that inspect the actual request payload — the split happens only when the claimed prefix genuinely matches and clears a worthwhile length, and degrades safely to the old plain-string format otherwise (including when a caller's `cacheSplit` claim turns out to be wrong — never sends a corrupted request). **Honest limit:** this app's own `bill()` cost estimator still prices every token at full rate — it doesn't know the real cache-discounted price, because that requires a live key and a real response to inspect. The *mechanism* is proven; the *dollar figure* can only be confirmed against a live OpenRouter account.

**Implemented — a semantic response cache for the Advisor, adapted from [`zilliztech/GPTCache`](https://github.com/zilliztech/GPTCache)'s idea (8.1k★, claims 10× cost / 100× latency on hits): cache by similarity, not exact string match.** Rather than pull in an embedding model and a vector store for a single-file app, `semCacheGet`/`semCacheSet` reuse `sim()` — the same lexical/token-overlap scorer that already does fuzzy field/product/operator matching elsewhere in this codebase. That's a coarser proxy than a real embedding index, honestly scoped: it catches the same label question re-typed ("what's the PHI on luna" / "whats the phi on luna please" / "PHI on luna"), not a full paraphrase with no shared words. **A real trap surfaced while testing it, not while building it:** whole-string similarity scores *"PHI on luna"* vs. *"PHI on signum"* at **~0.79** — HIGHER than it scores the legitimate Luna reword above (~0.6). A product name is a small fraction of the sentence, so swapping it barely moves the score — no single threshold can separate "same question, reworded" from "same words, different product" once you're comparing whole strings. Fixed by partitioning the cache namespace on the product actually named in the question (reusing the same `match()` fuzzy-resolver the verifier already trusts for `resolve_product`) — only *within* that partition is a loose similarity threshold (0.6) safe to apply to the phrasing. Deliberately scoped to **Advisor only**: its label data is static for the whole session, so a hit can never be stale. Extractor is excluded on purpose — a "similar" utterance can carry a different dose number, and a wrongly-reused cached extraction would fabricate a value on a legal record. Chat is excluded too — its answer depends on session identity and a live memory-recall snippet that change turn to turn. **Cost savings only where they cannot cost correctness.** 12 assertions (`semcache.js`) include the cross-product collision case as a named regression, not an incidental pass.

**Researched, not yet wired in — the next two, in adoption order:**

| Technique | Project | Real-world claim | Where it would plug in |
|---|---|---|---|
| Confidence-based model cascades | [`lm-sys/RouteLLM`](https://github.com/lm-sys/RouteLLM) (5.2k★, LMSYS/Chatbot Arena team) | Up to 85% cost cut at 95% of top-model quality on MT-Bench | Escalate Critic from `gemini-flash-lite` to `claude-opus` only when a cheap first pass reports low confidence, instead of always paying the 500× tier |
| Unified gateway w/ embedding-based semantic cache | [`BerriAI/litellm`](https://github.com/BerriAI/litellm) (54k★, production use at Netflix/Rocket Money per their materials) | Built-in Redis semantic caching, weighted failover | Would subsume the hand-rolled `LLM_CHAINS` fallback in `gateway/server.js` and upgrade the lexical Advisor cache above to real embedding similarity, safely, at the gateway rather than the browser |

**Guardrails — what's real vs. niche**, from the same pass: [`guardrails-ai/guardrails`](https://github.com/guardrails-ai/guardrails) (7.2k★, schema-validated structured output) and [`NVIDIA/NeMo-Guardrails`](https://github.com/NVIDIA/NeMo-Guardrails) (6.7k★, programmable dialog/input/output rails) are the two with genuine adoption; both map onto capability this system already has by construction rather than by add-on library — every quarantined agent's output is already JSON-schema-constrained (`response_format:{type:"json_schema",strict:true}`, the same idea Guardrails AI packages as a separate product), and the CaMeL trust-zone split *is* a dialog/execution rail, just implemented directly rather than through NeMo's config DSL. The [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) is worth keeping as a standing checklist (LLM01 prompt injection is what the Screen agent exists for; LLM06 excessive agency is what "no Q-agent holds a tool binding" exists for) rather than a library to install.

---

## 10. Future work — named, not vague

**A company-policy knowledge base an agent can cross-verify against.** Every rule this engine currently enforces is a *legal* minimum — the Nitrates Directive ceiling, the PPP label range, the PHI window. A real farm operator often layers **stricter internal policy** on top: a company-wide no-spray window tighter than the legal rainfastness note, an approved-product shortlist narrower than what's legally permitted, a blackout period around a neighbouring organic certification. None of that lives in AGRIVI's regulatory data, and it shouldn't be hardcoded into the engine — it's tenant-specific, changes over time, and is exactly the kind of thing that should be *retrieved*, not compiled in. The seam is the same one §2 already describes for MCP: a policy document store (start as simple keyword/section retrieval over uploaded PDFs/markdown; a proper vector index is a swap-in later, not a redesign) that the Critic or a new dedicated Policy agent queries at review time, returning findings the same shape Foresight and Critic already emit — `{severity, criterion, message}` — with a citation back to the policy document and section. Same trust boundary as MCP: retrieved policy text is untrusted input, quarantined, never a direct write — it can only ever *add* a finding for the deterministic kernel to surface, the same way Foresight and Critic already do. This is genuinely additive to record quality (a policy violation the law wouldn't catch, but the company would) and fits the architecture without touching the reducer.

**Voice and image, deliberately deferred.** Both were raised and explicitly set aside for later rather than folded in now: voice input would sit *before* the Normalizer (ASR disfluency is exactly what that agent already exists to clean up — "pola litre" → 0.5 L is the same problem whether it arrived typed or transcribed), and a photo of a product label or a field condition would be a new quarantined vision-capable agent proposing a raw span (a product name, a visible symptom) for the *same* deterministic Verifier to resolve or reject — never a new privileged path. Both are real, scoped, and consistent with the existing trust boundary; they're future work because they're new capability, not because they'd require re-architecting anything above.

---

## 11. Verification

**214 assertions green** across nine suites — the 102 covering the engine's conversational core, 9 circuit-breaker state-machine tests, 36 + 16 from the v2 conversation/outbox harnesses, the tenant seam (7), the web-search decision gate + tier mapping (8), 16 dedicated to session identity (established-from-conversation, coworker-vs-self distinction, cross-session reset, the licence/identity-conflation fix, and the deterministic defense-in-depth strip), 8 proving the prompt-caching request-payload shape, and 12 for the Advisor's semantic cache — including the cross-product collision case as a named regression, not an incidental pass. Gateway boots clean, serves the app, and reports its session/LLM/weather status over `/health`.

---

### Sources
Multi-tenant architecture: [Brocoders 2026 guide](https://brocoders.com/blog/multi-tenant-architecture-designing-saas-apps/) · [tenant resolution before first query](https://gainhq.com/blog/multi-tenant-architecture/) · [practical SaaS guide](https://www.adeptdev.io/blogs/multi-tenant-architecture-a-practical-guide-for-saas-founders-in-2026)
Agriculture MCP servers: [Leaf, John Deere, weather, satellite — ChatForest survey](https://dev.to/grove_chatforest/agriculture-farming-mcp-servers-leaf-john-deere-farmerchat-weather-satellite-imagery-hkb) · [Leaf MCP launch](https://withleaf.io/en/whats-new/leaf-mcp-launch/)
MCP trust boundary: [6 critical MCP challenges 2026](https://medium.com/@MattLeads/6-critical-challenges-facing-the-mcp-in-2026-06258e914402)
Web search: [OpenRouter web search plugin docs](https://openrouter.ai/docs/features/web-search) · [Anthropic web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
Agriculture AI platform architecture 2026: [autonomous farm management platforms](https://codenicely.in/blog/businesses/agritech/ai-agents-agriculture-autonomous-farm-management-platforms-2026) · [agricultural AI agent architecture survey](https://doi.org/10.3390/app16115389)
Prompt caching: [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [OpenAI automatic prompt caching](https://openai.com/index/api-prompt-caching/) · [OpenRouter prompt caching passthrough](https://openrouter.ai/docs/features/prompt-caching) · [ProjectDiscovery's real-world 60–70% cut](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)
Cost-saving multi-model patterns: [`lm-sys/RouteLLM`](https://github.com/lm-sys/RouteLLM) · [RouteLLM launch post](https://www.lmsys.org/blog/2024-07-01-routellm/) · [`stanford-futuredata/FrugalGPT`](https://github.com/stanford-futuredata/FrugalGPT) · [FrugalGPT paper](https://arxiv.org/abs/2305.05176) · [`BerriAI/litellm`](https://github.com/BerriAI/litellm) · [LiteLLM caching docs](https://docs.litellm.ai/docs/caching/all_caches) · [`zilliztech/GPTCache`](https://github.com/zilliztech/GPTCache) · [`aurelio-labs/semantic-router`](https://github.com/aurelio-labs/semantic-router) · [Anthropic Message Batches API](https://www.anthropic.com/news/message-batches-api)
Guardrails: [`guardrails-ai/guardrails`](https://github.com/guardrails-ai/guardrails) · [`NVIDIA/NeMo-Guardrails`](https://github.com/NVIDIA/NeMo-Guardrails) · [`protectai/llm-guard`](https://github.com/protectai/llm-guard) · [`microsoft/PyRIT`](https://github.com/microsoft/PyRIT) · [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/)
