/* ================= 標案搜尋 ================= */
/* ---------- 多條件搜尋（標案名稱 / 機關名稱 / 廠商名稱 / 統一編號，AND） ----------
   四個欄位都填就要同時成立，但標案 API 一次只能用一個條件查，而且**沒有機關查詢端點**
   （實測多傳 unit_name 參數會被完全忽略：總筆數不變、無關機關照樣回來）。
   所以要挑一個當「主查詢」丟給 API，其餘在前端篩。優先序照選擇性由高到低：

     1. 機關名稱在機關索引裡唯一命中 → 走 listbyunit（每頁 1000 筆），
        對該機關接近完整，其餘條件全部在前端篩。這是涵蓋最好的一條路。
     2. 統一編號  → searchbycompanyid（8 碼，選擇性最高）
     3. 廠商名稱  → searchbycompanyname（每頁 20 筆）
     4. 標案名稱  → searchbytitle（每頁 50 筆，廣泛關鍵字會被截在 10,000 筆／100 頁）

   只填一個條件時走原本的伺服器分頁；填兩個以上就進掃描模式（分批抓、可續掃），
   並在畫面上標明主查詢是哪個欄位、掃了多少筆、前端又篩掉多少——
   部分結果絕不能被當成全部。 */
const SEARCH_SCAN_PAGES = 5;
const SEARCH_PAGE_GAP = 300;
const DRIVER_EP    = { title:'searchbytitle', vendor:'searchbycompanyname', vid:'searchbycompanyid' };
const COND_LABEL   = { title:'標案名稱', agency:'機關名稱', vendor:'廠商名稱', vid:'統一編號' };
const COND_FIELDS  = { title:'searchQuery', agency:'agencyQuery', vendor:'vendorQuery', vid:'vendorIdQuery' };
let scanState = null;

function readConds(){
  const c={};
  Object.keys(COND_FIELDS).forEach(k=>{
    const el=document.getElementById(COND_FIELDS[k]);
    c[k]=el?String(el.value||'').trim():'';
  });
  return c;
}
function filledConds(c){ return Object.keys(COND_FIELDS).filter(k=>c[k]); }
/* 主查詢：選擇性由高到低。機關不在此列——API 沒有機關查詢端點，
   機關只能走精準路徑（索引唯一命中）或當前端篩選條件。 */
function pickDriver(c){
  return (c&&c.vid) ? 'vid' : (c&&c.vendor) ? 'vendor' : (c&&c.title) ? 'title' : null;
}
function driverEndpoint(k){ return DRIVER_EP[k]||null; }
function clearSearchConds(){
  Object.values(COND_FIELDS).forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  scanState=null; agSearch=null;
  document.getElementById('searchMeta').textContent='';
  document.getElementById('searchResults').innerHTML='';
  document.getElementById('searchPager').innerHTML='';
}
function condDesc(c,keys){
  return keys.map(k=>COND_LABEL[k]+'含「'+esc(c[k])+'」').join('、');
}
/* skip 是主查詢欄位——伺服器已經比對過，不再用前端條件複篩，
   免得我的比對比伺服器更嚴而誤刪正確結果。 */
function condFilters(c,skip){
  const fs=[];
  const names=x=>(((x.brief&&x.brief.companies&&x.brief.companies.names)||[]).join(' '));
  const ids  =x=>(((x.brief&&x.brief.companies&&x.brief.companies.ids)||[]).join(' '));
  if(c.title  && skip!=='title')  fs.push(x=>String((x.brief&&x.brief.title)||'').indexOf(c.title)>=0);
  if(c.vendor && skip!=='vendor') fs.push(x=>names(x).indexOf(c.vendor)>=0);
  if(c.vid    && skip!=='vid')    fs.push(x=>ids(x).indexOf(c.vid)>=0);
  if(c.agency && skip!=='agency') fs.push(x=>String(x.unit_name||'').indexOf(c.agency)>=0);
  return fs;
}
function applyConds(recs,c,skip){
  const fs=condFilters(c,skip);
  return fs.length ? recs.filter(x=>fs.every(f=>f(x))) : recs;
}
function matchAgencies(ag){
  const q=String(ag||'').trim(); if(!q) return [];
  return Object.keys(agencyIndex).filter(nm=>nm.indexOf(q)>=0)
    .sort((a,b)=>a.length-b.length)          // 較短的通常是上層機關
    .map(nm=>[nm,agencyIndex[nm]]);
}
function typeFilters(recs){
  let r=recs;
  if(document.getElementById('filterTenderOnly').checked) r=r.filter(x=>isTenderNotice((x.brief&&x.brief.type)||''));
  if(document.getElementById('filterAwardOnly').checked)  r=r.filter(x=>isAwardNotice((x.brief&&x.brief.type)||''));
  return r;
}

