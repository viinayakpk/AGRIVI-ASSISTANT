// agents/14-foresight.js
// Agent ⑩ Foresight — deterministic, offline, reads the temporal memory graph.

/* ⑩ FORESIGHT — rung 6. Reasons about the FUTURE from memory, not just the
   record in front of it. This is the transcriptionist → advisor leap.

   Deterministic-first and OFFLINE-CAPABLE: the whole point is that depth does
   not require a network. It reads the temporal graph (privileged) and reasons
   about consequences the moment a record is about to be written:
     · re-entry   — when is it safe to walk the block again
     · pre-harvest — earliest legal harvest date (PHI)
     · resistance — repeated mode-of-action on this block this season
     · N-balance  — season nitrogen vs the Nitrates Directive ceiling
     · PHI GATE   — a HARVEST inside a prior spray's PHI window is a BLOCK
   Selective foresight (WorldEvolver): only surface what we're sure of. It
   returns an EMPTY list on a clean record — it never manufactures concern. */
const AgentForesight = {
  id:"foresight", zone:"P",
  run(rec, st){
    const F=[]; const block=rec.block, when=rec.date;

    // A harvest inside a live PHI window is unlawful — the cross-schema check
    // that only memory can answer. This is why memory had to come first.
    if(rec.type==="HARVEST"){
      for(const f of mem.validAt(block,"under_phi",when))
        F.push({severity:"BLOCK",criterion:"pre-harvest interval",
          message:`${block} is inside the pre-harvest interval of ${f.meta.name} (applied earlier, PHI ${f.meta.phiDays}d). Harvesting on ${when} is not permitted until ${f.validTo}. This would fail an MRL audit.`});
      for(const f of mem.validAt(block,"re_entry",when))
        F.push({severity:"WARN",criterion:"re-entry",message:`${block} was under a re-entry restriction from ${f.meta.name} until ${f.validTo}. Confirm the harvest crew's entry was compliant.`});
    }

    // Live weather → drift compliance. Wind above the ground-boom cutoff means
    // the application risked drifting off-target; the record must carry it.
    // Conditions are now attached to EVERY record type (informational), but
    // these two findings only make sense for an actual product application —
    // a harvest or a generic note isn't "at risk of spray drift".
    if(rec.conditions && (rec.type==="SPRAYING"||rec.type==="FERTILIZING")){
      const w=rec.conditions;
      if(w.windKph>DRIFT_KPH) F.push({severity:"WARN",criterion:"spray drift",
        message:`Wind was ${w.windKph} km/h at application (${field(rec.fieldId).name}), above the ~${DRIFT_KPH} km/h drift threshold. Note the off-target drift risk or reassess the timing. [live: ${w.source}]`});
      if(w.rainNext6hMm>=1) F.push({severity:"WARN",criterion:"rainfastness",
        message:`~${w.rainNext6hMm} mm rain forecast in the next 6 h. Confirm the product is rainfast, or the application may wash off. [live: ${w.source}]`});
    }

    // For an application (spray/fertilise) — forward-looking consequences.
    for(const p of (rec.products||[])){
      const prod=product(p.productId); if(!prod) continue;
      if(prod.reEntryH) F.push({severity:"INFO",criterion:"re-entry",
        message:`No re-entry to ${field(rec.fieldId).name} until ${addHoursISO(when,prod.reEntryH)} (${prod.reEntryH}h after application).`});
      if(prod.phiDays) F.push({severity:"INFO",criterion:"pre-harvest",
        message:`Do not harvest ${block} before ${addDaysISO(when,prod.phiDays)}. ${prod.name} has a ${prod.phiDays}-day pre-harvest interval.`});
      // Resistance: prior + current applications of the SAME target on this block this year.
      const yr=when.slice(0,4);
      const priorSame=mem.applications(block).filter(f=>f.meta.target===prod.target&&f.validFrom.startsWith(yr)).length;
      const total=priorSame+1;
      if(prod.target&&total>=3) F.push({severity:"WARN",criterion:"resistance management",
        message:`This is the ${total}${total===3?"rd":"th"} ${prod.target}-target product on ${block} this season. Rotate the mode of action or you risk breeding resistance (FRAC/IRAC guidance).`});
    }

    // Nitrogen balance for fertilising — a real regulatory ceiling.
    if(rec.type==="FERTILIZING"){
      const yr=when.slice(0,4);
      const priorN=mem.seasonN(block,yr);
      const thisN=(rec.products||[]).filter(p=>product(p.productId)?.kind==="FERT").reduce((n,p)=>n+(p.dosePerHa||0)*0.27,0);
      const totalN=priorN+thisN;
      if(totalN>170) F.push({severity:"BLOCK",criterion:"nitrogen ceiling",
        message:`This application puts ${block} at ~${Math.round(totalN)} kg N/ha for the season. This would breach the Nitrates Directive ceiling of 170 kg N/ha.`});
      else if(totalN>140) F.push({severity:"WARN",criterion:"nitrogen ceiling",
        message:`${block} is at ~${Math.round(totalN)} kg N/ha this season, approaching the 170 kg N/ha Nitrates Directive ceiling.`});
    }

    return {findings:F, by:"foresight:deterministic", cost:0};
  }
};

