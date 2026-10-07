/* ================= 機關洞察 ================= */
/* 機關索引：API 沒有「用機關名稱查機關」的端點，只能從抓下來的公告裡累積
   unit_name -> unit_id。它獨立於公告快取，所以快取被裁掉後機關仍然認得。 */
const AGENCY_INDEX_MAX = 3000;
function noteAgency(unit_id, unit_name){
  const nm = String(unit_name||'').trim(), id = String(unit_id||'').trim();
  if(!nm || !id || agencyIndex[nm]===id) return false;
  agencyIndex[nm]=id; return true;
}
function persistAgencyIndex(){
  const names=Object.keys(agencyIndex);
  if(names.length>AGENCY_INDEX_MAX) names.slice(0,names.length-AGENCY_INDEX_MAX).forEach(nm=>delete agencyIndex[nm]);
  return LS.set(K.AGENCY,agencyIndex,'機關索引');
}
function clearAgencyFilter(){ document.getElementById('agencyFilter').value=''; renderAgencies(); }
function syncFromAgencies(){ go('overview'); document.getElementById('syncDays').value='7'; syncDays(); }
function searchAgencyByTitle(){
  const q=(document.getElementById('agencyFilter').value||'').trim();
  if(!q) return;
  go('tenders');
  clearSearchConds();
  document.getElementById('searchQuery').value=q;
  doSearch(1);
}

function renderAgencies(){
  renderAgencyCompare();
  const filter=(document.getElementById('agencyFilter').value||'').trim();
  const box=document.getElementById('agencyList');
  const recs=cacheRecords();

  // 先用快取算出各機關的公告則數
  const map={};
  recs.forEach(r=>{
    if(!r.n) return;
    if(!map[r.n]) map[r.n]={name:r.n,unit_id:r.u,total:0,tender:0,award:0};
    const m=map[r.n]; m.total++;
    if(isTender(r.ty)) m.tender++;
    if(isAward(r.ty) && !isAmendment(r.t)) m.award++;   // r.t 是標題，排除契約變更
  });
  // 再補上索引裡有、但目前快取期間內沒有公告的機關（照樣可以點進去看全期間）
  Object.keys(agencyIndex).forEach(nm=>{
    if(!map[nm]) map[nm]={name:nm,unit_id:agencyIndex[nm],total:0,tender:0,award:0};
  });

  const known=Object.values(map);
  if(!known.length){
    box.innerHTML='<div class="card p-8 text-center space-y-3">'+
      '<p class="text-sm text-slate-500">還沒有認識任何機關。</p>'+
      '<p class="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">標案 API 沒有「用機關名稱查機關」的端點，機關只能從抓下來的公告裡認識。先同步幾天公告，或到標案情報中心查一筆標案、按「機關採購輪廓」進來。</p>'+
      '<div class="flex gap-2 justify-center flex-wrap pt-1">'+
      '<button onclick="syncFromAgencies()" class="px-4 py-2 bg-ink-800 hover:bg-ink-900 text-white rounded-lg text-xs font-medium">同步近 7 日公告</button>'+
      '<button onclick="go(\'tenders\')" class="px-4 py-2 border rounded-lg text-xs hover:bg-slate-50">去標案情報中心</button>'+
      '</div></div>';
    return;
  }

  const hit = filter ? known.filter(m=>m.name.indexOf(filter)>=0) : known;
  if(!hit.length){
    box.innerHTML='<div class="card p-8 text-center space-y-3">'+
      '<p class="text-sm text-slate-500">已認識的 <strong>'+known.length+'</strong> 個機關裡沒有「'+esc(filter)+'」。</p>'+
      '<p class="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">API 只能用<strong>標案名稱</strong>查，不能用機關名稱查。改用「'+esc(filter)+'」查標案，開任一筆按「機關採購輪廓」，這個機關就會被加進來。</p>'+
      '<div class="flex gap-2 justify-center flex-wrap pt-1">'+
      '<button onclick="searchAgencyByTitle()" class="px-4 py-2 bg-jade-600 hover:bg-jade-700 text-white rounded-lg text-xs font-medium">用「'+esc(filter)+'」查標案</button>'+
      '<button onclick="clearAgencyFilter()" class="px-4 py-2 border rounded-lg text-xs hover:bg-slate-50">清除篩選</button>'+
      '</div></div>';
    return;
  }

  // 快取內有公告的排前面（多的先），其餘按名稱排
  hit.sort((a,b)=> (b.total-a.total) || a.name.localeCompare(b.name,'zh-Hant'));
  const list=hit.slice(0,60);
  const max=list[0].total||1;

  box.innerHTML='';
  const meta=document.createElement('div');
  meta.className='text-[11px] text-slate-500 px-1 pb-1';
  meta.textContent='共 '+hit.length+' 個機關'+(filter?('符合「'+filter+'」'):'')+
    (hit.length>60?'，顯示前 60 個':'')+'；則數來自本地快取的 '+Object.keys(dayCache).length+' 天公告。';
  box.appendChild(meta);

  list.forEach((m,i)=>{
    const el=document.createElement('div');
    el.className='card p-4 cursor-pointer hover:shadow-md transition';
    el.onclick=()=>openAgency(m.unit_id,m.name);
    el.innerHTML='<div class="flex items-center gap-3">'+
      '<div class="w-7 h-7 rounded-lg bg-jade-50 text-jade-700 text-xs font-bold flex items-center justify-center flex-shrink-0">'+(i+1)+'</div>'+
      '<div class="flex-1 min-w-0"><div class="text-sm font-semibold text-ink-900 truncate">'+esc(m.name)+'</div>'+
      (m.total
        ? '<div class="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden"><div class="h-full bg-jade-500 rounded-full" style="width:'+(m.total/max*100)+'%"></div></div>'+
          '<div class="text-[11px] text-slate-500 mt-1.5">快取內 '+m.total+' 則 · 招標 '+m.tender+' · 決標 '+m.award+'</div>'
        : '<div class="text-[11px] text-slate-400 mt-1.5">已認識，但快取的這幾天沒有它的公告 · 點進去仍可看全期間</div>')+
      '</div><i class="fa-solid fa-chevron-right text-slate-300"></i></div>';
    box.appendChild(el);
  });
}

