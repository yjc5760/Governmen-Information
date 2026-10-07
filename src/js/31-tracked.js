/* ================= 追蹤與比較 ================= */
function renderTracked(){
  const box=document.getElementById('trackedList');
  if(!tracked.length){ box.innerHTML='<div class="card p-8 text-center text-sm text-slate-400">還沒有追蹤任何標案。</div>'; return; }
  box.innerHTML='';
  tracked.forEach(t=>{
    const dl=parseTwDate(t.deadline), left=daysLeft(dl);
    const el=document.createElement('div');
    el.className='card p-4 border-l-4 '+(left!=null&&left>=0&&left<=7?'border-rose-400':'border-jade-500');
    el.innerHTML='<div class="flex justify-between gap-3">'+
      '<div class="min-w-0 flex-1 cursor-pointer"><div class="text-xs text-jade-700 font-semibold truncate">'+esc(t.unit_name)+(t.src==='live'?' <span class="tag bg-slate-100 text-slate-500">官網</span>':'')+'</div>'+
      '<div class="text-sm font-bold text-ink-900 mt-1 leading-snug">'+esc(t.title)+'</div>'+
      '<div class="text-[11px] text-slate-500 mt-2">截止：'+(t.deadline?esc(t.deadline):'未取得')+
      (left!=null?(left>=0?'（剩 '+left+' 天）':'（已截止）'):'')+'</div>'+
      '<div class="text-[11px] text-slate-500">預算：'+(parseMoney(t.budget)?('$'+fmtNum(parseMoney(t.budget))):'未公開')+'</div></div>'+
      '<button class="text-slate-300 hover:text-rose-500 self-start p-1"><i class="fa-regular fa-trash-can"></i></button></div>';
    el.querySelector('.cursor-pointer').onclick=()=>{
      if(t.src==='live'){ if(safeUrl(t.link)) window.open(safeUrl(t.link),'_blank','noopener'); else toast('這筆來自官網即時查，沒有詳情連結','info'); }
      else openTender(t.unit_id,t.job_number,t.unit_name,t.title); };
    el.querySelector('button').onclick=()=>{ tracked=tracked.filter(x=>trackKey(x)!==trackKey(t)); LS.set(K.TRACKED,tracked); renderTracked(); updateCounters(); };
    box.appendChild(el);
  });
}
async function refreshTrackedDetails(){
  if(!tracked.length) return;
  toast('更新中…','info');
  for(const t of tracked){
    if(t.src==='live') continue;
    try{
      const r=await api('/api/tender?unit_id='+encodeURIComponent(t.unit_id)+'&job_number='+encodeURIComponent(t.job_number),{patient:true});
      const recs=r.records||[]; if(!recs.length) continue;
      const d=recs[recs.length-1].detail||{};
      t.deadline=pick(d,['截止投標','投標截止'])||t.deadline;
      t.budget=budgetStr(d,recs)||t.budget;
      t.type=(recs[recs.length-1].brief&&recs[recs.length-1].brief.type)||t.type;
    }catch(e){}
    await new Promise(r=>setTimeout(r,300));
  }
  LS.set(K.TRACKED,tracked); renderTracked(); toast('追蹤資料已更新','success');
}
