/* ================= 標案詳情 ================= */
async function openTender(unit_id,job_number,unit_name,title){
  modal('tenderModal',true);
  document.getElementById('tmUnit').textContent=unit_name||'';
  document.getElementById('tmTitle').textContent=title||'載入中…';
  const body=document.getElementById('tmBody');
  body.innerHTML='<div class="py-10 text-center text-slate-400 text-sm"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>載入標案詳情…</div>';
  document.getElementById('tmSourceLink').classList.add('hidden');
  try{
    const r=await api('/api/tender?unit_id='+encodeURIComponent(unit_id)+'&job_number='+encodeURIComponent(job_number));
    const records=r.records||[];
    if(!records.length){ body.innerHTML='<p class="text-sm text-slate-500">查不到這個標案的紀錄。</p>'; return; }
    const last=records[records.length-1];
    const detail=last.detail||{};
    currentTender={ unit_id, job_number, unit_name:r.unit_name||unit_name||'', title:(last.brief&&last.brief.title)||title||'',
      date:last.date, type:(last.brief&&last.brief.type)||'',
      deadline:pick(detail,['截止投標','投標截止']), budget:budgetStr(detail,records), detail, records };
    document.getElementById('tmUnit').textContent=currentTender.unit_name;
    document.getElementById('tmTitle').textContent=currentTender.title;
    if(noteAgency(unit_id,currentTender.unit_name)) persistAgencyIndex();
    const url=pick(detail,['url']);
    if(url){ const a=document.getElementById('tmSourceLink'); a.href=url; a.classList.remove('hidden'); }
    renderTenderBody();
    refreshTrackBtn();
  }catch(e){ body.innerHTML='<p class="text-sm text-rose-600">載入失敗：'+esc(e.message)+'</p>'; }
}
/* ---------- 投標門檻雷達 ----------
   招標公告的 detail 有 85 個欄位，真正決定「這案我方能不能投、要不要投」的只有十幾個。
   把它們抽出來分組，並把「會增加負擔或風險」的那幾項標出來。
   標記只針對客觀上多一道要求的情況，不替使用者判斷該不該投。 */
const GATE_GROUPS = [
  ['案件性質', [
    ['是否屬統包',   ['是否屬統包'],            v=>/^是/.test(v) && '統包，需設計與施工整合'],
    ['需技師簽證',   ['技師簽證'],              v=>/^是/.test(v) && '須依技師簽證規則辦理'],
    ['是否特殊採購', ['是否屬特殊採購'],        v=>/^是/.test(v) && '特殊採購，資格門檻較高'],
    ['標的分類',     ['標的分類','採購性質'],   null],
    ['採購金額級距', ['採購金額級距','金額級距'], null]
  ]],
  ['競爭條件', [
    ['決標方式',     ['決標方式'],              v=>/最低標/.test(v) && '以價格競爭為主'],
    ['是否訂有底價', ['是否訂有底價'],          v=>/^否/.test(v) && '未訂底價'],
    ['是否複數決標', ['是否複數決標'],          null],
    ['協商措施',     ['是否採行協商措施'],      null],
    ['適用 GPA',     ['政府採購協定'],          v=>/^是/.test(v) && '外商可參與，競爭範圍擴大'],
    ['共同供應契約', ['是否屬共同供應契約'],    null]
  ]],
  ['資格與保證金', [
    ['押標金',       ['押標金額度','是否須繳納押標金'], v=>v && !/^否/.test(v) && '須繳押標金'],
    ['履約保證金',   ['是否須繳納履約保證金'],  v=>/^是/.test(v) && '須繳履約保證金'],
    ['廠商資格摘要', ['廠商資格摘要'],          null],
    ['基本資格文件', ['廠商應附具之基本資格證明文件'], null],
    ['電子投標',     ['是否提供電子投標'],      null]
  ]],
  ['履約條件', [
    ['履約期限',     ['履約期限'],              null],
    ['履約地點',     ['履約地點'],              null],
    ['後續擴充',     ['後續擴充'],              null],
    ['物價指數調整', ['物價指數'],              null]
  ]]
];

