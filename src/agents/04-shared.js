// agents/04-shared.js
// §10 intro + CATALOGUE_TXT, the static catalogue block shared into the Extractor's
//    prompt (and prompt-cached there).

/* ───────── §10  THE AGENTS  (12-factor #10: small and focused) ─────────
   Every quarantined agent: (input) -> typed JSON. No tools. No state.
   No control flow. If one is fooled it produces a wrong CLAIM, which the
   verifier rejects, which costs a turn. That is the designed blast radius. */

const CATALOGUE_TXT = () => {
  const pool = SCHEMA.productKind ? MIRROR.products.filter(p=>p.kind===SCHEMA.productKind) : [];
  return [ `FARM: ${MIRROR.farm.name}`,
    `FIELDS (crop is assigned to the BLOCK for the season — derive it, never ask):`,
    ...MIRROR.fields.map(f=>`  - ${f.name} | ${f.block} | ${f.areaHa} ha | crop: ${crop(f.cropId).name}${f.aliases.length?` | aka ${f.aliases.join(", ")}`:""}`),
    pool.length?`\nREGISTERED ${SCHEMA.productKind==="FERT"?"FERTILISERS":"PRODUCTS"}:`:"",
    ...pool.map(p=>`  - ${p.name} (${p.authNo}) | ${p.doseMin}–${p.doseMax} ${p.unit} | on: ${p.approvedCrops.map(c=>crop(c).name).join(", ")}`),
    `\nOPERATORS: ${MIRROR.operators.map(o=>o.name).join(", ")}`,
    // Only tell the model who "me/I" refers to when the worker has actually
    // told the system — never assume identity from tenant config. If unknown,
    // the model should pass "me"/"I" through verbatim and let the verifier
    // ask, exactly as it would for any other unresolved name.
    S.identity ? `KNOWN IDENTITY ("me","I" refers to this person — only because they told you): ${operator(S.identity).name}`
               : `IDENTITY UNKNOWN — do not guess who "me"/"I" is. Pass it through as said.`,
    `TODAY: ${todayISO()}`
  ].filter(Boolean).join("\n"); };

/* ② INJECTION SCREEN — ASI01 goal hijack. Policy-conditioned classifier.
   The policy is domain-specific on purpose: a spray-log utterance is DATA.
   It should never contain instructions addressed to the system.            */
