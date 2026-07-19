// agents/11-advisor.js
// Agent ⑨ Advisor (label Q&A) + its semantic response cache.

/* SEMANTIC RESPONSE CACHE — adapted from GPTCache's idea (cache by similarity,
   not exact string match) using tools already in this codebase rather than a
   new embedding dependency: `sim()` is the same lexical/token-overlap scorer
   that already does fuzzy field/product/operator matching, not a real
   embedding index. Honestly scoped to what that actually catches — the same
   question re-typed with a word reordered, dropped, or misspelled ("what's
   the PHI on luna" / "whats the phi on luna please"), NOT a full paraphrase
   with no shared words. Still real, dependency-free, offline-capable savings
   for the case that actually repeats on a farm: the same handful of label
   questions asked slightly differently by different workers. Scoped
   deliberately to ADVISOR ONLY: label data is static for the whole session,
   so a cache hit can never serve a stale numeric answer.
   Extractor is explicitly EXCLUDED — a "similar" utterance can carry a
   different dose number, and reusing a cached extraction would silently
   fabricate a wrong value on a legal record. Chat is excluded too — its
   answer depends on session identity and a live memory-recall snippet that
   change turn to turn, so a cache hit there risks answering with stale
   memory. Cost savings only where they cannot cost correctness. */
const SEM_CACHE={};
function semCacheGet(ns, text, opts={}){
  const ttl=opts.ttlMs??10*60000, threshold=opts.threshold??0.6;
  const list=SEM_CACHE[ns]; if(!list) return null;
  const nt=norm(text), now=Date.now();
  for(const e of list) if(now-e.ts<=ttl && sim(nt,e.normText)>=threshold) return e.value;
  return null;
}
function semCacheSet(ns, text, value, cap=30){
  const list=SEM_CACHE[ns]||(SEM_CACHE[ns]=[]);
  list.unshift({normText:norm(text), value, ts:Date.now()});
  if(list.length>cap) list.length=cap;
}

/* ⑨ ADVISOR — label Q&A. Reads the mirror via the kernel, never directly.
   Gate is deterministic, same discipline as the Web Search gate below it:
   the kernel decides whether a question is label-shaped, never the model. */
const LABEL_Q_RE=/\b(phi|pre-?harvest|re-?entry|licen[cs]e|authoris|authoriz|dose|dosage|rate|approved crop|label rate|withdrawal period)\b/i;
function needsAdvisor(text){ return LABEL_Q_RE.test(text); }
const ADV_SCHEMA={type:"object",properties:{answer:{type:"string"}},required:["answer"],additionalProperties:false};
const AgentAdvisor = {
  id:"advisor", zone:"Q",
  needs(text){ return needsAdvisor(text); },
  async run(q, st){
    // The kernel does the lookup and hands the agent DATA. The agent never
    // touches the mirror — that is the quarantine boundary doing its job.
    const facts = MIRROR.products.filter(p=>!SCHEMA.productKind||p.kind===SCHEMA.productKind)
      .map(p=>({name:p.name,authNo:p.authNo,rate:`${p.doseMin}-${p.doseMax} ${p.unit}`,
        approvedCrops:p.approvedCrops.map(c=>crop(c).name),preHarvestIntervalDays:p.phiDays,reEntryHours:p.reEntryH}));
    // Cache namespace is partitioned by (farm, schema, and whichever product
    // the question mentions) — NOT text similarity alone. Whole-string sim()
    // actually scores "PHI on luna" vs "PHI on signum" HIGHER (~0.79) than it
    // scores genuine rewordings of the SAME question ("what's the PHI on
    // luna" vs "whats the phi on luna please", ~0.6) — a product name is a
    // small fraction of the sentence, so swapping it barely moves the whole-
    // string score. A single sim() threshold can't safely separate "same
    // question, reworded" from "same words, different product" — one of
    // those has to lose, and it must not be "different product". Partitioning
    // by the product actually named (reusing the same fuzzy matcher that
    // already resolves products elsewhere) makes the two questions structurally
    // unable to collide, however similar their text — only THEN is a looser
    // similarity threshold safe to use for the phrasing itself.
    const prodHit=match(q,MIRROR.products,p=>p.name)[0];
    const prodKey=(prodHit&&prodHit.score>=0.5)?prodHit.row.id:"none";
    const ns=`advisor:${MIRROR.farm?.id||"?"}:${SCHEMA.productKind||"none"}:${prodKey}`;
    const hit=semCacheGet(ns, q);
    if(hit) return {...hit, by:"cache:semantic", cost:0};
    if(cbOpen("advisor")) return {answer:"I can't reach the advisor right now. The label data is in the Slots panel.",by:"degraded",cost:0};
    try{
      const r=await runQ("advisor",
        `Answer a farm worker's question using ONLY the label data provided. One or two sentences,
plain language, no preamble. If the data does not contain the answer, say so plainly — never guess
a rate, interval or authorisation number.

LABEL DATA:
${JSON.stringify(facts,null,1)}`, q, ADV_SCHEMA);
      cbOk("advisor"); semCacheSet(ns, q, r.parsed);
      return {...r.parsed, by:r.model, cost:r.cost};
    }catch(e){ cbFail("advisor",String(e.message||e));
      return {answer:"I can't reach the advisor right now. The label rates are available in Captured data.",by:"degraded",cost:0}; }
  }
};

