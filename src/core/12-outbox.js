// core/12-outbox.js
// §14 — outbox + idempotency. The failure mode this whole design is built around.

/* ───────── §14  OUTBOX + IDEMPOTENCY (v1, kept — the failure mode) ─────────
   TRIGGER: submit goes out, the answer never comes back. The client cannot
   tell "never landed" from "landed, ACK lost".
   RESPONSE: durable outbox, idempotency key = content hash. Retries replay the
   SAME key; the server dedupes. Worker is told "queued", never "saved".
   WHY: a duplicate spray record is worse than a missing one — a missing one is
   re-entered from memory; a phantom second application makes the block look
   over-dosed on paper, failing an audit and breaking MRL traceability.      */
function h32(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; } return h.toString(16).padStart(8,"0"); }
const SESSION="SES-"+Math.random().toString(36).slice(2,8).toUpperCase();
/* True only when the CURRENT schema's every required slot is satisfied.
   Slots are schema-scoped, so this must be asked per-schema, not globally. */
function recordComplete(st){
  const s=st.slots;
  if(!s.field.value||!s.date.value||!s.operator.value) return false;
  if(SCHEMA.slots.includes("products") && (!s.products.value.length||s.products.value.some(p=>p.dose==null))) return false;
  if(SCHEMA.slots.includes("yield") && !s.yield.value) return false;
  if(SCHEMA.slots.includes("moisture") && !s.moisture.value) return false;
  if(SCHEMA.slots.includes("note") && !s.note.value) return false;
  return true;
}
// Total: returns null rather than throwing. A half-built record is a normal
// state (mid-conversation, or after a schema switch), not an exception.
function buildRecord(st){
  if(!recordComplete(st)) return null;
  const r={ type:SCHEMA.type, farmId:MIRROR.farm.id, fieldId:st.slots.field.value.id,
    block:st.slots.field.value.block, areaHa:st.slots.field.value.areaHa, cropId:st.slots.crop.value?.id,
    date:st.slots.date.value?.iso, operatorId:st.slots.operator.value?.id, source:"companion-agent" };
  if(SCHEMA.slots.includes("products"))
    r.products=st.slots.products.value.map(p=>({productId:p.productId,authNo:p.authNo,dosePerHa:p.dose,unit:p.unit}));
  if(SCHEMA.slots.includes("yield")&&st.slots.yield.value) r.yieldTHa=st.slots.yield.value.v;
  if(SCHEMA.slots.includes("moisture")&&st.slots.moisture.value) r.moisturePct=st.slots.moisture.value.v;
  if(SCHEMA.slots.includes("note")&&st.slots.note.value) r.note=st.slots.note.value.text;
  if(st.amendsId) r.amendsId=st.amendsId;
  r.idempotencyKey="WO-"+h32(SESSION+JSON.stringify(r));
  return r;
}
// Starts a correction to an already-submitted record. Deliberately single-
// level (an amendment can't itself be amended) — chained corrections are a
// real feature but out of scope here; one worker fixing one mistake on the
// same shift is the case this actually needs to cover.
function startAmend(serverId){
  const orig=S.server.find(r=>r.serverId===serverId);
  if(!orig) return false;
  emit("AMEND_STARTED",{amendsId:serverId});
  S=fold();
  // Stay on the current schema for the correction — submit() just unlocked
  // it so a FRESH message can start a different work order, but a correction
  // ("the dose was actually 0.6") often has no category keyword of its own
  // and must not be forced through re-classification, which could fail to
  // recognise it and drop into a plain chat reply instead of continuing
  // the collect flow.
  SCHEMA_LOCKED=true;
  say({text:`What needs to change on ${B(serverId)}? Describe the correction and I'll walk through it again.`});
  return true;
}
const SEEN=new Map();
async function agriviWrite(rec){
  if(KILL) throw new Error("kill-switch");
  if(NET==="offline") throw new Error("offline");
  if(NET==="flaky"){ await nap(700+Math.random()*1800);
    // The nasty one: the write COMMITS, then the response is lost.
    if(Math.random()<0.5){ if(!SEEN.has(rec.idempotencyKey))
        SEEN.set(rec.idempotencyKey,{serverId:"AGRIVI-WO-"+h32(rec.idempotencyKey).slice(0,6).toUpperCase(),rec});
      throw new Error("ack-lost-after-commit"); }
  } else await nap(250+Math.random()*300);
  const prior=SEEN.get(rec.idempotencyKey);
  if(prior) return {...prior,deduped:true};
  const out={serverId:"AGRIVI-WO-"+h32(rec.idempotencyKey).slice(0,6).toUpperCase(),rec};
  SEEN.set(rec.idempotencyKey,out); return {...out,deduped:false};
}
async function submit(){
  if(S.phase!=="review") return;
  if(S.findings.some(f=>f.severity==="BLOCK")){ toast("Resolve the blocking record check before submitting."); go("trace"); return; }
  const rec=buildRecord(S);
  if(!rec){ toast("Complete the missing details before submitting."); return; }
  emit("PHASE_CHANGED",{phase:"submitting"}); emit("OUTBOX_ENQUEUED",{key:rec.idempotencyKey,record:rec});
  S=fold(); render(); go("outbox");
  say({text: NET==="offline"
    ? "Saved on this device. It will submit to AGRIVI 360 automatically when the connection returns."
    : "Sending to AGRIVI 360…"});
  render(); scrollLog(); drain(rec.idempotencyKey);
}
async function drain(key){
  for(let a=1;a<=6;a++){
    const it=S.outbox.find(x=>x.key===key); if(!it||it.status==="SYNCED") return;
    while(NET==="offline"&&!KILL){ await nap(400); }
    emit("OUTBOX_ATTEMPT",{key,attempt:a}); S=fold(); render();
    try{
      const r=await agriviWrite(it.record);
      emit("OUTBOX_SYNCED",{key,serverId:r.serverId,deduped:r.deduped});
      emit("SERVER_RECORD_COMMITTED",{record:{...it.record,serverId:r.serverId,committedAt:Date.now()}});
      emit("PHASE_CHANGED",{phase:"done"}); S=fold();
      // Unlock for the next thing the worker says — same reasoning as CANCEL
      // (11-kernel.js): nextDirective() always returns DONE once phase is
      // "done", with nothing to move it back to "collecting" for a plain
      // follow-up message. Without this, a worker logging several jobs in
      // one sitting is stuck after the first: every later message still
      // extracts and silently commits slots (products merge into the
      // now-stale array), but the reply is always just "Logged. Anything
      // else?" with no way to review or submit the second job. startAmend()
      // explicitly re-locks for its own flow, so this doesn't fight amending.
      SCHEMA_LOCKED=false;
      consolidate(it.record);   // slow process: fold the new record into temporal memory
      say({text: r.deduped
          ? `Confirmed as ${B(r.serverId)}. AGRIVI matched the retry to the original record, so no duplicate was created.`
          : it.record.amendsId
            ? `Amendment recorded as ${B(r.serverId)}, linked to the original record ${B(it.record.amendsId)}. Both are preserved on AGRIVI 360 — nothing was overwritten.`
            : `Saved to AGRIVI 360 as ${B(r.serverId)} for ${B(S.slots.field.value.block)} on ${B(S.slots.date.value.iso)}.`,
        chips: (!r.deduped && !it.record.amendsId) ? [`Amend ${r.serverId}`] : []});
      render(); scrollLog(); return;
    }catch(e){
      const w=String(e.message||e);
      emit("OUTBOX_FAILED",{key,error:w,attempt:a}); S=fold(); render();
      const wait=Math.min(400*2**(a-1),5000);
      toast(`Connection attempt ${a} failed. Retrying in ${(wait/1000).toFixed(1)} seconds.`);
      await nap(wait);
    }
  }
  say({kind:"warn",code:"OUTBOX_STALLED",text:"AGRIVI 360 is still unavailable. The record is safe on this device and will keep retrying automatically."});
  render(); scrollLog();
}
function say(o){ emit("AGENT_UTTERANCE",{ack:null,text:o.text,kind:o.kind||"say",code:o.code,src:"kernel",ms:0,cost:0});
  S=fold(); setChips(o.chips||[]); }

