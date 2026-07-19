// core/04-capability.js
// §3 — capability / taint labels (CaMeL).

/* ───────── §3  CAPABILITY / TAINT (CaMeL) ─────────
   Every value carries where it came from and what blessed it. Taint is sticky:
   a value derived from untrusted input stays untrusted until a validator
   RE-DERIVES it from the mirror — at which point it is replaced by the
   mirror's value, not merely blessed. That replacement is the whole point.  */
const Cap = {
  untrusted:(origin)=>({trust:"untrusted",origin,verifiedBy:null}),
  quarantined:(origin,agent)=>({trust:"quarantined",origin,agent,verifiedBy:null}),
  trusted:(origin,verifiedBy)=>({trust:"trusted",origin,verifiedBy}),
  derive:(parent,agent)=>({trust:parent.trust==="trusted"?"quarantined":parent.trust,origin:parent.origin,agent,verifiedBy:null})
};