async function doSearch(page){
  const c=readConds();
  const filled=filledConds(c);
  if(!filled.length){ toast('請至少填一個搜尋條件','warning'); return; }

  const agHits=c.agency?matchAgencies(c.agency):[];

  // 機關唯一命中 → 精準路徑（涵蓋最完整）
  if(c.agency && agHits.length===1) return searchWithinAgency(agHits[0][0],agHits[0][1],c);

  const driver = pickDriver(c);
  if(!driver) return agencyOnlyHelp(c.agency,agHits);      // 只填機關，且沒唯一命中

  if(filled.length===1){ scanState=null; return plainSearch(c,driver,page); }
  scanState={c,driver,page:1,tp:null,total:null,hits:[],seen:0,scanned:0,exhausted:false,agHits};
  return runScan();
}

/* 只有一個條件 → 沿用伺服器分頁 */
async function plainSearch(c,driver,page){
  const meta=document.getElementById('searchMeta'), list=document.getElementById('searchResults');
  meta.textContent='查詢中…'; list.innerHTML=''; document.getElementById('searchPager').innerHTML='';
  try{
    const r=await api('/api/'+driverEndpoint(driver)+'?query='+encodeURIComponent(c[driver])+'&page='+page);
    const raw=r.records||[];
    raw.forEach(x=>noteAgency(x.unit_id,x.unit_name)); persistAgencyIndex();
    const recs=typeFilters(raw);
    meta.innerHTML=COND_LABEL[driver]+'「'+esc(c[driver])+'」共 '+fmtNum(r.total_records)+' 筆，第 '+r.page+' / '+r.total_pages+' 頁'+
      (recs.length!==raw.length?('（本頁依公告類型篩選後 '+recs.length+' 筆）'):'');
    if(!recs.length) list.innerHTML='<div class="card p-8 text-center text-sm text-slate-400">這一頁沒有符合條件的結果。</div>';
    recs.forEach(x=>list.appendChild(tenderCard(x)));
    renderPager(r.page,r.total_pages);
  }catch(e){ meta.textContent=''; list.innerHTML='<div class="card p-6 text-sm text-rose-600">查詢失敗：'+esc(e.message)+'</div>'; }
}

function agencyOnlyHelp(ag,hits){
  const meta=document.getElementById('searchMeta'), list=document.getElementById('searchResults');
  document.getElementById('searchPager').innerHTML=''; meta.textContent='';
  if(hits.length>1){
    list.innerHTML='<div class="card p-6 space-y-3">'+
      '<p class="text-sm text-slate-600">機關索引裡有 <strong>'+hits.length+'</strong> 個機關含「'+esc(ag)+'」。挑一個，或再補上其他條件一起查。</p>'+
      '<div class="flex flex-wrap gap-1.5">'+
      hits.slice(0,30).map(([nm])=>'<button onclick="pickAgency('+jsArg(nm)+')" class="tag bg-slate-100 hover:bg-jade-100 text-slate-700 hover:text-jade-800">'+esc(nm)+'</button>').join('')+
      (hits.length>30?'<span class="text-[11px] text-slate-400">…另 '+(hits.length-30)+' 個，請輸入更完整的名稱</span>':'')+
      '</div></div>';
  }else{
    list.innerHTML='<div class="card p-6 space-y-2">'+
      '<p class="text-sm text-slate-600">只填機關名稱查不了——標案 API <strong>沒有機關查詢端點</strong>。</p>'+
      '<p class="text-xs text-slate-500 leading-relaxed">兩個作法：① 補上標案名稱、廠商名稱或統一編號，機關就能當附加條件一起篩；'+
      '② 先到<strong>機關洞察</strong>把這個機關認識一次（它會進機關索引），之後只填機關名稱就能直接列出它的公告。</p>'+
      '<button onclick="go(\'agencies\')" class="px-3 py-2 text-xs border rounded-lg hover:bg-slate-50">去機關洞察</button></div>';
  }
}
function pickAgency(nm){
  document.getElementById('agencyQuery').value=nm;
  doSearch(1);
}

