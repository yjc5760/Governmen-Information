/* ---------- 發包節奏：週期預測與流標重招 ----------
   全部只用 unitData.records（機關全期間公告清單）計算，不額外打 API。
   做法是把「115年度…」這類年度案的名稱正規化成系列鍵，同一系列的歷年
   招標公告排成時間軸，用年度間隔中位數推下一次招標。 */
/* seriesKey 是整個機關洞察最常呼叫的函式（一個大機關一次重繪會對幾萬則標題各算好幾次），
   九道正規表示式不便宜，所以依標題快取。上限只是保險，正常一個機關用不到。 */
const SERIES_KEY_CACHE=new Map();
function seriesKey(title){
  const raw=String(title||'');
  let k=SERIES_KEY_CACHE.get(raw);
  if(k===undefined){
    if(SERIES_KEY_CACHE.size>100000) SERIES_KEY_CACHE.clear();
    k=seriesKeyRaw(raw); SERIES_KEY_CACHE.set(raw,k);
  }
  return k;
}
function seriesKeyRaw(title){
  let t=String(title||'');
  t=t.replace(/[（(]\s*第\s*\d+\s*次[^）)]*[）)]/g,'');        // （第3次公告）
  t=t.replace(/第\s*\d+\s*次(公告|招標|契約變更)?/g,'');
  t=t.replace(/\d{2,4}\s*[~～\-–至]\s*\d{2,4}\s*年度?/g,'');   // 114~115年度
  t=t.replace(/\d{2,4}\s*年度?/g,'');                          // 115年度 / 115年
  t=t.replace(/(上|下)半年/g,'');
  t=t.replace(/第\s*[一二三四1-4]\s*季/g,'');
  t=t.replace(/[（(]\s*[）)]/g,'');
  t=t.replace(/[\s　]+/g,'');
  return t;
}
function median(arr){ if(!arr.length) return null;
  const a=arr.slice().sort((x,y)=>x-y), m=a.length>>1;
  return a.length%2 ? a[m] : Math.round((a[m-1]+a[m])/2); }

/* 同一輪招標可能出現多次（流標重招、分批、跨曆年的第2次公告）。
   原本按「每個曆年取最早一次」去重，但台電實例 2025/08/14 流標、2026/02/04 重招
   跨了曆年而雙雙留下，於是 174 天被當成半年週期，還跟 5/5 命中的年度案並列。
   改成不管曆年，只要距離上一次不到 MIN_ROUND_GAP 天就視為同一輪。
   門檻取 240 天：流標重招最久可拖到半年左右，而年度案是 365 天，兩者分得開。
   真正的半年約會被收攏成一年一次——但 seriesKey 本來就把「上／下半年」併成同一系列，
   所以不會誤殺，只是改用年度節奏預估。 */
const MIN_ROUND_GAP = 240;

/* 間隔像不像一個真的週期。刻意不設「半年」這一類：單一個 150~250 天的間隔，
   光看數字無法跟流標重招區分，寧可標成不規律也不要給出看似精確的錯預測。
   不規律的照樣列出來，但要標記並淡化，不能跟 5/5 命中的年度案並列。 */
function cycleLabel(gap){
  const near=(v,t,tol)=>Math.abs(v-t)<=tol;
  if(near(gap,365,60))  return {label:'年度',     ok:true};
  if(near(gap,730,90))  return {label:'兩年一次', ok:true};
  if(near(gap,1095,120))return {label:'三年一次', ok:true};
  return {label:'不規律', ok:false};
}

