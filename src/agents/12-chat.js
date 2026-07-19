// agents/12-chat.js
// Agent ⑪ Chat — general conversation, never guesses a worker's name.

/* ⑪ CHAT — the general conversational agent. This is what makes it feel like a
   normal assistant rather than a form: greetings, "what can you do", questions
   about products or a block's history, or just talking. It is quarantined
   (reads context the kernel hands it; never writes state or mints ids). When a
   worker starts describing actual work, the router sends them to the work-order
   flow instead — chat is the home base, logging is a focused task off it.

   WEB SEARCH: farm/label/memory data answers most questions, but "what's
   wheat trading at today" or "is there a blight alert near me" needs the live
   web — no local mirror can hold that. The decision to search is DETERMINISTIC
   (a keyword heuristic, same discipline as the router's fast paths) — the
   quarantined Chat agent is never handed an autonomous tool-call decision; the
   kernel decides whether this turn is ALLOWED to leave the farm's data, then
   the call is made with OpenRouter's native web-search plugin attached. */
const LIVE_INFO_RE=/\b(price|prices|trading at|market rate|news|latest|current(ly)?|today'?s|this week'?s|recall|outbreak|banned?|regulat|announc|forecast for|weather (in|near)|what'?s happening)\b/i;
function needsWebSearch(text){ return LIVE_INFO_RE.test(text) && !/\b(phi|pre-harvest|re-?entry|dose|rate|licence|license)\b/i.test(text); }
const CHAT_SCHEMA={type:"object",properties:{answer:{type:"string"},
  wants_to_log:{type:"boolean"}},required:["answer","wants_to_log"],additionalProperties:false};
const AgentChat = {
  id:"chat", zone:"Q",
  // opts.liveInfoUnavailable: the question looked like it needed the live web,
  // but the Web Search agent is off/unreachable — say so honestly rather than
  // silently guessing an answer that could be stale or wrong.
  async run(text, st, opts={}){
    const t=norm(text);
    // Deterministic handlers — instant, offline, and enough for the common
    // cases. None of these address the worker by name: nobody has told this
    // session who they are yet, and assuming would be exactly the bug this
    // was built to avoid — any device, any worker, no guessed identity.
    if(/^(hi|hey|hello|yo|good (morning|afternoon|evening)|dobar dan|bok)\b/.test(t))
      return {answer:`Hey, good to hear from you — how's the day going?`,wants_to_log:false,by:"chat:local",cost:0};
    if(/(what can you do|who are you|help|how do you work|what do you do)/.test(t))
      return {answer:`I'm your AGRIVI field companion. I log work orders — spraying, fertilising, harvest, or any field task — validating everything against your farm's data. I remember every application on each block, check the weather and pre-harvest intervals for you, and I can answer questions about your products or past work. Just talk to me normally.`,wants_to_log:false,by:"chat:local",cost:0};
    if(/(thank|thanks|cheers|hvala)/.test(t)) return {answer:`Anytime.`,wants_to_log:false,by:"chat:local",cost:0};
    if(/(what did i|what have i|last (time|spray|applic)|history|when did i|show me|already (spray|applied|done))/.test(t)){
      return {answer:`Here's what I have on record:\n${memSummary(text)}`,wants_to_log:false,by:"chat:local(memory)",cost:0};
    }
    // Online: a real conversational model with the farm + memory + label context.
    if(!cbOpen("chat") && !KILL && NET!=="offline" && hasKey()){
      try{
        const facts=MIRROR.products.map(p=>`${p.name} (${p.authNo}): ${p.doseMin}-${p.doseMax} ${p.unit}, on ${p.approvedCrops.map(c=>crop(c).name).join("/")}, PHI ${p.phiDays}d`).join("\n");
        // Same cache split as the extractor: the persona + capability text +
        // FIELDS/PRODUCTS listing is identical turn to turn within a session
        // (until identity establishes once, or the mirror changes on a tenant
        // switch); the live-search-unavailable flag and the memory recall are
        // genuinely per-turn, so they stay a second, uncached block.
        const staticSys=`You are the AGRIVI Field Companion — a warm, concise assistant for a farm worker on ${MIRROR.farm.name}. Talk naturally, like a helpful colleague.
You do not know the worker's name unless they have told you in this conversation${st.identity?` — this one has: ${operator(st.identity).name}`:" — this one hasn't, so do not address them by any name or guess one"}.
You can: log work orders (spraying, fertilising, harvest, or any task), answer questions about products and fields, and recall past work from memory. Keep replies to 1-3 sentences, no preamble.
If the worker is starting to describe actual field work they did, set wants_to_log true so the system can capture it properly; otherwise false. Never invent a product rate, authorisation number, or a past record — only use the data below.

FIELDS: ${MIRROR.fields.map(f=>`${f.name} (${f.block}, ${f.areaHa}ha, ${crop(f.cropId).name})`).join("; ")}
PRODUCTS:\n${facts}`;
        const dynamicSys=`${opts.liveInfoUnavailable?"\nThis question needs current/live information and web search is unavailable right now — say so plainly instead of guessing an answer.":""}
RECENT WORK (from memory):\n${memSummary(text)}`;
        const r=await runQ("chat", staticSys+dynamicSys, text, CHAT_SCHEMA, {cacheSplit:staticSys});   // no web-search plugin here — that's the dedicated Web Search agent's job
        cbOk("chat");
        return {...r.parsed, answer:stripGuessedGreeting(r.parsed.answer, st.identity), by:r.model, cost:r.cost};
      }catch(e){ cbFail("chat",String(e.message||e)); }
    }
    // Offline / no key fallback — still useful, still on-topic.
    return {answer:`I can log spraying, fertilising, harvest, or any field task — just tell me what you did (e.g. "sprayed the north vineyard with Luna at 0.5 L/ha this morning"). Or ask me about a product or a block's history.`,wants_to_log:false,by:"chat:local",cost:0};
  }
};

