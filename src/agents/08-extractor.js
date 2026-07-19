// agents/08-extractor.js
// Agent ④ Extractor (schema-driven, emits raw spans never ids) + the deterministic
//    tier-3 fallback extractor (LocalExtractor).

/* ④ EXTRACTOR — schema-driven. Emits RAW SPANS, never ids. */
function extractorSchema(){
  const p={ intent:{type:"string",enum:["provide","confirm","reject","correct","cancel","question","unclear"]},
    ack:{type:["string","null"]}, field_text:{type:["string","null"]}, crop_text:{type:["string","null"]},
    date_text:{type:["string","null"]}, operator_text:{type:["string","null"]} };
  const req=["intent","ack","field_text","crop_text","date_text","operator_text"];
  if(SCHEMA.slots.includes("products")){
    p.products={type:["array","null"],items:{type:"object",properties:{
      product_text:{type:"string"},dose:{type:["number","null"]},dose_unit:{type:["string","null"]}},
      required:["product_text","dose","dose_unit"],additionalProperties:false}};
    req.push("products");
  }
  if(SCHEMA.slots.includes("yield")){ p.yield_value={type:["number","null"]}; req.push("yield_value"); }
  if(SCHEMA.slots.includes("moisture")){ p.moisture_value={type:["number","null"]}; req.push("moisture_value"); }
  if(SCHEMA.slots.includes("note")){ p.note_text={type:["string","null"]}; req.push("note_text"); }
  return {type:"object",properties:p,required:req,additionalProperties:false};
}
const AgentExtractor = {
  id:"extractor", zone:"Q",
  async run(text, ctx){
    if(!cbOpen("extractor")){
      try{
        // Split static (cacheable — identical every turn this session, unless
        // identity just got established or the schema switched) from dynamic
        // (the per-turn "what are we waiting for" hint). See openrouter()'s
        // opts.cacheSplit: this exact prefix, verbatim, is what lets a repeat
        // call re-read the field/product/operator catalogue at a fraction of
        // the price instead of paying full price for it on every extraction.
        const staticSys=`You are the READING stage of AGRIVI's Companion Agent, logging a ${SCHEMA.label} work order.

YOUR ONLY JOB IS TO READ. You decide nothing.
- Extract what the worker said into raw strings. Hand them over.
- You never validate, never resolve ids, never choose the next question.
- A deterministic verifier re-checks everything you emit against AGRIVI master data and owns
  the conversation. Do not try to be right about validity — be right about what was SAID.

RULES
- If a catalogue entry is unmistakable, use its name ("luna" -> "Luna Experience").
  If MORE THAN ONE could match ("the vineyard"), emit the worker's words VERBATIM and let the
  verifier decide. Guessing wrong is worse than passing through.
- Fill every slot you heard — workers speak in bursts.
- NEVER invent a field, product, operator, dose or date. An omission is recoverable; an
  invention becomes a legal record of work that did not happen.
- ack: ONE short sentence stating only what you understood. Never a question. Never claim
  something is valid or logged. null if you understood nothing.

MASTER DATA (synced ${MIRROR.syncedAt}):
${CATALOGUE_TXT()}`;
        const dynamicSys=ctx.awaiting?`\n\n- The agent just asked for: ${ctx.awaiting}. An unmatched reply is probably answering THAT.`:"";
        const sys=staticSys+dynamicSys;
        const r=await runQ("extractor",sys,text,extractorSchema(),{cacheSplit:staticSys});
        cbOk("extractor");
        return { ...normalizeProposal(r.parsed), source:r.model, cost:r.cost };
      }catch(e){ cbFail("extractor",String(e.message||e)); }
    }
    return await LocalExtractor.run(text,ctx);
  }
};
function normalizeProposal(i){
  return { intent:i.intent||"provide", ack:i.ack||null, field_text:i.field_text||null, crop_text:i.crop_text||null,
    date_text:i.date_text||null, operator_text:i.operator_text||null,
    products:(i.products||[]).map(p=>({product_text:p.product_text,dose:p.dose,dose_unit:p.dose_unit})),
    yield_value:i.yield_value??null, moisture_value:i.moisture_value??null, note_text:i.note_text||null };
}