function buildSeries(recs){
  const map=new Map();
  recs.forEach(r=>{
    if(!isTender(recTy(r))) return;
    const d=recDate(r); if(!d) return;
    const t=(r.brief&&r.brief.title)||''; if(!t) return;
    const k=seriesKey(t); if(!k||k.length<4) return;
    if(!map.has(k)) map.set(k,{key:k,title:t,items:[]});
    map.get(k).items.push({d,date:r.date,job:r.job_number,title:t});
  });
  const out=[]; const now=new Date();
  map.forEach(sr=>{
    sr.items.sort((a,b)=>a.d-b.d);
    // 收攏同一輪：距離上一次不到 MIN_ROUND_GAP 天的都算同一輪，只留最早那一次
    const yearly=[];
    sr.items.forEach(it=>{
      const prev=yearly[yearly.length-1];
      if(!prev || (it.d-prev.d)/86400000 >= MIN_ROUND_GAP) yearly.push(it);
    });
    if(yearly.length<2) return;                    // 只辦過一輪的不算系列
    const gaps=[]; for(let i=1;i<yearly.length;i++) gaps.push(Math.round((yearly[i].d-yearly[i-1].d)/86400000));
    const gap=median(gaps);
    const cyc=cycleLabel(gap);
    const last=yearly[yearly.length-1];
    const next=new Date(last.d.getTime()+gap*86400000);
    const months={}; yearly.forEach(it=>{ const m=it.d.getMonth()+1; months[m]=(months[m]||0)+1; });
    const top=Object.entries(months).sort((a,b)=>b[1]-a[1])[0];
    out.push({ key:sr.key, title:last.title, yearly, gap, next, count:yearly.length,
      lastDate:last.date, monthMode:+top[0], monthHits:top[1],
      cycle:cyc.label, regular:cyc.ok,
      daysToNext: Math.ceil((next-now)/86400000) });
  });
  // 即將到來的排前面（-60 到 365 天視為值得注意）
  // 先看「規律且即將到來」的，不規律的一律往後排
  return out.sort((a,b)=>{
    const rank=x=>(x.regular?0:2)+((x.daysToNext>=-60&&x.daysToNext<=365)?0:1);
    return rank(a)-rank(b) || a.daysToNext-b.daysToNext;
  });
}

/* 每則流標找「同系列、日期在它之後最早的一次招標」。
   舊寫法對每則流標都把全部招標掃一遍再排序（流標數 × 招標數），
   台電這種 4 萬則的機關一次重繪要 20 秒以上。改成先按系列分組、組內依日期排好，
   每則流標用二分搜尋找第一個晚於它的——結果與舊寫法逐筆相同（同日多筆時取原順序第一筆）。 */
function buildFailed(recs){
  const fails=recs.filter(r=>isFailedAward(recTy(r)));
  const groups=new Map();
  recs.forEach((r,i)=>{
    const d=recDate(r); if(!d||!isTender(recTy(r))) return;
    const k=seriesKey((r.brief&&r.brief.title)||'');
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push({r,d,t:d.getTime(),i});
  });
  groups.forEach(g=>g.sort((a,b)=>(a.t-b.t)||(a.i-b.i)));
  const firstAfter=(g,t)=>{ let lo=0,hi=g.length; while(lo<hi){ const m=(lo+hi)>>1; if(g[m].t>t) hi=m; else lo=m+1; } return g[lo]; };
  return fails.map(f=>{
    const fd=recDate(f); if(!fd) return null;
    const title=(f.brief&&f.brief.title)||''; const k=seriesKey(title);
    const g=groups.get(k); const re=g?firstAfter(g,fd.getTime()):undefined;
    return { title, date:f.date, d:fd, job:f.job_number,
             reDate: re?re.r.date:null, reJob: re?re.r.job_number:null,
             lag: re?Math.round((re.d-fd)/86400000):null };
  }).filter(Boolean).sort((a,b)=>b.d-a.d);
}

