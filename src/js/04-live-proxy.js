/* ================= 官網即時查（本機 proxy） ================= */
const proxyBase = () => (LS.get(K.PROXY,'http://localhost:5178')||'').replace(/\/$/,'');
async function proxyGet(path){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),30000);
  try{
    const r=await fetch(proxyBase()+path,{signal:c.signal});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
    return j;
  } finally { clearTimeout(t); }
}
async function checkProxy(loud){
  try{ await proxyGet('/api/health'); proxyOk=true; if(loud) toast('proxy 連線正常','success'); }
  catch(e){ proxyOk=false; if(loud) toast('proxy 沒有回應：'+e.message,'error'); }
  const dot=document.getElementById('navLiveDot');
  if(dot) dot.className='w-2 h-2 rounded-full '+(proxyOk?'bg-emerald-400':'bg-slate-500');
  document.getElementById('proxyOffline').classList.toggle('hidden',proxyOk);
  return proxyOk;
}
async function testProxy(){
  LS.set(K.PROXY,document.getElementById('proxyBaseInput').value.trim()||'http://localhost:5178');
  await checkProxy(true);
}
function liveFilterQS(){
  const p=new URLSearchParams();
  const mb=document.getElementById('liveMinBudget').value;
  const md=document.getElementById('liveMaxDays').value;
  const st=document.getElementById('liveSort').value;
  if(mb&&mb!=='0') p.set('minBudget',mb);
  if(md) p.set('maxDays',md);
  if(st) p.set('sort',st);
  return p.toString();
}
function liveCard(x){
  const el=document.createElement('div');
  const left=x.remainingDays;
  const urgent=left!=null&&left<=7;
  el.className='card p-4 border-l-4 '+(urgent?'border-rose-400':'border-jade-500');
  el.innerHTML=
    '<div class="flex items-start gap-3">'+
      '<div class="w-12 h-12 rounded-xl flex-shrink-0 flex flex-col items-center justify-center '+(urgent?'bg-rose-50 text-rose-600':'bg-jade-50 text-jade-700')+'">'+
        '<span class="text-base font-bold leading-none">'+(left==null?'—':left)+'</span><span class="text-[10px]">天</span></div>'+
      '<div class="min-w-0 flex-1">'+
        '<div class="text-xs text-jade-700 font-semibold truncate">'+esc(x.orgName)+'</div>'+
        '<div class="text-[15px] font-bold text-ink-900 mt-0.5 leading-snug">'+esc(x.name)+'</div>'+
        '<div class="flex flex-wrap gap-1.5 mt-2">'+
          (x.tenderWay?'<span class="tag bg-slate-100 text-slate-700">'+esc(x.tenderWay)+'</span>':'')+
          (x.tenderType?'<span class="tag bg-jade-100 text-jade-700">'+esc(x.tenderType)+'</span>':'')+
          (x.matched&&x.matched.length?'<span class="tag bg-amber-100 text-amber-800">'+esc(x.matched.join('／'))+'</span>':'')+
        '</div>'+
        '<div class="grid grid-cols-2 gap-2 mt-3 text-[11px]">'+
          '<div><span class="text-slate-400">預算</span><div class="font-bold text-ink-900">'+(x.budget?('$'+fmtNum(x.budget)):'未提供')+'</div></div>'+
          '<div><span class="text-slate-400">截止投標</span><div class="font-bold text-ink-900">'+esc(x.deadline||'—')+'</div></div>'+
        '</div>'+
        '<div class="text-[11px] text-slate-400 mt-2 font-mono">'+esc(x.caseId)+(x.tenderPeriod?(' · 等標期 '+x.tenderPeriod+' 天'):'')+'</div>'+
        '<div class="flex flex-wrap gap-2 mt-3">'+
          '<button class="px-2.5 py-1.5 text-[11px] border rounded-lg bg-white" data-act="track"></button>'+
          (safeUrl(x.link)?'<a href="'+esc(safeUrl(x.link))+'" target="_blank" rel="noopener" class="px-2.5 py-1.5 text-[11px] border rounded-lg bg-white"><i class="fa-solid fa-arrow-up-right-from-square mr-1"></i>官網</a>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  const tb=el.querySelector('[data-act="track"]');
  const key='live|'+x.caseId;
  const setLabel=()=>{ const on=tracked.some(t=>trackKey(t)===key);
    tb.innerHTML=on?'<i class="fa-solid fa-bookmark mr-1"></i>已追蹤':'<i class="fa-regular fa-bookmark mr-1"></i>追蹤'; };
  setLabel();
  tb.onclick=()=>{ toggleTrackLive(x); setLabel(); };
  return el;
}
function toggleTrackLive(x){
  const key='live|'+x.caseId;
  if(tracked.some(t=>trackKey(t)===key)){ tracked=tracked.filter(t=>trackKey(t)!==key); toast('已移除追蹤','info'); }
  else{
    tracked.unshift({src:'live',unit_id:'live',job_number:x.caseId,unit_name:x.orgName,title:x.name,
      date:x.publishDate,type:x.tenderWay,deadline:x.deadline,budget:String(x.budget||''),link:x.link});
    toast('已加入追蹤','success');
  }
  LS.set(K.TRACKED,tracked); updateCounters();
}
async function doLiveSearch(){
  const kw=document.getElementById('liveKeyword').value.trim();
  if(!kw){ toast('請輸入關鍵字','warning'); return; }
  if(!await checkProxy(false)){ toast('proxy 沒有回應，請先啟動','error'); return; }
  const meta=document.getElementById('liveMeta'), box=document.getElementById('liveResults');
  meta.textContent='查詢官網中…'; box.innerHTML='';
  try{
    const r=await proxyGet('/api/search?keyword='+encodeURIComponent(kw)+'&'+liveFilterQS());
    meta.textContent='「'+kw+'」等標期內共 '+r.total+' 筆，篩選後 '+r.count+' 筆'+(r.cached?'（10 分鐘內快取）':'');
    if(!r.count) box.innerHTML='<div class="card p-8 text-center text-sm text-slate-400">沒有符合條件的案子。</div>';
    r.records.forEach(x=>box.appendChild(liveCard(x)));
  }catch(e){ meta.textContent=''; box.innerHTML='<div class="card p-6 text-sm text-rose-600">查詢失敗：'+esc(e.message)+'</div>'; }
}
function renderWatchChips(){
  const box=document.getElementById('watchChips'); box.innerHTML='';
  if(!watchKeywords.length){ box.innerHTML='<span class="text-xs text-slate-400">還沒有關鍵字。</span>'; return; }
  watchKeywords.forEach((k,i)=>{
    const c=document.createElement('span');
    c.className='tag bg-jade-100 text-jade-700 flex items-center gap-1.5';
    c.innerHTML=esc(k)+'<button class="text-jade-600 hover:text-rose-500"><i class="fa-solid fa-xmark"></i></button>';
    c.querySelector('button').onclick=()=>{ watchKeywords.splice(i,1); LS.set(K.WATCH,watchKeywords); renderWatchChips(); };
    box.appendChild(c);
  });
}
function addWatchKeyword(){
  const i=document.getElementById('watchInput'), v=i.value.trim();
  if(!v) return;
  if(watchKeywords.indexOf(v)>=0){ toast('已經有這個關鍵字','info'); i.value=''; return; }
  watchKeywords.push(v);
  if(!LS.set(K.WATCH,watchKeywords,'關鍵字清單')) watchKeywords.pop();
  i.value=''; renderWatchChips();
}
async function runWatch(){
  if(!watchKeywords.length){ toast('請先新增關鍵字','warning'); return; }
  if(!await checkProxy(false)){ toast('proxy 沒有回應，請先啟動','error'); return; }
  const meta=document.getElementById('watchMeta');
  const closing=document.getElementById('watchClosing'), all=document.getElementById('watchAll');
  meta.textContent='監看中，'+watchKeywords.length+' 組關鍵字逐一查詢（每組間隔約 1 秒）…';
  closing.innerHTML=''; all.innerHTML='';
  try{
    const r=await proxyGet('/api/watch?keywords='+encodeURIComponent(watchKeywords.join(','))+'&'+liveFilterQS());
    meta.textContent='共 '+r.count+' 件等標期內案件，其中 '+r.closingSoon.length+' 件 14 日內截止'+
      (r.errors&&r.errors.length?('；'+r.errors.length+' 組關鍵字失敗'):'');
    if(r.closingSoon.length){
      closing.innerHTML='<div class="eyebrow px-1">14 日內截止</div>';
      r.closingSoon.forEach(x=>closing.appendChild(liveCard(x)));
    }
    const rest=r.records.filter(x=>!r.closingSoon.some(c=>c.caseId===x.caseId));
    if(rest.length){
      all.innerHTML='<div class="eyebrow px-1 mt-4">其他等標期內案件</div>';
      rest.forEach(x=>all.appendChild(liveCard(x)));
    }
    if(!r.count) all.innerHTML='<div class="card p-8 text-center text-sm text-slate-400">這組關鍵字目前沒有等標期內的案子。</div>';
  }catch(e){ meta.textContent=''; all.innerHTML='<div class="card p-6 text-sm text-rose-600">監看失敗：'+esc(e.message)+'</div>'; }
}

