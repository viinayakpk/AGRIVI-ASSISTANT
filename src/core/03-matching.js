// core/03-matching.js
// §2 — fuzzy matching primitives + work-order classification.

/* ───────── §2  MATCHING (v1, 36 tests green) ───────── */
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

