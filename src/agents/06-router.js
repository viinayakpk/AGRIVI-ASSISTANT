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
    // "yes"/"no" only MEAN confirm/reject when a review is actually pending —
    // anywhere else they're ordinary words that happen to start a real
    // sentence ("yes I need to know what kind of grape it is"). Matching just
    // the PREFIX outside a review turned every such sentence into a silent
    // "confirm" that nothing downstream handles, so it fell through unrouted
    // all the way to extraction and produced an unrelated canned question.
    // In review, stay lenient (prefix match — "yes that's right" should work
    // without the whole phrase matching exactly); anywhere else, require the
    // WHOLE message to be just the affirmation/negation, not merely start
    // with one.
    const inReview=st&&st.phase==="review";
    const CONFIRM_RE=/(yes|yep|yeah|yea|yup|sure|ok|okay|correct|confirm|da|submit|send|looks good|sounds good|go ahead|that s right|perfect|great)/;
    const REJECT_RE=/(no|nope|nah|wrong|not right|not quite|incorrect|ne|change|fix|edit)/;
    // In review, "yes but change the date" / "yes, except the dose was wrong"
    // still opens with a confirm word — a PREFIX match alone would submit()
    // immediately (kernel.js never looks past the intent) and silently ship
    // the record with the correction that was just stated never read. Any
    // "but"/"except"/"however", or a comma followed by a revision verb,
    // means this is a correction wearing a confirm word as its opener, not
    // an actual confirmation — route it to reject so the worker is asked
    // what to change instead of having it discarded.
    const carriesCorrection=inReview && /\b(but|except|however|actually|instead|wait|change|fix)\b/.test(t);
    if(!carriesCorrection && (inReview ? new RegExp("^"+CONFIRM_RE.source).test(t) : new RegExp("^"+CONFIRM_RE.source+"$").test(t)))
      return {intent:"confirm",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    if(carriesCorrection || (inReview ? new RegExp("^"+REJECT_RE.source).test(t) : new RegExp("^"+REJECT_RE.source+"$").test(t)))
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
    // "No '?' " is necessary but not sufficient evidence of a real answer —
    // "lol nice" and "capital of france" also have no "?", and were both
    // getting swallowed as the answer to whatever slot was pending, then
    // silently failing extraction and re-asking the same question with no
    // acknowledgment. A single short word/number is always worth trying
    // (covers "0.5", "Ivana", "today"); anything longer has to show SOME
    // resemblance to what's actually being asked for — a fuzzy match against
    // the real roster for field/product/operator, a digit for dose/yield/
    // moisture, a date-shaped word for date — using the same matcher the
    // verifier already trusts, not a fresh guess. Free text (note) and an
    // unawaited turn are always plausible; nothing here blocks a genuine
    // (even messy) attempt, it only stops obviously-unrelated text from
    // being force-fed into extraction.
    const plausible=(()=>{ if(!awaiting||awaiting==="note") return true;
      if(wc<=1) return true;
      switch(awaiting){
        case "field": return match(text,MIRROR.fields,f=>f.name).some(m=>m.score>=0.3);
        case "product": return match(text,MIRROR.products.filter(p=>!SCHEMA.productKind||p.kind===SCHEMA.productKind),p=>p.name).some(m=>m.score>=0.3);
        case "dose": return /\d/.test(t) || /\bhalf\b/.test(t);
        case "yield": case "moisture": return /\d/.test(t);
        case "date": return !!resolveDateExpr(text) || /\d/.test(t) || /\b(today|yesterday|morning|afternoon|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|ago)\b/.test(t);
        // Unlike field/product/dose, an operator is NOT restricted to a known
        // list — resolve_operator itself now accepts any name, uncertified if
        // it's not on the roster (see 05-tools.js). Gating this on a roster
        // match would silently defeat that fix for anyone not named Marko,
        // Ivana or Petar: a real two-or-three-word name a worker actually
        // gives would score 0 against the fixed roster and never even reach
        // extraction. A short, name-shaped reply (up to 4 words — covers
        // "Stjepan Babić", "Dr. Jane Smith") is accepted on its shape alone;
        // the earlier checks in this function (question openers, weather,
        // confirm/reject/cancel/chitchat) have already caught the obvious
        // non-name cases by the time execution reaches here.
        case "operator": return /\b(me|i|myself|self)\b/.test(t) || wc<=4 || match(text,MIRROR.operators,o=>o.name).some(m=>m.score>=0.3);
        default: return true;
      } })();
    if(awaiting && (!endsInQ || wc<=2) && text.trim().length<60 && plausible)
      return {intent:"provide",messy:false,needs_normalizer:false,by:"heuristic:awaiting",cost:0};
    if(endsInQ)
      return {intent:"question",messy:false,needs_normalizer:false,by:"heuristic",cost:0};
    const messy = text.length>60 || /\b(uh|um|erm|ovaj)\b/.test(t) || /[čćžšđ]/i.test(text);
    if(!cbOpen("router")){
      try{
        // The deterministic fast paths above already handle the unambiguous
        // majority; a message that reaches the model is, by construction,
        // one they couldn't confidently resolve — the model needs to know
        // WHAT the system just asked to have any chance of doing better,
        // otherwise it's classifying the words alone, blind to dialogue
        // state, the same failure the fast paths above just had fixed.
        const stateHint = inReview ? "The system just showed a review card and is waiting for the worker to confirm or ask for a change."
          : awaiting ? `The system just asked the worker for their "${awaiting}" and is waiting on that specific answer.`
          : "No specific answer is pending — this may be the start of a new topic.";
        const r=await runQ("router",
          `Classify a farm worker's message to a work-order logging agent. Return JSON only.
${stateHint}
intent: "confirm"/"reject" ONLY make sense if a review or a clear yes/no moment is actually pending (see above) — a message that merely starts with "yes"/"no" but continues with unrelated content is "question" or "chitchat", not confirm/reject. "provide" means it's actually answering what's pending; if it isn't, classify what it actually is instead.
messy: true if the text has ASR noise, disfluency, or mixed languages.
needs_normalizer: true only if cleaning the text would materially help extraction.`,
          text, ROUTER_SCHEMA);
        cbOk("router"); return {...r.parsed, by:r.model, cost:r.cost};
      }catch(e){ cbFail("router",String(e.message||e)); }
    }
    // Nothing resolved it — if we know a specific answer was pending and this
    // clearly isn't it, don't default to "provide" and let it fall silently
    // into extraction; hand it to Chat instead, same as an unrecognised
    // question would get.
    if(awaiting && !plausible) return {intent:"chitchat",messy,needs_normalizer:messy,by:"heuristic",cost:0};
    return {intent:"provide",messy,needs_normalizer:messy,by:"heuristic",cost:0};
  }
};

