// core/10-policy.js
// §12 — policy. The machine owns every question.

/* ───────── §12  POLICY — the machine owns every question ───────── */
/* The PLAN is a PROPOSAL too — the same rule that governs the extractor governs
   the planner. It can be stale (schema just switched), degraded, or simply
   wrong. The SCHEMA is authoritative: drop any slot it doesn't define, and
   append any required slot the plan forgot. A planner can influence ORDER;
   it can never change WHAT a lawful record requires. */
function order(){
  const want=SCHEMA.slots.filter(s=>s!=="crop");            // crop is derived
  const proposed=((PLAN&&PLAN.order)||[]).filter(s=>want.includes(s));
  return [...proposed, ...want.filter(s=>!proposed.includes(s))];
}
function nextDirective(st){
  if(st.blocked) return {t:"BLOCKED",b:st.blocked};
  if(st.phase==="done") return {t:"DONE"};
  if(st.phase==="cancelled") return {t:"CANCELLED"};
  if(st.ambiguity) return {t:"DISAMBIGUATE",slot:st.ambiguity.slot,candidates:st.ambiguity.candidates};
  if(st.rejections.length) return {t:"REPAIR",r:st.rejections[0]};
  for(const slot of order()){
    if(slot==="products"){
      if(!st.slots.products.value.length) return {t:"ASK",slot:"product"};
      const nd=st.slots.products.value.find(p=>p.dose==null);
      if(nd) return {t:"ASK",slot:"dose",product:nd};
    } else if(st.slots[slot] && st.slots[slot].status!=="filled") return {t:"ASK",slot};
  }
  return {t:"REVIEW"};
}
const B=x=>`<b>${esc(x)}</b>`, C=x=>`<code>${esc(x)}</code>`;
function phrase(d,st){
  const E=SCHEMA.elicit;
  const fill=(s,m)=>s.replace(/\{(\w+)\}/g,(_,k)=>m[k]??`{${k}}`);
  switch(d.t){
    case "BLOCKED": return {kind:"blocked",code:d.b.code,text:esc(d.b.detail),chips:["Sprayed North Vineyard with Luna at 0.5 L/ha today"]};
    // Defence in depth: if a schema ever lacks a template for a slot it
    // declares, ask a plain question rather than throwing at the worker.
    case "ASK": if(!E[d.slot]) return {text:`What was the ${esc(d.slot)}?`};
    switch(d.slot){
      case "field": return {text:E.field,chips:MIRROR.fields.slice(0,3).map(f=>f.name)};
      case "product": return {text:fill(E.product,{field:st.slots.field.value.name,crop:st.slots.crop.value.name}),
        chips:MIRROR.products.filter(p=>p.kind===SCHEMA.productKind&&p.approvedCrops.includes(st.slots.crop.value.id)).map(p=>p.name)};
      case "dose": { const p=product(d.product.productId);
        return {text:fill(E.dose,{product:d.product.name,range:`${p.doseMin}-${p.doseMax} ${p.unit}`}),
          chips:[`${p.doseMin} ${p.unit}`,`${p.doseMax} ${p.unit}`]}; }
      case "date": return {text:E.date,chips:["Today","Yesterday"]};
      // No chips: offering the operator roster as tap-targets meant handing a
      // worker three names before they'd said anything — jarring, and in
      // spirit the same guess-the-name problem the identity system exists to
      // avoid. Typing "me" still correctly triggers the identity question
      // ("I don't know who you are yet — what's your name?") exactly as before.
      case "operator": return {text:E.operator};
      case "yield": return {text:E.yield,chips:["7.2 t/ha","9 t/ha"]};
      case "moisture": return {text:E.moisture,chips:["13%","18%"]};
      case "note": return {text:E.note};
    } break;
    case "DISAMBIGUATE": return {kind:"warn",code:"AMBIGUOUS",text:"That could be more than one. Which did you mean?",
      chips:d.candidates.map(c=>c.label)};
    case "REPAIR": return {kind:d.r.code==="IDENTITY_UNKNOWN"?"warn":"alert",code:d.r.code,text:esc(d.r.detail),chips:(d.r.options||[]).slice(0,4)};
    case "REVIEW": return {kind:"review",chips:["Submit record","Fix something"]};
    case "DONE": return {text:"Logged. Anything else?"};
    case "CANCELLED": return {text:"Discarded. Nothing was written to AGRIVI."};
  }
  return {text:"Go ahead."};
}
function localAck(a,b){
  const g=[];
  if(a.slots.field.status!=="filled"&&b.slots.field.status==="filled") g.push(b.slots.field.value.name);
  const na=b.slots.products.value.length, nb=a.slots.products.value.length;
  if(na>nb){ const p=b.slots.products.value[na-1]; g.push(p.dose!=null?`${p.name} at ${p.dose} ${p.unit}`:p.name); }
  else if(na&&na===nb){ const bp=a.slots.products.value.find(x=>x.dose==null);
    const ap=bp&&b.slots.products.value.find(x=>x.productId===bp.productId);
    if(ap&&ap.dose!=null) g.push(`${ap.dose} ${ap.unit} of ${ap.name}`); }
  if(a.slots.date.status!=="filled"&&b.slots.date.status==="filled")
    g.push(b.slots.date.value.daysAgo===0?"today":b.slots.date.value.iso);
  if(a.slots.operator.status!=="filled"&&b.slots.operator.status==="filled") g.push(b.slots.operator.value.name);
  if(a.slots.yield.status!=="filled"&&b.slots.yield.status==="filled") g.push(`${b.slots.yield.value.v} t/ha`);
  if(a.slots.moisture.status!=="filled"&&b.slots.moisture.status==="filled") g.push(`${b.slots.moisture.value.v}% moisture`);
  return g.length?`Got it: ${g.join(", ")}.`:null;
}

