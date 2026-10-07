/* ---------- 前置公告雷達（招標公告出來之前的訊號）----------
   招標公告是落後指標：公告出來時資格條款已經寫死。真正的時間窗在它前面兩種公告：

     招標文件公開閱覽公告資料   機關把招標文件草案公開供廠商閱覽並收意見
     公開徵求廠商提供參考資料   RFI，通常還在寫規範的階段，更早

   實測前置公告 → 正式招標的間隔，兩個機關的中位數都是 28 天：
     台電核能火力發電工程處 1,187 則公告裡，公開閱覽 38 則、公開徵求 16 則，
       47 個案號有前置公告，其中 35 個後來確實招標（四分位 21–45 天）
     台電總公司 2,000 則裡，公開徵求 213 則、公開閱覽 44 則，222 個案號有前置公告

   而且公開閱覽公告的 detail 有招標公告給不出來的東西——**量化的特定資格**與**預算金額**。
   招標公告的「其他:廠商資格摘要」是樣板文字（「具公司登記具商業登記…」），
   但公開閱覽公告的「標案內容:廠商資格摘要」寫得很具體，例如：
     興達二期委託技術服務：1 部 44 萬瓩(含)以上發電機組規劃設計整合經驗，
       或累積 110 萬瓩(含)以上，預算 564,179,175 元
     協和 LNG 接收站技服：6 萬公秉(含)以上地上型全容式 LNG 儲槽設計實績，
       且須有乙座 LNG 接收站設計實績，預算 183,340,500 元
   條款愈窄、符合家數愈少，量身訂做的程度愈高——這是「該不該投、該找誰結盟」的依據，
   而且在招標前約四週就看得到。

   ⚠ 這些公告本來被 TYPE_NOT_TENDER 當雜訊排除（它們確實不是招標，不該計入招標數），
     所以要單獨處理，不是放回 isTender。
   ⚠ 實測有間隔為 −12 天的資料（招標日早於公開閱覽日），一律視為不可用而不是照算。 */
const PRE_GAP_MAX = 400;          // 超過這麼久的配對視為不同一輪，不納入間隔統計
const PRE_DETAIL_MAX = 30;

function isPreview(t){ return String(t||'').indexOf('公開閱覽')>=0 && !isCorrection(t); }
function isRFI(t){ return String(t||'').indexOf('徵求廠商提供參考資料')>=0 && !isCorrection(t); }
function isPreTender(t){ return isPreview(t) || isRFI(t); }

/* 廠商資格摘要通常寫成「基本資格：… 特定資格：…」。
   特定資格才是有鑑別力的那一段；沒有特定資格本身也是訊號（門檻低、開放程度高）。 */
function splitQual(s){
  const t=String(s||'').replace(/\s+/g,' ').trim();
  if(!t) return { basic:'', special:'' };
  const m=t.match(/特定資格\s*[:：]?\s*/);
  if(!m) return { basic:t.replace(/^基本資格\s*[:：]?\s*/,'').trim(), special:'' };
  return { basic:t.slice(0,m.index).replace(/^基本資格\s*[:：]?\s*/,'').trim(),
           special:t.slice(m.index+m[0].length).trim() };
}

/* 這個機關自己的前置→招標間隔分布。樣本太少就不要拿出來當推估依據。 */
function preLeadStats(rows){
  const gs=rows.map(r=>r.gap).filter(g=>g!=null && g>=0 && g<=PRE_GAP_MAX).sort((a,b)=>a-b);
  if(!gs.length) return null;
  const q=p=>gs[Math.min(gs.length-1, Math.floor(gs.length*p))];
  return { n:gs.length, med:medianF(gs), q1:q(0.25), q3:q(0.75), min:gs[0], max:gs[gs.length-1] };
}

