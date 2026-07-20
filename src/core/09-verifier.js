// core/09-verifier.js
// §11 — verifier. Privileged. The only id minter.

/* ───────── §11  VERIFIER — privileged. The only id minter. ───────── */
function verify(P){
  const src=P.source||"deterministic";
  const cap=v=>Cap.trusted(src,v);
  if(P.field_text){
    const r=callTool("resolve_field",{text:P.field_text});
    if(r.verdict==="OK"){ const f=field(r.fieldId);
      emit("SLOT_COMMITTED",{slot:"field",raw:P.field_text,cap:cap("resolve_field"),
        value:{id:f.id,name:f.name,block:f.block,areaHa:f.areaHa}});
      emit("SLOT_COMMITTED",{slot:"crop",raw:null,cap:Cap.trusted("derived","field.cropId"),
        value:{id:f.cropId,name:crop(f.cropId).name,latin:crop(f.cropId).latin}});
    } else if(r.verdict==="AMBIGUOUS") emit("SLOT_AMBIGUOUS",{slot:"field",raw:P.field_text,candidates:r.candidates});
    else emit("SLOT_REJECTED",{slot:"field",raw:P.field_text,code:r.code,detail:r.detail,options:r.options});
  }
  const cur=fold().slots;
  if(P.crop_text&&cur.field.status==="filled"){
    const a=crop(field(cur.field.value.id).cropId);
    if(sim(P.crop_text,a.name)<0.55)
      emit("SLOT_REJECTED",{slot:"crop",raw:P.crop_text,code:"CROP_CONFLICT",
        detail:`${cur.field.value.name} (${cur.field.value.block}) is registered to ${a.name} for season 2026, not ${P.crop_text}. One of these is wrong.`,
        options:[`Keep ${a.name}`,"Different field"]});
  }
  for(const it of (P.products||[])){
    const r=callTool("resolve_product",{text:it.product_text,kind:SCHEMA.productKind});
    if(r.verdict==="AMBIGUOUS"){ emit("SLOT_AMBIGUOUS",{slot:"products",raw:it.product_text,candidates:r.candidates}); continue; }
    if(r.verdict==="REJECT"){ emit("SLOT_REJECTED",{slot:"products",raw:it.product_text,code:r.code,detail:r.detail,options:r.options}); continue; }
    const p=product(r.productId), st=fold();
    if(st.slots.crop.status==="filled"){
      const c=callTool("check_crop_product_compatibility",{cropId:st.slots.crop.value.id,productId:p.id});
      if(c.verdict==="REJECT"){ emit("SLOT_REJECTED",{slot:"products",raw:it.product_text,code:c.code,detail:c.detail,options:c.options}); continue; }
    }
    const base={productId:p.id,name:p.name,authNo:p.authNo,unit:p.unit,actives:p.actives,phiDays:p.phiDays};
    if(it.dose!=null){
      const d=callTool("check_dose",{productId:p.id,dose:it.dose,unit:it.dose_unit});
      if(d.verdict==="REJECT"){
        // Product is fine; only the rate is wrong. Commit the product so the
        // worker never says it twice, then reject just the rate.
        emit("SLOT_COMMITTED",{slot:"products",raw:it.product_text,cap:cap("resolve_product"),value:{...base,dose:null}});
        emit("SLOT_REJECTED",{slot:"products",raw:`${it.product_text} @ ${it.dose}${it.dose_unit||""}`,
          code:d.code,detail:d.detail,options:[`${p.doseMin}-${p.doseMax} ${p.unit}`]});
        continue;
      }
      emit("SLOT_COMMITTED",{slot:"products",raw:it.product_text,cap:cap("resolve_product+check_dose"),value:{...base,dose:it.dose}});
    } else emit("SLOT_COMMITTED",{slot:"products",raw:it.product_text,cap:cap("resolve_product"),value:{...base,dose:null}});
  }
  if(P.date_text){
    // The LIVE extractor is told to emit what was SAID, not resolve it (that's
    // deliberate — the same "hand over the raw span" rule that keeps field and
    // product names from being wrongly pre-resolved). A date has no such
    // ambiguity to preserve, so resolve it here rather than trust the model to
    // have already normalized "today"/"Monday"/etc — falls back to the
    // original text if it's not a recognisable expression, so check_date's
    // rejection still names what was actually said instead of "null".
    const resolved=resolveDateExpr(P.date_text)||P.date_text;
    const r=callTool("check_date",{iso:resolved});
    if(r.verdict==="OK") emit("SLOT_COMMITTED",{slot:"date",raw:P.date_text,cap:cap("check_date"),value:{iso:r.iso,daysAgo:r.daysAgo}});
    else emit("SLOT_REJECTED",{slot:"date",raw:P.date_text,code:r.code,detail:r.detail});
  }
  if(P.yield_value!=null&&SCHEMA.slots.includes("yield")){
    const r=callTool("check_yield",{value:P.yield_value});
    if(r.verdict==="OK") emit("SLOT_COMMITTED",{slot:"yield",raw:String(P.yield_value),cap:cap("check_yield"),value:{v:r.value,unit:r.unit}});
    else emit("SLOT_REJECTED",{slot:"yield",raw:String(P.yield_value),code:r.code,detail:r.detail});
  }
  if(P.moisture_value!=null&&SCHEMA.slots.includes("moisture")){
    const r=callTool("check_moisture",{value:P.moisture_value});
    if(r.verdict==="OK") emit("SLOT_COMMITTED",{slot:"moisture",raw:String(P.moisture_value),cap:cap("check_moisture"),value:{v:r.value,unit:r.unit,needsDrying:r.needsDrying}});
    else emit("SLOT_REJECTED",{slot:"moisture",raw:String(P.moisture_value),code:r.code,detail:r.detail});
  }
  if(P.operator_text){
    const st=fold(), onDate=st.slots.date.status==="filled"?st.slots.date.value.iso:todayISO();
    const answeringIdentity=st.rejections.some(x=>x.slot==="operator"&&x.code==="IDENTITY_UNKNOWN");
    const r=callTool("resolve_operator",{text:P.operator_text,onDate,answeringIdentity,knownIdentity:st.identity,selfIntro:!!P.operator_self_intro});
    if(r.verdict==="OK"&&r.operatorId==null){
      // Not on the roster, accepted anyway — see resolve_operator's own
      // comment. No real id to mint, no licence fields to show.
      emit("SLOT_COMMITTED",{slot:"operator",raw:P.operator_text,cap:cap("resolve_operator"),
        value:{id:null,name:r.operatorName,licenceNo:null,licenceExpiry:null,uncertified:true}});
    } else if(r.verdict==="OK"){ const o=operator(r.operatorId);
      emit("SLOT_COMMITTED",{slot:"operator",raw:P.operator_text,cap:cap("resolve_operator"),
        value:{id:o.id,name:o.name,licenceNo:o.licenceNo,licenceExpiry:o.licenceExpiry}});
      // Learned from what the worker told us — never assumed. Lands in the
      // fold (state = fold(events)), so it's correct on replay and correctly
      // absent in any OTHER conversation, with no separate reset to forget.
      if(r.establishesIdentity) emit("IDENTITY_ESTABLISHED",{operatorId:o.id});
    } else {
      emit("SLOT_REJECTED",{slot:"operator",raw:P.operator_text,code:r.code,detail:r.detail,options:r.options});
      // Even when the slot commit itself is refused (e.g. an expired PPP
      // licence), a genuine self-reference still tells us who is talking —
      // that fact is independent of whether THIS record can be certified.
      if(r.establishesIdentity && r.operatorId) emit("IDENTITY_ESTABLISHED",{operatorId:r.operatorId});
    }
  }
  // Note is free text — a description, not an entity. Nothing to resolve or
  // mint; it's stored as the worker's own words (quarantined provenance).
  if(P.note_text&&SCHEMA.slots.includes("note"))
    emit("SLOT_COMMITTED",{slot:"note",raw:P.note_text,cap:{trust:"quarantined",origin:src,verifiedBy:"free-text"},value:{text:P.note_text}});
}

