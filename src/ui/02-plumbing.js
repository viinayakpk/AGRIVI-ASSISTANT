// ui/02-plumbing.js
// §16 — UI plumbing: tabs, drawer, history panel, focus management, DOM event wiring.

/* ───────── §16  UI PLUMBING ───────── */
function scrollLog(){ const e=$("#log"); requestAnimationFrame(()=>e.scrollTop=e.scrollHeight); }
let tT; function toast(m){ const t=$("#toast"); t.textContent=m; t.dataset.on="1"; clearTimeout(tT); tT=setTimeout(()=>t.dataset.on="0",4200); }
function renderReceipt(){
  const turnSpans=SPANS.filter(s=>s.turn===turnSeq&&s.attrs&&(s.attrs["agent.id"]||s.attrs["tool.name"]));
  const last=[...S.messages].reverse().find(m=>m.role==="agent"&&m.src!=="kernel");
  const ms=last?.ms||0, cost=last?.cost||0;
  $("#turnTime").textContent=busy?"Working…":(ms?`${ms} ms`:"0 ms");
  $("#turnSteps").textContent=String(turnSpans.length);
  $("#turnCost").textContent=`$${cost.toFixed(5)}`;
  $("#turnSummary").textContent=busy?"Checking your entry against AGRIVI":turnSpans.length
    ? `${turnSpans.length} processing steps for the latest response`
    : "No activity yet";
}
let inspectorReturnFocus=null;
function setInspector(open,tab="activity"){
  const drawer=$("#inspector"),backdrop=$("#drawerBackdrop"),trigger=$("#explainBtn");
  if(open){ inspectorReturnFocus=document.activeElement; go(tab); }
  drawer.dataset.open=open?"1":"0"; drawer.setAttribute("aria-hidden",String(!open)); drawer.inert=!open;
  backdrop.dataset.on=open?"1":"0"; trigger.setAttribute("aria-expanded",String(open));
  if(open) $("#drawerClose").focus(); else if(inspectorReturnFocus?.focus) inspectorReturnFocus.focus();
}
window.openInspector=(tab="activity")=>setInspector(true,tab);
function setChips(l){ $("#chips").innerHTML=(l||[]).map(c=>{
  const evil=/ignore previous/i.test(c);
  return `<button class="chip" ${evil?'data-evil="1"':""} onclick="quick(${JSON.stringify(c).replace(/"/g,"&quot;")})">${esc(c)}</button>`; }).join(""); }
window.quick=t=>{ $("#input").value=t; send(); };
window.uiSubmit=()=>submit();
window.setModel=(a,m)=>{ MODELS[a]=m; renderModels(); toast(`${a} → ${m.split("/").pop()}`); };
function send(){ const i=$("#input"), v=i.value.trim(); if(!v||busy) return;
  i.value=""; i.style.height="auto"; setChips([]); turn(v); }
function setNet(n){ NET=n;
  const c=$("#netChip"); if(c){ c.textContent=(n==="offline"?"Offline":"Online"); c.dataset.net=n; }
  render(); if(n!=="offline") S.outbox.filter(o=>o.status==="PENDING").forEach(o=>drain(o.key)); }
// Connectivity is AUTO-DETECTED, not a manual toggle. Default online; if the
// browser goes offline the outbox takes over and drains on reconnect — the
// brief's "handle unreliable connectivity gracefully", without a gimmick switch.
function autoNet(){ setNet((typeof navigator!=="undefined" && navigator.onLine===false) ? "offline" : "online"); }
if(typeof window!=="undefined" && window.addEventListener){
  window.addEventListener("online", autoNet);
  window.addEventListener("offline", autoNet);
}
function go(tab){
  const mapped={trace:"activity",rails:"activity",models:"activity",slots:"data",outbox:"delivery"}[tab]||tab;
  document.querySelectorAll(".tabs button").forEach(b=>{ const on=b.dataset.tab===mapped;
    b.setAttribute("aria-selected",String(on)); b.tabIndex=on?0:-1; });
  document.querySelectorAll(".pane").forEach(p=>p.dataset.on=p.dataset.pane===mapped?"1":"0");
}
async function setSchema(t){
  SCHEMA=SCHEMAS[t]; emit("SCHEMA_CHANGED",{type:t}); S=fold();
  pipe("kernel","run");
  PLAN=await AgentPlanner.run();
  span("invoke_agent",{"agent.id":"planner","plan.order":PLAN.order.join(","),
    "plan.rationale":String(PLAN.rationale).slice(0,60),"gen_ai.request.model":PLAN.by},0,"P");
  pipe("kernel","done");
  emit("AGENT_UTTERANCE",{ack:null,src:"kernel",ms:0,cost:0,kind:"say",
    text:`Switched to ${B(SCHEMA.label)}. ${esc(PLAN.rationale)}`});
  S=fold(); setChips(SCHEMA.type==="HARVEST"?["Harvested donje polje today, 7.2 tonnes a hectare"]
    :SCHEMA.type==="FERTILIZING"?["Put 200 kilos of KAN on gornje polje this morning"]
    :["Sprayed north vineyard with luna, half a litre per hectare, this morning"]);
  render(); scrollLog();
}

