// core/08-memory.js
// §6b — temporal (bi-temporal) memory graph.

/* ───────── §6b  TEMPORAL MEMORY — a bi-temporal knowledge graph ─────────
   Rung 4 (long-term memory) + the substrate for rung 6 (foresight).
   Modelled on Zep/Graphiti: every fact carries a VALIDITY WINDOW
   {validFrom, validTo}. Superseded facts are invalidated, not deleted, so
   crop rotation, PHI windows and re-entry intervals — all inherently
   temporal — have a natural home. A pile of embeddings cannot answer "is this
   block still inside a pre-harvest interval NOW?"; a temporal graph can.

   MEM is DERIVED from the event log, exactly like S. That is the safety
   property: a bad consolidation is fixed by replay, never a data-loss event.
   The agent's "memory" is just another fold of the same append-only truth. */
let MEM = [];
const addDaysISO=(iso,d)=>new Date(Date.parse(iso)+d*864e5).toISOString().slice(0,10);
const addHoursISO=(iso,h)=>new Date(Date.parse(iso)+h*3600e3).toISOString().slice(0,16).replace("T"," ");

function memAssert(subject,predicate,object,validFrom,validTo,meta){
  MEM.push({subject,predicate,object,validFrom,validTo:validTo||null,recordedAt:todayISO(),meta:meta||{}});
}
// Turn one committed record into episodic + temporal facts.
function memIngest(rec){
  const at=rec.date, yr=at.slice(0,4);
  // Crop assignment is a temporal fact (rotation across seasons).
  memAssert(rec.block,"crop",rec.cropId,`${yr}-01-01`,null,{});
  for(const p of (rec.products||[])){
    const prod=product(p.productId); if(!prod) continue;
    memAssert(rec.block,"applied",p.productId,at,null,
      {dose:p.dosePerHa,unit:p.unit,target:prod.target,kind:prod.kind,name:prod.name,areaHa:rec.areaHa,session:rec.idempotencyKey});
    if(prod.phiDays) memAssert(rec.block,"under_phi",p.productId,at,addDaysISO(at,prod.phiDays),{phiDays:prod.phiDays,name:prod.name});
    if(prod.reEntryH) memAssert(rec.block,"re_entry",p.productId,at,addDaysISO(at,Math.ceil(prod.reEntryH/24)),{reEntryH:prod.reEntryH,name:prod.name});
  }
  if(rec.yieldTHa!=null) memAssert(rec.block,"harvested",rec.cropId,at,null,{yieldTHa:rec.yieldTHa,areaHa:rec.areaHa});
}
// Rebuild memory from the log — pure, idempotent, crash-safe.
function memRebuild(){
  MEM=[];
  for(const e of EVENTS) if(e.type==="SERVER_RECORD_COMMITTED") memIngest(e.payload.record);
}
const mem = {
  history:  block => MEM.filter(f=>f.subject===block).slice().sort((a,b)=>a.validFrom<b.validFrom?1:-1),
  // Facts of a given predicate on a block that are VALID AT a moment (bi-temporal core).
  validAt:  (block,predicate,when) => MEM.filter(f=>f.subject===block&&f.predicate===predicate&&f.validFrom<=when&&(!f.validTo||f.validTo>=when)),
  applications: block => MEM.filter(f=>f.subject===block&&f.predicate==="applied"),
  seasonN: (block,year) => MEM.filter(f=>f.subject===block&&f.predicate==="applied"&&f.meta.kind==="FERT"&&f.validFrom.startsWith(year))
             .reduce((n,f)=>n+(f.meta.dose||0)*0.27,0)  // rough kg N/ha; KAN-class ~27% N
};

/* Slow process (System-2 consolidation) — runs OFF the hot path, after a
   record syncs. Distils semantic facts without making the worker wait. Kept
   deliberately light; the temporal graph does the heavy lifting. */
function consolidate(rec){ memRebuild(); /* semantic/procedural distillation lands here in Phase 3 */ }

