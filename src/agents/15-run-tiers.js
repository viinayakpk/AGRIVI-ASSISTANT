// agents/15-run-tiers.js
// Shared Q-agent execution: tries OpenRouter, then Nano, and NEVER gets tools.

/* Q-agent execution: tries OpenRouter, then Nano, and NEVER gets tools. */
async function runQ(agent, system, user, schema, opts={}){
  const t0=performance.now();
  if(!KILL && NET!=="offline" && hasKey()){
    try{
      const r=await openrouter(agent, MODELS[agent]||MODELS.extractor, system, user, schema, opts);
      span("chat",{ "gen_ai.operation.name":"chat", "gen_ai.request.model":r.model,
        "gen_ai.usage.input_tokens":r.tin, "gen_ai.usage.output_tokens":r.tout,
        "gen_ai.response.finish_reasons":r.finish, "agent.id":agent, "cost.usd":r.cost.toFixed(6),
        ...(opts.webSearch?{"web_search.used":true,"web_search.citations":r.citations?.length||0}:{}) },
        performance.now()-t0, "Q");
      return r;
    }catch(e){
      // "or-" = OpenRouter itself rejected the request (bad key, bad request) —
      // that's not something Nano/deterministic can fix, so surface it.
      // "gw-llm" = the GATEWAY exhausted its whole model fallback chain — every
      // model in the tier is down. That's exactly what the on-device tier is
      // for, so fall through to Nano rather than failing the turn.
      if(String(e.message).startsWith("or-")) throw e;
    }
  }
  if(Nano.state!=="absent" && Nano.state!=="unknown"){
    const r=await Nano.run(agent, system, user, schema);
    span("chat",{ "gen_ai.operation.name":"chat", "gen_ai.request.model":"gemini-nano",
      "gen_ai.system":"chrome.prompt_api", "agent.id":agent, "cost.usd":"0.000000" },
      performance.now()-t0, "Q");
    return r;
  }
  throw new Error("no-proposer");
}

