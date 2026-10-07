/* ---------- 流標機會清單 ----------
   為什麼看這個：決標公告是落後指標——公告出來時資格條款早就寫死了。
   無法決標公告才是「機關卡住、正在想辦法」的訊號，而且同一案號流標愈多次，
   機關愈可能拆包、放寬資格或調高預算，這三件事都是切入點。

   這一段的序列（流標幾次、間隔、有沒有重招成案）純粹用已經抓下來的公告算，
   不打任何 API。流標理由與各輪預算在 detail 裡，要逐案打 /api/tender，
   所以做成「補詳情」按鈕，而且只針對「還沒成案」的那幾筆抓，不是整個機關。

   台電核能火力發電工程處實測：1,187 則公告裡 63 個案號曾流標，
   其中 14 個流標 2 次以上、16 個至今未成案。 */
const FLOP_DETAIL_MAX = 30;

function dayGap(a,b){
  const p=s=>{ s=String(s||''); return s.length===8?new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6)):null; };
  const x=p(a), y=p(b); if(!x||!y) return null;
  return Math.round((y-x)/86400000);
}
/* 只取鍵尾完全相符的文字欄位——子字串比對會撈到 X:remind 之類的伴生欄位（見易錯陷阱第 3 條） */
function pickText(detail, keys){
  if(!detail) return '';
  for(const key of keys){
    for(const k of Object.keys(detail)){
      if(k.slice(k.lastIndexOf(':')+1)!==key) continue;
      const v=String(detail[k]||'').trim(); if(v) return v;
    }
  }
  return '';
}

function flopSeries(records){
  const src = records || (unitData && unitData.records);
  if(!src) return [];
  const byJob={};
  src.forEach(r=>{ if(r.job_number) (byJob[r.job_number]=byJob[r.job_number]||[]).push(r); });
  const byDate=(a,b)=>String(a.date).localeCompare(String(b.date));
  const today=ymd(new Date());
  const rows=[];
  Object.keys(byJob).forEach(job=>{
    const list=byJob[job];
    const fails=list.filter(r=>isFailedAward(recTy(r))).sort(byDate);
    if(!fails.length) return;
    const awards=list.filter(isAwardRec).sort(byDate);
    const tenders=list.filter(r=>isTender(recTy(r))).sort(byDate);
    const lastFail=String(fails[fails.length-1].date||'');
    // 只有「最後一次流標之後」才出現的決標才算成案；之前的決標是上一輪的事
    const after=awards.filter(a=>String(a.date)>=lastFail);
    const gaps=[];
    for(let i=1;i<fails.length;i++){ const g=dayGap(fails[i-1].date,fails[i].date); if(g!=null) gaps.push(g); }
    rows.push({ job,
      title: recTitle(fails[fails.length-1]) || recTitle(list[0]) || '（公告未列標案名稱）',
      fails: fails.length,
      failDates: fails.map(f=>String(f.date)),
      gaps,
      tenders: tenders.length,
      lastFail,
      settled: after.length>0,
      settledDate: after.length? String(after[0].date) : null,
      span: after.length ? dayGap(fails[0].date, after[0].date) : dayGap(lastFail, today) });
  });
  return rows.sort((a,b)=> (b.fails-a.fails) || String(b.lastFail).localeCompare(String(a.lastFail)));
}

function flopKey(job){ return unitData.unit_id+'|'+job; }