document.querySelectorAll(".tabs button").forEach(b=>{
  b.onclick=()=>go(b.dataset.tab);
  b.addEventListener("keydown",e=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) return;
    e.preventDefault(); const tabs=[...document.querySelectorAll(".tabs button")]; let i=tabs.indexOf(b);
    if(e.key==="Home") i=0; else if(e.key==="End") i=tabs.length-1;
    else i=(i+(e.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    go(tabs[i].dataset.tab); tabs[i].focus();
  });
});
$("#explainBtn").onclick=()=>setInspector($("#inspector").dataset.open!=="1");
$("#newBtn").onclick=()=>newSession();
$("#histBtn").onclick=()=>{ const p=$("#histPanel"); if(!p) return; renderHistoryPanel(); p.dataset.open=p.dataset.open==="1"?"0":"1"; };
$("#websearchBtn").onclick=()=>{ setWebSearchEnabled(!WEB_SEARCH_ENABLED); syncWebSearchBtn(); };
$("#woType").onchange=e=>{ if(!busy) setSchema(e.target.value); };
$("#auditExportBtn").onclick=()=>exportAuditLog();
$("#auditVerifyBtn").onclick=()=>{
  const v=verifyChain();
  toast(v.ok ? `Integrity verified — ${v.n} events, unbroken chain.` : `Tampering detected at event #${v.brokenAtSeq} of ${v.n}.`);
};
document.addEventListener("click",e=>{ const p=$("#histPanel"); if(p&&p.dataset.open==="1"&&!p.contains(e.target)&&e.target.id!=="histBtn"&&!$("#histBtn").contains(e.target)) p.dataset.open="0"; });
$("#drawerClose").onclick=()=>setInspector(false);
$("#drawerBackdrop").onclick=()=>setInspector(false);
$("#send").onclick=send;
$("#input").addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } });
$("#input").addEventListener("input",e=>{ e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,110)+"px"; });
let modalReturnFocus=null;
function keepFocusInside(container,e){
  if(e.key!=="Tab") return;
  const items=[...container.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[href]')]
    .filter(el=>el.offsetParent!==null);
  if(!items.length) return; const first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
}
function closeProvider(){ $("#modal").dataset.on="0"; if(modalReturnFocus?.focus) modalReturnFocus.focus(); }
$("#keyBtn").onclick=()=>{ modalReturnFocus=document.activeElement; $("#modal").dataset.on="1"; $("#keyIn").focus(); };
$("#keyCancel").onclick=closeProvider;
$("#keySave").onclick=()=>{ const k=$("#keyIn").value.trim(); if(k) sessionStorage.setItem("agrivi.or.key",k);
  closeProvider(); $("#keyIn").value=""; refreshKey(); if(k&&NET==="offline") setNet("online"); else render();
  toast(k?"OpenRouter connected.":"No key entered"); };
$("#keyClear").onclick=()=>{ sessionStorage.removeItem("agrivi.or.key"); closeProvider(); refreshKey(); render(); toast("Key cleared. Local processing is active."); };
$("#modal").addEventListener("click",e=>{ if(e.target===$("#modal")) closeProvider(); });
$("#modal").addEventListener("keydown",e=>keepFocusInside($("#modal"),e));
$("#inspector").addEventListener("keydown",e=>keepFocusInside($("#inspector"),e));
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape") return;
  if($("#modal").dataset.on==="1") closeProvider();
  else if($("#inspector").dataset.open==="1") setInspector(false);
});
function refreshKey(){ const h=hasKey(); $("#keyBtn").dataset.on=h?"1":"0"; $("#keyBtn").textContent=h?"OpenRouter connected":"Connect provider"; }

