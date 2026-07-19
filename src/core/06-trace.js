// core/06-trace.js
// §5 — OTel GenAI trace spans.

/* ───────── §5  TRACE — OTel GenAI semantic conventions ─────────
   invoke_agent → chat / execute_tool, with gen_ai.* attributes. A standard,
   not a bespoke log: these spans would ship to Jaeger/Datadog unchanged. */
let SPANS=[], turnSeq=0;
function span(name,attrs,ms,zone,parent){
  SPANS.push({id:SPANS.length,name,attrs,ms:+(ms||0).toFixed(1),zone:zone||"P",parent:parent??null,turn:turnSeq,at:Date.now()});
  if(SPANS.length>400) SPANS.shift();
}

