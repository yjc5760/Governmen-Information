/* ================= 導覽 ================= */
const PAGE_TITLE={overview:'總覽',tenders:'標案情報中心',live:'官網即時查',agencies:'機關洞察',market:'市場與廠商',calendar:'採購行事曆',tracked:'追蹤清單',compare:'標案比較'};
function go(page){
  document.querySelectorAll('[data-view]').forEach(s=>s.hidden = s.dataset.view!==page);
  document.querySelectorAll('.navitem').forEach(n=>n.classList.toggle('active', n.dataset.page===page));
  document.getElementById('pageTitle').textContent=PAGE_TITLE[page]||'';
  closeDrawer(); window.scrollTo(0,0);
  if(page==='overview') renderOverview();
  if(page==='live'){ renderWatchChips(); checkProxy(false); }
  if(page==='agencies') renderAgencies();
  if(page==='market'){ renderMarketRanking(); renderRivals(); renderVendorCompare(); }
  if(page==='calendar') renderCalendar();
  if(page==='tracked') renderTracked();
  if(page==='compare') renderCompare();
}
document.querySelectorAll('.navitem[data-page]').forEach(n=>n.onclick=()=>go(n.dataset.page));

/* ================= 同步 ================= */
/* 公告快取改用「筆數」上限而不是「天數」。天數上限無法反映實際大小——
   全國一天的公告量差很多，14 天就可能超過整個 localStorage 配額。
   原本的裁切迴圈還有 off-by-one：條件是 keys.length>3 且寫入失敗，
   所以裁到剩 3 天時 3>3 為 false 直接跳出，那個「剩 3 天」的版本從來沒被寫進去，
   記憶體已經裁掉了但 localStorage 還是舊值，卻照樣顯示「已丟掉最舊幾天」。 */
const DAYCACHE_MAX_RECORDS = 12000;

function trimDayCache(){
  const keys=Object.keys(dayCache).sort();          // 舊的在前
  let total=keys.reduce((n,k)=>n+(dayCache[k]||[]).length,0);
  let dropped=0;
  while(keys.length>1 && total>DAYCACHE_MAX_RECORDS){
    const k=keys.shift();
    total-=(dayCache[k]||[]).length;
    delete dayCache[k]; dropped++;
  }
  return dropped;
}
function persistDayCache(){
  const trimmed=trimDayCache();
  if(LS.trySet(K.DAYCACHE,dayCache)){
    if(trimmed) toast('公告快取超過 '+fmtNum(DAYCACHE_MAX_RECORDS)+' 筆上限，已丟掉最舊 '+trimmed+' 天','warning');
    return true;
  }
  // 還是寫不進去（配額被別的東西占住）→ 一天一天丟，每丟一次就真的試寫一次
  const keys=Object.keys(dayCache).sort();
  let more=0;
  while(keys.length){
    delete dayCache[keys.shift()]; more++;
    if(LS.trySet(K.DAYCACHE,dayCache)){
      toast('儲存空間不足，公告快取已丟掉最舊 '+(trimmed+more)+' 天','warning');
      return true;
    }
  }
  warnQuota(K.DAYCACHE,'公告快取');
  return false;
}
async function syncDays(){
  const n=parseInt(document.getElementById('syncDays').value,10);
  const btn=document.getElementById('syncBtn'), bar=document.getElementById('syncProgress');
  btn.disabled=true; btn.classList.add('opacity-50'); bar.classList.remove('hidden');
  let got=0, fail=0;
  for(let i=0;i<n;i++){
    const d=new Date(); d.setDate(d.getDate()-i);
    const key=ymd(d);
    bar.textContent='同步中… '+(i+1)+' / '+n+'（'+key+'）';
    try{
      const r=await api('/api/listbydate?date='+key);
      const recs=(r.records||[]).map(x=>{
        const cos=splitCompanies((x.brief&&x.brief.companies&&x.brief.companies.names)||[],
                                 x.brief&&x.brief.companies&&x.brief.companies.name_key);
        const names=cos.map(o=>o.name);
        // w 存索引而不是名字，同一份名單不重複佔配額；undefined 代表舊快取、判不出勝負
        const w=[]; cos.forEach((o,i)=>{ if(o.won) w.push(i); });
        return {u:x.unit_id,n:x.unit_name,j:x.job_number,t:(x.brief&&x.brief.title)||'',
                ty:(x.brief&&x.brief.type)||'',f:x.filename||'', c:names, w:w};
      });
      recs.forEach(z=>noteAgency(z.u,z.n));
      dayCache[key]=recs; got+=recs.length;
    }catch(e){ fail++; }
    await new Promise(r=>setTimeout(r,350));
  }
  // 機關索引不可重建，要在公告快取之前寫，免得被快取把配額吃光
  persistAgencyIndex();
  persistDayCache();
  renderStorageMeter();
  bar.classList.add('hidden'); btn.disabled=false; btn.classList.remove('opacity-50');
  toast('同步完成：'+fmtNum(got)+' 筆'+(fail?('，'+fail+' 天失敗'):''), fail?'warning':'success');
  renderOverview();
}
function cacheRecords(){ return Object.keys(dayCache).sort().reverse().flatMap(k=>dayCache[k].map(r=>({...r,d:k}))); }

