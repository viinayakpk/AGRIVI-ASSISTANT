// agents/02-providers.js
// §8 — the three-tier proposer: OpenRouter gateway / Chrome Nano / deterministic.

/* ───────── §8  PROVIDERS — three tiers, one contract ─────────
   online+key → OpenRouter (per-agent tiering)
   offline+Nano → Chrome Prompt API (on-device, JSON-schema constrained)
   otherwise → deterministic
   Q-agents get NO tool bindings. Not asked nicely — structurally absent.  */
let NET="online", KILL=false;
const nap=ms=>new Promise(r=>setTimeout(r,ms));
async function gate(){
  if(KILL) throw new Error("kill-switch");
  if(NET==="offline") throw new Error("offline");
  if(NET==="flaky"){ await nap(500+Math.random()*1600); if(Math.random()<0.35) throw new Error("network-timeout"); }
  else await nap(80+Math.random()*140);
}
const hasKey=()=>!!sessionStorage.getItem("agrivi.or.key");

/* Two paths, same contract — this is the plug-and-play seam for the LLM leg:
     served over http(s) → the resilient GATEWAY (/api/llm): key stays server-
       side, gateway walks a per-tier model FALLBACK CHAIN (see
       gateway/server.js), so one provider/model failing auto-switches — the
       caller never sees it.
     opened as file://                → direct-to-OpenRouter demo fallback
       (client-side key), same request/response shape, no gateway available.
   `opts.webSearch` attaches OpenRouter's native web-search plugin
   (`plugins:[{id:"web"}]`) so the model can ground an answer in a live page —
   only the Chat agent asks for this, and only when the question needs it. */
async function openrouter(agent, model, system, user, schema, opts={}){
  await gate();
  // PII: every known operator name is pseudonymised before anything leaves
  // the browser — one chokepoint, so the Extractor/Chat/Advisor never even
  // know it happened. restorePIIDeep() undoes it on the parsed response
  // below, before any caller sees it, so "Ivana" still resolves against the
  // roster exactly as if the model had seen the real name.
  const systemR=redactPII(system), userR=redactPII(user);
  const cacheSplitR=opts.cacheSplit?redactPII(opts.cacheSplit):null;
  // Prompt caching (OpenRouter → Anthropic/Gemini cache_control passthrough).
  // `opts.cacheSplit`, when given, is the STATIC prefix of `system` — the
  // large catalogue/instruction text that's byte-identical turn to turn
  // within a session. Marking it as its own content block with cache_control
  // lets a matching request re-read it at a steep discount instead of paying
  // full input price for the same fields/products/operators list on every
  // single turn. The volatile remainder (a per-turn hint, e.g. "the agent
  // just asked for X") stays a second, uncached block after it, so a change
  // there never busts the cache on the big static part. `system` itself is
  // untouched and still passed whole to Nano/deterministic fallback below —
  // this is purely an OpenRouter-path optimization, never a behaviour change.
  const sysContent = (cacheSplitR && systemR.startsWith(cacheSplitR) && cacheSplitR.length>800)
    ? [ {type:"text",text:cacheSplitR,cache_control:{type:"ephemeral"}},
        ...(systemR.length>cacheSplitR.length ? [{type:"text",text:systemR.slice(cacheSplitR.length)}] : []) ]
    : systemR;
  const payload={ messages:[{role:"system",content:sysContent},{role:"user",content:userR}],
    max_tokens:900, temperature:0,
    response_format:{ type:"json_schema", json_schema:{ name:agent, strict:true, schema } } };
  if(opts.webSearch) payload.plugins=[{ id:"web", max_results: opts.webSearch===true?3:opts.webSearch }];

  let d, servedModel=model;
  if(usingGateway()){
    const r=await fetch(`${location.origin}/api/llm`,{ method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ tier: AGENT_TIER[agent]||"extractor-class", payload }) });
    d=await r.json();
    if(!r.ok || d.error) throw new Error(`gw-llm: ${d.error||r.status}${d.attempts?" "+JSON.stringify(d.attempts).slice(0,100):""}`);
    servedModel=d._served_by||model;
  } else {
    const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{ method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${sessionStorage.getItem("agrivi.or.key")}`,
        "HTTP-Referer":"https://agrivi.local/companion-agent", "X-Title":"AGRIVI Companion Agent" },
      body:JSON.stringify({ ...payload, model }) });
    if(!r.ok){ const t=await r.text().catch(()=>""); throw new Error(`or-${r.status}: ${t.slice(0,120)}`); }
    d=await r.json();
  }
  const u=d.usage||{};
  const cost=bill(agent,servedModel,u.prompt_tokens||0,u.completion_tokens||0);
  const txt=d.choices?.[0]?.message?.content||"{}";
  let parsed; try{ parsed=JSON.parse(txt); }catch(_){ throw new Error("or-bad-json"); }
  restorePIIDeep(parsed);
  const citations=(d.choices?.[0]?.message?.annotations||[]).filter(a=>a.type==="url_citation").map(a=>a.url_citation);
  return { parsed, model:servedModel, cost, tin:u.prompt_tokens||0, tout:u.completion_tokens||0,
           finish:d.choices?.[0]?.finish_reason||"stop", citations };
}

/* Chrome Prompt API — Gemini Nano, fully on-device, JSON-schema constrained.
   Needs Chrome 138+, 22GB free, 16GB RAM. Feature-detected; silently absent. */
const Nano = {
  session:null, state:"unknown",
  async probe(){
    if(typeof LanguageModel==="undefined"){ this.state="absent"; return "absent"; }
    try{ const a=await LanguageModel.availability({expectedInputs:[{type:"text",languages:["en"]}],
            expectedOutputs:[{type:"text",languages:["en"]}]});
      this.state = a==="unavailable" ? "absent" : a; return this.state;
    }catch(_){ this.state="absent"; return "absent"; }
  },
  async get(system){
    if(this.session) return this.session;
    this.session=await LanguageModel.create({ initialPrompts:[{role:"system",content:system}] });
    return this.session;
  },
  async run(agent, system, user, schema){
    if(this.state==="absent"||this.state==="unknown") throw new Error("nano-absent");
    const s=await this.get(system);
    const out=await s.prompt(user,{ responseConstraint:schema });
    return { parsed:JSON.parse(out), model:"gemini-nano (on-device)", cost:0, tin:0, tout:0, finish:"stop" };
  }
};

