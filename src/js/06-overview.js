/* ================= 總覽 ================= */
async function renderOverview(){
  const recs=cacheRecords();
  document.getElementById('statRecent').textContent=fmtNum(recs.length);
  const days=Object.keys(dayCache).sort();
  document.getElementById('syncSummary').textContent = days.length
    ? ('已快取 '+days.length+' 天（'+days[0]+' – '+days[days.length-1]+'）')
    : '尚未同步任何日期。';

  const soon=tracked.map(t=>({...t,dl:parseTwDate(t.deadline)})).filter(t=>t.dl&&daysLeft(t.dl)>=0&&daysLeft(t.dl)<=14).sort((a,b)=>a.dl-b.dl);
  document.getElementById('statDeadline').textContent=soon.length;

  const box=document.getElementById('overviewDeadlines');
  box.innerHTML = soon.length ? '' : '<p class="text-xs text-slate-400 py-6 text-center">追蹤清單裡沒有 14 日內截止的案子。到標案情報中心把有興趣的案子加入追蹤。</p>';
  soon.slice(0,8).forEach(t=>{
    const el=document.createElement('div');
    el.className='flex items-center gap-3 py-3 cursor-pointer';
    el.onclick=()=>openTender(t.unit_id,t.job_number);
    el.innerHTML='<div class="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex flex-col items-center justify-center flex-shrink-0">'+
      '<span class="text-base font-bold leading-none">'+daysLeft(t.dl)+'</span><span class="text-[10px]">天</span></div>'+
      '<div class="min-w-0 flex-1"><div class="text-sm font-semibold text-ink-900 truncate">'+esc(t.title)+'</div>'+
      '<div class="text-[11px] text-slate-500 truncate">'+esc(t.unit_name)+'</div></div>'+
      '<i class="fa-solid fa-chevron-right text-slate-300"></i>';
    box.appendChild(el);
  });

  try{ const info=await api('/api/getinfo'); const tot=pickInfoTotal(info); if(tot) document.getElementById('statTotal').textContent=fmtNum(tot);
       document.getElementById('apiStatus').textContent='API 連線正常'; }
  catch(e){ document.getElementById('statTotal').textContent='—'; document.getElementById('apiStatus').textContent='API 連不上：'+e.message; }
  updateCounters();
}
function updateCounters(){
  const t=document.getElementById('navTrackCount'), c=document.getElementById('navCompareCount');
  t.textContent=tracked.length||''; c.textContent=compareList.length||'';
}