function preTenderList(records){
  const src = records || (unitData && unitData.records);
  if(!src) return [];
  const byJob={};
  src.forEach(r=>{ if(r.job_number) (byJob[r.job_number]=byJob[r.job_number]||[]).push(r); });
  const byDate=(a,b)=>String(a.date).localeCompare(String(b.date));
  const today=ymd(new Date());
  const rows=[];
  Object.keys(byJob).forEach(job=>{
    const list=byJob[job];
    const pre=list.filter(r=>isPreTender(recTy(r))).sort(byDate);
    if(!pre.length) return;
    const first=pre[0], preDate=String(first.date||'');
    const tnAll=list.filter(r=>isTender(recTy(r))).sort(byDate);
    const tn=tnAll.filter(r=>String(r.date)>=preDate)[0] || null;
    // 實測有招標日早於前置公告日的反常資料（相差 −12 天）。
    // 這種案子「有招標公告、只是日期對不起來」，不可以顯示成還沒招標的機會。
    const tnBefore = tn ? null : (tnAll.length ? tnAll[tnAll.length-1] : null);
    const aw=list.filter(isAwardRec).sort(byDate)
                 .filter(r=>String(r.date)>=preDate)[0] || null;
    const gap = tn ? dayGap(preDate, String(tn.date)) : null;
    rows.push({ job,
      title: recTitle(first) || recTitle(list[0]) || '（公告未列標案名稱）',
      kind: isPreview(recTy(first)) ? '公開閱覽' : '公開徵求',
      preDate,
      rounds: pre.length,
      tenderDate: tn ? String(tn.date) : null,
      awardDate: aw ? String(aw.date) : null,
      gap,
      odd: !tn && !!tnBefore,
      oddTenderDate: tnBefore ? String(tnBefore.date) : null,
      waiting: (tn||tnBefore) ? null : dayGap(preDate, today) });
  });
  /* 排序：真正還沒招標的（機會）→ 日期反常的 → 已招標的；各組內新的先 */
  const grade=x => x.tenderDate ? 2 : (x.odd ? 1 : 0);
  return rows.sort((a,b)=> (grade(a)-grade(b)) || String(b.preDate).localeCompare(String(a.preDate)));
}

function preKey(job){ return ((unitData&&unitData.unit_id)||'')+'|'+job; }

function preRow(x, st){
  const det=preDetail[preKey(x.job)];
  const kindTone = x.kind==='公開徵求' ? 'bg-indigo-100 text-indigo-700' : 'bg-sky-100 text-sky-700';   // 完整 class 名稱：Tailwind 建置時掃得到
  let h='<div class="rounded-xl border p-3">'+
    '<div class="flex justify-between gap-3 flex-wrap">'+
      '<div class="min-w-0 flex-1">'+
        '<div class="text-sm font-semibold text-ink-900 leading-snug">'+esc(x.title)+'</div>'+
        '<div class="text-[11px] text-slate-400 mt-0.5 font-mono">'+esc(x.job)+'</div>'+
      '</div>'+
      '<div class="flex-shrink-0 text-right">'+
        '<span class="tag '+kindTone+'">'+x.kind+'</span>'+
        (x.tenderDate
          ? '<div class="text-[11px] text-slate-500 mt-1">已於 '+fmtYmd(x.tenderDate)+' 招標'+
            (x.gap!=null?('（'+x.gap+' 天後）'):'')+
            (x.awardDate?('<br>決標 '+fmtYmd(x.awardDate)):'')+'</div>'
          : x.odd
          ? '<div class="text-[11px] text-amber-700 mt-1">⚠ 招標公告 '+fmtYmd(x.oddTenderDate)+
            '<br>早於前置公告，日期對不起來</div>'
          : '<div class="text-[11px] text-jade-700 mt-1 font-semibold">尚未招標'+
            (x.waiting!=null?('（已過 '+x.waiting+' 天）'):'')+'</div>')+
      '</div>'+
    '</div>'+
    '<div class="text-[11px] text-slate-500 mt-2">前置公告 '+fmtYmd(x.preDate)+
      (x.rounds>1?('　共 '+x.rounds+' 則'):'')+'</div>';

  // 推估招標區間：用這個機關自己的間隔分布，樣本不足就不推估
  if(!x.tenderDate && st && st.n>=5 && x.waiting!=null){
    const lo=st.q1, hi=st.q3;
    const late=x.waiting-hi;
    h+='<div class="text-[11px] mt-1 text-slate-600">推估招標：前置公告後 <strong>'+lo+'–'+hi+' 天</strong>'+
      '（本機關中位數 '+st.med+' 天，n='+st.n+'）</div>';
    if(late>0){
      h+='<div class="text-[11px] mt-1 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">'+
        '已超過推估區間 '+late+' 天——可能招標在即、計畫展延或改案號重辦，'+
        '也可能只是那則招標公告還沒抓到。這是<strong>推估不是公告</strong>，要確認請看官網。</div>';
    }
  }

  if(det){
    if(det.budget) h+='<div class="text-[11px] mt-2">預算 <strong class="text-ink-900">'+fmtWan(det.budget)+'</strong>'+
      (det.level?('　'+esc(det.level)):'')+(det.way?('　'+esc(det.way)):'')+'</div>';
    if(det.viewDate) h+='<div class="text-[11px] text-slate-500 mt-1">閱覽期間 '+esc(det.viewDate)+
      (det.opinionDue?('　意見送達期限 '+esc(det.opinionDue)):'')+'</div>';
    if(det.summary) h+='<div class="text-[11px] text-slate-600 mt-1 leading-relaxed"><span class="text-slate-400">內容摘要：</span>'+esc(det.summary)+'</div>';
    if(det.special){
      h+='<div class="mt-2 rounded-lg bg-rose-50 border border-rose-100 p-2">'+
        '<div class="text-[11px] font-bold text-rose-700 mb-0.5"><i class="fa-solid fa-filter mr-1"></i>特定資格（門檻在這裡）</div>'+
        '<div class="text-[11px] text-rose-900 leading-relaxed">'+esc(det.special)+'</div></div>';
    } else if(det.basic!=null){
      h+='<div class="mt-2 text-[11px] text-jade-700"><i class="fa-solid fa-circle-check mr-1"></i>公告未列特定資格，只有基本資格——門檻相對低</div>';
    }
  }
  return h+'</div>';
}

