# Change Plan — turning the gap analysis into code

**Companion of [`DEPTH-GAP-ANALYSIS.md`](DEPTH-GAP-ANALYSIS.md). What we change, in what order, and what to expect after each change.** (Written when the app was still one file; the same engine now lives in `src/`, built to `dist/agrivi-companion.html` — see the root README.)

This is the delivery document: every change is named against a real function/section in the current file, has a measurable expected outcome, and has a verification step. Nothing here is aspirational — it's a work order.

---

## 0. Principles that don't change

Three things stay fixed, because they're what make the additions safe:

1. **The event log is the truth.** `state = fold(events)`. Every new capability is either a new event type or a new reducer branch. This means **every change is reversible and replayable** — we can ship memory, watch it fold wrong, and roll back by ignoring an event type. No migration, no data loss.
2. **The SDB holds.** New agents (Resolver, Foresight, Reflector) are **quarantined proposers** — they read, they never write state or mint ids. The verifier stays the only authority.
3. **Depth is gated.** Per CMU's ceiling finding, every new agent runs *only when it changes a decision*. The router already owns depth; new agents extend its decision table, they don't run unconditionally.

---

## 1. The three phases at a glance

| Phase | Ships | The demo becomes | Depends on |
|---|---|---|---|
| **P1 — Memory & Foresight** | temporal graph, episodic memory, slow-process consolidation, Foresight agent | *"It remembers every application on this block and warns you the harvest window just closed."* | nothing (offline-capable) |
| **P2 — Live grounding** | weather/METAR at application, agentic-RAG retrieval, hybrid lookup | *"It filled in the wind reading for you and flagged a drift risk."* | one weather API key |
| **P3 — Resolution, self-improvement, governance** | Resolver (coreference), verify→refine critic, Reflector, Cedar/OPA policy, MCP surface | *"It understands 'the usual', gets better when you correct it, and the compliance rules are an auditable policy file."* | OpenRouter key; real AGRIVI API |

Each phase is independently shippable and demo-able. **P1 is the jump** — memory + foresight is the whole "advisor not transcriptionist" moment, and it needs no new credentials.

---

## PHASE 1 — Memory & Foresight (the big jump)

### 1.1 Temporal memory graph — new `§MEMORY` section

**What we add.** A local temporal knowledge graph replacing the static role of the mirror for *history*. The mirror stays as master-data (fields/products); memory is the *events over time*.