/* Deterministic extractor — tier 3. v1's parser, 36 assertions green. */
const LocalExtractor = {
  id:"extractor-local", zone:"Q",
  async run(text,ctx){
    const t=norm(text);
    const P={source:"deterministic",cost:0,intent:"provide",ack:null,note_text:null,field_text:null,crop_text:null,
      date_text:null,operator_text:null,products:[],yield_value:null,moisture_value:null};
    if(ctx.ambiguity){
      const c=ctx.ambiguity.candidates.map(c=>({c,s:sim(text,c.label)})).sort((a,b)=>b.s-a.s)[0];
      if(c&&c.s>0.4){ const nm=c.c.label.split(" (")[0];
        if(ctx.ambiguity.slot==="field") P.field_text=nm; else P.products.push({product_text:nm,dose:null,dose_unit:null});
        return P; }
    }
    let dose=null,unit=null;
    const dm=t.match(/(\d+(?:[.,]\d+)?)\s*(l|lit(?:re|er)s?|kg|kilos?|g|ml|t|tonnes?)\b\s*(?:\/|per\s+|a\s+)?\s*(ha|hectare)?/);
    if(dm){ dose=parseFloat(dm[1].replace(",",".")); const u=dm[2];
      unit=/^(l|lit)/.test(u)?"L/ha":/^(kg|kilo)/.test(u)?"kg/ha":/^(t|ton)/.test(u)?"t/ha":/^g$/.test(u)?"g/ha":"mL/ha"; }
    else if(/\bhalf a (lit(re|er))\b/.test(t)){ dose=0.5; unit="L/ha"; }
    if(dose==null&&(ctx.awaiting==="dose"||/\b(rate|dose|per ha|per hectare)\b/.test(t))){
      const b=t.match(/(?:^|\s)(\d+(?:[.,]\d+)?)(?:\s|$)/); if(b) dose=parseFloat(b[1].replace(",",".")); }
    P.date_text=resolveDateExpr(text);
    const fs=match(text,MIRROR.fields,f=>f.name)[0];
    if(fs&&fs.score>=0.55) P.field_text=fs.span;
    if(SCHEMA.slots.includes("products")){
      const pool=MIRROR.products.filter(p=>p.kind===SCHEMA.productKind);
      const ps=match(text,pool,x=>x.name)[0];
      if(ps&&ps.score>=0.55) P.products.push({product_text:ps.span,dose,dose_unit:unit});
    }
    const os=match(text,MIRROR.operators,o=>o.name)[0];
    if(os&&os.score>=0.62) P.operator_text=os.span;
    if(ctx.awaiting==="yield"&&dose!=null){ P.yield_value=dose; dose=null; }
    if(ctx.awaiting==="moisture"){ const m=t.match(/(\d+(?:[.,]\d+)?)\s*%?/); if(m) P.moisture_value=parseFloat(m[1].replace(",",".")); }
    if(ctx.awaiting==="note"&&text.trim()) P.note_text=text.trim();
    const found=P.field_text||P.products.length||P.date_text||P.operator_text||P.yield_value!=null||P.moisture_value!=null||P.note_text;
    if(!found){
      if(ctx.awaiting==="field"&&text.trim()) P.field_text=text.trim();
      else if(ctx.awaiting==="product"&&text.trim()) P.products.push({product_text:text.trim(),dose,dose_unit:unit});
      else if(ctx.awaiting==="operator"&&text.trim()) P.operator_text=text.trim();
      // GENERIC: an unmatched utterance for a generic work order IS the note.
      else if(SCHEMA.type==="GENERIC"&&text.trim()) P.note_text=text.trim();
    }
    if(dose!=null&&!P.products.length&&SCHEMA.slots.includes("products")){
      const tgt=ctx.doseFor||ctx.singleProduct; if(tgt) P.products.push({product_text:tgt,dose,dose_unit:unit});
    }
    if(!P.field_text&&!P.products.length&&!P.date_text&&!P.operator_text&&P.yield_value==null&&P.moisture_value==null)
      P.intent="unclear";
    return P;
  }
};