function gateBlock(d){
  if(!d) return '';
  const groups=[]; let flags=[];
  GATE_GROUPS.forEach(([g,items])=>{
    const rows=[];
    items.forEach(([label,keys,flagFn])=>{
      const raw=pick(d,keys); if(!raw) return;
      const v=String(raw).trim();
      const flag=flagFn?flagFn(v):null;
      if(flag) flags.push(flag);
      rows.push({label,v,flag});
    });
    if(rows.length) groups.push({g,rows});
  });
  if(!groups.length) return '';

  let h='<div class="border rounded-2xl overflow-hidden">'+
    '<div class="flex items-center justify-between gap-2 flex-wrap p-3 bg-slate-50 border-b">'+
      '<div class="text-sm font-bold text-ink-900"><i class="fa-solid fa-shield-halved text-jade-600 mr-1.5"></i>投標門檻</div>'+
      (flags.length
        ? '<span class="tag bg-amber-100 text-amber-800">'+flags.length+' 項需要留意</span>'
        : '<span class="tag bg-jade-100 text-jade-700">沒有額外門檻</span>')+
    '</div>';
  if(flags.length){
    h+='<div class="p-3 bg-amber-50 border-b border-amber-100 flex flex-wrap gap-1.5">'+
      flags.map(f=>'<span class="tag bg-white border border-amber-200 text-amber-800">'+esc(f)+'</span>').join('')+
      '</div>';
  }
  groups.forEach(({g,rows})=>{
    h+='<div class="p-3 border-b last:border-0">'+
      '<div class="text-[11px] font-bold text-jade-700 mb-2">'+esc(g)+'</div>'+
      '<div class="space-y-1.5">';
    rows.forEach(r=>{
      const long=r.v.length>60;
      h+='<div class="flex gap-2 items-start text-xs '+(r.flag?'bg-amber-50 -mx-1 px-1 py-1 rounded':'')+'">'+
        '<span class="w-24 flex-shrink-0 text-slate-500">'+esc(r.label)+'</span>'+
        '<span class="flex-1 min-w-0 '+(r.flag?'text-amber-900 font-semibold':'text-ink-900')+' '+(long?'leading-relaxed':'')+'" '+
          (long?('title="'+esc(r.v)+'"'):'')+'>'+esc(long?r.v.slice(0,60)+'…':r.v)+'</span>'+
        '</div>';
    });
    h+='</div></div>';
  });
  return h+'</div>';
}

