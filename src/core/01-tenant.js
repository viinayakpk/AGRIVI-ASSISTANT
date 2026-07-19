// core/01-tenant.js
// §0/§0b — tenant mirror data (fields/products/operators) + live weather grounding.

/* ───────── §0  TENANT DATA ─────────
   This engine is NOT wired to one farm. Everything below — fields, products,
   operators, crops — is a TENANT CONFIG, not application logic. The reducer,
   verifier, rails, memory graph and every agent read it through `MIRROR`,
   which is a swappable binding: `AGRIVI.loadTenant(config)` replaces it at
   runtime and the whole engine (Vineyard Estate today, a wheat co-op or a
   greenhouse operator tomorrow) re-derives against the new data with no code
   change. `DEFAULT_TENANT` below is the reference tenant used for this demo —
   real, current AGRIVI-shaped data, not placeholder text. In production the
   tenant is resolved server-side, before the first request is handled (the
   standard multi-tenant pattern: identify the tenant, load its config, keep
   that context for the whole request) — see PLATFORM-ARCHITECTURE.md. */
const DEFAULT_TENANT = {
  id:"agrivi-demo", label:"AGRIVI 360 — reference tenant",
  syncedAt:"2026-07-16T04:12:00Z",
  farm:{ id:"FARM-HR-021", name:"Slavonija Estate" },
  crops:[
    {id:"CRP-GRAPE",name:"Grape",latin:"Vitis vinifera"},
    {id:"CRP-APPLE",name:"Apple",latin:"Malus domestica"},
    {id:"CRP-WHEAT",name:"Winter wheat",latin:"Triticum aestivum"},
    {id:"CRP-MAIZE",name:"Maize",latin:"Zea mays"}
  ],
  fields:[
    {id:"FLD-101",name:"North Vineyard",block:"NV-1",areaHa:12.4,cropId:"CRP-GRAPE",season:2026,aliases:["north vines","sjever"]},
    {id:"FLD-102",name:"South Vineyard",block:"SV-2",areaHa:8.1,cropId:"CRP-GRAPE",season:2026,aliases:["south vines","jug"]},
    {id:"FLD-201",name:"Rakitovac Orchard",block:"RK-1",areaHa:22.0,cropId:"CRP-APPLE",season:2026,aliases:["rakitovac","apple block"]},
    {id:"FLD-301",name:"Donje Polje",block:"DP-3",areaHa:45.7,cropId:"CRP-WHEAT",season:2026,aliases:["lower field","donje"]},
    {id:"FLD-302",name:"Gornje Polje",block:"GP-1",areaHa:38.2,cropId:"CRP-MAIZE",season:2026,aliases:["upper field","gornje"]}
  ],
  // kind:"PPP" plant protection product | kind:"FERT" fertiliser
  products:[
    {id:"PPP-1042",kind:"PPP",name:"Luna Experience",authNo:"HR-2019-0123",actives:["fluopyram 200 g/L","tebuconazole 200 g/L"],
     approvedCrops:["CRP-GRAPE","CRP-APPLE"],doseMin:0.3,doseMax:0.6,unit:"L/ha",phiDays:14,reEntryH:48,aliases:["luna"],target:"fungal"},
    {id:"PPP-2088",kind:"PPP",name:"Ridomil Gold MZ",authNo:"HR-2016-0455",actives:["metalaxyl-M 38.8 g/kg","mancozeb 640 g/kg"],
     approvedCrops:["CRP-GRAPE"],doseMin:2.0,doseMax:2.5,unit:"kg/ha",phiDays:28,reEntryH:24,aliases:["ridomil"],target:"fungal"},
    {id:"PPP-3310",kind:"PPP",name:"Karate Zeon",authNo:"HR-2018-0912",actives:["lambda-cyhalothrin 50 g/L"],
     approvedCrops:["CRP-WHEAT","CRP-MAIZE","CRP-APPLE"],doseMin:0.075,doseMax:0.15,unit:"L/ha",phiDays:28,reEntryH:24,aliases:["karate"],target:"insect"},
    {id:"PPP-4501",kind:"PPP",name:"Signum",authNo:"HR-2020-0221",actives:["boscalid 267 g/kg","pyraclostrobin 67 g/kg"],
     approvedCrops:["CRP-APPLE"],doseMin:0.9,doseMax:1.8,unit:"kg/ha",phiDays:7,reEntryH:24,aliases:[],target:"fungal"},
    {id:"FRT-7001",kind:"FERT",name:"KAN 27",authNo:"HR-F-2015-0044",actives:["ammonium nitrate 27% N"],
     approvedCrops:["CRP-WHEAT","CRP-MAIZE","CRP-GRAPE","CRP-APPLE"],doseMin:100,doseMax:350,unit:"kg/ha",phiDays:0,reEntryH:0,aliases:["kan"],target:"nitrogen"},
    {id:"FRT-7002",kind:"FERT",name:"NPK 15-15-15",authNo:"HR-F-2014-0091",actives:["N 15%","P2O5 15%","K2O 15%"],
     approvedCrops:["CRP-WHEAT","CRP-MAIZE","CRP-GRAPE","CRP-APPLE"],doseMin:150,doseMax:400,unit:"kg/ha",phiDays:0,reEntryH:0,aliases:["npk"],target:"balanced"}
  ],
  operators:[
    {id:"OP-11",name:"Marko Horvat",licenceNo:"HR-PPP-88214",licenceExpiry:"2027-03-31",aliases:["marko"]},
    {id:"OP-12",name:"Ivana Kovač",licenceNo:"HR-PPP-90551",licenceExpiry:"2026-11-30",aliases:["ivana"]},
    {id:"OP-13",name:"Petar Novak",licenceNo:"HR-PPP-70112",licenceExpiry:"2026-02-28",aliases:["petar"]}
  ],
  currentUser:"OP-11"
};
let MIRROR = DEFAULT_TENANT;

