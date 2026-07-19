// agents/13-websearch.js
// Agent ⑫ Web Search — its own model, its own circuit breaker, independently toggleable.

/* ⑫ WEB SEARCH — its own agent, its own model tier, its own circuit breaker,
   its own line in the pipeline strip. A separate agent rather than a plugin
   quietly bolted onto Chat, because that is what every other capability in
   this system is — one agent, one job — and because it is the only agent that
   is allowed to leave the farm's own data and touch the open internet. That
   is exactly the kind of surface that should be a distinct, auditable,
   individually toggleable thing, not a hidden flag inside a general-purpose
   chat call. USER-CONTROLLED: off by default is not required, but every
   invocation is gated by WEB_SEARCH_ENABLED (see §UI) — flip it off and this
   agent is never called, full stop, no matter what the router thinks. */
const WEBSEARCH_SCHEMA={type:"object",properties:{answer:{type:"string"}},required:["answer"],additionalProperties:false};
const AgentWebSearch = {
  id:"websearch", zone:"Q",
  enabled(){ return WEB_SEARCH_ENABLED; },
  needs(text){ return needsWebSearch(text); },
  async run(text){
    if(cbOpen("websearch")) return {answer:null, ok:false, by:"degraded", cost:0, citations:[]};
    try{
      const r=await runQ("websearch",
        `Answer the farm worker's question using the live web result attached to this request. Be concise —
1-2 sentences, plain language, no preamble. Always state where/when the information is from if it's price-
or time-sensitive. If the search did not turn up a clear answer, say so plainly — never guess a number,
a price, or a regulatory status.`,
        text, WEBSEARCH_SCHEMA, {webSearch:3});
      cbOk("websearch");
      return {...r.parsed, ok:true, by:r.model, cost:r.cost, citations:r.citations||[]};
    }catch(e){ cbFail("websearch",String(e.message||e));
      return {answer:null, ok:false, by:"degraded", cost:0, citations:[]}; }
  }
};