- **New data structure — `MEM`:** an append-only set of **bi-temporal facts** `{ subject, predicate, object, validFrom, validTo, recordedAt, sourceEvent }`. Invalidate-not-delete: a superseded fact gets `validTo` set, never removed (per [Zep/Graphiti's bi-temporal model](https://github.com/getzep/graphiti)).
- **New event → memory hook:** on `SERVER_RECORD_COMMITTED`, write episodic facts:
  `block NV-1 —sprayed→ Luna (validFrom=date, product=PPP-1042, dose=0.5)`,
  `block NV-1 —under_phi_until→ 2026-07-24`,
  `block NV-1 —re_entry_until→ 2026-07-12`.
- **New query API — `mem.validAt(subject, predicate, whenISO)`** and `mem.history(subject)`. These are the functions Foresight and grounding call.
- **Persistence:** IndexedDB in the browser (the file already persists the event log to `localStorage`; memory derives from it, so it's rebuildable by replay — crash-safe for free).

**Files/functions touched:** new `§MEMORY` block after `§6 event log`; hook in `reduce()` case `SERVER_RECORD_COMMITTED`; boot replay rebuilds `MEM` from events.

**Before → after:** today a second spraying on the same block knows nothing about the first. After: the block carries its full application history, queryable by time.

**Expected outcome (measurable):** after logging two records on one block, `mem.history("NV-1")` returns both; `mem.validAt("NV-1","under_phi", today)` returns true/false correctly across the PHI boundary.

**Verification:** new harness section — commit 2 records, assert history length, assert PHI validity flips at the boundary date, assert a superseded crop fact is invalidated-not-deleted.

**Risk:** memory drift if consolidation is buggy → **mitigation:** memory is *derived from the event log*, so a bad consolidation is fixed by replay, never a data-loss event.

### 1.2 Slow-process consolidation — `consolidate()`

**What we add.** The System-2 offline step from the [dual-process memory paper](https://arxiv.org/pdf/2606.09483): after a record commits, distill **semantic** facts ("this block is sprayed ~monthly", "Marko's licence valid to 2027-03") and seed **procedural** hooks for Phase 3. Runs in the "slow process" — after submit, not in the turn's hot path.

**Files/functions touched:** new `consolidate(record)` called from `drain()` on `OUTBOX_SYNCED`.

**Expected outcome:** semantic memory accumulates without bloating the turn latency (consolidation is off the critical path; the worker never waits for it).

**Verification:** assert consolidation runs after sync, not before the confirmation message; assert semantic facts are additive and deduped.

### 1.3 Foresight agent — new agent ⑩, `AgentForesight`

**What we add.** The rung-6 capability: at review time, reason about **future consequences** from memory. Emits forward-looking findings alongside the QA critic.

- **Runs:** review phase only (like the critic — depth where it's earned).
- **Zone:** quarantined *reasoning*; privileged *read* of `MEM` (the kernel hands it data, exactly like the Advisor pattern already in the file).
- **Findings it produces** (all deterministic-first, model-optional):
  - **Harvest window:** `PHI(product) + applicationDate` vs any planned harvest → BLOCK if violated.
  - **Re-entry:** `reEntryH` → INFO with the safe-return timestamp.
  - **Resistance:** count same-mode-of-action applications on the block this season → WARN at 3+.
  - **N-balance (fertilising):** sum season N/ha vs the 170 kg Nitrates Directive ceiling → BLOCK if breached.
- Uses [WorldEvolver's "selective foresight"](https://arxiv.org/abs/2606.30639): only surface a prediction we're confident in; low-confidence ones are dropped, not guessed.

**Files/functions touched:** new `AgentForesight` in `§10`; called in `turn()` at the `d.t==="REVIEW"` branch, right after `AgentCritic`; findings merged into the `QA_FINDINGS` event so the review card renders them.

**Before → after:** today the QA critic's rubric *asks* "does PHI leave a workable harvest window?" but has no data to answer. After: Foresight answers it from memory, with the actual date.

**Expected outcome:** log a spray with a 14-day PHI, then attempt a harvest schedule inside that window → a BLOCK finding with the exact earliest-harvest date. Log a 3rd FRAC-7 fungicide on a block → a resistance WARN.

**Verification:** new harness section — assert PHI-window BLOCK fires with correct date; assert resistance WARN at the 3rd same-group application; assert N-balance BLOCK at the ceiling; assert **no** finding when the record is clean (no invented concerns — the [ACE anti-pattern](https://arxiv.org/abs/2510.04618) of manufacturing findings to seem useful).

**Risk:** foresight over-blocks and annoys the worker → **mitigation:** BLOCK only for a genuine legal violation; everything else is WARN/INFO; selective-foresight confidence gate.

### 1.4 UI — memory & foresight surfaces

**What we add.** A **"Block history"** strip in the review card (the last N applications on this block, from `MEM`), and Foresight findings rendered in the existing QA block with a distinct icon. A new **Memory tab** in the right panel showing the temporal graph facts with their validity windows.

**Files/functions touched:** `reviewCard()`; new pane in the tabs; `renderMemory()`.

**Expected outcome:** the review card visibly *knows the block's past*, which is the single most convincing "this is deep" signal in a demo.

### Phase 1 acceptance

- Target: **+18–22 new assertions** (memory, consolidation, foresight), all green, **plus the existing 68 still green.**
- Demo script: log a spray → log a second spray on the same block a week later → the agent shows the block's history and warns that the first application's re-entry/PHI is still active → attempt a harvest inside the window → BLOCK with the earliest legal harvest date.
- **No new credentials.** Runs fully offline. This is the phase that proves depth with zero external dependency.

---

## PHASE 2 — Live grounding (the "magic" phase)

### 2.1 Weather at application — `AgentGrounding` + a weather tool

**What we add.** Just-in-time retrieval of wind/weather for the field's location at the application timestamp — a **legally required field** for a spray record, not a feature.

- **New tool (privileged, network):** `fetch_weather(lat, lon, iso)` → `{ windKph, dir, tempC, humidity, source }`. In the demo, a mock keyed to date+field so it's deterministic and offline-replayable; in production, a METAR/weather API as an **MCP server** (§P3).
- **New slot:** `conditions` on the spraying schema — auto-filled by grounding, not asked. The worker confirms rather than reads a gauge.
- **New Foresight finding:** wind above the drift threshold at application time → WARN (compliance) with the reading; rain forecast within the product's rainfast window → WARN.
- **Pattern:** [agentic RAG — the agent decides when a live lookup is worth it](https://www.brightter.com/articles/agentic-rag-five-retrieval-patterns-that-survive-production); the router gates it (spraying yes, harvest no).

**Files/functions touched:** new tool in `§4 TOOLS` (network-flagged); grounding call in `turn()` after field+date commit; schema gets a `conditions` slot for SPRAYING only; Foresight reads it.

**Before → after:** the record has no environmental data. After: it carries the wind reading at application, auto-filled, and flags a drift-risk window — an audit-grade field no static rule could produce.

**Expected outcome:** log a spray on a windy day → the record carries the wind reading and a drift WARN; on a calm day → the reading with no warning.

**Verification:** mock two weather states; assert the field auto-fills; assert the drift WARN fires above threshold and not below; assert grounding does **not** run for a harvest work order (router gating).

**Risk:** weather API down → **mitigation:** grounding failure is a circuit-breaker case (already built); the slot degrades to "ask the worker" rather than blocking the log.

### 2.2 Regulatory freshness — PPP registry check

**What we add.** A live check that the product's authorisation is still current (authorisations get withdrawn mid-season). A `check_authorisation_current(productId)` that, when online, verifies against a registry feed; offline, uses the last-synced status with an age warning.

**Expected outcome:** a product whose authorisation was withdrawn → a BLOCK with the withdrawal date, even though the local mirror still lists it.

### Phase 2 acceptance

- Target: **+10–14 assertions.** Demo: log a spray → wind auto-fills → drift warning on a gusty timestamp → clean on a calm one.
- **Depends on:** one weather API key (you provide) for the live path; the mock path needs nothing and is what the tests run against.

---

## PHASE 3 — Resolution, self-improvement, governance

### 3.1 Resolver agent — coreference & entity memory (answers your follow-up question)

**What we add.** The rung-3 upgrade from [`DEPTH-GAP-ANALYSIS.md §2`](DEPTH-GAP-ANALYSIS.md). A **Resolver** (router-tier, quarantined) that runs *before* the Extractor when the utterance has a pronoun/ellipsis or there are pending referents. It rewrites *"the usual"* / *"same as last time"* / *"the second one"* into a fully-grounded utterance using **entity memory** (per-operator resolved referents) from `MEM`.

- **New per-operator procedural fact:** "OP-11 says 'the vineyard' → FLD-102 (learned from 2 corrections)."
- **[Query-rewriting pattern](https://arxiv.org/pdf/2210.12775):** rewrite → then extract, so the extractor never has to both resolve *and* read.

**Files/functions touched:** new `AgentResolver` in `§10`; called in `turn()` between the router and the extractor, gated on referent detection; reads `MEM` procedural facts.

**Before → after:** *"same as last time"* is meaningless today. After: it resolves to the block's most recent application; *"the vineyard"* stops asking Marko to disambiguate once it's learned his default.

**Expected outcome:** after Marko corrects "vineyard"→South twice, the 3rd time it resolves without asking; *"the usual for this block"* fills product+dose from history.

**Verification:** assert the rewrite grounds an elliptical utterance; assert the per-operator default is learned after N corrections and applied on N+1; assert it *still* asks when genuinely ambiguous (doesn't over-guess — the [clarification failure mode](https://arxiv.org/html/2503.22458v1)).

### 3.2 verify→refine QA critic — iterative verification

**What we change.** The one-shot `AgentCritic` becomes a **verify→refine loop** ([rubric-guided verification](https://arxiv.org/html/2601.15808v2)): decompose the rubric into ≤3 targeted checks, score, and if a finding is uncertain (score ≤2) run one more targeted round — capped at 4 ([CMU ceiling](https://effloow.com/articles/agent-test-time-compute-scaling-context-ceiling-2026)).

**Before → after:** the critic surfaces or drops a finding in one pass. After: an uncertain finding gets one focused second look before it becomes a BLOCK — fewer false BLOCKs, fewer missed real ones.

**Expected outcome:** a borderline dose×area case that a single pass mis-judges is corrected on round 2; the loop stops at ≤4 rounds.

**Verification:** assert the loop refines a seeded borderline case; assert it terminates at the cap; assert it early-stops when the first pass is confident.

### 3.3 Reflector — self-improvement from corrections

**What we add.** The [ACE-style](https://arxiv.org/abs/2510.04618) slow-process learner: every correction becomes a structured, reversible delta into procedural memory (alias maps, per-operator defaults, disambiguation priors). Bounded updates — no free-form rewrite — to avoid [capability collapse](https://arxiv.org/abs/2606.04703).

**Before → after:** the agent makes the same mis-hearing forever. After: a corrected "ryedale"→"Ridomil Gold" is remembered for that accent; the agent visibly improves over a session.

**Expected outcome:** after correcting an ASR mishear once, the same utterance resolves correctly next time. An operator can inspect and reset what the agent learned (auditable, per [ACE's structured-update discipline](https://venturebeat.com/ai/ace-prevents-context-collapse-with-evolving-playbooks-for-self-improving-ai)).

**Verification:** assert a learned alias applies on the next occurrence; assert reset clears it; assert learned facts are additive and capped (no unbounded growth).

### 3.4 Policy-as-code — validators → Cedar/OPA

**What we change.** The pure tool suite (`check_dose`, `check_crop_product_compatibility`, licence/date rules) is refactored to emit decisions from a **declarative policy set** ([Cedar/OPA pattern](https://tianpan.co/blog/2026-04-25-policy-as-code-agent-permissions-opa-rego)) — same verdicts, but the compliance logic becomes an auditable, versioned artifact separable from the code, plus **role/tenant authorization** (who may back-date, who may override a BLOCK).

**Before → after:** compliance rules live inside JS functions. After: they're a policy file an auditor can read and a security review can sign off — the enterprise-buyer answer.

**Expected outcome:** the exact same validation verdicts as today (regression-proven), now driven by policy; plus new authorization checks (an operator can't log against another farm; only a supervisor can override a BLOCK).

**Verification:** assert byte-for-byte the same verdicts as the current tool suite across the full test matrix (the policy refactor must not change behavior); assert the new authz rules block cross-tenant writes.

### 3.5 MCP tool surface + real AGRIVI API

**What we add.** The weather feed, PPP registry, and **real AGRIVI 360 write** become [MCP servers](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026); the agent's tools speak MCP so the same agent runs against staging/prod/partner data by swapping servers. Every MCP call passes through the privileged kernel + policy engine — [an MCP tool is untrusted input](https://medium.com/@MattLeads/6-critical-challenges-facing-the-mcp-in-2026-06258e914402), fenced by the trust zones that already exist.

**Before → after:** the "server" is an in-memory `Map`. After: the outbox drains to the real AGRIVI 360 API via MCP, with the same idempotency guarantee.

**Depends on:** the real AGRIVI API endpoint + auth (you provide). Until then, the mock stands in and the architecture is written to swap it.

### Phase 3 acceptance

- Target: **+20–26 assertions.** Demo: *"the usual for north vineyard"* → fully resolved; correct a mishear → it sticks; show the Cedar policy file next to the identical verdicts.

---

## 2. What the whole thing looks like when it's done

| Capability | v2 today | After P1–P3 |
|---|---|---|
| Remembers past work | ❌ cold every session | ✅ full temporal history per block |
| Understands "the usual" | ❌ | ✅ Resolver + entity memory |
| Knows the weather when you sprayed | ❌ | ✅ auto-filled, drift-checked |
| Warns about the future | ❌ records only | ✅ harvest window, re-entry, resistance, N-balance |
| Gets better when corrected | ❌ same mistake forever | ✅ Reflector, per-operator |
| Critic reasons vs one-shot | 🟡 one pass | ✅ verify→refine, capped |
| Compliance as auditable policy | 🟡 in code | ✅ Cedar/OPA file |
| Real integrations | 🟡 mock | ✅ MCP servers, real AGRIVI API |
| Trust zones / offline / idempotency | ✅ | ✅ **unchanged — the spine holds all of it** |

**Total test target:** 68 (today) → **~130 assertions** across the three phases, with the existing 68 never regressing.

---

## 3. Sequencing & risk

- **Ship order is P1 → P2 → P3.** P1 needs nothing external and delivers the biggest depth jump, so it's first and it de-risks the demo immediately.
- **Every phase is behind the event log**, so any phase can be shipped, evaluated, and rolled back by ignoring its event types. No destructive migration exists anywhere in this plan.
- **Credentials you'll provide gate only the *live* paths:** weather key (P2), OpenRouter (already have — P3 agents), real AGRIVI API (P3). Every phase's *tests* run against deterministic mocks, so verification never depends on a network.
- **The one thing to watch:** foresight/critic over-blocking. Mitigated by BLOCK-only-for-legal-violations and the selective-confidence gate. We verify "no finding on a clean record" as a first-class test.

---

## 4. Starting now

Per the instruction to keep working: **Phase 1 begins immediately** — temporal memory (`§MEMORY`), consolidation, and the Foresight agent, verified headlessly against the real file the same way v2's 68 assertions are. P1 is the honest proof of depth: memory + foresight, fully offline, no new credentials. The live-grounding and self-improvement phases follow, wiring the keys you provide as they arrive.