function preTenderBlock(){
  if(!unitData) return '';
  const rows=preTenderList(unitData.records);
  if(!rows.length) return '';
  const st=preLeadStats(rows);
  const open=rows.filter(x=>!x.tenderDate && !x.odd);
  const odd=rows.filter(x=>x.odd);
  const done=rows.filter(x=>x.tenderDate);
  const needDetail=open.slice(0,PRE_DETAIL_MAX).filter(x=>!preDetail[preKey(x.job)]).length;

  let h='<div class="card p-5 border-l-4 border-sky-400">'+
    ''+
    '<h3 class="font-bold text-ink-900">前置公告雷達</h3>'+
    '<p class="hint text-xs text-slate-500 mt-1 leading-relaxed">'+
      '<strong>招標公告是落後指標</strong>——公告出來時資格條款已經寫死。'+
      '真正的時間窗在它前面：<span class="tag bg-sky-100 text-sky-700">公開閱覽</span>是招標文件草案公開供閱覽，'+
      '<span class="tag bg-indigo-100 text-indigo-700">公開徵求</span>是 RFI、通常還在寫規範的階段。'+
      '公開閱覽公告還會寫出<strong>量化的特定資格與預算金額</strong>，那是招標公告給不出來的。</p>'+
    '<div class="flex flex-wrap gap-2 mt-3 text-[11px]">'+
      '<span class="tag bg-slate-100 text-slate-700">前置公告 '+rows.length+' 案</span>'+
      '<span class="tag bg-jade-100 text-jade-700">尚未招標 '+open.length+' 案</span>'+
      (st?('<span class="tag bg-sky-100 text-sky-700">本機關前置→招標中位數 '+st.med+' 天（'+st.q1+'–'+st.q3+'，n='+st.n+'）</span>'):
          '<span class="tag bg-amber-100 text-amber-800">還沒有配對成功的樣本，算不出時間窗</span>')+
    '</div>';

  if(needDetail){
    h+='<div class="mt-3 flex items-center gap-2 flex-wrap text-xs bg-sky-50 border border-sky-100 rounded-xl p-3">'+
      '<i class="fa-solid fa-filter text-sky-600"></i>'+
      '<span class="text-sky-900">預算與特定資格在公告明細裡，要逐案抓。還有 <strong>'+needDetail+'</strong> 案沒抓（只抓尚未招標的，約 '+Math.ceil(needDetail*0.35)+' 秒）。</span>'+
      '<button onclick="fillPreDetail()" class="ml-auto px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium">補預算與資格條款</button></div>';
  }
  h+='<div id="preProgress" class="hidden mt-3 text-xs bg-slate-50 border rounded-xl p-3"></div>';

  if(open.length){
    h+='<div class="mt-4"><div class="text-[11px] font-bold text-jade-700 mb-2"><i class="fa-solid fa-satellite-dish mr-1"></i>還沒招標（時間窗在這裡）</div>'+
      '<div class="space-y-2">'+open.slice(0,25).map(x=>preRow(x,st)).join('')+'</div>'+
      (open.length>25?('<p class="text-[11px] text-slate-400 mt-2">另有 '+(open.length-25)+' 案未顯示。</p>'):'')+'</div>';
  }
  if(odd.length){
    h+='<div class="mt-4"><div class="text-[11px] font-bold text-amber-700 mb-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i>日期對不起來 '+odd.length+' 案（有招標公告但早於前置公告，不當成機會）</div>'+
      '<div class="space-y-2">'+odd.slice(0,10).map(x=>preRow(x,st)).join('')+'</div></div>';
  }
  if(done.length){
    h+='<details class="mt-4"><summary class="text-[11px] font-bold text-slate-600 cursor-pointer">已進入招標 '+done.length+' 案（用來校準這個機關的時間窗）</summary>'+
      '<div class="space-y-2 mt-2">'+done.slice(0,20).map(x=>preRow(x,st)).join('')+'</div>'+
      (done.length>20?('<p class="text-[11px] text-slate-400 mt-2">另有 '+(done.length-20)+' 案未顯示。</p>'):'')+'</details>';
  }
  h+='<p class="hint text-[11px] text-slate-400 mt-3 leading-relaxed">'+
    '「尚未招標」與推估區間都只反映<strong>已抓取的公告</strong>——機關沒抓完的話，招標公告可能已經出了只是還沒抓到。'+
    '資格條款是公告的<strong>摘要</strong>，完整條款在公開閱覽文件裡（公告有列閱覽地點與網址）。'+
    '實測有招標日早於前置公告日的反常資料，那種配對會標出來且不計入時間窗統計。</p>';
  return h+'</div>';
}