// DEFENSE IN DEPTH — do not trust the model's promise not to guess a name.
// The system prompt instructs it not to; models slip. Nothing in this codebase
// trusts an LLM's claim without a deterministic check (that's the whole SDB
// pattern), so a name assumption gets the same treatment: if nobody has told
// this session who they are, strip any direct-address greeting that uses a
// roster name ("Hey Marko," / "Marko, ...") before it ever reaches the UI.
// Scoped to the greeting pattern specifically, not any mention of the name
// anywhere in the sentence, so it can't eat legitimate content.
function stripGuessedGreeting(answer, knownIdentity){
  if(knownIdentity || !answer) return answer;
  const firsts=(MIRROR.operators||[]).map(o=>(o.name||"").split(" ")[0]).filter(Boolean);
  if(!firsts.length) return answer;
  const namePat=firsts.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
  const stripped=answer.replace(new RegExp(`^\\s*(?:(?:hey|hi|hello)\\s+)?(?:${namePat})\\s*[,!]\\s*`,"i"),"").trim();
  return stripped || answer;
}

// Renders a short "sources" footer under a web-searched answer. Citations are
// server-verified URLs from OpenRouter's web plugin, not model-invented links.
function citeFooter(a){
  if(!a.citations?.length) return "";
  const links=a.citations.slice(0,3).map(c=>`<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title||new URL(c.url).hostname)}</a>`).join(" · ");
  return `<div class="cite-footer">🔎 ${links}</div>`;
}

/* A plain-language digest of what memory knows — so the chat agent can answer
   "what did I spray on the north vineyard?" without touching the graph itself. */
function memSummary(text){
  const fmatch = MIRROR.fields.map(f=>({f,s:Math.max(bestSpan(text||"",f.name).score,...(f.aliases||[]).map(a=>bestSpan(text||"",a).score))})).sort((a,b)=>b.s-a.s)[0];
  const scope = fmatch && fmatch.s>0.55 ? [fmatch.f] : MIRROR.fields;
  const lines=[];
  for(const f of scope){
    const h=mem.history(f.block).filter(x=>x.predicate==="applied"||x.predicate==="harvested").slice(0,4);
    for(const x of h) lines.push(`${f.name} (${f.block}) · ${x.validFrom} · ${x.predicate==="harvested"?`harvested ${x.meta.yieldTHa} t/ha`:`${x.meta.name} ${x.meta.dose} ${x.meta.unit||""}`}`);
  }
  return lines.length ? lines.join("\n") : "No work has been logged yet.";
}
