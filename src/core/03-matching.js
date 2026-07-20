// core/03-matching.js
// §2 — fuzzy matching primitives + work-order classification.

/* ───────── §2  MATCHING (v1, kept) ───────── */
const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")
  .replace(/[^a-z0-9\s.]/g," ").replace(/\s+/g," ").trim();
const tokens=s=>norm(s).split(" ").filter(Boolean);
const STOP=new Set(["the","a","an","it","was","with","on","in","and","of","to","this","that","did","i","we","at","for","my","is","are","some","just","also","then"]);
function lev(a,b){ if(a===b)return 0; const m=a.length,n=b.length; if(!m)return n; if(!n)return m;
  let p=Array.from({length:n+1},(_,i)=>i),c=new Array(n+1);
  for(let i=1;i<=m;i++){ c[0]=i; for(let j=1;j<=n;j++) c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1)); [p,c]=[c,p]; }
  return p[n]; }
function sim(q,t){ q=norm(q); t=norm(t); if(!q||!t)return 0; if(q===t)return 1;
  const qp=` ${q} `,tp=` ${t} `;
  if(tp.includes(qp)) return 0.5+0.42*(q.length/t.length);
  if(qp.includes(tp)) return 0.5+0.42*(t.length/q.length);
  const qt=q.split(" "),tt=t.split(" ");
  const hits=qt.filter(w=>w.length>2&&tt.some(x=>x===w||(x.length>3&&lev(w,x)<=1))).length;
  const tok=hits/Math.max(qt.length,1);
  // Edit distance is a TYPO allowance (~1 per 4 chars), not a similarity score.
  // Scored as a ratio it calls "rate" 67% of "ka-rate-".
  const d=lev(q,t), budget=Math.max(1,Math.floor(Math.min(q.length,t.length)/4));
  const ed = d<=budget ? 1-d/Math.max(q.length,t.length) : 0;
  return Math.max(tok*0.9,ed); }
function bestSpan(u,name){ const ut=tokens(u),nt=tokens(name);
  if(!ut.length||!nt.length) return {score:0,span:""};
  let best={score:0,span:""};
  for(const L of new Set([nt.length,Math.max(1,nt.length-1),nt.length+1]))
    for(let i=0;i+L<=ut.length;i++){ const w=ut.slice(i,i+L);
      if(w.every(x=>STOP.has(x))) continue;
      const span=w.join(" "), sc=sim(span,name);
      if(sc>best.score) best={score:sc,span}; }
  return best; }
function match(q,rows,nameOf){ return rows.map(r=>{ let b={score:0,span:""};
  for(const n of [nameOf(r),...(r.aliases||[])]){ const x=bestSpan(q,n); if(x.score>b.score) b=x; }
  return {row:r,score:b.score,span:b.span}; }).sort((a,b)=>b.score-a.score); }

/* Resolves a natural date expression — "today", "Monday", "3 days ago", an
   explicit 2026-03-15 or 15/03/2026 — to YYYY-MM-DD. Shared by LocalExtractor
   (which scans a whole utterance) and the verifier (which normalizes whatever
   date_text the LIVE extractor already pulled out), so a worker gets the same
   answer regardless of which tier is running. Returns null on no match so
   each caller picks its own fallback — LocalExtractor leaves the slot empty,
   the verifier falls back to the original text so check_date's rejection
   still names what was actually said.

   Matched against the RAW text, not norm(text): norm() strips "-" and "/"
   (only "." survives, since its allowed-char set is a-z/0-9/whitespace/period)
   — matching the ISO/EU regexes against normalized text meant an explicitly
   typed "2026-03-15" or "15/03/2026" was silently unparseable; only the
   period-separated form ("15.03.2026") ever actually matched. */
const WEEKDAYS=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
function resolveDateExpr(text){
  if(!text) return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const t=norm(text);
  // A correction or negated mention ("it wasn't today, it was yesterday",
  // "make that yesterday, not today") must not resolve to "today" just
  // because that check runs first — a negation word ahead of "today" means
  // today is being RULED OUT, not stated, so skip it and let yesterday (or
  // whatever else is actually said) win instead of silently overriding a
  // worker's own correction with the wrong date.
  const negatedToday=/\b(not|wasn t|isn t|never|no)\b[^.]{0,20}\btoday\b/.test(t);
  if(!negatedToday && /\b(today|this morning|this afternoon|tonight|just now|danas)\b/.test(t)) return todayISO();
  if(/\b(yesterday|last night|jucer)\b/.test(t)) return shiftISO(-1);
  const daysAgo=t.match(/\b(\d+)\s*days?\s*ago\b/);
  if(daysAgo) return shiftISO(-parseInt(daysAgo[1],10));
  for(let i=0;i<WEEKDAYS.length;i++){
    if(new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)){
      const diff=(new Date().getDay()-i+7)%7;   // 0 = today, otherwise the most recent past occurrence
      return shiftISO(-diff);
    }
  }
  const iso=text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(iso) return iso[0];
  const eu=text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if(eu) return `${eu[3]}-${String(eu[2]).padStart(2,"0")}-${String(eu[1]).padStart(2,"0")}`;
  return null;
}

