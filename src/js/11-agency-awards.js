/* ---------- 得標／未得標判讀 ----------
   brief.companies.names 列的是「這一案出現過的所有廠商」，不是得標名單。
   同一份 brief.companies 裡的 name_key 記錄每個名字是從詳細資料哪些欄位抓來的，
   據此就能分辨勝負，不必再打一次 API：
     決標品項:第N品項:得標廠商N:得標廠商               → 得標
     決標品項:第N品項:得標廠商N(共同投標廠商):得標廠商 → 共同投標且得標
     決標品項:第N品項:未得標廠商N:未得標廠商           → 未得標
     投標廠商:投標廠商N:廠商名稱                       → 只知道有投標
     標案內容:廠商名稱                                 → 拒絕往來公告的當事廠商
     英文公告:廠商名稱                                 → 同一家的英文名，不是另一家
   實測 2026-09-01 全日 624 則決標公告：1,169 個名字裡只有 725 家真的得標、
   417 家落標，舊寫法（names 全算得標）把得標件數灌水 61%。
   多品項的案子同一家可能一項得標、另一項落標（實測有），所以只要有一個純得標
   的欄位就算得標。 */
function keyIsWin(k){ k=String(k||''); return k.indexOf('未得標廠商')<0 && k.indexOf('得標廠商')>=0; }
function keyIsLose(k){ return String(k||'').indexOf('未得標廠商')>=0; }
function keyIsEng(k){ return String(k||'').indexOf('英文公告')>=0; }
function keyIsJoint(k){ return String(k||'').indexOf('共同投標廠商')>=0; }

/* names + name_key → [{name,known,won,lost,joint}]，純英文名變體會被濾掉。 */
function splitCompanies(names, nameKey){
  const nk=nameKey||{}, out=[], seen={};
  (names||[]).forEach(n0=>{
    const n=String(n0||'').trim(); if(!n||seen[n]) return; seen[n]=1;
    const keys=nk[n]||[];
    if(keys.length && keys.every(keyIsEng)) return;
    out.push({ name:n, known:keys.length>0,
               won:keys.some(keyIsWin), lost:keys.some(keyIsLose),
               joint:keys.some(keyIsJoint) });
  });
  return out;
}
function recCompanies(r){
  const c=(r&&r.brief&&r.brief.companies)||{};
  return splitCompanies(c.names, c.name_key);
}
/* 真正得標的廠商。完全沒有 name_key 可判讀時退回列出全部（舊資料），
   有判讀資料但這案沒人得標就回空陣列，不要硬湊。 */
function winnersOf(list){
  const won=list.filter(x=>x.won);
  if(won.length) return won.map(x=>x.name);
  return list.some(x=>x.known) ? [] : list.map(x=>x.name);
}
function recVendors(r){ return winnersOf(recCompanies(r)); }      // 得標廠商，統計用
function recBidders(r){ return recCompanies(r).map(x=>x.name); }  // 所有廠商，顯示與比對用
function vendorShort(n){ return String(n||'').replace(/\s*[（(][^）)]*[）)]\s*$/,''); }
function amtKey(job){ return ((unitData&&unitData.unit_id)||'')+'|'+job; }  // 沒開機關時也不可爆掉
function amtOf(job){ const c=amountCache[amtKey(job)]; return (c&&c.a)||0; }
function fmtWan(n){ if(!n) return '—';
  if(n>=1e8) return (n/1e8).toFixed(2).replace(/\.?0+$/,'')+' 億';
  if(n>=1e4) return Math.round(n/1e4).toLocaleString()+' 萬';
  return n.toLocaleString()+' 元'; }

/* 大機關的公告量很可觀（台電總公司 3.13.31 有 4 萬則、41 頁、每頁 1000 筆約 630KB）。
   實測連續抓 15 頁之後第 16 頁就會 Failed to fetch——API 對連續大量請求會斷線。
   所以：每輪只抓固定頁數、頁間拉長間隔、單頁失敗會退避重試，
   而且不管是被擋還是撞到上限，都保留已經抓到的資料並在畫面上說清楚沒抓完。 */
const AGENCY_PAGE_CAP = 15;                 // 每輪最多頁數
const AGENCY_PAGE_GAP = 700;                // 頁間間隔（毫秒）
const AGENCY_RETRY    = [1500,4000,9000];   // 單頁失敗的退避重試