// Fill in anything a partial tenant config omits, so a minimal config (a
// handful of fields/products) still runs — required keys default to empty,
// not undefined, so every `.find()`/`.map()` call site stays safe.
function normalizeTenant(cfg){
  return {
    id: cfg.id || "custom-tenant", label: cfg.label || cfg.farm?.name || "Custom tenant",
    syncedAt: cfg.syncedAt || new Date().toISOString(),
    farm: cfg.farm || { id:"FARM-UNKNOWN", name:"Unnamed farm" },
    crops: cfg.crops || [], fields: cfg.fields || [], products: cfg.products || [],
    operators: cfg.operators || [], currentUser: cfg.currentUser || cfg.operators?.[0]?.id || null
  };
}
// The multi-tenant seam. Swaps the data plane; every agent, tool and rule
// re-derives against it on the next turn. Memory is farm-scoped, so a tenant
// switch starts a clean temporal graph — this is a different farm's history.
function loadTenant(cfg){
  MIRROR = normalizeTenant(cfg);
  MEM = []; Object.keys(WX_CACHE).forEach(k=>delete WX_CACHE[k]);
  Object.keys(CB).forEach(k=>delete CB[k]);
}
const crop=id=>MIRROR.crops.find(c=>c.id===id);
const field=id=>MIRROR.fields.find(f=>f.id===id);
const product=id=>MIRROR.products.find(p=>p.id===id);
const operator=id=>MIRROR.operators.find(o=>o.id===id);
const todayISO=()=>new Date().toISOString().slice(0,10);
const shiftISO=d=>new Date(Date.now()+d*864e5).toISOString().slice(0,10);
const shiftFrom=(iso,d)=>new Date(Date.parse(iso)+d*864e5).toISOString().slice(0,10);

/* ───────── §0b  LIVE GROUNDING — real weather at the field ─────────
   Wind speed is a LEGALLY REQUIRED field on a spray record (drift onto
   neighbouring land) — and useful context on every OTHER record too (harvest
   timing, fertiliser runoff risk after rain, general conditions on a generic
   work order). So it's attached to every completed record, not just spraying;
   only the drift/rainfastness FINDINGS in AgentForesight stay scoped to actual
   product applications, since "spray drift" means nothing on a harvest. We
   fetch it from Open-Meteo — no API key, CORS-open, verified live — so the
   worker never reads it off a gauge. Two paths, and it degrades rather than blocks:
     · served over http(s) → go through the gateway (/api/weather): keys
       server-side, provider failover, caching, stale-on-outage.
     · opened as a file://  → call Open-Meteo directly (it's keyless + CORS).
   19 km/h is a common ground-boom drift cutoff; above it, spraying risks
   off-target drift and the record should carry a warning. */
const FIELD_COORDS = { "FLD-101":[45.553,18.690], "FLD-102":[45.541,18.712],
  "FLD-201":[45.492,18.601], "FLD-301":[45.604,18.752], "FLD-302":[45.621,18.684] };
const DRIFT_KPH = 19;
const usingGateway = () => location.protocol === "http:" || location.protocol === "https:";
const WX_CACHE = {};
const GROUNDED = {};   // fieldId → last grounded conditions, for the review card
async function groundWeather(fieldId){
  const c = FIELD_COORDS[fieldId]; if(!c) return null;
  const ck = fieldId;
  if(WX_CACHE[ck] && Date.now()-WX_CACHE[ck].at < 15*60000) return WX_CACHE[ck].wx;
  const url = usingGateway()
    ? `${location.origin}/api/weather?lat=${c[0]}&lon=${c[1]}`
    : `https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation&hourly=precipitation&forecast_hours=6`;
  try{
    const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),8000);
    const r=await fetch(url,{signal:ac.signal}); clearTimeout(t);
    if(!r.ok) return null;
    const d=await r.json();
    // Gateway already shapes it; direct Open-Meteo needs shaping.
    const wx = d.windKph!=null ? d : (()=>{ const cur=d.current||{};
      const rain6=(d.hourly?.precipitation||[]).slice(0,6).reduce((a,b)=>a+(b||0),0);
      return { windKph:cur.wind_speed_10m, windDir:cur.wind_direction_10m, tempC:cur.temperature_2m,
               humidity:cur.relative_humidity_2m, precipMm:cur.precipitation, rainNext6hMm:+rain6.toFixed(1),
               at:cur.time, source:"open-meteo" }; })();
    WX_CACHE[ck]={wx,at:Date.now()};
    return wx;
  }catch(_){ return null; }   // degrade: the record is never blocked by a weather outage
}