function flopRow(x){
  const det=flopDetail[flopKey(x.job)];
  const tone = x.fails>=3 ? 'bg-rose-100 text-rose-700' : x.fails===2 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700';   // 完整 class 名稱：Tailwind 建置時掃得到
  let h='<div class="rounded-xl border p-3">'+
    '<div class="flex justify-between gap-3 flex-wrap">'+
      '<div class="min-w-0 flex-1">'+
        '<div class="text-sm font-semibold text-ink-900 leading-snug">'+esc(x.title)+'</div>'+
        '<div class="text-[11px] text-slate-400 mt-0.5 font-mono">'+esc(x.job)+'</div>'+
      '</div>'+
      '<div class="flex-shrink-0 text-right">'+
        '<span class="tag '+tone+'">流標 '+x.fails+' 次</span>'+
        (x.settled
          ? '<div class="text-[11px] text-jade-700 mt-1">已於 '+fmtYmd(x.settledDate)+' 決標'+(x.span!=null?('（歷時 '+x.span+' 天）'):'')+'</div>'
          : '<div class="text-[11px] text-rose-600 mt-1 font-semibold">尚未決標'+(x.span!=null?('（距上次流標 '+x.span+' 天）'):'')+'</div>')+
      '</div>'+
    '</div>'+
    '<div class="text-[11px] text-slate-500 mt-2">流標日：'+x.failDates.map(fmtYmd).join(' → ')+
      (x.gaps.length?('　<span class="text-slate-400">間隔 '+x.gaps.join('、')+' 天</span>'):'')+'</div>';
  if(det){
    if(det.reasons && det.reasons.length){
      h+='<div class="mt-2 space-y-0.5">'+det.reasons.map(function(r){
        return '<div class="text-[11px]"><span class="text-slate-400 font-mono mr-1">'+fmtYmd(r.d)+'</span>'+esc(r.r)+'</div>';
      }).join('')+'</div>';
    }
    if(det.budgets && det.budgets.length>1){
      const a=det.budgets[0].b, b=det.budgets[det.budgets.length-1].b;
      const pctv=a?Math.round((b/a-1)*100):null;
      h+='<div class="mt-2 text-[11px]">預算：'+det.budgets.map(function(x2){ return fmtWan(x2.b); }).join(' → ')+
        (pctv!=null?(' <span class="font-bold '+(pctv>0?'text-jade-700':pctv<0?'text-rose-600':'text-slate-500')+'">'+(pctv>0?'+':'')+pctv+'%</span>'):'')+'</div>';
    } else if(det.budgets && det.budgets.length===1){
      h+='<div class="mt-2 text-[11px] text-slate-500">預算：'+fmtWan(det.budgets[0].b)+'（只查到一輪，看不出調整）</div>';
    }
    if(det.reuse){
      h+='<div class="mt-1 text-[11px] '+(det.reuse.indexOf('是')>=0?'text-rose-600 font-semibold':'text-slate-500')+'">'+
        '沿用本案號及原招標方式續行招標：'+esc(det.reuse)+
        (det.reuse.indexOf('是')>=0?'　← 機關打算原條件再招一次':'')+'</div>';
    }
  }
  return h+'</div>';
}

