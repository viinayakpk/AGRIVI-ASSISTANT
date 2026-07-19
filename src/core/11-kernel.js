// core/11-kernel.js
// §13 — the kernel. Owns control flow; untrusted text never selects an action.
//    Turn orchestration lives here.

/* ───────── §13  THE KERNEL — owns control flow. Untrusted text never
   selects an action here; the schema and kernel state do.               ───────── */
let busy=false, PIPE={};
function pipe(id,st){ PIPE[id]=st; renderPipe(); }
function resetPipe(){ PIPE={}; renderPipe(); }

async function turn(text){
  if(busy) return;
  busy=true; turnSeq++; resetPipe(); render();
  emit("USER_UTTERANCE",{text}); S=fold(); render(); scrollLog();
  pipe("input","done");
  const tSpan=SPANS.length;
  span("invoke_agent",{"agent.name":"companion","work_order.type":SCHEMA.type,"turn":turnSeq},0,"P");

  const st0=S, d0=nextDirective(st0);
  let awaiting=null, doseFor=null;
  const pending=st0.slots.products.value.find(p=>p.dose==null);
  const only=st0.slots.products.value.length===1?st0.slots.products.value[0].name:null;
  // Gated on SCHEMA_LOCKED: nextDirective() defaults to "ASK field" from turn
  // one (SPRAYING is the in-memory default schema before the worker has said
  // anything work-related), so treating that as a live question would let a
  // vague message like "weather" get force-fed into the field-elicitation
  // flow before any actual intent to log work was established.
  if(SCHEMA_LOCKED){
    if(d0.t==="ASK"){ awaiting=d0.slot; if(d0.slot==="dose") doseFor=d0.product.name; }
    else if(d0.t==="DISAMBIGUATE") awaiting=d0.slot;
    else if(d0.t==="REPAIR"){ if(/^DOSE/.test(d0.r.code)){ awaiting="dose"; doseFor=(pending&&pending.name)||only; }
      else awaiting=d0.r.slot==="products"?"product":d0.r.slot; }
  }
  const ctx={ambiguity:st0.ambiguity,awaiting,doseFor,singleProduct:only};

  showTyping(); const t0=performance.now(); let cost=0;

  /* RAIL:input — ② injection screen. ASI01. */
  pipe("screen","run");
  const sc=await AgentScreen.run(text); cost+=sc.cost||0;
  RAILS.push({stage:"input",rail:"injection_screen",verdict:sc.verdict,category:sc.category,detail:sc.reason,by:sc.by,at:Date.now()});
  span("invoke_agent",{"agent.id":"screen","rail.stage":"input","rail.verdict":sc.verdict,
    "rail.category":sc.category,"gen_ai.request.model":sc.by},0,"Q");
  if(sc.verdict==="TRIP"){
    pipe("screen","trip"); hideTyping();
    emit("RAIL_TRIPPED",{stage:"input",code:`INJECTION_${sc.category.toUpperCase()}`,
      detail:`That message contains an instruction aimed at the assistant, not a description of field work. Describe the spraying job and I'll record it.`});
    S=fold();
    const out=phrase(nextDirective(S),S);
    emit("AGENT_UTTERANCE",{ack:null,text:out.text,kind:"blocked",code:out.code,src:sc.by,ms:Math.round(performance.now()-t0),cost});
    emit("RAIL_CLEARED",{}); S=fold(); setChips(out.chips||[]);
    busy=false; render(); scrollLog(); go("rails"); return;
  }
  pipe("screen","done");

  /* ③ router — depth decision */
  pipe("router","run");
  const rt=await AgentRouter.run(text,st0,awaiting); cost+=rt.cost||0;
  span("invoke_agent",{"agent.id":"router","router.intent":rt.intent,"router.depth":rt.needs_normalizer?"deep":"shallow",
    "gen_ai.request.model":rt.by},0,"Q");
  pipe("router","done");

  /* terminal intents — no further agents needed */
  if(rt.intent==="cancel"){ hideTyping(); emit("PHASE_CHANGED",{phase:"cancelled"}); S=fold();
    SCHEMA_LOCKED=false;   // the next thing they say may be a different work order
    const o=phrase({t:"CANCELLED"},S); emit("AGENT_UTTERANCE",{ack:null,text:o.text,kind:"say",src:rt.by,ms:0,cost});
    S=fold(); setChips([]); busy=false; render(); scrollLog(); return; }
  if(rt.intent==="confirm"&&S.phase==="review"){ hideTyping(); busy=false; render(); submit(); return; }
  if(rt.intent==="reject"&&S.phase==="review"){ hideTyping();
    emit("AGENT_UTTERANCE",{ack:null,text:"What should I change? Just say the corrected value.",kind:"say",src:rt.by,ms:0,cost});
    S=fold(); setChips(["It was yesterday","Ivana did it","Rate was 0.4 L/ha"]);
    busy=false; render(); scrollLog(); return; }
  if(rt.intent==="amend"){ hideTyping();
    if(!startAmend(rt.amendsId)) emit("AGENT_UTTERANCE",{ack:null,text:`I don't have a record ${esc(rt.amendsId||"")} to amend this session.`,kind:"say",src:"kernel",ms:0,cost});
    S=fold(); busy=false; render(); scrollLog(); return; }

  /* ⑪ CHAT — general conversation is the home base. Questions and chit-chat go
     here; the agent answers naturally (greetings, help, product/label questions,
     memory recall — "what did I spray on the north vineyard?"). If the worker is
     actually starting to describe field work, the chat agent flags wants_to_log
     and we fall through to the work-order flow. Mid-work-order, we answer then
     resume the current question. This is what makes it feel like a normal chat. */
  const inFlow = SCHEMA_LOCKED && (S.phase==="collecting"||S.phase==="review") &&
    (awaiting || Object.values(S.slots).some(sl=>sl.status==="filled"||(Array.isArray(sl.value)&&sl.value.length)));
  let chatWantsLog=false;
  if(rt.intent==="chitchat" || rt.intent==="question"){
    // Weather gets first refusal, ahead of Web Search: it's a real, free,
    // keyless, already-integrated data source (Open-Meteo, same one the
    // review card uses) — no reason to spend a Web Search call, or fall
    // through to Chat's honest "I don't have live data" degradation, when the
    // answer is one fetch away. Needs a resolved field to fetch coordinates
    // for; if none is established yet, ask rather than guess — same rule
    // identity and every other slot already follows.
    if(needsWeather(text) && NET!=="offline" && !KILL){
      const fld=S.slots.field.value;
      if(fld){
        pipe("weather","run");
        const wx=await groundWeather(fld.id);
        span("invoke_agent",{"agent.id":"weather","weather.ok":!!wx},0,"P");
        pipe("weather","done"); hideTyping();
        if(wx){ GROUNDED[fld.id]=wx;
          const back = inFlow ? phrase(nextDirective(S),S) : {text:""};
          // B() escapes its own argument internally — the outer template must
          // NOT also go through esc(), or its <b> tags get escaped into
          // literal text instead of rendering (same rule the amend/submit
          // success messages already follow correctly, elsewhere in this file).
          emit("AGENT_UTTERANCE",{ack:`${B(fld.name)}: ${wx.windKph} km/h wind, ${wx.tempC}°C, ${wx.humidity}% humidity — live from ${wx.source}.`,
            text:back.kind==="review"?"":(back.text||""),kind:back.kind==="review"?"say":(back.kind||"say"),
            src:"weather:open-meteo",ms:Math.round(performance.now()-t0),cost});
          S=fold(); setChips(back.chips||[]); busy=false; render(); scrollLog(); return;
        }
        // Provider unreachable — fall through to Chat, honestly flagged, same as a degraded Web Search.
      } else {
        hideTyping();
        emit("AGENT_UTTERANCE",{ack:null,text:"Which field? I can pull live conditions for it.",kind:"say",src:"kernel",ms:0,cost});
        S=fold(); setChips(MIRROR.fields.slice(0,4).map(f=>f.name)); busy=false; render(); scrollLog(); return;
      }
    } else if(needsWeather(text)) pipe("weather","skip");

    // The Web Search agent gets first refusal on anything ELSE that looks
    // like it needs live/current info — but ONLY if the worker has left it
    // enabled. Disabled means disabled: the router never even asks the question.
    const wantsLive = AgentWebSearch.needs(text);
    if(wantsLive && AgentWebSearch.enabled() && !cbOpen("websearch")){
      pipe("websearch","run");
      const ws=await AgentWebSearch.run(text); cost+=ws.cost||0;
      span("invoke_agent",{"agent.id":"websearch","websearch.ok":ws.ok,"websearch.citations":ws.citations?.length||0,"gen_ai.request.model":ws.by},0,"Q");
      pipe("websearch","done");
      if(ws.ok && ws.answer){
        hideTyping();
        emit("AGENT_UTTERANCE",{ack:esc(ws.answer)+citeFooter(ws),text:"",kind:"say",src:ws.by,ms:Math.round(performance.now()-t0),cost});
        S=fold(); setChips([]); busy=false; render(); scrollLog(); return;
      }
      // Search agent degraded mid-turn — fall through to Chat, honestly flagged.
    } else if(wantsLive) pipe("websearch","skip");

    // Label Q&A (PHI, dose, licence, approved crop…) goes to the Advisor —
    // its own cheaper tier, and a semantic cache keyed by the product actually
    // named so a reworded repeat of the same label question is free. This was
    // fully wired end-to-end but never actually called from turn() — every
    // label question was silently absorbed by Chat instead, which works but
    // skips the cache and the per-agent cost tiering the README documents.
    if(AgentAdvisor.needs(text) && !cbOpen("advisor")){
      pipe("advisor","run");
      const av=await AgentAdvisor.run(text,S); cost+=av.cost||0;
      span("invoke_agent",{"agent.id":"advisor","gen_ai.request.model":av.by},0,"Q");
      pipe("advisor","done"); hideTyping();
      const back = inFlow ? phrase(nextDirective(S),S) : {text:""};
      emit("AGENT_UTTERANCE",{ack:esc(av.answer),text:back.kind==="review"?"":(back.text||""),
        kind:back.kind==="review"?"say":(back.kind||"say"),src:av.by,ms:Math.round(performance.now()-t0),cost});
      S=fold(); setChips(back.chips||[]); busy=false; render(); scrollLog(); return;
    } else if(AgentAdvisor.needs(text)) pipe("advisor","skip");

    pipe("chat","run");
    const a=await AgentChat.run(text,S,{liveInfoUnavailable: wantsLive && !(AgentWebSearch.enabled()&&!cbOpen("websearch"))});
    cost+=a.cost||0;
    span("invoke_agent",{"agent.id":"chat","chat.wants_to_log":!!a.wants_to_log,"gen_ai.request.model":a.by},0,"Q");
    pipe("chat","done");
    if(!a.wants_to_log || inFlow){
      hideTyping();
      const back = inFlow ? phrase(nextDirective(S),S) : {text:""};
      emit("AGENT_UTTERANCE",{ack:esc(a.answer)+citeFooter(a),text:back.kind==="review"?"":(back.text||""),
        kind:back.kind==="review"?"say":(back.kind||"say"),src:a.by,ms:Math.round(performance.now()-t0),cost});
      S=fold(); setChips(back.chips||[]); busy=false; render(); scrollLog(); return;
    }
    // wants_to_log outside a flow → fall through to intent detection + logging.
    // Router said chitchat/question but Chat itself judged this as real work
    // description — that disagreement used to fall through past the classify
    // block entirely (it only checked for intent "provide"/"correct"), so the
    // extractor could commit real slots while SCHEMA_LOCKED stayed false —
    // the very next bare-value answer (a dose, a date — anything without a
    // work-order keyword) would then fail classify() and get swallowed as
    // chitchat, orphaning an already-partially-filled record.
    chatWantsLog=true;
  }

  /* ⑤ INTENT — the Planner decides WHAT this is before we extract. The worker
     never picked a category; the agent infers it from what they said, locks it
     for the session, and re-plans the elicitation. This is what makes the
     Planner honest: it now classifies AND plans.
     Re-run even once SCHEMA_LOCKED — not just on the first message. A worker
     mid-spraying-flow who says "actually I did fertiliser today" is reporting
     a DIFFERENT work order, not answering the spraying question we last asked;
     without this, the kernel kept walking the OLD schema's slots and asked a
     spraying question about a fertilising job. classifyWorkOrder's keyword
     lists are narrow category words (fertilis/nitrogen/spray/harvest…), not
     everyday vocabulary, so an ordinary slot answer essentially never collides
     with them — and it's the SAME deterministic classifier every other branch
     already trusts, never a fresh guess, so this stays exactly as rule-based
     and auditable as the very first classification. */
  const type0=(rt.intent==="provide"||rt.intent==="correct"||chatWantsLog) ? AgentPlanner.classify(text) : null;
  const switching = SCHEMA_LOCKED && type0 && type0!==SCHEMA.type;
  if((!SCHEMA_LOCKED && (rt.intent==="provide"||rt.intent==="correct"||chatWantsLog)) || switching){
    pipe("kernel","run");
    const type=type0;
    // Unconditional, not just "if the type changed": we're inside !SCHEMA_LOCKED,
    // so this is always a FRESH lock-in — including re-describing work after a
    // CANCEL, which leaves phase="cancelled" and old slots sitting in state.
    // SCHEMA_CHANGED's reducer resets both (phase -> "collecting", slots wiped);
    // gating it on type!==SCHEMA.type meant cancelling and then redoing the SAME
    // kind of work order (the common case — SPRAYING is the default) left
    // nextDirective() permanently short-circuited to CANCELLED: the record kept
    // committing behind the scenes while the UI insisted nothing was written.
    // (When `switching` is what got us here, `type` is guaranteed truthy, so
    // the "not recognisable" branch below is unreachable for a schema switch —
    // it only ever fires on the original first-message path.)
    if(type){ SCHEMA=SCHEMAS[type]; emit("SCHEMA_CHANGED",{type}); S=fold(); PLAN=await AgentPlanner.run(); SCHEMA_LOCKED=true; }
    else {
      // Not a recognisable work order — treat it as conversation rather than
      // forcing a category. The chat agent replies naturally (and nudges toward
      // logging if that's what they seem to want).
      pipe("chat","run");
      const a=await AgentChat.run(text,S); cost+=a.cost||0;
      span("invoke_agent",{"agent.id":"chat","chat.route":"fallthrough","gen_ai.request.model":a.by},0,"Q");
      pipe("chat","done"); hideTyping();
      emit("AGENT_UTTERANCE",{ack:null,text:esc(a.answer)+citeFooter(a),kind:"say",src:a.by,ms:Math.round(performance.now()-t0),cost});
      S=fold(); setChips([]); busy=false; render(); scrollLog(); return;
    }
    span("invoke_agent",{"agent.id":"planner","planner.intent":SCHEMA.type,"planner.locked":SCHEMA_LOCKED,"planner.switched":switching},0,"P");
    pipe("kernel","done");
  }
  // A one-word category answer to the question above locks the schema.
  if(!SCHEMA_LOCKED){
    const pick={spraying:"SPRAYING",fertilising:"FERTILIZING",fertilizing:"FERTILIZING",harvest:"HARVEST","something else":"GENERIC",other:"GENERIC"}[norm(text)];
    if(pick){ SCHEMA=SCHEMAS[pick]; emit("SCHEMA_CHANGED",{type:pick}); S=fold(); PLAN=await AgentPlanner.run(); SCHEMA_LOCKED=true;
      hideTyping(); const o=phrase(nextDirective(S),S);
      emit("AGENT_UTTERANCE",{ack:null,text:o.text,kind:o.kind||"say",code:o.code,src:"planner",ms:0,cost}); S=fold(); setChips(o.chips||[]);
      busy=false; render(); scrollLog(); return; }
  }

  /* ① normalizer — only when the router says it'd help */
  let workText=text;
  if(rt.needs_normalizer && !KILL){
    pipe("normalizer","run");
    const nz=await AgentNormalizer.run(text); cost+=nz.cost||0;
    if(nz.changed&&nz.clean) workText=nz.clean;
    span("invoke_agent",{"agent.id":"normalizer","normalizer.changed":!!nz.changed,
      "normalizer.lang":nz.lang,"gen_ai.request.model":nz.by},0,"Q");
    pipe("normalizer","done");
  } else pipe("normalizer","skip");

  /* ④ extractor */
  pipe("extractor","run");
  let P;
  try{ P = KILL ? await LocalExtractor.run(workText,ctx) : await AgentExtractor.run(workText,ctx); }
  catch(e){ P = await LocalExtractor.run(workText,ctx); }
  cost+=P.cost||0;
  span("invoke_agent",{"agent.id":"extractor","proposal.intent":P.intent,
    "proposal.slots":Object.keys(P).filter(k=>/_text$|_value$/.test(k)&&P[k]!=null).join(",")||"-",
    "gen_ai.request.model":P.source},0,"Q");
  pipe("extractor","done");
  emit("PROPOSAL_RECEIVED",{source:P.source,proposal:P});

  /* ═══ SDB: everything above is a CLAIM. Below is the authority. ═══ */
  pipe("verifier","run");
  const before=S;
  verify(P);
  S=fold();
  pipe("verifier","done");

  let d=nextDirective(S);

  /* ⑧⑩ Pre-submit review — depth where it's earned.
     Foresight runs ALWAYS (deterministic, offline, reads memory). The QA
     critic layers on when a model is available. Findings are merged: the
     things a rules engine can't see (critic) + the things only memory over
     time can see (foresight). */
  if(d.t==="REVIEW"){
    if(S.phase!=="review"){ emit("PHASE_CHANGED",{phase:"review"}); S=fold(); }
    const rec=buildRecord(S);
    if(rec){
      // Live grounding: fetch conditions at the field for EVERY work order
      // type, not just spraying — useful context on the audit trail (harvest
      // timing, fertiliser runoff risk after rain, general field conditions),
      // not only a spray-drift number. Purely informational: it degrades to
      // null on any outage and never blocks or delays the record.
      if(NET!=="offline" && !KILL){
        const wx=await groundWeather(rec.fieldId);
        if(wx){ rec.conditions=wx; GROUNDED[rec.fieldId]=wx; }
      }
      pipe("foresight","run");
      const fs=AgentForesight.run(rec,S);
      span("invoke_agent",{"agent.id":"foresight","foresight.findings":fs.findings.length,
        "foresight.blocking":fs.findings.filter(f=>f.severity==="BLOCK").length,"gen_ai.request.model":fs.by},0,"P");
      pipe("foresight","done");
      let findings=fs.findings;
      if(!KILL && NET!=="offline" && hasKey()){
        pipe("critic","run");
        const qa=await AgentCritic.run(rec,S); cost+=qa.cost||0;
        span("invoke_agent",{"agent.id":"critic","qa.findings":(qa.findings||[]).length,
          "qa.blocking":(qa.findings||[]).filter(f=>f.severity==="BLOCK").length,"gen_ai.request.model":qa.by},0,"Q");
        pipe("critic","done");
        findings=[...fs.findings, ...(qa.findings||[])];
      } else pipe("critic","skip");
      emit("QA_FINDINGS",{findings}); S=fold();
    }
  }

  hideTyping();
  const ack = P.source==="deterministic" ? localAck(before,S) : (P.ack||null);
  const out = phrase(nextDirective(S),S);
  const ms = Math.round(performance.now()-t0);
  if(out.kind==="review") emit("AGENT_UTTERANCE",{ack,kind:"review",schema:SCHEMA.type,src:P.source,ms,cost});
  else emit("AGENT_UTTERANCE",{ack,text:out.text,kind:out.kind||"say",code:out.code,src:P.source,ms,cost});
  S=fold(); setChips(out.chips||[]);
  busy=false; render(); scrollLog();
}