function renderTenderBody(){
  const t=currentTender, d=t.detail;
  const dl=parseTwDate(t.deadline), left=daysLeft(dl);
  const key=[
    ['標案案號', pick(d,['標案案號'])||t.job_number],
    ['採購性質', pick(d,['採購性質','標的分類'])],
    ['公告日期', pick(d,['公告日'])],
    ['招標方式', pick(d,['招標方式'])],
    ['決標方式', pick(d,['決標方式'])],
    ['依據法條', pick(d,['依據法條','法條'])],
    ['是否屬特殊採購', pick(d,['特殊採購'])],
    ['共同供應契約', pick(d,['共同供應契約'])],
    ['電子領標', pick(d,['提供電子領標','電子領標'])],
    ['電子投標', pick(d,['提供電子投標','電子投標'])],
    ['採購金額級距', pick(d,['金額級距'])],
    ['履約地點', pick(d,['履約地點'])],
    ['履約期限', pick(d,['履約期限'])]
  ].filter(r=>r[1]);

  let html='<div class="flex flex-wrap gap-1.5">'+typeTag(t.type)+(t.date?'<span class="tag bg-slate-100 text-slate-600">'+esc(t.date)+'</span>':'')+
    (t.records.length>1?'<span class="tag bg-amber-100 text-amber-800">'+t.records.length+' 次公告紀錄</span>':'')+'</div>';

  html+='<div class="rounded-2xl bg-ink-900 text-white p-5 space-y-4">'+
    '<div class="eyebrow text-jade-500/90">投標關鍵資訊</div>'+
    '<div><div class="text-xs text-white/60"><i class="fa-regular fa-calendar mr-1.5"></i>投標截止</div>'+
    '<div class="text-xl font-bold mt-1">'+(t.deadline?esc(t.deadline):'—')+
    (left!=null&&left>=0?' <span class="text-sm font-normal text-jade-300">（剩 '+left+' 天）</span>':(left!=null?' <span class="text-sm font-normal text-white/40">（已截止）</span>':''))+'</div></div>'+
    '<div class="border-t border-white/10 pt-3"><div class="text-xs text-white/60"><i class="fa-solid fa-dollar-sign mr-1.5"></i>採購預算</div>'+
    '<div class="text-xl font-bold mt-1">'+(parseMoney(t.budget)?('$'+fmtNum(parseMoney(t.budget))):(esc(t.budget)||'未公開'))+'</div></div>'+
    '</div>';

  html+=gateBlock(d);

  html+='<div class="border rounded-2xl divide-y">';
  key.forEach(r=>{ html+='<div class="p-3"><div class="text-[11px] text-slate-500">'+esc(r[0])+'</div><div class="text-sm font-semibold text-ink-900 mt-0.5">'+esc(r[1])+'</div></div>'; });
  html+='</div>';

  html+='<details class="border rounded-2xl"><summary class="p-3 text-sm font-semibold cursor-pointer">完整公告欄位（'+Object.keys(d).length+' 項）</summary>'+
    '<div class="divide-y border-t max-h-80 overflow-y-auto">';
  Object.keys(d).forEach(k=>{ if(!d[k]) return;
    html+='<div class="p-2.5 grid grid-cols-3 gap-2"><div class="text-[11px] text-slate-500 break-all">'+esc(k)+'</div><div class="col-span-2 text-xs text-slate-800 break-all">'+esc(d[k])+'</div></div>'; });
  html+='</div></details>';

  if(t.records.length>1){
    html+='<div class="border rounded-2xl p-3"><div class="eyebrow mb-2">公告歷程</div><div class="space-y-1 text-xs">';
    t.records.slice().reverse().forEach(r=>{ html+='<div class="flex gap-2"><span class="font-mono text-slate-400">'+esc(r.date)+'</span><span>'+esc((r.brief&&r.brief.type)||'')+'</span></div>'; });
    html+='</div></div>';
  }
  document.getElementById('tmBody').innerHTML=html;
}
function agencyFromTender(){
  if(!currentTender) return;
  modal('tenderModal',false);
  openAgency(currentTender.unit_id,currentTender.unit_name);
}
function trackKey(t){ return t.unit_id+'|'+t.job_number; }
function isTracked(t){ return tracked.some(x=>trackKey(x)===trackKey(t)); }
function refreshTrackBtn(){
  const b=document.getElementById('tmTrackBtn');
  const on=currentTender&&isTracked(currentTender);
  b.innerHTML=on?'<i class="fa-solid fa-bookmark mr-1"></i>已追蹤':'<i class="fa-regular fa-bookmark mr-1"></i>加入追蹤';
  b.className='px-3 py-2 text-xs rounded-lg '+(on?'bg-jade-600 text-white':'border bg-white hover:bg-slate-50');
}
function toggleTrackCurrent(){
  if(!currentTender) return;
  const k=trackKey(currentTender);
  const removing=isTracked(currentTender);
  const prev=tracked.slice();
  if(removing){ tracked=tracked.filter(x=>trackKey(x)!==k); }
  else{ const {unit_id,job_number,unit_name,title,date,type,deadline,budget}=currentTender;
        tracked.unshift({unit_id,job_number,unit_name,title,date,type,deadline,budget}); }
  // 存不進去就把記憶體也退回去，免得畫面顯示已追蹤但重載就不見
  if(!LS.set(K.TRACKED,tracked,'追蹤清單')){ tracked=prev; refreshTrackBtn(); updateCounters(); return; }
  refreshTrackBtn(); updateCounters();
  toast(removing?'已移除追蹤':'已加入追蹤', removing?'info':'success');
}
function addCompareCurrent(){
  if(!currentTender) return;
  if(compareList.some(x=>trackKey(x)===trackKey(currentTender))){ toast('已經在比較清單裡','info'); return; }
  if(compareList.length>=CMP_MAX){ toast('比較最多 '+CMP_MAX+' 案，請先移除一個','warning'); return; }
  const {unit_id,job_number,unit_name,title,date,type,deadline,budget,detail}=currentTender;
  // 存完整 detail，欄位才能自選；去掉沒有比較價值的內部欄位
  const keep={};
  Object.keys(detail||{}).forEach(k=>{ if(CMP_SKIP.indexOf(k)<0 && detail[k]) keep[k]=String(detail[k]); });
  compareList.push({unit_id,job_number,unit_name,title,date,type,deadline,budget,detail:keep});
  if(!LS.set(K.COMPARE,compareList,'比較清單')){ compareList.pop(); updateCounters(); return; }
  updateCounters();
  toast('已加入比較（'+compareList.length+'/'+CMP_MAX+'）','success');
}