/* 分頁去重：抓第 N 頁與第 N+1 頁之間官網若新增公告，位移會讓邊界紀錄被重抓
   （實測台電總公司 30,000 筆裡有 34 筆一字不差的重複，多數貼齊每千筆邊界）。
   filename 不是唯一鍵（會被多筆共用），job+date+type 也不是（同案同日可有多則，
   例如各廠商一則的拒絕往來名單），所以用複合鍵——實測與整筆 JSON 比對結果完全一致，
   但快 4 倍以上。 */
function unitRecKey(r){
  return [r.filename, r.job_number, r.date, (r.brief&&r.brief.type)||'',
          ((r.brief&&r.brief.companies&&r.brief.companies.names)||[]).join('')].join(' ');
}

async function fetchUnitPage(unit_id,page,onRetry){
  let last;
  for(let i=0;i<=AGENCY_RETRY.length;i++){
    if(i){ if(onRetry) onRetry(i,AGENCY_RETRY[i-1]); await new Promise(s=>setTimeout(s,AGENCY_RETRY[i-1])); }
    try{ return await api('/api/listbyunit?unit_id='+encodeURIComponent(unit_id)+'&page='+page); }
    catch(e){ last=e; }
  }
  throw last;
}

async function loadUnitPages(unit_id,startPage,existing,unit_name,say){
  let all=existing.slice(), page=startPage, name=unit_name||'', tp=null, total=null, stop=null;
  const seen=new Set(all.map(unitRecKey));
  let dropped=0;
  const cap=startPage+AGENCY_PAGE_CAP-1;
  while(page<=cap){
    let r;
    try{
      r=await fetchUnitPage(unit_id,page,(i,wait)=>
        say('第 '+page+' 頁失敗，'+(wait/1000)+' 秒後重試（第 '+i+' 次）…已取得 '+fmtNum(all.length)+' 則'));
    }catch(e){ stop={reason:'error',message:e.message,page}; break; }
    name=r.unit_name||name;
    tp=r.total_page||r.total_pages||tp||1;
    if(r.total!=null) total=r.total;
    const recs=r.records||[];
    for(const rec of recs){
      const k=unitRecKey(rec);
      if(seen.has(k)){ dropped++; continue; }
      seen.add(k); all.push(rec);
    }
    say('抓取 '+esc(name)+'：第 '+page+' / '+tp+' 頁，已取得 '+fmtNum(all.length)+' 則…');
    if(page>=tp||!recs.length){ stop={reason:'done',page}; break; }
    if(page>=cap){ stop={reason:'cap',page}; break; }
    page++; await new Promise(s=>setTimeout(s,AGENCY_PAGE_GAP));
  }
  return {all,name,tp:tp||1,total,dropped,stop:stop||{reason:'cap',page},
          pagesFetched:(stop&&stop.reason==='error')?page-1:page};
}

async function openAgency(unit_id,unit_name){
  go('agencies');
  const box=document.getElementById('agencyDetail');
  box.classList.remove('hidden');
  const say=t=>box.innerHTML='<div class="card p-8 text-center text-sm text-slate-500"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>'+t+'</div>';
  say('抓取 '+esc(unit_name||unit_id)+' 的公告…');
  window.scrollTo(0,0);
  const r=await loadUnitPages(unit_id,1,[],unit_name,say);
  if(!r.all.length){
    const msg=(r.stop.reason==='error')?('第 '+r.stop.page+' 頁抓取失敗：'+r.stop.message):'這個機關沒有公告紀錄';
    box.innerHTML='<div class="card p-6 space-y-3"><p class="text-sm text-rose-600">載入失敗：'+esc(msg)+'</p>'+
      '<button onclick="openAgency('+jsArg(unit_id)+','+jsArg(unit_name||'')+')" class="px-3 py-2 text-xs border rounded-lg hover:bg-slate-50">重試</button></div>';
    return;
  }
  unitData={unit_id,unit_name:r.name,records:r.all,total:r.total,totalPages:r.tp,
            pagesFetched:r.pagesFetched,stop:r.stop,dropped:r.dropped};
  if(noteAgency(unit_id,r.name)) persistAgencyIndex();
  unitVendorQ=''; unitSort='count';
  renderAgencyDetail();
}