/* ---------- 精準路徑：抓該機關的公告，再用其餘條件篩 ---------- */
let agSearch = null;   // {unit_name,unit_id,c,records,pagesFetched,tp,total,stop}

async function searchWithinAgency(unit_name,unit_id,c){
  scanState=null;
  const meta=document.getElementById('searchMeta'), list=document.getElementById('searchResults');
  document.getElementById('searchPager').innerHTML='';
  list.innerHTML=''; meta.textContent='抓取 '+unit_name+' 的公告…';
  const r=await loadUnitPages(unit_id,1,[],unit_name,t=>{ meta.textContent=t; });
  if(!r.all.length){
    meta.textContent='';
    list.innerHTML='<div class="card p-6 text-sm text-rose-600">抓不到這個機關的公告'+
      (r.stop.reason==='error'?('：'+esc(r.stop.message)):'')+'</div>';
    return;
  }
  agSearch={unit_name,unit_id,c,records:r.all,pagesFetched:r.pagesFetched,tp:r.tp,total:r.total,stop:r.stop};
  renderAgencySearch();
}

async function continueAgencySearch(){
  if(!agSearch) return;
  const meta=document.getElementById('searchMeta');
  const r=await loadUnitPages(agSearch.unit_id,agSearch.pagesFetched+1,agSearch.records,
                              agSearch.unit_name,t=>{ meta.textContent=t; });
  const added=r.all.length-agSearch.records.length;
  agSearch=Object.assign({},agSearch,{records:r.all,pagesFetched:r.pagesFetched,
                                      tp:r.tp,total:r.total!=null?r.total:agSearch.total,stop:r.stop});
  renderAgencySearch();
  if(r.stop.reason==='error') toast('又補了 '+fmtNum(added)+' 則，但第 '+r.stop.page+' 頁被擋下','warning');
  else if(r.stop.reason==='done') toast('補了 '+fmtNum(added)+' 則，已抓到最後一頁','success');
  else toast('補了 '+fmtNum(added)+' 則','success');
}

function renderAgencySearch(){
  const st=agSearch; if(!st) return;
  const meta=document.getElementById('searchMeta'), list=document.getElementById('searchResults');
  const c=st.c;
  const others=filledConds(c).filter(k=>k!=='agency');
  let hit=typeFilters(applyConds(st.records,c,'agency'));
  const complete=st.stop.reason==='done';

  meta.innerHTML='<span class="tag bg-jade-100 text-jade-700 mr-1.5">精準</span>'+
    ' 主查詢 <strong>'+esc(st.unit_name)+'</strong>：已取得 '+fmtNum(st.records.length)+' 則公告'+
    (st.total?('／官方共 '+fmtNum(st.total)+' 則'):'')+
    '（第 1–'+st.pagesFetched+' / '+st.tp+' 頁）'+
    (others.length?('，再篩 '+condDesc(c,others)+' → <strong>'+fmtNum(hit.length)+'</strong> 筆')
                  :('，共 <strong>'+fmtNum(hit.length)+'</strong> 筆'))+
    (complete?'':'　<span class="text-amber-700">· 公告未抓完，早年的還沒進來</span>');

  list.innerHTML='';
  if(!hit.length){
    list.innerHTML='<div class="card p-8 text-center text-sm text-slate-400">這個機關'+
      (complete?'':'已抓到的公告裡')+'沒有同時符合其他條件的標案。'+(complete?'':'可以再往下抓看看。')+'</div>';
  }
  hit.slice(0,300).forEach(x=>list.appendChild(tenderCard(x)));
  if(hit.length>300) list.insertAdjacentHTML('beforeend',
    '<p class="text-xs text-slate-400 text-center">符合 '+fmtNum(hit.length)+' 筆，只顯示前 300 筆。請把條件下得更具體。</p>');

  document.getElementById('searchPager').innerHTML='<div class="flex flex-wrap gap-2 justify-center">'+
    (complete?'':'<button onclick="continueAgencySearch()" class="px-3 py-2 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium"><i class="fa-solid fa-angles-down mr-1"></i>繼續往下抓 '+AGENCY_PAGE_CAP+' 頁</button>')+
    (others.length?'<button onclick="forceScanSearch()" class="px-3 py-2 text-xs border rounded-lg hover:bg-slate-50">改用掃描全國標案的方式查</button>':'')+
    '</div>';
}
function forceScanSearch(){
  const c=readConds();
  const driver = pickDriver(c);
  if(!driver){ toast('掃描方式需要標案名稱、廠商名稱或統一編號','warning'); return; }
  agSearch=null;
  scanState={c,driver,page:1,tp:null,total:null,hits:[],seen:0,scanned:0,exhausted:false,agHits:matchAgencies(c.agency)};
  runScan();
}

