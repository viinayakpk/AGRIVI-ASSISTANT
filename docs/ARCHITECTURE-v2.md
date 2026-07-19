# Companion Agent v2 — Architecture

**Schema-driven work-order agent · AGRIVI 360 Farm Enterprise**

> v1 got the spine right and skipped the organs. It satisfied [12-factor](https://github.com/humanlayer/12-factor-agents) Factor 12 (*stateless reducer*), Factor 8 (*own your control flow*) and Factor 4 (*tools are structured outputs*) — and completely missed **Factor 10: small, focused agents**. v2 keeps the spine and adds the organs, each one justified or cut.

---

## 0. The one-paragraph version

A **deterministic kernel** owns control flow, state and every write. Around it sit **nine small, focused agents**, each a node in a workflow rather than an autonomous loop. A **router** decides how many of them run this turn, because multi-agent costs [+58% to +285% in tokens](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production) and depth must be earned per-turn, not paid by default. Trust is enforced with [CaMeL](https://simonwillison.net/2025/Apr/11/camel/)'s **Privileged/Quarantined split plus capability (taint) labels**: agents that touch worker speech get no tools, no state, and a typed channel out. The work order itself is **declarative** — a `WorkOrderSchema` — so the same engine runs Spraying, Fertilizing and Harvest, which is the only reason a Planner is honest here rather than theatre.

---

## 1. Trust zones (CaMeL)

```
┌─ UNTRUSTED ────────┐   ┌─ QUARANTINED ──────────────┐   ┌─ PRIVILEGED ─────────────┐
│ worker speech/ASR  │──▶│ Q-agents: no tools,        │──▶│ kernel: reducer, tools,  │
│ every retrieved    │   │ no state, no control flow. │   │ policy, ids, all writes  │
│ token              │   │ typed channel out only     │   │                          │
└────────────────────┘   └────────────────────────────┘   └──────────────────────────┘
```

Every value carries a **capability label** `{origin, trust, verifiedBy, spanId}`, inherited through the pipeline. Rules the kernel enforces:

1. **No untrusted value may become an id.** Only the verifier mints ids, only from the mirror. There is no code path from model output to a valid `FLD-*`/`PPP-*`.
2. **No untrusted value may select an action.** Control flow is derived from the *schema* and *kernel state*, never from proposal content. This is CaMeL's core claim: extract control flow from the trusted query so untrusted data can never influence it.
3. **Taint is sticky.** A value derived from untrusted input stays untrusted until a validator re-derives it from the mirror, at which point it is *replaced* by the mirror's value, not merely blessed.
4. **Q-agents cannot call tools.** Enforced structurally — they are given no tool bindings, not asked nicely.

**Honest limit** (Willison's, and ours): CaMeL manages injection risk architecturally; it does not eliminate it. Q-agents can still be *fooled* — they just can't *act*. Our answer is that a fooled Q-agent produces a wrong proposal, which the verifier rejects, which costs a turn. That is the designed blast radius.

## 2. The pipeline

```
utterance
   │
   ├─▶ RAIL:input ─── ② Injection Screen ──── trip ──▶ quarantine + typed refusal
   │                     (policy-conditioned safety classifier)
   ├─▶ ① Normalizer  (ASR/code-switch/units)      [only if messy]
   ├─▶ ③ Router      (depth decision)             [always, cheap]
   │
   ├─▶ ④ Extractor   (strict schema → Proposal)   [most turns]
   │       │
   │  ═════╪══════ SDB: proposal is a CLAIM ══════
   │       ▼
   ├─▶ ⑥ Verifier    (pure tool suite, authoritative)   ─▶ commit | typed reject
   ├─▶ ⑤ Planner     (schema → elicitation plan)  [schema change only]
   ├─▶ ⑧ QA Critic   (rubric-scored record review) [pre-submit only]
   ├─▶ ⑨ Advisor     (label Q&A)                  [on question]
   └─▶ RAIL:output   (⑩ no invented ids, no catalogue leak)  ─▶ worker
```

### Agent contracts

| # | Agent | Zone | In → Out | Runs when | Justified by |
|---|---|---|---|---|---|
| ① | **Normalizer** | Q | raw text → clean text + `lang` | router says messy | ASR disfluency, HR/EN code-switch, *"pola litre"* → 0.5 L. Genuinely open-domain |
| ② | **Injection Screen** | Q | text → `{verdict, category, spans}` | every turn | ASI01 Goal Hijack. [Injection +340% YoY](https://futureagi.com/blog/what-is-prompt-injection-defense-2026/); voice widens the surface |
| ③ | **Router** | Q | text + state → `{intent, depth, agents[]}` | every turn | Anthropic *routing* pattern. **Pays down the +285% tax** |
| ④ | **Extractor** | Q | text + schema → `Proposal` | most turns | v1's `propose_slots`, now schema-driven |
| ⑤ | **Planner** | P | `WorkOrderSchema` → elicitation plan | schema change | Anthropic *orchestrator-workers*. Honest **only** because schemas vary |
| ⑥ | **Verifier** | P | `Proposal` → commits/rejects | every commit | Deterministic. The authority |
| ⑦ | **Rails** | P | 5 stages (NeMo taxonomy) | every turn | input/dialog/retrieval/execution/output |
| ⑧ | **QA Critic** | Q | record + rubric → `Finding[]` | pre-submit | Anthropic *evaluator-optimizer*. Rubric is **explicit** — [open-ended "find problems" underperforms](https://github.com/CSHaitao/Awesome-LLMs-as-Judges) |
| ⑨ | **Advisor** | Q | question + label → answer | on question | Genuinely open-domain Q&A |

**Cut:** debate, self-consistency voting, tree search. All 2–5× compute for a task whose ground truth is a database lookup. A critic that disagrees with `check_dose` is *wrong*, not interesting.

## 3. Router — depth on demand

| Turn shape | Pipeline | ~Calls |
|---|---|---|
| slot answer (*"today"*, *"0.5"*) | screen → extractor | 2 |
| messy/voice/first utterance | screen → normalizer → extractor | 3 |
| question (*"what's the PHI?"*) | screen → advisor | 2 |
| pre-submit | + QA critic | +1 |
| schema change | + planner | +1 |
| offline | on-device tier, same contracts | 0 network |

## 4. Model tiering (OpenRouter)

Small focused agents make per-agent model choice possible — that's Factor 10 paying for itself. Verified live against `GET /api/v1/models`; all support `tools` + `structured_outputs` unless noted.

| Agent | Model | $/M in | $/M out | Why |
|---|---|---|---|---|
| ② Screen | `openai/gpt-oss-safeguard-20b` | 0.075 | 0.30 | **Policy-conditioned** safety classifier — we supply our own policy text |
| ③ Router | `inclusionai/ling-2.6-flash` | 0.010 | 0.03 | Cheapest with structured output; pure classification |
| ① Normalizer | `mistralai/mistral-nemo` | 0.019 | 0.03 | Cheap, strong multilingual (Croatian) |
| ④ Extractor | `google/gemini-2.5-flash-lite` | 0.10 | 0.40 | Workhorse: accuracy + strict schema + 1M ctx |
| ⑤ Planner | `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | Rare (schema change only) |
| ⑧ QA Critic | `anthropic/claude-opus-4.8` | 5.00 | 25.00 | Once per submit, reviewing a legal record. Worth it |
| ⑨ Advisor | `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | On demand |

Editable at runtime; a live cost meter shows spend per agent per turn. A frontier model on the router would be an architecture smell, and the UI makes that visible.

## 5. The three-tier proposer

The v1 thesis, now with three real implementations behind one envelope:

```
online + key   →  OpenRouter          (per-agent model tiering)
offline + Nano →  Chrome Prompt API   (Gemini Nano, on-device,
                                       responseConstraint JSON schema)
otherwise      →  deterministic NLU   (v1's parser, 36 tests green)
```

Nano needs Chrome 138+, 22 GB free, 16 GB RAM — so it is **feature-detected** via `LanguageModel.availability()` and silently absent. Tier 3 always works. Kill the network and the agent still *thinks*.

## 6. Guardrails — NeMo's five rail stages

| Stage | Rail | Enforcement |
|---|---|---|
| **input** | injection screen; length/rate caps; imperative detection in a data utterance | Q-agent + deterministic |
| **dialog** | topic bounds (this agent logs work orders, nothing else) | deterministic policy |
| **retrieval** | mirror is read-only, versioned, scoped to the operator's farm | structural |
| **execution** | zero-trust tooling (ASI02): every tool arg schema-validated; ids must exist in mirror | deterministic |
| **output** | ⑩ no invented ids, no catalogue dump, no rate outside label | deterministic |

**Circuit breakers (ASI08):** per-agent failure counters. N consecutive failures → open circuit → drop that agent from the pipeline and degrade (screen fails → deterministic screen; critic fails → block submit and escalate). Cascading failure is designed against, not hoped against.

**Kill switch (ASI10):** one control disables all network agents and pins the deterministic tier.

**Least agency (ASI09):** every committed slot shows origin + verifier. The agent articulates *why*, which is exactly the trust-exploitation mitigation.

## 7. Schema-driven work orders

```
WorkOrderSchema {
  type: SPRAYING | FERTILIZING | HARVEST
  slots:      [{ id, kind, required, dependsOn, elicit }]
  validators: [{ slot, tool }]
  rubric:     [ criteria for the QA critic ]
}
```

The Planner reads the schema and produces an elicitation plan; the kernel executes it. Harvest needs yield + moisture and has no dose or PHI; spraying needs authorisation numbers and label rates. **One engine, N work orders** — and a Planner that plans something real.

## 8. Observability

Spans follow [OTel GenAI semantic conventions](https://opentelemetry.io/blog/2026/genai-observability/): `invoke_agent` → `chat` / `execute_tool`, carrying `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`. The glass box is a real **trace viewer** over a standard, not a bespoke log — so the same traces would ship to Jaeger/Datadog unchanged.

## 9. What v2 keeps from v1

The event log (`state = fold(events)`), the pure tool suite, the outbox + content-hash idempotency key, and the failure mode: **the write that might have happened**. Those were right. 52 assertions still green.

## 10. Failure modes, ranked

| Trigger | Response | Why |
|---|---|---|
| **Ambiguous submit ACK** | Outbox, same idempotency key, backoff; server dedupes | A duplicate spray record is worse than a missing one (Reg. (EU) 1107/2009 Art. 67) |
| **Injection in a data utterance** | Screen trips → quarantine → typed refusal → deterministic re-parse | Untrusted text cannot select an action (CaMeL rule 2) |
| **Agent unreachable** | Circuit opens → degrade a tier → conversation continues | Only the proposer is network-bound |
| **Critic disputes a validator** | Validator wins; finding logged as advisory | The mirror is ground truth; the critic is an opinion |
| **Nano absent** | Feature detection → deterministic tier | 22 GB/16 GB requirements are not universal |
