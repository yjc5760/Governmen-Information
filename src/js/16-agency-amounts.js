/* ---------- 決標金額補齊 ---------- */
/* 決標金額快取的格式版本。v1 的 b（預算金額）因為上面那個 pick 陷阱全部是 0，
   所以版本不符的項目要重抓一次，否則落標率永遠沒有樣本。 */
const AMOUNT_VER = 2;
/* 決標金額快取原本沒有上限，逛過幾十個機關就會累積上萬筆而成為第二個配額大戶。
   它是逐案打 API 換來的（每筆約 0.32 秒），所以上限開大一點、用 LRU 淘汰。 */
const AMOUNT_MAX = 8000;
function persistAmountCache(){
  const ks=Object.keys(amountCache);
  if(ks.length>AMOUNT_MAX) ks.slice(0,ks.length-AMOUNT_MAX).forEach(k=>delete amountCache[k]);
  return LS.set(K.AMOUNT,amountCache,'決標金額快取');
}

async function fetchAmount(job_number){
  const r=await api('/api/tender?unit_id='+encodeURIComponent(unitData.unit_id)+'&job_number='+encodeURIComponent(job_number),{patient:true});
  const recs=r.records||[];
  const aw=recs.filter(x=>isAward((x.brief&&x.brief.type)||''));
  const rec=aw.length?aw[aw.length-1]:recs[recs.length-1];
  const d=(rec&&rec.detail)||{};
  return { a: pickMoney(d,['總決標金額','決標金額'])||0,
           d: pick(d,['決標日期'])||'',
           b: pickMoney(d,['預算金額']) || pickMoneyAcross(recs,['預算金額']) || 0,
           v: AMOUNT_VER };
}
async function fillAmounts(jobs,onTick){
  const todo=jobs.filter(j=>{ const c=amountCache[amtKey(j)]; return !c || c.v!==AMOUNT_VER; });
  if(!todo.length){ toast('這些案子都已經有金額了','info'); return 0; }
  fillAbort=false; let done=0,fail=0;
  for(const j of todo){
    if(fillAbort) break;
    try{ amountCache[amtKey(j)]=await fetchAmount(j); }
    catch(e){ fail++; amountCache[amtKey(j)]={a:0,d:'',b:0,err:1,v:AMOUNT_VER}; }
    done++; if(onTick) onTick(done,todo.length,fail);
    await new Promise(s=>setTimeout(s,320));
  }
  persistAmountCache();
  return done;
}
async function fillAgencyAmounts(){
  const jobs=unitPeriodRecords().filter(isAwardRec).map(r=>r.job_number);
  const uniq=jobs.filter((j,i)=>jobs.indexOf(j)===i);
  const need=uniq.filter(j=>!amountCache[amtKey(j)]).length;
  if(!need){ toast('本期間已全部補齊','info'); return; }
  const mins=Math.ceil(need*0.35/60);
  if(!confirm('要逐案向 API 取 '+need+' 筆決標金額，約需 '+mins+' 分鐘（每 0.32 秒一次，避免打太兇）。\n中途可以按取消。要開始嗎？')) return;
  const bar=document.getElementById('fillProgress');
  bar.classList.remove('hidden');
  const paint=(d,t,f)=>{ bar.innerHTML='<div class="flex items-center gap-3"><span class="flex-1">補齊中… <strong>'+d+'</strong> / '+t+(f?('（'+f+' 筆失敗）'):'')+'</span>'+
    '<button onclick="fillAbort=true" class="px-3 py-1 rounded-lg border bg-white text-xs">取消</button></div>'+
    '<div class="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden"><div class="h-full bg-jade-500 rounded-full" style="width:'+(d/t*100)+'%"></div></div>'; };
  paint(0,need,0);
  const n=await fillAmounts(uniq,paint);
  bar.classList.add('hidden');
  toast(fillAbort?('已停止，補了 '+n+' 筆'):('完成，補了 '+n+' 筆'), fillAbort?'warning':'success');
  renderAgencyDetail();
}

