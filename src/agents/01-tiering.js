// agents/01-tiering.js
// §7 — model tiering + per-agent billing.

/* ───────── §7  MODEL TIERING — Factor 10 paying for itself ─────────
   Small focused agents make per-agent model choice possible. Prices verified
   live against OpenRouter GET /api/v1/models. A frontier model on the router
   would be an architecture smell — the cost meter makes that visible.     */
const CATALOG = [
  {id:"inclusionai/ling-2.6-flash",           in:0.010, out:0.030},
  {id:"mistralai/mistral-nemo",               in:0.019, out:0.030},
  {id:"openai/gpt-oss-20b",                   in:0.030, out:0.130},
  {id:"openai/gpt-5-nano",                    in:0.050, out:0.400},
  {id:"meta-llama/llama-3.1-8b-instruct",     in:0.050, out:0.080},
  {id:"openai/gpt-oss-safeguard-20b",         in:0.075, out:0.300},
  {id:"google/gemini-2.5-flash-lite",         in:0.100, out:0.400},
  {id:"mistralai/mistral-small-3.2-24b-instruct", in:0.100, out:0.300},
  {id:"google/gemini-2.5-flash",              in:0.300, out:2.500},
  {id:"anthropic/claude-haiku-4.5",           in:1.000, out:5.000},
  {id:"anthropic/claude-sonnet-5",            in:2.000, out:10.000},
  {id:"anthropic/claude-opus-4.8",            in:5.000, out:25.000}
];
const MODELS = {
  screen:    "openai/gpt-oss-safeguard-20b",   // policy-conditioned safety classifier
  router:    "inclusionai/ling-2.6-flash",     // cheapest structured-output model
  normalizer:"mistralai/mistral-nemo",         // cheap, strong multilingual (Croatian)
  extractor: "google/gemini-2.5-flash-lite",   // the workhorse
  planner:   "anthropic/claude-haiku-4.5",     // rare
  critic:    "anthropic/claude-opus-4.8",      // once per submit, on a legal record
  advisor:   "anthropic/claude-haiku-4.5",
  chat:      "anthropic/claude-haiku-4.5",   // general conversation — the "works like a normal chat" tier
  websearch: "anthropic/claude-haiku-4.5"    // its own agent, its own tier — see AgentWebSearch
};
// Maps each agent to the gateway's resilience tier (its own model FALLBACK
// CHAIN). The gateway ignores which exact model we ask for and walks its
// chain, so this is "what class of model does this job need", not "call
// this model or nothing".
const AGENT_TIER = { screen:"screen-class", router:"router-class", normalizer:"router-class",
  extractor:"extractor-class", planner:"critic-class", critic:"critic-class",
  advisor:"advisor-class", chat:"chat-class", websearch:"websearch-class" };
let SPEND={total:0, byAgent:{}, tokIn:0, tokOut:0};
function bill(agent,model,tin,tout){
  const m=CATALOG.find(x=>x.id===model); if(!m) return 0;
  const c=(tin/1e6)*m.in+(tout/1e6)*m.out;
  SPEND.total+=c; SPEND.byAgent[agent]=(SPEND.byAgent[agent]||0)+c;
  SPEND.tokIn+=tin; SPEND.tokOut+=tout; return c;
}

