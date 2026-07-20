// core/05-tools.js
// §4 — the tool suite: pure, privileged validators. The only id minter.

/* ───────── §4  TOOL SUITE — pure, privileged, the only id minter ───────── */
const TOOLS = {
  resolve_field({text}){
    const s=match(text,MIRROR.fields,f=>f.name), top=s[0];
    if(!top||top.score<0.45) return {verdict:"REJECT",code:"UNKNOWN_FIELD",
      detail:`No field on ${MIRROR.farm.name} matches “${text}”.`,options:MIRROR.fields.map(f=>f.name)};
    const riv=s.filter(x=>x.score>=0.45&&top.score-x.score<0.12);
    if(riv.length>1) return {verdict:"AMBIGUOUS",code:"AMBIGUOUS_FIELD",detail:`“${text}” matches ${riv.length} blocks.`,
      candidates:riv.map(x=>({id:x.row.id,label:`${x.row.name} (${x.row.block}, ${x.row.areaHa} ha)`}))};
    const f=top.row;
    return {verdict:"OK",fieldId:f.id,block:f.block,areaHa:f.areaHa,cropId:f.cropId,confidence:+top.score.toFixed(2)};
  },
  resolve_product({text,kind}){
    const pool = kind ? MIRROR.products.filter(p=>p.kind===kind) : MIRROR.products;
    const s=match(text,pool,p=>p.name), top=s[0];
    if(!top||top.score<0.45) return {verdict:"REJECT",code:"UNREGISTERED_PRODUCT",
      detail:`“${text}” is not a registered ${kind==="FERT"?"fertiliser":"plant protection product"} for this farm.`,
      options:pool.map(p=>p.name)};
    const riv=s.filter(x=>x.score>=0.45&&top.score-x.score<0.12);
    if(riv.length>1) return {verdict:"AMBIGUOUS",code:"AMBIGUOUS_PRODUCT",detail:`“${text}” matches ${riv.length} products.`,
      candidates:riv.map(x=>({id:x.row.id,label:`${x.row.name} (${x.row.authNo})`}))};
    const p=top.row;
    return {verdict:"OK",productId:p.id,authNo:p.authNo,unit:p.unit,doseMin:p.doseMin,doseMax:p.doseMax,confidence:+top.score.toFixed(2)};
  },
  check_crop_product_compatibility({cropId,productId}){
    const p=product(productId),c=crop(cropId);
    if(!p||!c) return {verdict:"REJECT",code:"UNRESOLVED_REF",detail:"Unknown crop or product id."};
    if(p.approvedCrops.includes(cropId)) return {verdict:"OK",authNo:p.authNo,phiDays:p.phiDays,reEntryH:p.reEntryH};
    return {verdict:"REJECT",code:"NOT_APPROVED_FOR_CROP",
      detail:`${p.name} (${p.authNo}) is not authorised on ${c.name}. Approved: ${p.approvedCrops.map(i=>crop(i).name).join(", ")}.`,
      options:MIRROR.products.filter(x=>x.kind===p.kind&&x.approvedCrops.includes(cropId)).map(x=>x.name)};
  },
  check_dose({productId,dose,unit}){
    const p=product(productId);
    if(!p) return {verdict:"REJECT",code:"UNRESOLVED_REF",detail:"Unknown product id."};
    if(dose==null||Number.isNaN(dose)) return {verdict:"REJECT",code:"DOSE_MISSING",detail:`No rate given for ${p.name}.`};
    // norm() already turns "/" into a space ("L/ha" -> "l ha"), so stripping a
    // literal "/ha" AFTER norm() was a no-op — the extractor omitting the
    // per-hectare suffix entirely ("L" instead of "L/ha") failed this as a
    // false DOSE_UNIT_MISMATCH instead of the intended lenient base-unit match.
    const baseUnit = s => norm(s).replace(/\s*ha$/,"").trim();
    if(unit && baseUnit(unit)!==baseUnit(p.unit))
      return {verdict:"REJECT",code:"DOSE_UNIT_MISMATCH",detail:`${p.name} is dosed in ${p.unit}, not ${unit}.`};
    if(dose<p.doseMin||dose>p.doseMax)
      return {verdict:"REJECT",code:"DOSE_OUT_OF_RANGE",
        detail:`${dose} ${p.unit} is outside the authorised label rate for ${p.name} (${p.doseMin}-${p.doseMax} ${p.unit}).`};
    return {verdict:"OK",unit:p.unit};
  },
  // `knownIdentity` is passed in explicitly by the caller (from the folded
  // state) rather than read from a closure — this tool stays a pure function
  // of its arguments, like every other tool here, testable in isolation.
  resolve_operator({text,onDate,answeringIdentity,knownIdentity,selfIntro}){
    let q=norm(text);
    // A PATTERN, not an exact-string allowlist — "I did it", "I sprayed it",
    // "it was me" must all be recognised as self-reference. An exact-match
    // list silently mis-parsed anything not a precise match ("I did it" fell
    // through to fuzzy NAME matching and returned UNKNOWN_OPERATOR instead of
    // asking who "I" is) — same bug class as guessing an identity, just in
    // the other direction: failing to recognise a real self-reference.
    // selfIntro (set by the extractor from the ORIGINAL text, before it was
    // trimmed to just the matched name span) means this is "I'm Marko", not
    // a bare "I did it" — the name is already given right here, so this must
    // NOT fall into the "ask who you are" branch below, which exists only
    // for the case where a name genuinely isn't in the message at all.
    const selfRef=(/^(i|me|myself|self)\b/.test(q) || /\b(it was me|by me)$/.test(q)) && !selfIntro;
    if(selfRef){
      // "I/me" is only meaningful once the worker has told us who they are —
      // never guessed from tenant config. First time, we don't know: ask.
      if(!knownIdentity) return {verdict:"REJECT",code:"IDENTITY_UNKNOWN",
        detail:`I don't know who you are yet — what's your name?`,options:MIRROR.operators.map(o=>o.name)};
      q=norm(operator(knownIdentity).name);
    }
    const s=match(q,MIRROR.operators,o=>o.name), top=s[0];
    // This tenant's roster is a small, fixed demo list of three names —
    // treating anyone else as unresolvable would mean no name outside it
    // could ever be logged at all, a dead end rather than a validation. The
    // assignment's own required checks are field, product, and crop-product
    // compatibility; a closed operator list was never one of them. Accepted
    // as given rather than bounced — just honestly uncertified, since there's
    // no PPP licence on file to check it against, not a claim that one was
    // checked and passed. establishesIdentity stays false here regardless of
    // selfRef/selfIntro: there's no real roster id to remember it by, and a
    // null "identity" would be indistinguishable from "still unknown".
    if(!top||top.score<0.45) return {verdict:"OK",operatorId:null,operatorName:text.trim(),
      uncertified:true,establishesIdentity:false};
    const o=top.row;
    const establishesIdentity = selfRef||selfIntro||!!answeringIdentity;
    if(SCHEMA.productKind==="PPP" && onDate && o.licenceExpiry<onDate)
      return {verdict:"REJECT",code:"LICENCE_EXPIRED",
        detail:`${o.name}'s spray licence ${o.licenceNo} expired ${o.licenceExpiry}, before the application date ${onDate}. This record cannot be certified.`,
        options:MIRROR.operators.filter(x=>x.licenceExpiry>=onDate).map(x=>x.name),
        operatorId:o.id, establishesIdentity};
    return {verdict:"OK",operatorId:o.id,licenceNo:o.licenceNo,licenceExpiry:o.licenceExpiry,
      establishesIdentity};
  },
  check_date({iso}){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||"")) return {verdict:"REJECT",code:"DATE_UNPARSEABLE",detail:`Could not read “${iso}” as a date.`};
    const t=todayISO();
    if(iso>t) return {verdict:"REJECT",code:"DATE_IN_FUTURE",detail:`${iso} is in the future. Work is logged after it's done.`};
    const days=Math.round((Date.parse(t)-Date.parse(iso))/864e5);
    if(days>30) return {verdict:"REJECT",code:"DATE_OUTSIDE_WINDOW",
      detail:`${iso} is ${days} days ago, outside the 30-day record window (Reg. (EU) 2023/564). Needs supervisor back-entry.`};
    return {verdict:"OK",iso,daysAgo:days};
  },
  check_yield({value}){
    if(value==null||Number.isNaN(value)) return {verdict:"REJECT",code:"YIELD_MISSING",detail:"No yield given."};
    if(value<=0||value>25) return {verdict:"REJECT",code:"YIELD_IMPLAUSIBLE",
      detail:`${value} t/ha is outside any plausible range (0-25 t/ha).`};
    return {verdict:"OK",value,unit:"t/ha"};
  },
  check_moisture({value}){
    if(value==null||Number.isNaN(value)) return {verdict:"REJECT",code:"MOISTURE_MISSING",detail:"No moisture given."};
    if(value<5||value>40) return {verdict:"REJECT",code:"MOISTURE_IMPLAUSIBLE",detail:`${value}% is outside a plausible range (5-40%).`};
    return {verdict:"OK",value,unit:"%",needsDrying:value>14};
  }
};
let TOOL_LOG=[];
function callTool(name,args){
  const t0=performance.now(); const out=TOOLS[name](args);
  const rec={name,args,out,verdict:out.verdict,ms:+(performance.now()-t0).toFixed(2),at:Date.now()};
  TOOL_LOG.push(rec); if(TOOL_LOG.length>150) TOOL_LOG.shift();
  span("execute_tool",{ "tool.name":name, "tool.verdict":out.verdict, "tool.args":JSON.stringify(args).slice(0,90) }, rec.ms, "P");
  return out;
}