/* ---------- 廠商 × 機關 得標案件 ---------- */
function openVendorCases(name){
  if(!unitData) return;
  const recs=unitPeriodRecords().filter(isAwardRec).filter(r=>recVendors(r).indexOf(name)>=0);
  currentVendor={name,recs};
  renderVendorModal();
  modal('vendorModal',true);
}
function renderVendorModal(){
  if(!currentVendor) return;
  const {name,recs}=currentVendor;
  const known=recs.filter(r=>amtOf(r.job_number));
  const sum=known.reduce((a,r)=>a+amtOf(r.job_number),0);
  const need=recs.length-known.length;
  document.getElementById('vmTitle').innerHTML=esc(vendorShort(name))+' <span class="text-slate-400 font-normal">在</span> '+esc(unitData.unit_name);
  document.getElementById('vmStats').innerHTML=
    '<div class="p-3"><div class="text-[11px] text-slate-500">得標案件</div><div class="text-base font-bold text-ink-900 mt-0.5">'+recs.length+' 件</div></div>'+
    '<div class="p-3"><div class="text-[11px] text-slate-500">公開決標金額合計</div><div class="text-base font-bold text-jade-700 mt-0.5">'+fmtWan(sum)+'</div></div>'+
    '<div class="p-3"><div class="text-[11px] text-slate-500">金額有揭露</div><div class="text-base font-bold text-ink-900 mt-0.5">'+known.length+' / '+recs.length+' 件</div></div>'+
    '<div class="p-3"><div class="text-[11px] text-slate-500">統計期間</div><div class="text-base font-bold text-ink-900 mt-0.5">'+(unitPeriod?('近 '+unitPeriod+' 年'):'全期間')+'</div></div>';
  const body=document.getElementById('vmBody');
  body.innerHTML='';
  recs.slice().sort((a,b)=>(b.date||0)-(a.date||0)).forEach(r=>{
    const c=amountCache[amtKey(r.job_number)];
    const el=document.createElement('div');
    el.className='border rounded-xl p-3 cursor-pointer hover:bg-slate-50 flex items-center gap-3';
    el.onclick=()=>{ modal('vendorModal',false); openTender(unitData.unit_id,r.job_number,unitData.unit_name,(r.brief&&r.brief.title)||''); };
    const ds=String(r.date||''); const dstr=ds.length===8?(ds.slice(0,4)+'/'+ds.slice(4,6)+'/'+ds.slice(6)):'';
    el.innerHTML='<div class="min-w-0 flex-1">'+
      '<div class="text-sm font-semibold text-ink-900 leading-snug">'+esc((r.brief&&r.brief.title)||'（無標案名稱）')+'</div>'+
      '<div class="text-[11px] text-slate-500 mt-1">案號 <span class="font-mono">'+esc(r.job_number)+'</span> · 公告 '+dstr+
      (c?(c.d?' · 決標 '+esc(c.d):''):'')+' · 決標金額 '+(c?(c.a?('<strong class="text-jade-700">'+fmtWan(c.a)+'</strong>'):'<span class="text-slate-400">未公開</span>'):'<span class="text-slate-300">未補齊</span>')+
      (recVendors(r).length>1?' · <span class="tag bg-slate-100 text-slate-600">共 '+recVendors(r).length+' 家得標</span>':'')+'</div></div>'+
      '<i class="fa-solid fa-chevron-right text-slate-300"></i>';
    body.appendChild(el);
  });
  document.getElementById('vmFoot').innerHTML = need
    ? '<span class="text-xs text-slate-500 flex-1">'+need+' 案還沒有金額。</span><button onclick="fillVendorAmounts()" class="px-3 py-2 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium"><i class="fa-solid fa-coins mr-1"></i>補齊這 '+need+' 案</button>'
    : '<span class="text-xs text-jade-700"><i class="fa-solid fa-circle-check mr-1"></i>金額都已補齊。</span>';
}
async function fillVendorAmounts(){
  if(!currentVendor) return;
  const jobs=currentVendor.recs.map(r=>r.job_number).filter((j,i,a)=>a.indexOf(j)===i);
  const foot=document.getElementById('vmFoot');
  const paint=(d,t,f)=>{ foot.innerHTML='<span class="text-xs flex-1">補齊中… <strong>'+d+'</strong> / '+t+(f?('（'+f+' 失敗）'):'')+'</span><button onclick="fillAbort=true" class="px-3 py-2 text-xs border rounded-lg bg-white">取消</button>'; };
  paint(0,jobs.filter(j=>!amountCache[amtKey(j)]).length,0);
  await fillAmounts(jobs,paint);
  renderVendorModal(); renderAgencyDetail();
}

