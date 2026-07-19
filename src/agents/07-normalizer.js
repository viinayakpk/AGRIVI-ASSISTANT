// agents/07-normalizer.js
// Agent ① Normalizer — ASR disfluency, HR/EN code-switch, spoken numbers.

/* ① NORMALIZER — ASR disfluency, HR/EN code-switch, spoken numbers. */
const NORM_SCHEMA={type:"object",properties:{
  clean:{type:"string"},lang:{type:"string"},changed:{type:"boolean"}},
  required:["clean","lang","changed"],additionalProperties:false};
const AgentNormalizer = {
  id:"normalizer", zone:"Q",
  async run(text){
    if(cbOpen("normalizer")) return {clean:text,lang:"und",changed:false,by:"skipped",cost:0};
    try{
      const r=await runQ("normalizer",
        `You clean up speech-to-text from farm workers in Croatia. They mix Croatian and English.
Remove disfluency (uh, um, ovaj), fix obvious ASR errors, and convert spoken quantities to digits
("pola litre" -> "0.5 litre", "half a litre" -> "0.5 litre", "dvjesto kila" -> "200 kg").
Translate Croatian farm terms to English but KEEP proper nouns (field and product names) exactly.
Do NOT add, infer, or invent anything. Do NOT answer the message. Return the cleaned text only.`,
        text, NORM_SCHEMA);
      cbOk("normalizer"); return {...r.parsed, by:r.model, cost:r.cost};
    }catch(e){ cbFail("normalizer",String(e.message||e)); return {clean:text,lang:"und",changed:false,by:"degraded",cost:0}; }
  }
};

