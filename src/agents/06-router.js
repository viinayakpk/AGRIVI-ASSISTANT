// agents/06-router.js
// Agent ③ Router — decides how many agents run this turn.

/* ③ ROUTER — the thing that pays down the +285% multi-agent token tax. */
const ROUTER_SCHEMA={type:"object",properties:{
  intent:{type:"string",enum:["provide","confirm","reject","correct","cancel","amend","question","chitchat","unclear"]},
  messy:{type:"boolean"},
  needs_normalizer:{type:"boolean"}},required:["intent","messy","needs_normalizer"],additionalProperties:false};
const AgentRouter = {
  id:"router", zone:"Q",
  async run(text, st, awaiting){
    const t=norm(text);
    // Checked first, unconditionally: an exact reference to an already-issued
    // record id ("Amend AGRIVI-WO-6C4AB8") is unambiguous regardless of what
    // else is going on — it's the trigger the "Amend this record" chip sends.
    const amendMatch=text.trim().match(/^amend\s+(AGRIVI-WO-[A-Za-z0-9]+)/i);
    if(amendMatch) return {intent:"amend",messy:false,needs_normalizer:false,by:"heuristic",cost:0,amendsId:amendMatch[1].toUpperCase()};
    // Deterministic fast paths — no model needed, and identical offline. These
    // lists can never be exhaustive, but narrow ones are exactly what makes a
    // conversation feel like a form with extra steps: a worker who says "yup"
    // or "nah" or "never mind" is being perfectly clear, and having to fall
    // through to a live model call (or the offline heuristic guess) for
    // ordinary words like that is the kind of unnatural friction worth closing
    // deterministically, the same way "yes"/"no" already were.
    // norm() turns an apostrophe into a SPACE, not nothing — "that's" becomes
    // "that s" (three tokens), not "thats" — so "that s right" is what
    // actually needs matching here, not the apostrophe'd or naively-squashed
    // forms either one of which silently never matches.
    if(/^(yes|yep|yeah|yea|yup|sure|ok|okay|correct|confirm|da|submit|send|looks good|sounds good|go ahead|that s right|perfect|great)\b/.test(t))
      return {intent:"confirm",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    if(/^(no|nope|nah|wrong|not right|not quite|incorrect|ne|change|fix|edit)\b/.test(t))
      return {intent:"reject",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    if(/\b(cancel|abort|discard|start over|never ?mind|forget it|nvm)\b/.test(t))
      return {intent:"cancel",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    if(/^(hi|hey|hello|yo|good (morning|afternoon|evening)|dobar dan|bok|thanks|thank you|cheers|hvala)\b/.test(t))
      return {intent:"chitchat",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    // Interrogative-word openers are unambiguous — always route as a question,
    // even mid-flow ("what fields do I have?" while awaiting a field answer).
    if(/^(what|whats|what's|how|when|can i|is it|why|who|do you|are you|tell me)\b/.test(t))
      return {intent:"question",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    // A live-data question can be phrased without "?" or a recognised opener
    // ("weather in germany now" instead of "what's the weather..."), and the
    // awaiting fast-path below would otherwise swallow it as the answer to
    // whatever slot is being asked about — no field/product/dose/date/operator
    // answer is ever going to contain a weather word, so this is safe ahead of
    // it. Excluded only for the note slot, the one place a worker legitimately
    // describes conditions as free text ("windy, sprayed anyway") rather than
    // asking about them.
    if(needsWeather(text) && awaiting!=="note")
      return {intent:"question",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    // The kernel is actively waiting on a specific slot (mid-work-order) and
    // this doesn't open like a question — that's a direct answer, not a topic
    // switch. This was the actual bug behind "I answered with a field name
    // and it stayed blank": the router had no idea a field was being awaited,
    // so a bare answer like "Rakitovac Orchard" could get classified as
    // question/chitchat, routed to Chat instead of extraction, and never
    // written to state at all — Chat only talks, it never fills a slot.
    // A trailing "?" doesn't override this UNLESS the message is a real
    // sentence, not a name — "Rakitovac?" (1-2 words, uncertain phrasing of
    // an answer) still goes to the extractor, which can reject and re-ask;
    // "is this the right field?" (a genuine multi-word question that just
    // doesn't happen to open with a word from the list above) must not get
    // swallowed as "provide" — the word-count check is what tells them apart,
    // since the opener list can never be exhaustive.
    // norm() strips "?" entirely (it's not in [a-z0-9\s.]), so every trailing-
    // "?" check here tests the RAW text, never `t` — that was already true of
    // the single combined regex this replaced, which meant a question with no
    // covered opening word ("does this field have grapes?") was silently
    // falling all the way through to the model/fallback path instead of ever
    // being recognised as a question by the fast path meant to catch it.
    const endsInQ=/\?\s*$/.test(text);
    const wc=t.split(" ").filter(Boolean).length;
    if(awaiting && (!endsInQ || wc<=2) && text.trim().length<60)
      return {intent:"provide",messy:false,needs_normalizer:false,by:"heuristic:awaiting",cost:0};
    if(endsInQ)
      return {intent:"question",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    const messy = text.length>60 || /\b(uh|um|erm|ovaj)\b/.test(t) || /[čćžšđ]/i.test(text);
    if(!cbOpen("router")){
      try{ const r=await runQ("router",
          `Classify a farm worker's message to a work-order logging agent. Return JSON only.
intent: what they are doing. messy: true if the text has ASR noise, disfluency, or mixed languages.
needs_normalizer: true only if cleaning the text would materially help extraction.`,
          text, ROUTER_SCHEMA);
        cbOk("router"); return {...r.parsed, by:r.model, cost:r.cost};
      }catch(e){ cbFail("router",String(e.message||e)); }
    }
    return {intent:"provide",messy,needs_normalizer:messy,by:"heuristic",cost:0};
  }
};

