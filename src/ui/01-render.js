// ui/01-render.js
// §15 — render. Turns state into DOM.

/* ───────── §15  RENDER ───────── */
let RAILS=[];
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const NODES_Q=[["screen","Screen","screen"],["router","Router","router"],["chat","Chat","chat"],["normalizer","Normalizer","normalizer"],
  ["extractor","Extractor","extractor"],["critic","QA Critic","critic"],["advisor","Advisor","advisor"],["websearch","Web Search","websearch"]];
const NODES_P=[["verifier","Verifier","—  pure fns"],["foresight","Foresight","—  reads memory"],["weather","Weather","—  live, keyless"],["kernel","Policy","—  deterministic"]];

function renderPipe(){
  renderReceipt();
}
function render(){
  const st=S;
  renderChat(st); renderSlots(st); renderTrace(); renderRails(); renderModels(); renderOutbox(st); renderPipe();
  const latest=[...st.messages].reverse().find(m=>m.role==="agent"&&m.src!=="kernel");
  $("#spend").textContent="$"+(latest?.cost||0).toFixed(5);
  $("#tok").textContent=SPEND.tokIn?` · ${SPEND.tokIn}in/${SPEND.tokOut}out`:"";
  $("#send").disabled=busy||st.phase==="submitting";
  $("#schemaName").textContent=SCHEMA.type;
  const wc=$("#woChip"); if(wc) wc.textContent = SCHEMA_LOCKED ? SCHEMA.label : "Listening";
  const wt=$("#woType"); if(wt && wt.value!==SCHEMA.type) wt.value=SCHEMA.type;
  $("#hint").textContent="";
  syncWebSearchBtn();
}
function syncWebSearchBtn(){
  const b=$("#websearchBtn"), l=$("#websearchLabel"); if(!b||!l) return;
  b.setAttribute("aria-pressed", WEB_SEARCH_ENABLED?"true":"false");
  l.textContent = `Web search: ${WEB_SEARCH_ENABLED?"on":"off"}`;
}
const SEED_ICON=`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.2c4.2 3.4 6.9 8.6 5.9 13.6-.9 4.2-3.4 6.4-5.9 6.4s-5-2.2-5.9-6.4C5.1 10.8 7.8 5.6 12 2.2z" fill="#0F7A44"/><path d="M12 5.4v13.6" stroke="#F4F1EA" stroke-width="1.1" stroke-linecap="round" opacity=".5"/></svg>`;
let typing=false;
const showTyping=()=>{typing=true;render();scrollLog();}; const hideTyping=()=>{typing=false;};
function renderChat(st){
  if(!st.messages.length && !typing){ $("#log").innerHTML=""; return; }   // truly blank — no placeholder copy
  $("#log").innerHTML = st.messages.map(m=>{
    if(m.role==="user") return `<div class="msg user"><div class="av">YOU</div><div class="bub">${esc(m.text)}</div></div>`;
    if(m.kind==="review"){
      // A review card is bound to the schema that produced it. After a schema
      // switch the slots it summarised no longer exist — render the history
      // honestly rather than re-rendering it against unrelated data.
      if(m.schema!==st.schema || !recordComplete(st))
        return `<div class="msg agent"><div class="av">AG</div><div class="bub" style="opacity:.55">
          <span class="ecode" style="color:var(--ink-4)">SUPERSEDED</span>
          This earlier ${esc(m.schema||"work order")} summary is no longer current.</div></div>`;
      return reviewCard(st,m);
    }
    const cls=m.kind==="alert"?"alert":m.kind==="warn"?"warnb":m.kind==="blocked"?"blocked":"";
    const meta=m.src&&m.src!=="kernel"?`<button class="turn-receipt" type="button" onclick="openInspector('activity')">
      <span>Checked against AGRIVI</span><span aria-hidden="true">·</span><span>${m.ms||0} ms</span>${m.cost?`<span aria-hidden="true">·</span><span>$${m.cost.toFixed(5)}</span>`:""}<span aria-hidden="true">›</span></button>`:"";
    return `<div class="msg agent"><div class="av">AG</div><div>
      <div class="bub ${cls}">${m.ack?`<span class="ack">${m.ack}</span>`:""}<span>${m.text||""}</span></div>${meta}</div></div>`;
  }).join("") + (typing?`<div class="msg agent"><div class="av">AG</div><div class="bub"><span class="typing">${SEED_ICON}<em>Thinking</em></span></div></div>`:"");
}
function reviewCard(st,m){
  const s=st.slots, f=s.field.value, c=s.crop.value, o=s.operator.value;
  const rec=buildRecord(st);
  const blocking=st.findings.some(x=>x.severity==="BLOCK");
  const rows=[ [`Field`,`${esc(f.name)}<span class="sub">${esc(f.block)} · ${f.areaHa} ha</span>`],
    [`Crop`,`${esc(c.name)}<span class="sub">${esc(c.latin)} · derived from block</span>`] ];
  if(SCHEMA.slots.includes("products")&&s.products.value.length)
    rows.push([SCHEMA.productKind==="FERT"?"Fertiliser":"Products", s.products.value.map(p=>
      `${esc(p.name)}: <b>${p.dose} ${esc(p.unit)}</b><span class="sub">authorisation ${esc(p.authNo)} · total ${(p.dose*f.areaHa).toFixed(1)} ${esc(p.unit.replace("/ha",""))}${p.phiDays?` · PHI ${p.phiDays}d`:""}</span>`).join("<br>")]);
  if(s.yield.value) rows.push(["Yield",`<b>${s.yield.value.v} t/ha</b><span class="sub">total ${(s.yield.value.v*f.areaHa).toFixed(1)} t</span>`]);
  if(s.moisture.value) rows.push(["Moisture",`<b>${s.moisture.value.v}%</b><span class="sub">${s.moisture.value.needsDrying?"drying required":"storable"}</span>`]);
  const wx=GROUNDED[f.id];
  const isApplication = SCHEMA.type==="SPRAYING"||SCHEMA.type==="FERTILIZING";
  if(wx) rows.push(["Conditions",`<b>${esc(wx.windKph)} km/h</b> wind · ${esc(wx.tempC)}°C · ${esc(wx.humidity)}% RH<span class="sub">auto-filled from ${esc(wx.source)}${isApplication&&wx.windKph>19?" · above drift threshold":""}${wx._degraded?" · stale (provider degraded)":""}</span>`]);
  rows.push(["Date",`${esc(s.date.value.iso)}<span class="sub">${s.date.value.daysAgo===0?"today":s.date.value.daysAgo+"d ago"} · within 30-day window</span>`]);
  rows.push(["Operator",`${esc(o.name)}<span class="sub">${esc(o.licenceNo)} · valid to ${esc(o.licenceExpiry)}</span>`]);
  if(s.note.value) rows.push(["What was done",esc(s.note.value.text)]);
  // Block history from temporal memory — the visible proof the agent remembers.
  const hist=mem.history(f.block).filter(x=>x.predicate==="applied"||x.predicate==="harvested").slice(0,4);
  const histHtml = hist.length ? `<div class="rw"><dt>History</dt><dd>${hist.map(x=>
    `<span class="sub" style="margin:0">${esc(x.validFrom)} · ${x.predicate==="harvested"?`harvested ${x.meta.yieldTHa} t/ha`:`${esc(x.meta.name)} ${x.meta.dose} ${esc(x.meta.unit||"")}`}</span>`).join("")}</dd></div>` : "";
  return `<div class="msg agent review"><div style="width:100%">
    <h3>${st.amendsId?`Amending ${esc(st.amendsId)}`:"Check before submitting"}</h3>
    ${rows.map(([k,v])=>`<div class="rw"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}
    ${histHtml}
    ${st.findings.length?`<div class="qa"><div class="qh">Record checks</div>
      ${st.findings.map(x=>`<div class="qf"><i data-s="${esc(x.severity)}">${esc(x.severity)}</i><span>${esc(x.message)}</span></div>`).join("")}</div>`:""}
    <div class="acts">
      <button class="btn p" onclick="uiSubmit()" ${blocking?"disabled":""}>${blocking?"Blocked by QA":"Submit to AGRIVI 360"}</button>
      <button class="btn g" onclick="quick('no')">Fix</button>
      <button class="btn g" onclick="quick('cancel')">Discard</button>
    </div></div></div>`;
}
function renderSlots(st){
  const s=st.slots;
  const row=(n,sl,v)=>`<div class="slot" data-st="${sl.status}">
    <div class="t"><span class="n">${n}</span><span class="s">${sl.status}</span></div>
    <div class="v ${sl.status==="empty"?"dim":""}">${sl.status==="empty"?"Not captured yet":v}</div></div>`;
  let h=row("Field",s.field,s.field.value?`${esc(s.field.value.name)} <span class="mono" style="color:var(--ink-4);font-size:11px">${esc(s.field.value.block)}</span>`:"");
  h+=row("Crop",s.crop,s.crop.value?esc(s.crop.value.name):"");
  if(SCHEMA.slots.includes("products"))
    h+= s.products.value.length
      ? `<div class="slot" data-st="${s.products.status}"><div class="t"><span class="n">${SCHEMA.productKind==="FERT"?"Fertiliser":"Product(s)"} + rate</span><span class="s">${s.products.status}</span></div>
         ${s.products.value.map(p=>`<div class="v">${esc(p.name)}: ${p.dose!=null?`<b>${p.dose} ${esc(p.unit)}</b>`:`<span style="color:var(--warn)">rate pending</span>`}</div>`).join("")}</div>`
      : row("Product(s)",s.products,"");
  if(SCHEMA.slots.includes("yield")) h+=row("Yield",s.yield,s.yield.value?`<b>${s.yield.value.v}</b> t/ha`:"");
  if(SCHEMA.slots.includes("moisture")) h+=row("Moisture",s.moisture,s.moisture.value?`<b>${s.moisture.value.v}</b>%`:"");
  h+=row("Date",s.date,s.date.value?esc(s.date.value.iso):"");
  h+=row("Operator",s.operator,s.operator.value?`${esc(s.operator.value.name)} <span class="mono" style="color:var(--ink-4);font-size:11px">${esc(s.operator.value.licenceNo)}</span>`:"");
  $("#slotList").innerHTML=h;
  $("#rejList").innerHTML=st.rejections.length? st.rejections.map(r=>`<div class="slot" data-st="rejected">
    <div class="t"><span class="n">${esc(r.slot)}</span><span class="s">Needs attention</span></div>
    <div class="v" style="font-size:12.5px">${esc(r.detail)}</div></div>`).join("") : `<div class="empty">none open</div>`;
}
function renderTrace(){
  const labels={
    screen:["Checked the message","Safety screen"],
    router:["Chose the next step","Conversation routing"],
    normalizer:["Clarified the wording","Language normalization"],
    extractor:["Read the work details","Structured extraction"],
    planner:["Prepared the questions","Work-order planning"],
    verifier:["Checked AGRIVI data","Fields, products and allowed rates"],
    foresight:["Reviewed field history","Previous work and timing"],
    critic:["Reviewed the record","Final quality check"],
    advisor:["Answered the question","Guidance response"],
    chat:["Answered naturally","General conversation"],
    websearch:["Searched the live web","External, cited source — not farm data"]
  };
  const toolLabels={
    resolve_field:["Found the field","Matched against this farm"],
    resolve_product:["Found the product","Matched against registered products"],
    check_crop_product_compatibility:["Checked crop compatibility","Confirmed the product is allowed"],
    check_dose:["Checked the application rate","Compared with the authorised range"],
    resolve_operator:["Verified the operator","Checked the farm team and licence"],
    check_date:["Checked the date","Confirmed the logging window"]
  };
  const rows=SPANS.filter(s=>s.turn===turnSeq&&s.attrs&&(s.attrs["agent.id"]||s.attrs["tool.name"]));
  $("#traceList").innerHTML = rows.length ? `<div class="activity-list">${rows.map(s=>{
    const id=s.attrs["agent.id"], tool=s.attrs["tool.name"], copy=id?(labels[id]||["Processed a step",id]):(toolLabels[tool]||["Checked a value",tool]);
    const model=s.attrs["gen_ai.request.model"];
    return `<div class="activity-row"><span class="activity-mark" aria-hidden="true">✓</span>
      <div class="activity-copy"><b>${esc(copy[0])}</b><span>${esc(copy[1])}${model?` · ${esc(String(model).split("/").pop())}`:""}</span></div>
      <span class="activity-time">${s.ms?s.ms+" ms":""}</span></div>`;
  }).join("")}</div>` : `<div class="empty">Details for the next response will appear here.</div>`;
}
function renderRails(){
  $("#railList").innerHTML = RAILS.length ? RAILS.slice().reverse().map(r=>`<div class="row">
    <div class="h"><span class="vd" data-v="${esc(r.verdict)}">${esc(r.verdict)}</span>
      <span style="font-weight:650">${esc(r.stage)}:${esc(r.rail)}</span>
      <span style="margin-left:auto;color:var(--ink-4);font-size:9px">${esc(String(r.by).split("/").pop())}</span></div>
    <div class="b">${esc(r.category!=="none"?r.category+": ":"")}${esc(r.detail||"")}</div></div>`).join("")
    : `<div class="empty">No safety checks have required attention.</div>`;
  const cbs=Object.entries(CB);
  $("#cbList").innerHTML = cbs.length ? cbs.map(([k,c])=>`<div class="row"><div class="h">
    <span class="vd" data-v="${c.open?"TRIP":"OK"}">${c.open?"OPEN":"CLOSED"}</span><span style="font-weight:650">${esc(k)}</span>
    <span style="margin-left:auto;color:var(--ink-4);font-size:9px">${c.fails} fail${c.fails===1?"":"s"}</span></div>
    ${c.lastError?`<div class="b">${esc(c.lastError)}</div>`:""}</div>`).join("") : `<div class="empty">all closed</div>`;
}
function renderModels(){
  $("#modelList").innerHTML = Object.keys(MODELS).map(a=>{
    const m=CATALOG.find(x=>x.id===MODELS[a]);
    return `<div class="mrow"><span class="ag">${esc(a)}</span>
      <select aria-label="Model for ${esc(a)}" onchange="setModel('${a}',this.value)">${CATALOG.map(c=>
        `<option value="${esc(c.id)}" ${c.id===MODELS[a]?"selected":""}>${esc(c.id)}</option>`).join("")}</select>
      <span class="cost">$${m?m.in.toFixed(3):"?"}/M</span></div>`; }).join("");
  const e=Object.entries(SPEND.byAgent).sort((a,b)=>b[1]-a[1]);
  $("#spendList").innerHTML = e.length ? e.map(([a,c])=>`<div class="mrow"><span class="ag">${esc(a)}</span>
    <span style="flex:1;height:4px;background:var(--wash-2);border-radius:2px;overflow:hidden">
      <span style="display:block;height:100%;background:var(--signal);width:${Math.min(100,(c/Math.max(...e.map(x=>x[1])))*100)}%"></span></span>
    <span class="cost">$${c.toFixed(5)}</span></div>`).join("")
    : `<div class="empty">No model cost. This session is using local processing.</div>`;
}
function renderOutbox(st){
  $("#obList").innerHTML = st.outbox.length ? st.outbox.slice().reverse().map(o=>`<div class="row">
    <div class="h"><span class="vd" data-v="${o.status==="SYNCED"?"OK":o.status==="FAILED"?"REJECT":"WARN"}">${esc(o.status)}</span>
    <span style="font-weight:650">${esc(field(o.record.fieldId).name)}</span></div>
    <div class="b">${esc(o.record.date)}${o.status==="PENDING"?" · Saved on this device":o.status==="SYNCED"?" · Submitted safely":""}${o.lastError?" · Retrying automatically":""}</div></div>`).join("")
    : `<div class="empty">No submission yet. Confirmed records will appear here.</div>`;
  $("#srvList").innerHTML = st.server.length ? st.server.map(r=>`<div class="row"><div class="h">
      <span class="vd" data-v="OK">SAVED</span><span style="font-weight:650">${esc(r.serverId)}</span></div>
      <div class="b">${esc(field(r.fieldId).name)} · ${esc(r.date)}</div></div>`).join("")
    : `<div class="empty">AGRIVI 360 has no record this session.</div>`;
}

