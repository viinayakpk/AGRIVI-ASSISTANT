// core/07-eventlog.js
// §6 — event log. state = fold(events).

/* ───────── §6  EVENT LOG — state = fold(events) (v1, kept) ───────── */
/* ───────── SESSIONS — ChatGPT-style multiple conversations ─────────
   Each conversation is its own event log, keyed by a session id, with an index
   of {id,title,updatedAt} for the sidebar. Refresh restores the active one;
   "New chat" starts a fresh log. In production this same per-session log lives
   in Valkey/Redis (short-term working memory, TTL'd) behind the gateway — the
   browser is just the local cache of it. */
const SIDX="agrivi.sessions", SPFX="agrivi.session.", SACT="agrivi.active";
const LEGACY_LS="agrivi.v2.log", PREVIOUS_LS=["agrivi.companion.log","agrivi.companion.focused.v1"];
let SID = null;
let EVENTS=[];
const loadIndex=()=>{ try{ return JSON.parse(localStorage.getItem(SIDX)||"[]"); }catch(_){ return []; } };
function sessionTitle(){
  const u=EVENTS.find(e=>e.type==="USER_UTTERANCE"); return u ? u.payload.text.slice(0,42) : "New chat"; }
function saveSession(){
  if(!SID) return;
  // Only persist a conversation once it has real content. An empty/greeting-only
  // session leaves no trace — so refresh never resurrects a blank thread, and
  // the Chats list stays clean.
  if(!EVENTS.some(e=>e.type==="USER_UTTERANCE")) return;
  try{
    localStorage.setItem(SPFX+SID, JSON.stringify(EVENTS.slice(-400)));
    const idx=loadIndex().filter(s=>s.id!==SID);
    idx.unshift({ id:SID, title:sessionTitle(), updatedAt:Date.now(), n:EVENTS.filter(e=>e.type==="USER_UTTERANCE").length });
    localStorage.setItem(SIDX, JSON.stringify(idx.slice(0,50)));
    localStorage.setItem(SACT, SID);
  }catch(_){}
}
// Tamper-evident audit chain: each event's hash commits to the previous
// event's hash plus its own content (same h32 FNV-1a hash already used for
// the idempotency key below — no new dependency), so editing or deleting any
// past event breaks every hash after it. This is EVIDENCE, not cryptographic
// proof of authorship — a client-only app has no server-side key to sign
// against — but it's exactly what the EU AI Act's Article 12 traceability
// requirement actually asks for: detectable tampering, not a PKI.
function emit(type,payload={}){
  const seq=EVENTS.length, ts=Date.now();
  const prevHash=seq?EVENTS[seq-1].hash:"GENESIS";
  const hash=h32(`${prevHash}|${seq}|${ts}|${type}|${JSON.stringify(payload)}`);
  EVENTS.push({seq,ts,type,payload,prevHash,hash});
  saveSession();
}
function verifyChain(events=EVENTS){
  let prev="GENESIS";
  for(const e of events){
    const expected=h32(`${prev}|${e.seq}|${e.ts}|${e.type}|${JSON.stringify(e.payload)}`);
    if(e.prevHash!==prev||e.hash!==expected) return {ok:false,brokenAtSeq:e.seq,n:events.length};
    prev=e.hash;
  }
  return {ok:true,n:events.length};
}
function exportAuditLog(){
  const verdict=verifyChain();
  const blob=new Blob([JSON.stringify({
    exportedAt:new Date().toISOString(), sessionId:SID, farm:MIRROR.farm?.name,
    integrity:verdict, events:EVENTS
  },null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`agrivi-audit-${SID||"session"}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
const ES=()=>({status:"empty",value:null,raw:null,cap:null});
function baseState(){ return { phase:"collecting", schema:"SPRAYING", identity:null, amendsId:null,
  slots:{ field:ES(),crop:ES(),products:{status:"empty",value:[],raw:null,cap:null},date:ES(),operator:ES(),yield:ES(),moisture:ES(),note:ES() },
  rejections:[], ambiguity:null, messages:[], outbox:[], server:[], findings:[], blocked:null }; }
function reduce(s0,ev){
  const s=structuredClone(s0), p=ev.payload;
  switch(ev.type){
    case "SCHEMA_CHANGED": s.schema=p.type; s.slots=baseState().slots; s.rejections=[]; s.ambiguity=null; s.findings=[]; s.phase="collecting"; s.amendsId=null; break;
    // A correction to an ALREADY-SUBMITTED record. Reuses the same schema and
    // the same collect→review→submit machinery — the only difference is that
    // buildRecord() carries `amendsId` through, so the resulting record is
    // linked to, never a replacement for, the original (append-only, matching
    // "duplicates are worse than omissions" — nothing already on AGRIVI 360
    // is ever deleted or silently overwritten by an amendment).
    case "AMEND_STARTED": s.slots=baseState().slots; s.rejections=[]; s.ambiguity=null; s.findings=[]; s.phase="collecting"; s.amendsId=p.amendsId; break;
    case "USER_UTTERANCE": s.messages.push({role:"user",text:p.text,ts:ev.ts}); break;
    case "AGENT_UTTERANCE": s.messages.push({role:"agent",ack:p.ack,text:p.text,kind:p.kind||"say",code:p.code,src:p.src,ms:p.ms,cost:p.cost,schema:p.schema,ts:ev.ts}); break;
    case "PROPOSAL_RECEIVED": break;   // a claim, not a fact — deliberately inert
    case "RAIL_TRIPPED": s.blocked={stage:p.stage,code:p.code,detail:p.detail}; break;
    case "RAIL_CLEARED": s.blocked=null; break;
    case "SLOT_COMMITTED": {
      if(p.slot==="products"){ const l=s.slots.products.value.slice();
        const i=l.findIndex(x=>x.productId===p.value.productId);
        if(i>=0) l[i]={...l[i],...p.value,dose:p.value.dose!=null?p.value.dose:l[i].dose}; else l.push(p.value);
        s.slots.products={status:"filled",value:l,raw:p.raw,cap:p.cap};
      } else s.slots[p.slot]={status:"filled",value:p.value,raw:p.raw,cap:p.cap};
      s.rejections=s.rejections.filter(r=>r.slot!==p.slot);
      if(s.ambiguity&&s.ambiguity.slot===p.slot) s.ambiguity=null; break; }
    case "SLOT_REJECTED":
      if(p.slot!=="products") s.slots[p.slot]={status:"rejected",value:null,raw:p.raw,cap:null};
      else s.slots.products={...s.slots.products,status:"rejected",raw:p.raw};
      s.rejections=s.rejections.filter(r=>r.slot!==p.slot);
      s.rejections.push({slot:p.slot,raw:p.raw,code:p.code,detail:p.detail,options:p.options}); break;
    case "SLOT_AMBIGUOUS": s.slots[p.slot].status="ambiguous"; s.slots[p.slot].raw=p.raw;
      s.ambiguity={slot:p.slot,candidates:p.candidates}; break;
    case "PHASE_CHANGED": s.phase=p.phase; break;
    case "QA_FINDINGS": s.findings=p.findings; break;
    case "OUTBOX_ENQUEUED": s.outbox.push({key:p.key,record:p.record,status:"PENDING",attempts:0,lastError:null}); break;
    case "OUTBOX_ATTEMPT":{ const i=s.outbox.find(x=>x.key===p.key); if(i){i.status="SENDING";i.attempts=p.attempt;} break; }
    case "OUTBOX_FAILED":{ const i=s.outbox.find(x=>x.key===p.key); if(i){i.status="PENDING";i.lastError=p.error;} break; }
    case "OUTBOX_SYNCED":{ const i=s.outbox.find(x=>x.key===p.key); if(i){i.status="SYNCED";i.serverId=p.serverId;i.deduped=p.deduped;} break; }
    case "SERVER_RECORD_COMMITTED":
      if(!s.server.some(r=>r.idempotencyKey===p.record.idempotencyKey)) s.server.push(p.record); break;
    // Identity lives in the fold, exactly like every other fact this system
    // knows — never a free-floating variable someone can forget to reset.
    // A fresh session's baseState() has identity:null; replaying a saved
    // conversation correctly reconstructs whatever was established in it;
    // switching tenants starts a new session and so starts unidentified again.
    case "IDENTITY_ESTABLISHED": s.identity=p.operatorId; break;
  }
  return s;
}
const fold=upto=>(upto==null?EVENTS:EVENTS.slice(0,upto+1)).reduce(reduce,baseState());
let S=baseState();