/* 從上次停下來的頁數接著抓，已取得的資料不重抓 */
async function continueAgency(){
  if(!unitData) return;
  const btnBox=document.getElementById('agencyMore');
  const say=t=>{ if(btnBox) btnBox.innerHTML='<span class="text-xs text-amber-900"><i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i>'+t+'</span>'; };
  const from=unitData.pagesFetched+1;
  if(unitData.totalPages && from>unitData.totalPages){ toast('已經抓到最後一頁','info'); return; }
  say('從第 '+from+' 頁繼續…');
  const r=await loadUnitPages(unitData.unit_id,from,unitData.records,unitData.unit_name,say);
  const added=r.all.length-unitData.records.length;
  unitData={unit_id:unitData.unit_id,unit_name:r.name,records:r.all,
            total:r.total!=null?r.total:unitData.total,
            totalPages:r.tp||unitData.totalPages,pagesFetched:r.pagesFetched,stop:r.stop,
            dropped:(unitData.dropped||0)+r.dropped};
  renderAgencyDetail();
  if(r.stop.reason==='error') toast('又補了 '+fmtNum(added)+' 則，但第 '+r.stop.page+' 頁被擋下，稍等一下再續抓','warning');
  else if(r.stop.reason==='done') toast('補了 '+fmtNum(added)+' 則，已經抓到最後一頁','success');
  else toast('補了 '+fmtNum(added)+' 則','success');
}

/* 涵蓋範圍：拿到多少 / 官方總共多少 / 抓到第幾頁 */
function agencyCoverage(){
  if(!unitData) return null;
  const st=unitData.stop||{reason:'cap',page:unitData.pagesFetched||0};
  return { got:unitData.records.length, total:unitData.total, tp:unitData.totalPages||1,
           pf:unitData.pagesFetched||0, complete:st.reason==='done', stop:st };
}
function closeAgency(){ unitData=null; document.getElementById('agencyDetail').classList.add('hidden'); }
function setUnitPeriod(y){ unitPeriod=y; renderAgencyDetail(); }
function setUnitSort(s){ unitSort=s; renderAgencyDetail(); }
function onVendorQ(v){ unitVendorQ=(v||'').trim(); renderVendorRank(); }

function unitPeriodRecords(){
  if(!unitData) return [];
  if(!unitPeriod) return unitData.records;
  const cut=new Date(); cut.setFullYear(cut.getFullYear()-unitPeriod);
  return unitData.records.filter(r=>{ const d=recDate(r); return d&&d>=cut; });
}
function vendorStats(recs){
  const map={};
  recs.forEach(r=>{
    if(!isAwardRec(r)) return;
    const seen={};
    recVendors(r).forEach(n=>{
      if(seen[n]) return; seen[n]=1;
      const m=map[n]||(map[n]={name:n,count:0,amount:0,known:0,multi:0,cases:[]});
      m.count++; m.cases.push(r);
      const a=amtOf(r.job_number);
      if(a){ m.amount+=a; m.known++; if(recVendors(r).length>1) m.multi++; }
    });
  });
  return Object.values(map);
}

function medianF(arr){ if(!arr.length) return null;
  const a=arr.slice().sort((x,y)=>x-y), m=a.length>>1;
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2; }
function pct1(v){ return v==null?'—':(v*100).toFixed(1)+'%'; }

/* ---------- 廠商集中度 ----------
   以件數佔比算 CR1／CR3／CR5 與 HHI（各家佔比百分比的平方和，0–10000）。
   分級用競爭法常見門檻：<1500 分散、1500–2500 中度集中、>2500 高度集中。
   注意共同投標／複數決標的案子會同時計入每一家，所以件數總和會大於案件數，
   集中度因此略被低估——畫面上要講明。 */