function fmtYmd(s){ s=String(s||''); return s.length===8?(s.slice(0,4)+'/'+s.slice(4,6)+'/'+s.slice(6)):s; }
function fmtDateObj(d){ return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0'); }

function ratioBlock(){
  const per=unitPeriodRecords();
  const awards=per.filter(isAwardRec);
  const rows=bidRatios(per);
  const st=ratioStats(rows);
  let h='<div class="card p-5">'+
    '<div class="eyebrow">BID RATIO</div>'+
    '<h3 class="font-bold text-ink-900 mt-1">落標率（決標金額 ÷ 預算金額）</h3>'+
    '<p class="text-xs text-slate-500 mt-1">判斷這個機關的案子要壓到幾折才會中。只能算<strong>同時有決標金額與預算金額</strong>的案子，所以樣本數很重要。</p>';
  if(!st){
    return h+'<div class="mt-4 flex items-center gap-2 flex-wrap text-xs bg-amber-50 border border-amber-100 rounded-xl p-3">'+
      '<i class="fa-solid fa-coins text-amber-600"></i>'+
      '<span class="text-amber-800">還沒有可用樣本。公告清單不含金額，要逐案抓才有——按上方廠商排行的「補齊決標金額」。</span>'+
      '</div></div>';
  }
  const cov=awards.length? Math.round(st.n/awards.length*100) : 0;
  h+='<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">'+
    '<div class="rounded-xl bg-ink-900 text-white p-3"><div class="text-xl font-bold">'+pct1(st.median)+'</div><div class="text-[11px] text-white/50 mt-0.5">落標率中位數</div></div>'+
    '<div class="rounded-xl bg-slate-50 border p-3"><div class="text-xl font-bold text-ink-900">'+fmtNum(st.n)+'</div><div class="text-[11px] text-slate-500 mt-0.5">樣本數（'+cov+'% 決標案）</div></div>'+
    '<div class="rounded-xl bg-slate-50 border p-3"><div class="text-xl font-bold text-ink-900">'+pct1(st.lowest[0].ratio)+'</div><div class="text-[11px] text-slate-500 mt-0.5">最低一案</div></div>'+
    '<div class="rounded-xl bg-slate-50 border p-3"><div class="text-xl font-bold text-ink-900">'+pct1(st.highest[0].ratio)+'</div><div class="text-[11px] text-slate-500 mt-0.5">最高一案</div></div>'+
    '</div>';
  h+='<div class="grid lg:grid-cols-2 gap-5 mt-5">'+
    '<div>'+distBlock('落標率分佈（'+fmtNum(st.n)+' 案）', st.dist.filter(r=>r[1]), 8)+'</div>'+
    '<div><div class="text-xs font-semibold text-slate-600 mb-2">逐年中位數</div>'+
      (st.years.length?('<table class="w-full text-xs"><tbody>'+
        st.years.slice().reverse().map(y=>'<tr class="border-b last:border-0"><td class="py-1.5 font-mono text-slate-500">'+esc(y.year)+'</td>'+
          '<td class="py-1.5 text-right font-bold text-ink-900">'+pct1(y.med)+'</td>'+
          '<td class="py-1.5 text-right text-[11px] text-slate-400">'+y.n+' 案</td></tr>').join('')+
        '</tbody></table>'):'<p class="text-xs text-slate-400">沒有可分年的樣本。</p>')+
    '</div></div>';
  h+='<details class="mt-4 border rounded-xl"><summary class="p-2.5 text-xs font-semibold cursor-pointer text-slate-600">壓最低的 5 案（可看它們是什麼性質的工作）</summary>'+
     '<div class="border-t divide-y">'+
     st.lowest.map(x=>'<div class="p-2.5 text-xs"><div class="font-semibold text-ink-900 leading-snug">'+esc(x.title)+'</div>'+
       '<div class="text-[11px] text-slate-500 mt-0.5">'+fmtYmd(x.date)+' · 預算 '+fmtWan(x.budget)+' → 決標 '+fmtWan(x.award)+
       ' · <strong class="text-rose-600">'+pct1(x.ratio)+'</strong></div></div>').join('')+
     '</div></details>';
  h+='<p class="text-[11px] text-slate-400 mt-3 leading-relaxed">比值超過 3 倍或非正數的已剔除（多半是複數決標的總額對上單項預算）。'+
     '樣本涵蓋率低的時候中位數會偏——它只代表<strong>你已經補齊金額的那些案子</strong>，而不是這個機關的全貌。'+
     '≥100% 的案子通常是決標金額含後續擴充或變更設計。</p>';
  return h+'</div>';
}

