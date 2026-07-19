// agents/03-breakers.js
// §9 — circuit breakers (ASI08 cascading-failure defense).

/* ───────── §9  CIRCUIT BREAKERS — ASI08 cascading failures ─────────
   closed → open (3 faults) → half-open (after cooldown, one trial) → closed.

   Two distinctions that matter more than the counter:
   1. Being OFFLINE is a MODE, not a FAULT. Counting it would open every
      circuit after three offline turns and never close them again — the
      breaker would punish the exact scenario the product exists for.
   2. A breaker that never half-opens is just a fuse. It must be able to
      recover on its own, or one bad minute degrades the session forever.  */
const CB={};
const CB_COOLDOWN=30000, CB_THRESHOLD=3;
// Expected conditions, not agent faults.
const EXPECTED=/offline|no-proposer|kill-switch|nano-absent|network-timeout/i;
function cb(agent){ return CB[agent] ||= {fails:0, open:false, opened:null, lastError:null}; }
function cbOk(agent){ const c=cb(agent); c.fails=0; c.open=false; c.opened=null; }
function cbFail(agent,why){
  if(EXPECTED.test(String(why))) return false;   // a mode, not a fault
  const c=cb(agent); c.fails++; c.lastError=String(why).slice(0,60);
  if(c.fails>=CB_THRESHOLD && !c.open){ c.open=true; c.opened=Date.now();
    toast(`${agent} is temporarily unavailable. Local processing will continue.`); }
  return c.open;
}
function cbOpen(agent){
  const c=cb(agent);
  if(c.open && Date.now()-c.opened>CB_COOLDOWN){ c.open=false; c.fails=CB_THRESHOLD-1; c.opened=null; } // half-open: one trial
  return c.open;
}

