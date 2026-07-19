# Depth Gap Analysis — from a validator-with-a-conversation to a reasoning system

**AGRIVI Companion Agent · what we lack, why it matters, and exactly how to close it**
*Grounded in 2026 papers and production repos. Every claim links its source.*

---

## 0. The honest diagnosis, in one paragraph

v2 is a **reactive validator with a conversation on top**. It reads an utterance, resolves it against a static snapshot, validates it, and writes it down. That is genuinely well-built — trust-zoned, tiered, tested — but it is a *transcriptionist*, not an *analyst*. It has no memory of yesterday, no idea what the weather was when you sprayed (which a spray record is **legally required to contain**), no notion of what your spray *implies* for next week's harvest, and no ability to get better at its job over a season. A deep agent is defined by four things this one doesn't have: **it remembers, it grounds in live reality, it reasons about consequences before they happen, and it improves from its own mistakes.** This document is the map from here to there.

**The discipline that keeps this from becoming slop:** CMU's 2026 *General AgentBench* shows [test-time scaling has a ceiling — 3–7 turns is the sweet spot and more compute stops helping](https://effloow.com/articles/agent-test-time-compute-scaling-context-ceiling-2026), because context degrades faster than reasoning improves. So "depth" is **not** more agents or more loops. Depth is *targeted*: the right memory, retrieved at the right time, verified against the right rubric, with foresight applied only where a wrong record has consequences. Every proposal below is gated by "does this change a decision?" — if it doesn't, it's cut.

---

## 1. Where v2 sits on the depth ladder

The field converged in 2026 on a rough capability ladder. Here is v2, honestly placed.

| Rung | Capability | v2 status |
|---|---|---|
| 0 | Single LLM call | — |
| 1 | Tool-using workflow, deterministic control flow | ✅ **this is v2's spine** |
| 2 | Multi-agent with routing + guardrails | ✅ **v2 has this** |
| 3 | **Working memory** — resolves follow-ups, coreference, ellipsis within a session | 🟡 **partial** — slot state only, no entity memory |
| 4 | **Long-term memory** — episodic/semantic/procedural across sessions | ❌ **absent** |
| 5 | **Live grounding** — real-time retrieval, temporal reasoning | ❌ **absent** (and compliance-critical here) |
| 6 | **Foresight** — predicts consequences of an action before committing | ❌ **absent** |
| 7 | **Self-improvement** — learns from corrections without retraining | ❌ **absent** |
| 8 | **Iterative verification** — verify→refine to a quality threshold | 🟡 **one-shot critic**, doesn't iterate |

v2 is a strong rung 1–2. Everything an interviewer would call "next level" lives at rungs 3–8. The rest of this document is those six rungs.

---

## 2. The question you asked: how does an agent understand a follow-up?

You asked specifically: *"when we ask questions, how do they understand the follow-up questions?"* This is the **working-memory / coreference** problem, and it's the single most important thing to get right because every multi-turn agent lives or dies on it. Here is the full picture — current mechanism, the 2026 state of the art, and the gap.

### 2.1 What actually happens on a follow-up (the mechanism)

When a worker says *"actually make it 0.4"* or *"the second one"* or *"no, Ivana did it"*, four things must resolve:

1. **Coreference** — what does *"it" / "that one" / "the second"* point back to?
2. **Ellipsis** — *"0.4"* omits "L/ha of Luna on North Vineyard"; the omission must be filled from context.
3. **Intent** — is this a new fact, a correction, a confirmation, or a question?
4. **Scope** — does the correction replace one slot or the whole record?