function concentration(vs){
  const n=vs.length; if(!n) return null;
  const totalCount=vs.reduce((s,v)=>s+v.count,0); if(!totalCount) return null;
  const sorted=vs.slice().sort((a,b)=>b.count-a.count);
  const share=v=>v.count/totalCount;
  const cr=k=>sorted.slice(0,k).reduce((s,v)=>s+share(v),0);
  const hhi=Math.round(vs.reduce((s,v)=>s+Math.pow(share(v)*100,2),0));
  const band = hhi<1500 ? {label:'分散',tone:'jade'}
             : hhi<2500 ? {label:'中度集中',tone:'amber'}
                        : {label:'高度集中',tone:'rose'};
  return { vendors:n, totalCount, cr1:cr(1), cr3:cr(3), cr5:cr(5), hhi,
           band:band.label, tone:band.tone, top:sorted.slice(0,5) };
}

/* ---------- 落標率（決標金額 / 預算金額） ----------
   只算 amountCache 裡同時有決標金額與預算金額的決標案，所以樣本數必須一起顯示。
   比值 >3 或 <=0 視為異常剔除（多半是複數決標的總額對上單項預算）。 */
function bidRatios(recs){
  const rows=[];
  recs.forEach(r=>{
    if(!isAwardRec(r)) return;
    const c=amountCache[amtKey(r.job_number)];
    if(!c||!c.a||!c.b) return;
    const ratio=c.a/c.b;
    if(!(ratio>0) || ratio>3) return;
    rows.push({ job:r.job_number, title:(r.brief&&r.brief.title)||'', date:r.date,
                award:c.a, budget:c.b, ratio, year:String(r.date||'').slice(0,4) });
  });
  return rows;
}
function ratioStats(rows){
  if(!rows.length) return null;
  const rs=rows.map(x=>x.ratio);
  const buckets=[['< 70%',0,0.70],['70–80%',0.70,0.80],['80–90%',0.80,0.90],
                 ['90–95%',0.90,0.95],['95–100%',0.95,1.0],['≥ 100%',1.0,Infinity]];
  const dist=buckets.map(([label,lo,hi])=>[label,rows.filter(x=>x.ratio>=lo&&x.ratio<hi).length]);
  const byYear={}; rows.forEach(x=>{ if(x.year) (byYear[x.year]=byYear[x.year]||[]).push(x.ratio); });
  const years=Object.keys(byYear).sort().map(y=>({year:y,n:byYear[y].length,med:medianF(byYear[y])}));
  const sortedRows=rows.slice().sort((a,b)=>a.ratio-b.ratio);
  return { n:rows.length, median:medianF(rs), dist, years,
           lowest:sortedRows.slice(0,5), highest:sortedRows.slice(-5).reverse() };
}

/* ---------- 拒絕往來廠商（停權名單） ----------
   政府採購的廠商拒絕往來公告。同一案同一天可能有多則，一家廠商一則。 */
function debarredList(recs){
  return recs.filter(r=>recTy(r).indexOf('拒絕往來')>=0)
    .map(r=>({ date:r.date, title:(r.brief&&r.brief.title)||'', job:r.job_number,
               vendors:recBidders(r), correction:recTy(r).indexOf('更正')>=0 }))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}

function coverageBanner(){
  const c=agencyCoverage();
  if(!c || c.complete) return '';
  const pct=c.total?Math.round(c.got/c.total*100):null;
  return '<div class="rounded-2xl bg-amber-50 border border-amber-200 p-4">'+
    '<div class="flex items-start gap-3 flex-wrap">'+
      '<i class="fa-solid fa-triangle-exclamation text-amber-600 mt-0.5"></i>'+
      '<div class="min-w-0 flex-1 text-xs text-amber-900 leading-relaxed">'+
        '<strong>這個機關的公告還沒抓完，底下每一項統計都只涵蓋已取得的部分。</strong><br>'+
        '已取得 <strong>'+fmtNum(c.got)+'</strong> 則'+
        (c.total?(' / 官方共 '+fmtNum(c.total)+' 則'+(pct!=null?('（'+pct+'%）'):'')):'')+
        '，第 1–'+c.pf+' 頁，共 '+c.tp+' 頁。'+
        (c.stop.reason==='error'
          ? '<br>第 '+c.stop.page+' 頁被擋下：'+esc(c.stop.message)+'。API 對連續大量請求會斷線，等十幾秒再續抓通常就過了。'
          : '<br>一次最多抓 '+AGENCY_PAGE_CAP+' 頁，避免被 API 擋下。')+
        '<br>公告是<strong>新到舊</strong>排序，所以手上這批是最近這幾年的；越早年的資料要繼續往下抓才會進來。'+
      '</div>'+
      '<div id="agencyMore" class="flex-shrink-0">'+
        '<button onclick="continueAgency()" class="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium whitespace-nowrap">'+
        '<i class="fa-solid fa-angles-down mr-1"></i>繼續往下抓 '+AGENCY_PAGE_CAP+' 頁</button>'+
      '</div>'+
    '</div></div>';
}

