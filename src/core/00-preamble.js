// core/00-preamble.js
// 'use strict' + the architecture overview banner.

"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   AGRIVI FIELD COMPANION — schema-driven multi-agent work-order pipeline

   THE SHAPE
   ---------
   A deterministic KERNEL owns control flow, state and every write. Around it
   sit nine SMALL, FOCUSED AGENTS (12-factor #10), each a node in a workflow —
   not an autonomous loop. A ROUTER picks how many run per turn, because
   multi-agent costs +58..285% tokens and depth must be earned.

   Trust follows CaMeL: agents that touch worker speech are QUARANTINED (no
   tools, no state, typed channel out). Only the PRIVILEGED kernel mints ids.
   Every value carries a capability/taint label that survives the pipeline.

        UNTRUSTED ──▶ QUARANTINED ──▶ PRIVILEGED
        speech/ASR    Q-agents        kernel: reducer + tools + policy

   The event log (state = fold(events)), pure tool suite and durable outbox
   provide content-hash idempotency across the complete pipeline.
   ═══════════════════════════════════════════════════════════════════════════ */