function flopBlock(){
  if(!unitData) return '';
  const rows=flopSeries(unitData.records);
  if(!rows.length) return '';
  const open=rows.filter(function(x){ return !x.settled; });
  const done=rows.filter(function(x){ return x.settled; });
  const multi=rows.filter(function(x){ return x.fails>=2; }).length;
  const needDetail=open.slice(0,FLOP_DETAIL_MAX).filter(function(x){ return !flopDetail[flopKey(x.job)]; }).length;

  let h='<div class="card p-5">'+
    ''+
    '<h3 class="font-bold text-ink-900">流標機會清單</h3>'+
    '<p class="hint text-xs text-slate-500 mt-1 leading-relaxed">同一案號流標愈多次，機關愈可能<strong>拆包、放寬廠商資格或調高預算</strong>，這三件事都是切入點。'+
    '決標公告是落後指標，無法決標公告才是「機關卡住、正在想辦法」的訊號。</p>'+
    '<div class="flex flex-wrap gap-2 mt-3 text-[11px]">'+
      '<span class="tag bg-slate-100 text-slate-700">曾流標 '+rows.length+' 案</span>'+
      '<span class="tag bg-amber-100 text-amber-800">流標 2 次以上 '+multi+' 案</span>'+
      '<span class="tag bg-rose-100 text-rose-700">至今未決標 '+open.length+' 案</span>'+
    '</div>';

  if(needDetail){
    h+='<div class="mt-3 flex items-center gap-2 flex-wrap text-xs bg-amber-50 border border-amber-100 rounded-xl p-3">'+
      '<i class="fa-solid fa-magnifying-glass-chart text-amber-600"></i>'+
      '<span class="text-amber-800">流標理由與各輪預算在公告明細裡，要逐案抓。還有 <strong>'+needDetail+'</strong> 案沒抓（只抓未決標的，約 '+Math.ceil(needDetail*0.35)+' 秒）。</span>'+
      '<button onclick="fillFlopDetail()" class="ml-auto px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium">補流標原因與預算變化</button></div>';
  }
  h+='<div id="flopProgress" class="hidden mt-3 text-xs bg-slate-50 border rounded-xl p-3"></div>';

  if(open.length){
    h+='<div class="mt-4"><div class="text-[11px] font-bold text-rose-700 mb-2"><i class="fa-solid fa-crosshairs mr-1"></i>還沒成案（機會在這裡）</div>'+
      '<div class="space-y-2">'+open.slice(0,25).map(flopRow).join('')+'</div>'+
      (open.length>25?('<p class="text-[11px] text-slate-400 mt-2">另有 '+(open.length-25)+' 案未顯示。</p>'):'')+'</div>';
  }
  if(done.length){
    h+='<details class="mt-4"><summary class="text-[11px] font-bold text-slate-600 cursor-pointer">已重招決標 '+done.length+' 案（看它們當初拖了多久）</summary>'+
      '<div class="space-y-2 mt-2">'+done.slice(0,20).map(flopRow).join('')+'</div>'+
      (done.length>20?('<p class="text-[11px] text-slate-400 mt-2">另有 '+(done.length-20)+' 案未顯示。</p>'):'')+'</details>';
  }
  h+='<p class="hint text-[11px] text-slate-400 mt-3 leading-relaxed">序列只涵蓋<strong>已抓取的公告</strong>，機關沒抓完的話早年的流標看不到。'+
    '「尚未決標」是指最後一次流標之後還沒有決標公告——也可能是機關放棄了、改用其他案號重招，或決標公告還沒抓到。'+
    '一案多則流標公告（複數決標各品項一則）會被算成多次，看得到流標日相同就是這種情形。</p>';
  return h+'</div>';
}

async function fillFlopDetail(){
  if(!unitData) return;
  const open=flopSeries(unitData.records).filter(function(x){ return !x.settled; }).slice(0,FLOP_DETAIL_MAX);
  const need=open.filter(function(x){ return !flopDetail[flopKey(x.job)]; });
  if(!need.length){ toast('這些案子的詳情都抓過了','info'); return; }
  if(!confirm('要向 API 逐案取 '+need.length+' 筆流標原因與預算變化，約 '+Math.ceil(need.length*0.35)+' 秒。\n中途可以按取消。要開始嗎？')) return;
  fillAbort=false;
  const bar=document.getElementById('flopProgress');
  if(bar) bar.classList.remove('hidden');
  let done=0, fail=0;
  for(const x of need){
    if(fillAbort) break;
    if(bar) bar.innerHTML='<div class="flex items-center gap-3"><span class="flex-1">抓取中… <strong>'+done+'</strong> / '+need.length+(fail?('（'+fail+' 筆失敗）'):'')+'</span>'+
      '<button onclick="fillAbort=true" class="px-3 py-1 rounded-lg border bg-white text-xs">取消</button></div>'+
      '<div class="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden"><div class="h-full bg-amber-500 rounded-full" style="width:'+(done/need.length*100)+'%"></div></div>';
    try{
      const r=await api('/api/tender?unit_id='+encodeURIComponent(unitData.unit_id)+'&job_number='+encodeURIComponent(x.job));
      const recs=r.records||[];
      const reasons=[], budgets=[]; let reuse='';
      recs.forEach(function(q){
        const d=q.detail||{}, ty=String((q.brief&&q.brief.type)||''), dt=String(q.date||'');
        if(ty.indexOf('無法決標')>=0){
          const rs=pickText(d,['無法決標的理由']);
          if(rs) reasons.push({d:dt, r:rs});
          const ru=pickText(d,['是否沿用本案號及原招標方式續行招標']);
          if(ru) reuse=ru;                       // 取最後一則（最新的意向）
        } else if(ty.indexOf('招標')>=0){
          const b=pickMoney(d,['預算金額']);
          if(b>0) budgets.push({d:dt, b:b});
        }
      });
      const byD=function(a,b){ return String(a.d).localeCompare(String(b.d)); };
      reasons.sort(byD); budgets.sort(byD);
      // 同一天多則只留一筆，免得複數決標把畫面灌爆
      const uniq=function(arr,f){ const seen={}; return arr.filter(function(z){ const k=z.d+'|'+f(z); if(seen[k]) return false; seen[k]=1; return true; }); };
      flopDetail[flopKey(x.job)]={ reasons:uniq(reasons,function(z){return z.r;}),
                                   budgets:uniq(budgets,function(z){return z.b;}),
                                   reuse:reuse, at:Date.now() };
      done++;
    }catch(e){ fail++; }
    await new Promise(function(s){ setTimeout(s,320); });
  }
  if(bar) bar.classList.add('hidden');
  LS.set(K.FLOPDETAIL, flopDetail, '流標詳情');
  toast(fillAbort?('已停止，抓了 '+done+' 筆'):('完成，抓了 '+done+' 筆'+(fail?('，'+fail+' 筆失敗'):'')), fillAbort?'warning':'success');
  renderAgencyDetail();
}