/* 機關頁的區塊很多、頁面很長：上方放一排跳轉鈕（跟著頁首黏住），按了直接捲到該區。
   沒內容的區塊（例如沒有前置公告）不出現按鈕也不佔位置。 */
function agencySections(list){
  const secs=list.filter(x=>x[2]);
  return '<div class="sticky top-[100px] z-20 -mx-1 px-1 py-2 bg-paper/95 backdrop-blur flex flex-wrap gap-1.5">'+
      secs.map(x=>'<button onclick="jumpTo('+jsArg(x[0])+')" class="px-3 py-1 rounded-full bg-white border border-slate-200 text-xs text-slate-600 hover:border-jade-500 hover:text-jade-700">'+x[1]+'</button>').join('')+
    '</div>'+
    secs.map(x=>'<div id="'+x[0]+'" class="scroll-mt-40">'+x[2]+'</div>').join('');
}
function jumpTo(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }

function renderAgencyDetail(){
  if(!unitData){ document.getElementById('agencyDetail').classList.add('hidden'); return; }
  const cov=agencyCoverage();
  const per=unitPeriodRecords();
  const awards=per.filter(isAwardRec), tenders=per.filter(r=>isTender(recTy(r)));
  const known=awards.filter(r=>amtOf(r.job_number));
  const sum=known.reduce((a,r)=>a+amtOf(r.job_number),0);
  const need=awards.length-known.length;
  const vs=vendorStats(per);
  const rg=recDateRange(unitData.records);
  const span=rg?(ymdDash(rg.from)+' — '+ymdDash(rg.to)):'—';
  const pill=(y,l)=>'<button onclick="setUnitPeriod('+y+')" class="px-3 py-1.5 text-xs rounded-lg '+(unitPeriod===y?'bg-jade-600 text-white font-semibold':'bg-white border hover:bg-slate-50')+'">'+l+'</button>';

  document.getElementById('agencyDetail').innerHTML=
  '<div class="card p-5">'+
    '<div class="flex justify-between items-start gap-3">'+
      '<div class="min-w-0">'+
      '<h3 class="text-lg font-bold text-ink-900 leading-snug"><i class="fa-solid fa-building-columns mr-2 text-jade-600"></i>'+esc(unitData.unit_name)+'</h3>'+
      '<div class="text-[11px] text-slate-400 mt-1 font-mono">'+esc(unitData.unit_id)+' · '+(cov&&cov.complete?'收錄':'已取得')+' '+span+'</div></div>'+
      '<button onclick="closeAgency()" class="text-slate-500 hover:text-slate-600 p-1 flex-shrink-0"><i class="fa-solid fa-xmark text-lg"></i></button>'+
    '</div>'+
    '<div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">'+
      '<div><div class="text-2xl font-bold text-ink-900">'+fmtNum(unitData.records.length)+
        (cov&&cov.total&&!cov.complete?'<span class="text-sm font-normal text-slate-400"> / '+fmtNum(cov.total)+'</span>':'')+
        '</div><div class="text-[11px] text-slate-500 mt-0.5">'+(cov&&cov.complete?'全期間公告':'已取得公告（未抓完）')+'</div></div>'+
      '<div><div class="text-2xl font-bold text-ink-900">'+fmtNum(awards.length)+'</div><div class="text-[11px] text-slate-500 mt-0.5">決標紀錄（'+(unitPeriod?('近'+unitPeriod+'年'):'全期')+'）</div></div>'+
      '<div><div class="text-2xl font-bold text-ink-900">'+fmtNum(tenders.length)+'</div><div class="text-[11px] text-slate-500 mt-0.5">招標公告（同期）</div></div>'+
      '<div><div class="text-2xl font-bold text-ink-900">'+fmtNum(vs.length)+'</div><div class="text-[11px] text-slate-500 mt-0.5">得標廠商家數</div></div>'+
    '</div>'+
    '<div class="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">'+
      '<span class="text-slate-500">已補齊決標金額合計</span><span class="text-lg font-bold text-jade-700">'+fmtWan(sum)+'</span>'+
      '<span class="text-slate-400">'+known.length+' / '+awards.length+' 案有金額'+(need?('，'+need+' 案未補'):'')+'</span>'+
      (unitData.dropped?('<span class="text-slate-400" title="抓分頁時官網又新增了公告，位移導致邊界紀錄被重抓，已濾掉">已濾除 '+fmtNum(unitData.dropped)+' 筆分頁重複</span>'):'')+
      '<button onclick="listUnitRecords()" class="ml-auto px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs">在情報中心列出全部公告</button>'+
    '</div>'+
  '</div>'+

  coverageBanner()+
  agencySections([
    ['agPre','前置公告', preTenderBlock()],
    ['agVendors','得標廠商排行',
  '<div class="grid lg:grid-cols-3 gap-4">'+
    '<div class="lg:col-span-2 card p-5">'+
      '<div class="flex justify-between items-start flex-wrap gap-2">'+
        '<div><h3 class="font-bold text-ink-900">得標廠商排行</h3></div>'+
        '<div class="flex gap-1.5">'+pill(3,'3 年')+pill(5,'5 年')+pill(10,'10 年')+pill(0,'全部')+'</div>'+
      '</div>'+
      '<div class="flex flex-wrap gap-2 mt-3">'+
        '<input id="vendorQ" type="text" value="'+esc(unitVendorQ)+'" oninput="onVendorQ(this.value)" placeholder="搜尋此機關得標廠商…" class="flex-1 min-w-[180px] px-3 py-2 border rounded-xl text-sm">'+
        '<button onclick="setUnitSort(\'count\')" class="px-3 py-2 text-xs rounded-lg '+(unitSort==='count'?'bg-jade-600 text-white':'border bg-white')+'">依件數</button>'+
        '<button onclick="setUnitSort(\'amount\')" class="px-3 py-2 text-xs rounded-lg '+(unitSort==='amount'?'bg-jade-600 text-white':'border bg-white')+'">依金額</button>'+
      '</div>'+
      (need?('<div class="mt-3 flex items-center gap-2 flex-wrap text-xs bg-amber-50 border border-amber-100 rounded-xl p-3">'+
        '<i class="fa-solid fa-coins text-amber-600"></i><span class="text-amber-800">還有 <strong>'+need+'</strong> 案沒有決標金額（公告清單不含金額，要逐案抓）。</span>'+
        '<button onclick="fillAgencyAmounts()" class="ml-auto px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium">補齊決標金額</button></div>')
       :(awards.length?'<div class="mt-3 text-xs text-jade-700 bg-jade-50 border border-jade-100 rounded-xl p-3"><i class="fa-solid fa-circle-check mr-1"></i>本期間決標金額已全部補齊。</div>':''))+
      '<div id="fillProgress" class="hidden mt-3 text-xs bg-slate-50 border rounded-xl p-3"></div>'+
      '<div id="vendorRank" class="mt-3"></div>'+
      '<p class="hint text-[11px] text-slate-400 mt-3 leading-relaxed">金額為公告的「總決標金額」。複數決標／共同投標的案子，官方只公布一個總額，這裡會同時計入每一家得標廠商，看到 <span class="tag bg-slate-100 text-slate-600">共同</span> 標記代表該筆有重複計算風險。</p>'+
    '</div>'+

    '<div class="card p-5">'+
      '<h3 class="font-bold text-ink-900">採購輪廓</h3>'+
      '<div class="text-[11px] text-slate-400 mt-0.5">全期間收錄</div>'+
      distBlock('公告類型', tally(unitData.records, r=>recTy(r)||'未分類'), 7)+
      distBlock('年度公告量', yearTally(unitData.records), 10)+
    '</div>'+
  '</div>'],
    ['agRatio','落標率', ratioBlock()],
    ['agFlop','流標機會', flopBlock()],
    ['agDebar','拒絕往來', debarredBlock()],
    ['agRhythm','發包節奏', rhythmBlock()]
  ]);

  saveAgencySnapshot();
  renderVendorRank();
  renderAgencyCompare();
}