async function fillPreDetail(){
  if(!unitData) return;
  const open=preTenderList(unitData.records).filter(x=>!x.tenderDate).slice(0,PRE_DETAIL_MAX);
  const need=open.filter(x=>!preDetail[preKey(x.job)]);
  if(!need.length){ toast('這些案子的詳情都抓過了','info'); return; }
  if(!confirm('要向 API 逐案取 '+need.length+' 筆預算與資格條款，約 '+Math.ceil(need.length*0.35)+' 秒。\n中途可以按取消。要開始嗎？')) return;
  fillAbort=false;
  const bar=document.getElementById('preProgress');
  if(bar) bar.classList.remove('hidden');
  let done=0, fail=0;
  for(const x of need){
    if(fillAbort) break;
    if(bar) bar.innerHTML='<div class="flex items-center gap-3"><span class="flex-1">抓取中… <strong>'+done+'</strong> / '+need.length+(fail?('（'+fail+' 筆失敗）'):'')+'</span>'+
      '<button onclick="fillAbort=true" class="px-3 py-1 rounded-lg border bg-white text-xs">取消</button></div>'+
      '<div class="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden"><div class="h-full bg-sky-500 rounded-full" style="width:'+(done/need.length*100)+'%"></div></div>';
    try{
      const r=await api('/api/tender?unit_id='+encodeURIComponent(unitData.unit_id)+'&job_number='+encodeURIComponent(x.job));
      const recs=r.records||[];
      // 取最新的那則前置公告（更正公告會補正內容，所以更正也要看）
      const pres=recs.filter(q=>{ const y=String((q.brief&&q.brief.type)||''); return y.indexOf('公開閱覽')>=0||y.indexOf('徵求廠商提供參考資料')>=0; })
                     .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const d=(pres.length? pres[pres.length-1].detail : null)||{};
      const q=splitQual(pickText(d,['廠商資格摘要']));
      preDetail[preKey(x.job)]={
        budget: pickMoney(d,['預算金額'])||0,
        level:  pickText(d,['採購金額級距']),
        way:    pickText(d,['招標方式']),
        summary:pickText(d,['內容摘要']).replace(/\s+/g,' ').slice(0,220),
        viewDate:   pickText(d,['公開閱覽日期']),
        opinionDue: pickText(d,['民眾意見之送達期限']),
        basic: q.basic, special: q.special, at: Date.now() };
      done++;
    }catch(e){ fail++; }
    await new Promise(s=>setTimeout(s,320));
  }
  if(bar) bar.classList.add('hidden');
  LS.set(K.PREDETAIL, preDetail, '前置公告詳情');
  toast(fillAbort?('已停止，抓了 '+done+' 筆'):('完成，抓了 '+done+' 筆'+(fail?('，'+fail+' 筆失敗'):'')), fillAbort?'warning':'success');
  renderAgencyDetail();
}