function debarredBlock(){
  const list=debarredList(unitData.records);
  if(!list.length) return '';
  // 交叉比對：被停權的廠商裡，有哪些同時也在這個機關的得標名單上
  const winners={}; vendorStats(unitData.records).forEach(v=>{ winners[v.name]=v.count; });
  const names=new Set(); list.forEach(x=>x.vendors.forEach(v=>names.add(v)));
  const alsoWon=[...names].filter(v=>winners[v]).map(v=>({name:v,count:winners[v]}))
                          .sort((a,b)=>b.count-a.count);
  let h='<div class="card p-5">'+
    ''+
    '<h3 class="font-bold text-ink-900">拒絕往來廠商（停權名單）</h3>'+
    '<p class="text-xs text-slate-500 mt-1">這個機關公告過的廠商拒絕往來名單，共 <strong>'+list.length+'</strong> 則、涉及 <strong>'+names.size+'</strong> 家。查對手或潛在協力廠商有沒有被停權時可以看這裡。</p>';
  if(alsoWon.length){
    h+='<div class="mt-3 rounded-xl bg-rose-50 border border-rose-100 p-3">'+
      '<div class="text-[11px] font-bold text-rose-700 mb-1.5"><i class="fa-solid fa-circle-exclamation mr-1"></i>其中 '+alsoWon.length+' 家同時也在本機關的得標名單上</div>'+
      '<div class="flex flex-wrap gap-1.5">'+
      alsoWon.slice(0,12).map(v=>'<span class="tag bg-white border border-rose-200 text-rose-700">'+esc(vendorShort(v.name))+' · '+v.count+' 件</span>').join('')+
      '</div></div>';
  }
  h+='<div class="mt-3 space-y-2 max-h-96 overflow-y-auto">'+
    list.slice(0,40).map(x=>'<div class="rounded-xl border p-3">'+
      '<div class="flex justify-between gap-3 flex-wrap">'+
        '<div class="min-w-0 flex-1">'+
          '<div class="text-sm font-semibold text-ink-900 leading-snug">'+
            (x.vendors.length? x.vendors.map(v=>esc(vendorShort(v))).join('、') : '（公告未列廠商）')+'</div>'+
          '<div class="text-[11px] text-slate-500 mt-0.5">'+esc(x.title)+'</div>'+
        '</div>'+
        '<div class="text-[11px] text-slate-400 whitespace-nowrap self-center font-mono">'+fmtYmd(x.date)+
          (x.correction?' <span class="tag bg-amber-100 text-amber-800">更正</span>':'')+'</div>'+
      '</div></div>').join('')+
    '</div>'+
    (list.length>40?('<p class="text-[11px] text-slate-400 mt-2">另有 '+(list.length-40)+' 則未顯示。</p>'):'')+
    '<p class="hint text-[11px] text-slate-400 mt-3 leading-relaxed">同一案同一天可能有多則公告（一家廠商一則）。名單有「更正公告」代表原公告被修正過，'+
    '這裡不會自動抵銷——要確認廠商目前的停權狀態，請到工程會的政府電子採購網查「拒絕往來廠商」專區。</p>';
  return h+'</div>';
}