/* ---------- 機關採購輪廓（全期間，直接打 listbyunit） ---------- */
let unitData=null, unitPeriod=5, unitSort='count', unitVendorQ='', fillAbort=false, currentVendor=null;

function recDate(r){ const s=String(r.date||''); if(s.length!==8) return null;
  return new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6)); }
/* 最早與最晚的公告日。只要頭尾，不必把幾萬個日期整串排序。 */
function recDateRange(recs){
  let lo=null, hi=null;
  for(const r of recs){ const d=recDate(r); if(!d) continue; if(!lo||d<lo) lo=d; if(!hi||d>hi) hi=d; }
  return lo?{from:lo,to:hi}:null;
}
/* 本地日期 → YYYY-MM-DD。不能用 toISOString：它換算成 UTC，
   台灣（UTC+8）的午夜會變成前一天，畫面上的起訖日會早一天。 */
function ymdDash(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function recTy(r){ return (r.brief&&r.brief.type)||''; }
function recTitle(r){ return (r.brief&&r.brief.title)||''; }
/* ---------- 契約變更也是一則獨立的決標公告 ----------
   它的預算與決標金額是「變更金額」不是原案金額，混在統計裡會把件數灌水、
   把落標率往 1.0 拉（議價後的變更案決標金額常常等於底價）。
   實測佔決標公告的比例，機關之間差非常多：
     台電核能火力發電工程處 610 則決標裡 170 則是契約變更（27.9%）
     全國 2026-09-01 全日 624 則裡 30 則（4.8%）
     台電電力修護處 201 則裡 0 則
   剛好在新建工程單位最嚴重，也就是最常看的那些機關。
   用標題比對就夠準：上述 170 則逐筆看過沒有誤判，連
   「…契約變更(第4次)」「…之契約變更」「Amendment No.2」這些寫法都涵蓋。
   ⚠ 刻意不納入「變更設計」與「增購」——「○○工程變更設計委託技術服務」
   是真的案子，「增購試運轉期間必要之備品」也是真的採購。
   ⚠ 也不要改成比對「第N次契約變更」：實測有標題用全形康熙部首「⼗」
   （U+2F17，不是 U+5341），序數比對會漏掉。 */
function isAmendment(title){ return String(title||'').indexOf('契約變更')>=0; }
/* 統計用的決標：排除更正、撤銷，也排除契約變更 */
function isAwardRec(r){ return isAward(recTy(r)) && !isAmendment(recTitle(r)); }
