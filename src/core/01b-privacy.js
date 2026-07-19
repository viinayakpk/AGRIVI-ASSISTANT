// core/01b-privacy.js
// PII redaction — known roster names never leave the browser in a model
// call. Applied at a single chokepoint (openrouter()'s payload construction
// and response parsing), so every agent downstream is unaware it happened:
// the Extractor still resolves a real operator name, because restorePII()
// runs on the parsed response before any caller ever sees it.

/* Stable per-session pseudonym map, built once from the tenant's operator
   roster. Longest names first when matching, so "Ivana Kovač" isn't
   partially eaten by a bare "Ivana" rule and left with a dangling surname. */
const PII={_map:null};
function pseudonymMap(){
  if(PII._map) return PII._map;
  const map=new Map();
  (MIRROR.operators||[]).forEach((o,i)=>{
    const token=`OPERATOR_${i+1}`;
    if(o.name) map.set(o.name,token);
    const first=(o.name||"").split(" ")[0];
    if(first && first!==o.name) map.set(first,token);
  });
  PII._map=map;
  return map;
}
function redactPII(text){
  if(!text) return text;
  const map=pseudonymMap();
  let out=text;
  for(const name of [...map.keys()].sort((a,b)=>b.length-a.length)){
    const re=new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"gi");
    out=out.replace(re,map.get(name));
  }
  return out;
}
function restorePII(text){
  if(!text||typeof text!=="string") return text;
  const map=pseudonymMap();
  // Reverse map, preferring the full name over a bare-first-name alias that
  // happens to share the same token, so restoration reads naturally.
  const reverse=new Map();
  for(const [name,token] of map) if(!reverse.has(token)||name.includes(" ")) reverse.set(token,name);
  let out=text;
  for(const [token,name] of reverse) out=out.split(token).join(name);
  return out;
}
// Shallow-restores every string-valued field of a parsed model response —
// covers `answer` (chat/advisor/websearch) and every `*_text` extraction
// field in one pass, with no per-agent special-casing needed.
function restorePIIDeep(obj){
  if(!obj||typeof obj!=="object") return obj;
  for(const k of Object.keys(obj)){
    if(typeof obj[k]==="string") obj[k]=restorePII(obj[k]);
    else if(Array.isArray(obj[k])) obj[k].forEach(v=>restorePIIDeep(v));
  }
  return obj;
}