/* ---------- 掃描路徑：掃主查詢的結果，再用其餘條件篩 ---------- */
async function runScan(){
  const st=scanState; if(!st) return;
  const meta=document.getElementById('searchMeta'), list=document.getElementById('searchResults');
  const c=st.c, others=filledConds(c).filter(k=>k!==st.driver);
  const from=st.page, to=from+SEARCH_SCAN_PAGES-1;
  let stopped=null;
  for(let p=from;p<=to;p++){
    meta.innerHTML='<i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i>掃描第 '+p+' 頁…已找到 '+fmtNum(st.hits.length)+' 筆符合';
    let r;
    try{ r=await api('/api/'+driverEndpoint(st.driver)+'?query='+encodeURIComponent(c[st.driver])+'&page='+p); }
    catch(e){ stopped={message:e.message,page:p}; break; }
    if(r.total_records!=null) st.total=r.total_records;
    st.tp=r.total_pages||st.tp;
    const recs=r.records||[];
    recs.forEach(x=>noteAgency(x.unit_id,x.unit_name));
    st.seen+=recs.length;
    st.hits=st.hits.concat(applyConds(recs,c,st.driver));
    st.scanned=p;
    if(!recs.length || (st.tp && p>=st.tp)){ st.exhausted=true; break; }
    if(p<to) await new Promise(s=>setTimeout(s,SEARCH_PAGE_GAP));
  }
  persistAgencyIndex();
  st.page=st.scanned+1;

  const shown=typeFilters(st.hits);
  meta.innerHTML='<span class="tag bg-slate-200 text-slate-700 mr-1.5">掃描</span>'+
    ' 主查詢 '+COND_LABEL[st.driver]+'「'+esc(c[st.driver])+'」共 '+fmtNum(st.total)+' 筆'+
    (st.tp?('（'+st.tp+' 頁）'):'')+'，已掃第 1–'+st.scanned+' 頁（'+fmtNum(st.seen)+' 筆），'+
    '再篩 '+condDesc(c,others)+' → <strong>'+fmtNum(shown.length)+'</strong> 筆。'+
    (stopped?('<span class="text-rose-600"> 第 '+stopped.page+' 頁失敗：'+esc(stopped.message)+'</span>'):'')+
    (st.exhausted?'<span class="text-jade-700"> 已掃完全部頁數。</span>':'');

  list.innerHTML='';
  if(!shown.length){
    list.innerHTML='<div class="card p-6 space-y-2">'+
      '<p class="text-sm text-slate-600">掃到的 '+fmtNum(st.seen)+' 筆裡沒有同時符合 '+condDesc(c,others)+' 的。</p>'+
      '<p class="text-xs text-slate-500 leading-relaxed">'+
      (st.exhausted?'已經掃完所有頁數，代表這個組合真的沒有結果。'
                   :COND_LABEL[st.driver]+'「'+esc(c[st.driver])+'」共 '+fmtNum(st.total)+' 筆，掃描只涵蓋一小部分。可以繼續往下掃'+
                    (c.agency?'，或到<strong>機關洞察</strong>把這個機關認識一次，之後就能走涵蓋更完整的精準路徑':'')+'。')+
      '</p></div>';
  }
  shown.slice(0,300).forEach(x=>list.appendChild(tenderCard(x)));
  if(shown.length>300) list.insertAdjacentHTML('beforeend','<p class="text-xs text-slate-400 text-center">符合 '+fmtNum(shown.length)+' 筆，只顯示前 300 筆。</p>');

  const pager=document.getElementById('searchPager');
  let pb='<div class="flex flex-wrap gap-2 justify-center">';
  if(!st.exhausted && !stopped) pb+='<button onclick="runScan()" class="px-3 py-2 text-xs rounded-lg bg-jade-600 hover:bg-jade-700 text-white font-medium"><i class="fa-solid fa-angles-down mr-1"></i>繼續掃下 '+SEARCH_SCAN_PAGES+' 頁</button>';
  if(stopped) pb+='<button onclick="runScan()" class="px-3 py-2 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium">重試</button>';
  if(st.agHits && st.agHits.length){
    pb+='<span class="text-[11px] text-slate-400 self-center">機關索引命中 '+st.agHits.length+' 個，改走精準：</span>'+
        st.agHits.slice(0,6).map(([nm])=>'<button onclick="pickAgency('+jsArg(nm)+')" class="tag bg-jade-50 border border-jade-200 text-jade-700 hover:bg-jade-100">'+esc(nm)+'</button>').join('');
  }
  pager.innerHTML=pb+'</div>';
}

