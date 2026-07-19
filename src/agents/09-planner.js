// agents/09-planner.js
// Agent ⑤ Planner — honest only because schemas actually differ.

/* ⑤ PLANNER — reads the schema, plans elicitation. Honest only because
   schemas actually differ. On a fixed form this would be theatre.        */
const PLAN_SCHEMA={type:"object",properties:{
  order:{type:"array",items:{type:"string"}}, rationale:{type:"string"}},
  required:["order","rationale"],additionalProperties:false};
const AgentPlanner = {
  id:"planner", zone:"P",
  classify: classifyWorkOrder,   // intent detection is a Planner job: decide WHAT, then plan HOW
  async run(){
    const fallback={order:SCHEMA.slots.filter(s=>s!=="crop"),rationale:"schema order; crop derives from the block",by:"deterministic",cost:0};
    if(cbOpen("planner")) return fallback;
    try{
      const r=await runQ("planner",
        `You plan the order in which a farm worker is asked for a work order's fields.
Return the slot ids in the order they should be elicited, and one sentence of rationale.
Rules: ask for the field FIRST (everything else depends on it). Never ask for "crop" — it is
derived from the block's season assignment. Prefer the order that lets the worker answer in
one breath. Slots available: ${JSON.stringify(SCHEMA.slots)}. Work order type: ${SCHEMA.type}.`,
        JSON.stringify({type:SCHEMA.type,slots:SCHEMA.slots}), PLAN_SCHEMA);
      cbOk("planner");
      const order=r.parsed.order.filter(s=>SCHEMA.slots.includes(s)&&s!=="crop");
      return order.length ? {...r.parsed,order,by:r.model,cost:r.cost} : fallback;
    }catch(e){ cbFail("planner",String(e.message||e)); return fallback; }
  }
};
let PLAN=null;

