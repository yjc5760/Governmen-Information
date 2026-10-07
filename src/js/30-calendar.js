/* ================= 行事曆 ================= */
function shiftMonth(n){ calCursor.setMonth(calCursor.getMonth()+n); renderCalendar(); }
function renderCalendar(){
  const y=calCursor.getFullYear(), m=calCursor.getMonth();
  document.getElementById('calLabel').textContent=y+' 年 '+(m+1)+' 月';
  const first=new Date(y,m,1), startDow=first.getDay(), dim=new Date(y,m+1,0).getDate();
  const deadlines={};
  tracked.forEach(t=>{ const d=parseTwDate(t.deadline); if(d&&d.getFullYear()===y&&d.getMonth()===m){ const k=d.getDate(); (deadlines[k]=deadlines[k]||[]).push(t); } });
  const grid=document.getElementById('calGrid'); grid.innerHTML='';
  for(let i=0;i<startDow;i++) grid.insertAdjacentHTML('beforeend','<div></div>');
  const today=new Date();
  for(let day=1;day<=dim;day++){
    const key=y+String(m+1).padStart(2,'0')+String(day).padStart(2,'0');
    const count=(dayCache[key]||[]).length;
    const dls=deadlines[day]||[];
    const isToday=today.getFullYear()===y&&today.getMonth()===m&&today.getDate()===day;
    const cell=document.createElement('button');
    cell.className='aspect-square rounded-lg p-1 flex flex-col items-center justify-center text-xs border '+
      (isToday?'border-jade-500 bg-jade-50':'border-transparent hover:bg-slate-50');
    cell.innerHTML='<span class="'+(isToday?'font-bold text-jade-700':'text-slate-700')+'">'+day+'</span>'+
      '<span class="flex gap-0.5 mt-1 h-1.5">'+
      (count?'<span class="w-1.5 h-1.5 rounded-full bg-jade-500"></span>':'')+
      (dls.length?'<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>':'')+'</span>';
    cell.onclick=()=>showCalDay(key,count,dls);
    grid.appendChild(cell);
  }
}
function showCalDay(key,count,dls){
  const box=document.getElementById('calDayDetail');
  box.classList.remove('hidden');
  let html='<div class="eyebrow">'+key.slice(0,4)+'/'+key.slice(4,6)+'/'+key.slice(6)+'</div>';
  html+='<p class="text-sm mt-2">當日已快取公告：<strong>'+count+'</strong> 則</p>';
  if(dls.length){
    html+='<div class="mt-3 space-y-2">';
    dls.forEach(t=>{ html+='<div class="p-3 rounded-xl bg-rose-50 border border-rose-100"><div class="text-xs text-rose-700 font-semibold">投標截止</div>'+
      '<div class="text-sm font-semibold text-ink-900 mt-0.5">'+esc(t.title)+'</div><div class="text-[11px] text-slate-500">'+esc(t.unit_name)+'</div></div>'; });
    html+='</div>';
  }
  if(count){
    html+='<button onclick="showDayList(\''+key+'\')" class="mt-3 px-3 py-2 text-xs border rounded-lg">列出當日公告</button>';
  }
  box.innerHTML=html;
}
function showDayList(key){
  const recs=dayCache[key]||[];
  go('tenders');
  document.getElementById('searchMeta').textContent=key+' 共 '+recs.length+' 則公告（來自本機快取）';
  const list=document.getElementById('searchResults'); list.innerHTML=''; document.getElementById('searchPager').innerHTML='';
  recs.slice(0,200).forEach(r=>list.appendChild(tenderCard({unit_id:r.u,unit_name:r.n,job_number:r.j,date:key,brief:{title:r.t,type:r.ty,companies:{names:r.c||[]}},winners:r.w?r.w.map(i=>(r.c||[])[i]).filter(Boolean):null})));
}