function typeTag(type){
  const t=type||'';
  if(t.indexOf('決標')>=0) return '<span class="tag bg-jade-100 text-jade-700">'+esc(t)+'</span>';
  if(t.indexOf('更正')>=0) return '<span class="tag bg-amber-100 text-amber-800">'+esc(t)+'</span>';
  if(t.indexOf('無法')>=0) return '<span class="tag bg-rose-100 text-rose-700">'+esc(t)+'</span>';
  return '<span class="tag bg-slate-100 text-slate-700">'+esc(t)+'</span>';
}
function tenderCard(x){
  const el=document.createElement('div');
  el.className='card p-4 border-l-4 border-amber-400 cursor-pointer hover:shadow-md transition';
  const brief=x.brief||{};
  const cos=splitCompanies(brief.companies&&brief.companies.names, brief.companies&&brief.companies.name_key);
  // x.winners 由快取帶入（已在同步時分好）；沒帶就現場用 name_key 分
  const hasKey=(x.winners!=null)||cos.some(o=>o.known);
  const winners=(x.winners!=null)?x.winners:cos.filter(o=>o.won).map(o=>o.name);
  const companies=winners.length?winners:cos.map(o=>o.name);
  // 分不出勝負時只寫「廠商」，不要假裝知道誰得標
  const coLabel=winners.length?'得標':(hasKey?'投標廠商':'廠商');
  el.onclick=()=>openTender(x.unit_id,x.job_number,x.unit_name,brief.title);
  el.innerHTML=
    '<div class="flex flex-wrap gap-1.5 mb-2">'+typeTag(brief.type)+(x.date?'<span class="tag bg-slate-50 text-slate-500">'+esc(x.date)+'</span>':'')+'</div>'+
    '<div class="text-xs text-jade-700 font-semibold"><i class="fa-solid fa-building-columns mr-1"></i>'+esc(x.unit_name)+'</div>'+
    '<div class="text-[15px] font-bold text-ink-900 mt-1 leading-snug">'+esc(brief.title)+'</div>'+
    '<div class="text-[11px] text-slate-400 mt-2 font-mono">'+esc(x.job_number)+'</div>'+
    (companies.length?'<div class="text-[11px] text-slate-600 mt-2"><i class="fa-solid fa-user-tie mr-1 text-slate-400"></i><span class="text-slate-400 mr-1">'+coLabel+'</span>'+esc(companies.slice(0,3).join('、'))+(companies.length>3?' 等 '+companies.length+' 家':'')+'</div>':'');
  return el;
}
function renderPager(page,total){
  const p=document.getElementById('searchPager'); p.innerHTML='';
  if(!total||total<2) return;
  const add=(n,label,active)=>{ const b=document.createElement('button');
    b.className='px-3 py-1.5 text-xs rounded-lg border '+(active?'bg-jade-600 text-white border-jade-600':'bg-white hover:bg-slate-50');
    b.textContent=label||n; b.onclick=()=>doSearch(n); p.appendChild(b); };
  const start=Math.max(1,page-3), end=Math.min(total,page+3);
  if(page>1) add(page-1,'‹');
  if(start>1){ add(1); if(start>2) p.insertAdjacentHTML('beforeend','<span class="px-1 text-slate-400">…</span>'); }
  for(let i=start;i<=end;i++) add(i,null,i===page);
  if(end<total){ if(end<total-1) p.insertAdjacentHTML('beforeend','<span class="px-1 text-slate-400">…</span>'); add(total); }
  if(page<total) add(page+1,'›');
}