Research is blunt about how hard this is: [LLMs routinely misinterpret "That one looks good" or "I did it", particularly in complex dialogues with many entities, failing to link utterances to the correct antecedents](https://arxiv.org/pdf/2504.04717). This is *the* failure mode of conversational agents.

### 2.2 How v2 handles it today (better than you'd expect, and where it breaks)

v2 does **not** throw the whole transcript at the model and hope. It uses three structured signals — this is the `ctx` object built at the top of every `turn()`:

- **`ctx.awaiting`** — the deterministic policy knows *exactly which slot it just asked for*. So a bare *"0.4"* while `awaiting === "dose"` is unambiguously a dose. This is why v2's offline parser works at all: **the open-domain follow-up collapses into a constrained one** because the machine controls the question.
- **`ctx.ambiguity.candidates`** — when disambiguating, the follow-up is matched *only against the offered candidates*, so *"the second one"* / *"south"* resolves against a 2-element list, not the whole catalogue.
- **`ctx.singleProduct` / `ctx.doseFor`** — "*rate was 0.4*" at review time attaches to the only product on file.
- **Last 8 messages** are passed to the extractor for the Claude/OpenRouter tier, so it has conversational context; the slot state (`fold(events)`) *is* the resolved dialogue state.

**This is genuinely solid for the happy path.** It's a form of *slot-based dialogue-state tracking* — the resolved state lives in the slots, not in the model's head. Where it breaks:

- **No entity memory.** If Marko *always* means South Vineyard when he says "the vineyard," v2 asks him to disambiguate every single time. A deep agent learns the antecedent.
- **No cross-turn coreference beyond slots.** *"Same as last time"* / *"the usual for this block"* is meaningless to v2 — it has no "last time."
- **Ambiguity is re-derived, never remembered.** Every session starts cold.

### 2.3 What the state of the art adds (rung 3 → done properly)

The 2026 answer to follow-up understanding is a **three-layer working memory** plus **explicit query rewriting**:

| Layer | What it holds | How it resolves a follow-up |
|---|---|---|
| **Slot / dialogue state** | the record being built (v2 has this) | *"0.4"* → the awaited slot |
| **Entity memory** | resolved referents this session ("the vineyard" = FLD-102) | *"it"* → last-committed entity of the right type |
| **Query rewriting** | a rewrite step that expands the utterance | *"same as last time"* → *"Luna Experience at 0.5 L/ha"* using long-term memory |

The rewrite step is the key upgrade: instead of asking the extractor to *both* resolve references *and* extract, a dedicated **coreference/rewrite pass** turns *"make the second one 0.4"* into a fully-specified utterance *before* extraction. This is [query rewriting for conversational systems](https://arxiv.org/pdf/2210.12775), and it's cheap — it's a classic router-tier job. Critically, research also warns the opposite failure: [when inputs are ambiguous, aligned LLMs over-hedge or silently guess rather than asking](https://arxiv.org/html/2503.22458v1) — v2's explicit `AMBIGUOUS` verdict is actually *ahead* of the average here, and we should keep it.

**The plan:** add a **Resolver agent** (router tier, quarantined) that runs *before* the extractor when `ctx` shows pending referents or the utterance contains a pronoun/ellipsis. It reads entity memory + the last turns and emits a rewritten, fully-grounded utterance. Everything downstream is unchanged. Cost: one cheap call, only on turns that need it (the router already gates this).

---

## 3. Long-term memory across sessions (rung 4) — the biggest single gap

Today, closing the tab erases everything the agent ever knew about you. The 2026 field converged hard here: [the agent ecosystem settled on a three-tier taxonomy — episodic, semantic, and procedural memory — mirroring cognitive science](https://zylos.ai/research/2026-04-05-ai-agent-memory-architectures-persistent-knowledge/).

### 3.1 The three tiers, mapped to this domain

| Tier | Definition | What it means for a farm agent |
|---|---|---|
| **Episodic** | specific past events with timestamps | "On 2026-07-10, Marko sprayed Luna 0.5 L/ha on North Vineyard" — *every prior record* |
| **Semantic** | facts distilled from many episodes | "North Vineyard is Grape, ~12.4 ha, sprayed ~monthly in season"; "Marko's licence expires 2027-03" |
| **Procedural** | learned skills and patterns | "This operator says 'the vineyard' → North; confirms fast; always gives dose in L not mL" |

### 3.2 The mechanism: dual-process consolidation (System 1 / System 2)

The best 2026 memory systems don't just log — they **consolidate**, like sleep. The [dual-process cognitive memory paper](https://arxiv.org/pdf/2606.09483) splits it: a **fast process (System 1)** answers within the context window in real time; a **slow process (System 2)** runs *offline between sessions* — encoding episodes, extracting patterns, pruning redundancy, and abstracting procedures. For us, the slow process runs after each submitted record: "another Luna application on a grape block → reinforce the semantic fact; the worker corrected 'vineyard' to South twice → update the procedural default."

### 3.3 The representation: a bi-temporal knowledge graph, not a vector blob

This is the find that matters most for *this* domain. A pile of embeddings can't answer *"is this block still inside a pre-harvest interval?"* — that's a **temporal** question. [Zep/Graphiti](https://github.com/getzep/graphiti) (20k+ stars, [94.8% on the DMR benchmark vs MemGPT's 93.4%](https://arxiv.org/abs/2501.13956)) is built exactly for this: a **bi-temporal knowledge graph** where [every fact tracks two timelines — valid time (true in the world) and ingestion time — and superseded facts are invalidated, not deleted](https://www.getzep.com/ai-agents/temporal-knowledge-graph/).

That is the natural shape of a farm's history:

- **Crop rotation is temporal:** "North Vineyard = Grape (valid 2024→…)" — a block's crop changes across seasons; a graph that invalidates-not-deletes preserves the whole rotation history for compliance.
- **A PHI window is a temporal fact:** "Luna applied 2026-07-10, re-entry until 07-12, no harvest until 07-24." Whether it's still binding is a `valid_at(now)` query.
- **Resistance management is temporal:** "3 applications of the same FRAC group on this block this season" is a graph traversal, not a similarity search.

### 3.4 The framework landscape (what to actually use)

| System | Mechanism | Standing | Fit here |
|---|---|---|---|
| [**Zep / Graphiti**](https://github.com/getzep/graphiti) | bi-temporal knowledge graph | 20k★, 94.8% DMR, 107 releases | **best fit** — temporal is the whole game |
| [**Mem0**](https://vectorize.io/articles/mem0-vs-letta) | vector + graph hybrid | 41k★, AWS Agent SDK's exclusive memory | strong default, huge adoption |
| **Letta (MemGPT)** | tiered virtual memory (core=RAM, archival=disk) | the original paradigm | good runtime model |
| **A-MEM** | Zettelkasten note-linking, evolving links | LoCoMo 0.58 | elegant, less temporal |
| **MAGMA** | multi-graph | [top LoCoMo 0.7 early 2026](https://blog.devgenius.io/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8) | research-grade |

**The plan:** the mirror stops being a static object literal and becomes a **local temporal knowledge graph** (Graphiti-style; in-browser it's IndexedDB with valid-time edges). Every committed record is an episode; the slow process consolidates semantic + procedural facts; the graph answers the foresight queries in §5. This single change moves us from rung 1 to rung 4–6 at once, because foresight and grounding both read from it.

---

## 4. Live grounding — and why it's a *compliance* requirement here, not a feature

v2 validates against a snapshot synced hours ago. The world moved. In 2026, [agentic RAG paired with a knowledge graph cut hallucination ~62% vs naive setups across 47 production deployments](https://www.brightter.com/articles/agentic-rag-five-retrieval-patterns-that-survive-production), and the frontier is **temporal RAG**: [standard RAG relies on pre-indexed documents and cannot answer questions about events that happened minutes ago](https://arxiv.org/pdf/2510.16715). For most agents live grounding is a nice-to-have. **For a spray record it is the law.**

### 4.1 The killer domain insight: weather is a legal field

A plant-protection application record in the EU/UK must capture the **conditions at application** — and wind speed governs spray drift onto neighbouring land. [METAR data provides exact wind direction and velocity, updating frequently, letting operators define spray windows and avoid contaminating neighbouring properties](https://farmonaut.com/precision-farming/precision-agriculture-2026-data-driven-advances). v2 doesn't ask for or fetch this. A deep agent **pulls the wind reading for the field's location at the application timestamp** and:

- fills a **required legal field** the worker shouldn't have to read off a gauge;
- **flags** an application logged during a wind window that breaches the drift threshold — a finding no static rule engine can produce;
- does it via **just-in-time retrieval**: the agent holds a reference (field lat/long + timestamp) and [fetches on demand rather than pre-loading](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), which is the correct pattern for a field device.

### 4.2 The other live signals worth grounding

| Signal | Source | What it changes |
|---|---|---|
| **Wind / weather at application** | weather API (METAR) | required field + drift-compliance finding |
| **Rain forecast** | forecast API | rainfastness warning ("rain in 6h, product needs 2h to set") |
| **Regulatory updates** | PPP registry feed | "this product's authorisation was withdrawn last month" |
| **Commodity / input prices** | market feed | cost-at-application on the record |
| **Pest/disease pressure** | regional model | "was there actually a fungal threat justifying this fungicide?" — the QA critic's rubric already asks this |

### 4.3 The retrieval architecture

The 2026 pattern is [agentic RAG: autonomous strategy selection, iterative execution, interleaved ReAct-style tool use](https://www.brightter.com/articles/agentic-rag-five-retrieval-patterns-that-survive-production) — the agent *decides* when a live lookup is worth it (the router already does depth decisions). Hybrid retrieval is now table stakes: [lexical + dense is no longer optional — dense misses keyword-exact matches like product SKUs, lexical misses semantic ones](https://www.callmissed.com/en/blog/vector-database-comparison-2026). Authorisation numbers and block codes are exactly the keyword-exact tokens that dense-only retrieval fumbles, so **hybrid** (BM25 + vector) is the right call.

---

## 5. Foresight — reason about the *future*, not just record the *past* (rung 6)

This is the leap from *transcriptionist* to *advisor*, and it's the one that makes an interviewer sit up. v2 records what happened. A deep agent [uses a world model to predict action consequences before execution — counterfactual reasoning and outcome prediction prior to committing, without the cost of trial-and-error](https://arxiv.org/html/2411.08794v2).

For a spray record, "the future" is concrete and valuable:

- **Harvest scheduling:** "Luna PHI is 14 days → this block can't be harvested before 2026-07-24. Your planned harvest is 07-20 — that's a violation." The agent knows the plan and the record, and reasons across them.
- **Re-entry safety:** "48-hour re-entry — nobody works this block until 07-12." A finding, surfaced at logging time.
- **Resistance management:** "This is the 3rd FRAC-7 fungicide on this block this season — rotate the mode of action or you're breeding resistance." A graph traversal over episodic memory (§3.3).
- **Nitrogen balance (fertilising schema):** "This application puts the block at 210 kg N/ha for the season — the Nitrates Directive ceiling is 170. This will breach it." The QA critic's rubric *already asks this*; today it has no data to answer with. Memory + foresight give it the data.

The best 2026 framing is [WorldEvolver: episodic memory for retrieval-based simulation, semantic memory extracting heuristic rules from prediction-observation mismatches, and selective foresight that filters low-confidence predictions before they reach the agent's reasoning](https://arxiv.org/abs/2606.30639) — all at test time, frozen weights. The **selective foresight** part matters for honesty: don't surface a prediction you're not confident in. And CMU's ceiling finding applies — [simulate only when the context warrants it, not at every decision point](https://arxiv.org/pdf/2605.22138).

**The plan:** a **Foresight agent** (privileged read of the temporal graph; the *reasoning* is quarantined) that runs at review time alongside the QA critic. It queries memory for the block's recent history and emits forward-looking findings (harvest window, re-entry, resistance, N-balance). This is where the QA critic's rubric finally has teeth.

---

## 6. Self-improvement — get better over a season without retraining (rung 7)

v2 makes the same mistake forever. If it mis-hears "Ridomil" as "Ryedale" every time, no amount of use fixes it. The 2026 answer is **not** fine-tuning — it's **evolving the agent's own context/playbook from feedback**.

### 6.1 The mechanism: an evolving playbook (ACE)

Stanford/SambaNova's [Agentic Context Engineering (ACE)](https://arxiv.org/abs/2510.04618) treats context as a living playbook with three roles — **Generator** produces trajectories, **Reflector** distills insights from successes and errors, **Curator** integrates them into structured updates — and gets [+17.1% on AppWorld from execution feedback alone, no labels, no weight updates](https://venturebeat.com/ai/ace-prevents-context-collapse-with-evolving-playbooks-for-self-improving-ai). Crucially it prevents [**context collapse** — where iterative rewriting erodes detail over time — with incremental, structured updates](https://arxiv.org/html/2510.04618v1) (the [ace-agent/ace repo](https://github.com/ace-agent/ace) is the reference). The classic ancestor is [Reflexion — storing verbal reflections in episodic memory to improve later attempts](https://arxiv.org/html/2603.24639).

### 6.2 What it looks like here

Every **correction is a training signal, for free**:

- Worker corrects "the vineyard" → South, twice → the **procedural memory** learns the default; the Resolver (§2.3) stops asking.
- A `UNREGISTERED_PRODUCT` reject that the worker resolves to "Ridomil" → learn the ASR/alias mapping "ryedale/ridomil gold" for this accent.
- The QA critic flags something a supervisor overrides → the override refines the rubric's application.

These are **component-level self-evolution** — [evolving external structures (memory, tools, skills, experience libraries) rather than model weights](https://arxiv.org/abs/2606.04703). The warning to respect: [under multi-iteration learning, naive methods suffer progressive capability collapse rather than compounding improvement](https://arxiv.org/abs/2606.04703) — so updates must be structured and reversible (ACE's discipline), never free-form rewrites.

**The plan:** a **Reflector** runs in the slow process (§3.2). It reads each session's corrections and writes structured deltas into procedural memory (alias maps, per-operator defaults, disambiguation priors). Bounded, auditable, reversible — an operator can inspect and reset what the agent "learned about them."

---

## 7. Iterative verification — the critic should argue with itself (rung 8)

v2's QA critic runs **once** and returns findings. The 2026 upgrade is a **verify→refine loop**. [Test-time rubric-guided verification](https://arxiv.org/html/2601.15808v2) runs a **DeepVerifier** that decomposes checking into ≤3 targeted sub-questions against a **failure taxonomy** (built from analyzing ~3,000 agent actions), judges the answer 1–4, and if it scores ≤2 feeds actionable corrections back for a retry — [accuracy climbs from 51%→62%+ on GAIA-Web, peaking around round 3–4](https://arxiv.org/html/2601.15808v2), exploiting the asymmetry that verification is easier than generation.

For us this is *narrow and cheap*: the critic doesn't re-review the whole record, it checks the specific rubric criteria that are hardest (dose×area plausibility, resistance, N-balance) and, if a finding is uncertain, spends one more targeted round rather than surfacing a shaky BLOCK. And it self-limits — the [CMU ceiling](https://effloow.com/articles/agent-test-time-compute-scaling-context-ceiling-2026) says stop at 3–4 rounds; more is waste.

---

## 8. The plumbing you asked about — MCP, APIs, vector DBs, policy engines

You said "include everything." Here is the integration and infrastructure layer, with the real recommendation for each.

### 8.1 MCP — the tool/integration standard

[MCP was donated to the Linux Foundation in Dec 2025; by mid-2026 there are 10,000+ public servers and an official registry](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026), with official servers for GitHub, Google, Salesforce, Stripe, and more. The production reference is [Pinterest: domain-specific MCP servers, a central registry, human-in-the-loop approval for high-risk operations, ~66,000 monthly tool invocations](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026).

**For us:** the weather feed, the PPP regulatory registry, and the **real AGRIVI 360 write API** become MCP servers. The agent's tool suite stops being hand-wired and speaks MCP — which means the same agent works against staging/prod/partner data by swapping servers. **But** heed the warning: [MCP standardizes an unprecedented attack surface, and a fragmented untrusted registry is a vector for compromise](https://medium.com/@MattLeads/6-critical-challenges-facing-the-mcp-in-2026-06258e914402). Every MCP tool call must pass through our privileged kernel and the policy engine (§8.3) — an MCP tool is *untrusted input*, exactly like a worker utterance. This is where v2's trust-zone architecture pays off: MCP servers slot into the quarantined zone by construction.

### 8.2 Storage — vector DB + temporal graph

The market consolidated to [Pinecone, Qdrant, Weaviate, pgvector](https://www.callmissed.com/en/blog/vector-database-comparison-2026). The right call for AGRIVI (an enterprise already running Postgres):

- **[pgvector](https://guptadeepak.com/tools/top-5-vector-databases-2026/)** — [the right default for ~70% of agent workloads: use it if you run Postgres, have <5M vectors, need SQL joins with vector search](https://www.callmissed.com/en/blog/vector-database-comparison-2026). A farm's records join naturally to fields/products/operators — SQL + vectors in one place.
- **Qdrant** if scale/latency demands it ([~12ms p99 at 10M vectors, best filtering](https://www.callmissed.com/en/blog/vector-database-comparison-2026)).
- **Graphiti/Neo4j** for the temporal knowledge graph (§3.3) — the memory that vectors can't represent.
- **Hybrid search (BM25 + dense) is mandatory** — auth numbers and block codes are keyword-exact.

In the single-file demo this is IndexedDB; the architecture is written so the storage backend is swappable (the outbox and mirror are already behind interfaces).

### 8.3 Governance — policy-as-code (this is v2's kernel, formalized)

Here's the satisfying part: v2 **already** does the thing the 2026 governance world is converging on. [The pattern is to decouple authorization from the LLM and offload it to a deterministic engine — OPA/Rego or Cedar — sitting in front of every tool call, moving from "hoping the agent behaves" to "enforcing boundary conditions."](https://tianpan.co/blog/2026-04-25-policy-as-code-agent-permissions-opa-rego) [AWS shipped Cedar inside Bedrock AgentCore Policy in March 2026, intercepting every agent-tool call at the gateway](https://chatforest.com/reviews/authorization-policy-engine-mcp-servers/). **Our pure tool suite is a hand-rolled Policy Decision Point.** The upgrade is to formalize it:

- rewrite the validators (`check_dose`, `check_crop_product_compatibility`, licence/date/window rules) as **[Cedar or OPA/Rego policies](https://www.permit.io/blog/policy-engine-showdown-opa-vs-openfga-vs-cedar)** — auditable, versioned, testable independently of the code, and [even generatable from natural-language rules that get formalized into Cedar](https://chatforest.com/reviews/authorization-policy-engine-mcp-servers/);
- add **role/tenant authorization** (Permit.io/OpenFGA): which operator may log against which farm, who may back-date, who may override a BLOCK;
- keep the decision point **in the privileged kernel**, exactly where v2 puts it.

This makes the compliance logic a **first-class, auditable artifact** — the thing an enterprise buyer's security review actually asks for.

---

## 9. The target architecture (all rungs, one picture)

```
UNTRUSTED            QUARANTINED (no tools/state)                 PRIVILEGED (kernel)
worker voice ─▶ Normalizer ─▶ Injection Screen ─▶ Resolver ─▶ Extractor ─▶ VERIFIER ─▶ commit
                                (rail)          (coref/rewrite)              │  (Cedar/OPA
                    ┌── Router: depth decision ──┘                           │   policy engine)
                    │                                                        ▼
   live world ─▶ Agentic RAG ──────────────────────────────────────▶ Temporal Knowledge Graph
   (weather/METAR,  (JIT, hybrid,                                     (episodic·semantic·procedural,
    PPP registry,    62%↓ hallucination)                              bi-temporal, invalidate-not-delete)
    prices)                                                                  │
                                              Foresight ◀── PHI/re-entry/resistance/N-balance
                                              QA Critic  ◀── verify→refine loop (≤4 rounds)
                                              Reflector  ◀── slow process: corrections → procedural memory
                                                                            │
                    Output rails ─▶ worker              Outbox + idempotency ─▶ AGRIVI 360 (MCP)
```

**What's new vs v2:** Resolver (rung 3), Temporal Knowledge Graph (rungs 4+6), Agentic RAG with live feeds (rung 5), Foresight (rung 6), verify→refine critic (rung 8), Reflector/slow-process (rung 7), Cedar/OPA policy engine (governance), MCP tool surface (integration). **What's unchanged:** the trust zones, the router, the SDB (proposal-is-a-claim), the outbox+idempotency failure mode. v2's spine holds all of it.

---

## 10. Prioritized roadmap — ranked by depth-per-unit-effort

Ordered so each step is independently demo-able and each unlocks the next. "Interview wow" is the honest read on what makes a reviewer lean in.

| # | Build | Rung | Effort | Interview wow | Why this order |
|---|---|---|---|---|---|
| 1 | **Temporal knowledge graph memory** (episodic + slow-process consolidation) | 4 | M | ★★★★ | unlocks 2, 3, 4 — everything reads from it |
| 2 | **Foresight agent** (PHI/re-entry/resistance/N-balance from memory) | 6 | S | ★★★★★ | the "advisor not transcriptionist" moment; small once memory exists |
| 3 | **Live weather grounding** (METAR at application → required field + drift finding) | 5 | S | ★★★★★ | compliance-critical *and* visibly magical; a real API you'll wire |
| 4 | **Resolver agent** (coreference/rewrite + per-operator entity memory) | 3 | S | ★★★ | directly answers your follow-up question; cheap |
| 5 | **verify→refine QA critic** (rubric loop, ≤4 rounds) | 8 | S | ★★★ | turns the one-shot critic into a reasoning loop |
| 6 | **Reflector / self-improvement** (corrections → procedural memory) | 7 | M | ★★★★ | "it gets better the more you use it" |
| 7 | **Cedar/OPA policy engine** (validators → auditable policy) | gov | M | ★★★ | the enterprise-buyer answer; formalizes what exists |
| 8 | **MCP tool surface + real AGRIVI API** | integ | M | ★★ | makes it real; needs the live keys you'll provide |

**If I could build only three:** #1, #2, #3. Memory + foresight + live weather is the entire jump from *"logs your work"* to *"watches your back."* That is the demo that lands.

---

## 11. What we will deliberately NOT build (depth ≠ noise)

Honesty is a feature. These are 2026-fashionable and wrong here:

- **Multi-agent debate / voting.** [2–5× compute to catch errors self-critique misses](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production) — but our ground truth is a database lookup. A second opinion about a fact you can *look up* is a category error.
- **Unbounded test-time loops.** [CMU: scaling has a ceiling at 3–7 turns; context degrades faster than reasoning improves](https://effloow.com/articles/agent-test-time-compute-scaling-context-ceiling-2026). Every loop is capped.
- **Fine-tuning per farm.** [Component-level self-evolution (evolving memory/context) beats weight updates and avoids capability collapse](https://arxiv.org/abs/2606.04703). No training pipeline.
- **A general "farm assistant" that does everything.** [12-factor #10: small, focused agents](https://github.com/humanlayer/12-factor-agents). This logs work orders extremely well. Scope is a feature.
- **Parametric/skill memory (Voyager-style code skills).** Overkill for structured records; the temporal graph is the right memory shape here.

---

## 12. The one-sentence version for the walkthrough

> *v2 proves the agent can be trusted to write a legal record. The next version proves it can be trusted to **think about one** — it remembers every application on the block, checks the wind at the moment you sprayed, warns you the harvest window just closed, and quietly gets better at understanding you every time you correct it — all on the same trust-zoned, offline-capable spine, with the reasoning still fenced away from the writes.*

---

### Sources

Multi-agent & depth: [12-factor-agents](https://github.com/humanlayer/12-factor-agents) · [Anthropic Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) · [CMU test-time ceiling](https://effloow.com/articles/agent-test-time-compute-scaling-context-ceiling-2026) · [multi-agent cost](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production)
Memory: [three-tier taxonomy](https://zylos.ai/research/2026-04-05-ai-agent-memory-architectures-persistent-knowledge/) · [dual-process cognitive memory](https://arxiv.org/pdf/2606.09483) · [Zep/Graphiti](https://github.com/getzep/graphiti) · [Zep paper](https://arxiv.org/abs/2501.13956) · [temporal KG](https://www.getzep.com/ai-agents/temporal-knowledge-graph/) · [Mem0 vs Letta](https://vectorize.io/articles/mem0-vs-letta) · [memory systems compared](https://blog.devgenius.io/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8)
Follow-ups/coreference: [multi-turn survey](https://arxiv.org/pdf/2504.04717) · [agent multi-turn eval survey](https://arxiv.org/html/2503.22458v1) · [conversational query rewrite](https://arxiv.org/pdf/2210.12775)
Self-improvement: [ACE](https://arxiv.org/abs/2510.04618) · [ACE / context collapse](https://venturebeat.com/ai/ace-prevents-context-collapse-with-evolving-playbooks-for-self-improving-ai) · [ace-agent/ace](https://github.com/ace-agent/ace) · [experiential reflective learning](https://arxiv.org/html/2603.24639) · [continual experience internalization](https://arxiv.org/abs/2606.04703)
Verification: [rubric-guided verification](https://arxiv.org/html/2601.15808v2)
Grounding & foresight: [agentic RAG patterns](https://www.brightter.com/articles/agentic-rag-five-retrieval-patterns-that-survive-production) · [temporal RAG](https://arxiv.org/pdf/2510.16715) · [spray/weather precision-ag](https://farmonaut.com/precision-farming/precision-agriculture-2026-data-driven-advances) · [WorldEvolver](https://arxiv.org/abs/2606.30639) · [world models for decisions](https://arxiv.org/html/2411.08794v2) · [self-regulated simulative planning](https://arxiv.org/pdf/2605.22138) · [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
Plumbing: [MCP in 2026](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026) · [MCP registry](https://registry.modelcontextprotocol.io/) · [MCP servers](https://github.com/modelcontextprotocol/servers) · [MCP risks](https://medium.com/@MattLeads/6-critical-challenges-facing-the-mcp-in-2026-06258e914402) · [vector DB comparison](https://www.callmissed.com/en/blog/vector-database-comparison-2026) · [pgvector](https://guptadeepak.com/tools/top-5-vector-databases-2026/) · [policy-as-code for agents](https://tianpan.co/blog/2026-04-25-policy-as-code-agent-permissions-opa-rego) · [policy engine showdown](https://www.permit.io/blog/policy-engine-showdown-opa-vs-openfga-vs-cedar) · [Cedar/OPA for agents](https://chatforest.com/reviews/authorization-policy-engine-mcp-servers/) · [deepagents](https://github.com/langchain-ai/deepagents)
