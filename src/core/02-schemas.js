// core/02-schemas.js
// §1 — work order schemas (Spraying / Fertilizing / Harvest / Generic).

/* ───────── §1  WORK ORDER SCHEMAS  — what makes the Planner honest ─────────
   The engine is schema-driven. Harvest has no dose and no PHI; spraying has
   authorisation numbers and label rates. One kernel, N work orders. A Planner
   that plans a constant would be theatre — this one plans something real. */
const SCHEMAS = {
  SPRAYING: {
    type:"SPRAYING", label:"Spraying", productKind:"PPP",
    slots:["field","crop","products","date","operator"],
    elicit:{ field:"Which field did you spray?", product:"What product did you use on {field}? It's growing {crop} this season.",
             dose:"How much {product} per hectare did you use? The label allows {range}.",
             date:"When did you spray?", operator:"Who did the spraying?" },
    validators:{ products:["resolve_product","check_crop_product_compatibility","check_dose"], operator:["resolve_operator"] },
    rubric:[ "Total product = dose × area is physically plausible for one tank run",
             "Product target (fungal/insect) is consistent with anything the worker described",
             "Pre-harvest interval leaves a workable harvest window",
             "No near-identical application already logged on this block inside the PHI window",
             "Operator licence covers plant protection products on the application date" ]
  },
  FERTILIZING: {
    type:"FERTILIZING", label:"Fertilizing", productKind:"FERT",
    slots:["field","crop","products","date","operator"],
    elicit:{ field:"Which field did you fertilise?", product:"What fertiliser did you put on {field}?",
             dose:"How much {product} per hectare? Typical range is {range}.",
             date:"When did you apply it?", operator:"Who applied it?" },
    validators:{ products:["resolve_product","check_crop_product_compatibility","check_dose"], operator:["resolve_operator"] },
    rubric:[ "Application rate is within agronomic norms for the crop and growth stage",
             "Total N applied does not breach the Nitrates Directive ceiling for the block",
             "No fertiliser licence requirement — do NOT flag operator certification" ]
  },
  HARVEST: {
    type:"HARVEST", label:"Harvest", productKind:null,
    slots:["field","crop","yield","moisture","date","operator"],
    elicit:{ field:"Which field did you harvest?", yield:"How much did you bring in, in tonnes per hectare?",
             moisture:"What was the grain moisture, roughly (as a %)?",
             date:"When did you harvest?", operator:"Who ran the harvester?" },
    validators:{ yield:["check_yield"], moisture:["check_moisture"], operator:["resolve_operator"] },
    rubric:[ "Yield is plausible for this crop and region",
             "Moisture is within a storable range or drying is implied",
             "Harvest date respects the pre-harvest interval of the last spraying on this block",
             "No dose, product or PHI concepts apply here — do NOT ask for them" ]
  },
  // GENERIC — the "useful in every occasion" path. Anything that isn't one of
  // the specialised work orders (irrigation, scouting, mowing, mulching …) is
  // still logged: field + date + operator validated against AGRIVI, plus a
  // free-text note. The agent never forces the worker into a category it
  // doesn't fit.
  GENERIC: {
    type:"GENERIC", label:"Work order", productKind:null,
    slots:["field","date","operator","note"],
    elicit:{ field:"Which field or block was this on?", date:"When did you do it?",
             operator:"Who did the work?", note:"In a few words, what did you do?" },
    validators:{ operator:["resolve_operator"] },
    rubric:[ "Field and operator resolve to real AGRIVI records",
             "The note captures what was actually done" ]
  }
};
let SCHEMA = SCHEMAS.SPRAYING;   // provisional; the agent INFERS the real type from the first utterance
// Both these initial values are placeholders only — applyRecovered() (ui/03-boot.js)
// overwrites them from the replayed event log before the worker can ever see or
// interact with them, on every boot and every new session. A fresh session has
// no SCHEMA_CHANGED event and no filled slots, so it correctly resolves to
// SCHEMA_LOCKED=false: unlocked, the agent infers spraying/fertilising/harvest/
// generic from what's actually said, and can re-lock to a different type
// mid-conversation (11-kernel.js) if what's said clearly changes.
let SCHEMA_LOCKED = true;

/* SESSION IDENTITY — who is actually talking, established from the
   conversation, never assumed from tenant config. `MIRROR.currentUser` is
   tenant DATA (a roster default a scripted demo can fall back to); it is not
   "the person using the device right now." Nothing greets by name, and "I" /
   "me" does not resolve to anybody, until the worker has told the agent who
   they are — the first time an operator slot commits from a self-reference
   phrase that couldn't otherwise resolve (see resolve_operator + verify()).
   Any device, any worker, no login screen, no guessed name.

   This lives in the FOLDED STATE (S.identity, via the IDENTITY_ESTABLISHED
   event below), not a free-floating variable — the same "state = fold(events)"
   discipline as every other fact this system knows. That is what makes it
   automatically correct on a new chat (fresh baseState → null), on reopening
   a saved conversation (replay reconstructs it), and on a tenant switch
   (a new session starts unidentified) — there is no separate reset call to
   forget. See baseState()/reduce() for the "IDENTITY_ESTABLISHED" case. */

// Web search is a distinct capability the worker can turn off — it is the
// only agent allowed to leave the farm's own data. Persisted across sessions
// (a preference, not conversation state), defaulting on.
let WEB_SEARCH_ENABLED = (()=>{ try{ const v=localStorage.getItem("agrivi.websearch.enabled"); return v===null?true:v==="1"; }catch(_){ return true; } })();
function setWebSearchEnabled(on){ WEB_SEARCH_ENABLED=!!on; try{ localStorage.setItem("agrivi.websearch.enabled", on?"1":"0"); }catch(_){} }

/* INTENT DETECTION — a Planner responsibility. The worker never picks a
   category from a menu; the agent reads what they said and routes to the right
   schema (or GENERIC). Deterministic-first, so it works offline; a model tier
   can sharpen it when connected. Returns a schema type, or null when it truly
   can't tell (then the agent asks). */
function classifyWorkOrder(text){
  const t=norm(text);
  // Prefix matching (leading \b, NO trailing \b) so "fungicide"/"irrigation"/
  // "fertilising" match their stems. A named product routes by its kind.
  const named = kind => MIRROR.products.some(p => p.kind===kind &&
    (bestSpan(text,p.name).score>0.6 || (p.aliases||[]).some(a => a && t.includes(a))));
  if(/\b(spray|fungicid|herbicid|insecticid|pesticid|treated|ppp)/.test(t) || named("PPP")) return "SPRAYING";
  if(/\b(fertilis|fertiliz|nitrogen|urea|manure|spread|top ?dress|npk|kan)/.test(t) || named("FERT")) return "FERTILIZING";
  if(/\b(harvest|combine|combined|yield|tonne|moisture|threshed)/.test(t)) return "HARVEST";
  // Something was clearly done, but it isn't a specialised type → GENERIC.
  if(/\b(irrigat|water|mow|mulch|scout|inspect|prun|plough|plow|till|seed|sow|plant|weed|check|clean|clear|repair|fix|mend|graz)/.test(t)) return "GENERIC";
  return null;
}

