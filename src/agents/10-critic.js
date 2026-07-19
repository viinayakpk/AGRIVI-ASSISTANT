// agents/10-critic.js
// Agent ⑧ QA Critic — rubric-scored, advisory over the deterministic validators.

/* ⑧ QA CRITIC — evaluator-optimizer. The rubric is EXPLICIT: open-ended
   "find problems" underperforms. And it is ADVISORY over the validators:
   a critic that disagrees with check_dose is wrong, not interesting.      */
const QA_SCHEMA={type:"object",properties:{
  findings:{type:"array",items:{type:"object",properties:{
    severity:{type:"string",enum:["BLOCK","WARN","INFO"]},
    criterion:{type:"string"}, message:{type:"string"}},
    required:["severity","criterion","message"],additionalProperties:false}}},
  required:["findings"],additionalProperties:false};
const AgentCritic = {
  id:"critic", zone:"Q",
  async run(record, st){
    if(cbOpen("critic")) return {findings:[],by:"skipped",cost:0};
    const ctxTxt=JSON.stringify({ record, field:st.slots.field.value, crop:st.slots.crop.value,
      products:st.slots.products.value, priorRecords:st.server.map(r=>({block:r.block,date:r.date,products:r.products})) });
    try{
      const r=await runQ("critic",
        `You are an agronomic QA reviewer for a ${SCHEMA.label} record about to be written to AGRIVI 360.
This record is a legal document under Reg. (EU) 1107/2009 Art. 67.

Score it against EXACTLY these criteria and nothing else:
${SCHEMA.rubric.map((x,i)=>`${i+1}. ${x}`).join("\n")}

Rules:
- Deterministic validators have ALREADY checked field existence, product registration,
  crop compatibility, label dose bounds, licence validity and the date window. Do NOT
  re-report those — they passed. You are looking for what a rules engine CANNOT see.
- BLOCK only for something that makes the record wrong or unlawful.
- WARN for something a supervisor should see. INFO for a note.
- Return an EMPTY findings array if the record is sound. Do not invent concerns to seem useful.`,
        ctxTxt, QA_SCHEMA);
      cbOk("critic"); return {...r.parsed, by:r.model, cost:r.cost};
    }catch(e){ cbFail("critic",String(e.message||e)); return {findings:[],by:"degraded",cost:0}; }
  }
};

