/* ---------- 機關快照與機關對比 ----------
   機關輪廓要向 API 抓幾萬則公告才算得出來，不可能為了對比而同時抓兩三個機關。
   所以每次看完一個機關就存一份「指標快照」（只存算好的數字，不存原始公告），
   之後就能把看過的機關並排比較。快照會記錄當時的資料涵蓋範圍，
   涵蓋率差很多的兩個機關不能直接比——表格裡會標出來。 */
const SNAP_MAX = 40;

function saveAgencySnapshot(){
  if(!unitData) return;
  const all=unitData.records;
  const awards=all.filter(isAwardRec);
  const tenders=all.filter(r=>isTender(recTy(r)));
  const fails=all.filter(r=>isFailedAward(recTy(r)));
  const vs=vendorStats(all);
  const con=concentration(vs);
  const st=ratioStats(bidRatios(all));
  const series=buildSeries(all);
  const cov=agencyCoverage();
  const rg=recDateRange(all);
  const decided=awards.length+fails.length;
  agencySnaps[unitData.unit_id]={
    unit_id:unitData.unit_id, unit_name:unitData.unit_name, at:Date.now(),
    got:cov.got, total:cov.total, pf:cov.pf, tp:cov.tp, complete:cov.complete,
    awards:awards.length, tenders:tenders.length, fails:fails.length,
    failRate: decided? fails.length/decided : null,
    vendors: con?con.vendors:0, cr1:con?con.cr1:null, cr3:con?con.cr3:null,
    hhi:con?con.hhi:null, band:con?con.band:null,
    ratioMed: st?st.median:null, ratioN: st?st.n:0,
    seriesReg: series.filter(x=>x.regular).length,
    seriesIrr: series.filter(x=>!x.regular).length,
    soon120: series.filter(x=>x.regular&&x.daysToNext>=-30&&x.daysToNext<=120).length,
    debarred: debarredList(all).length,
    from: rg?rg.from.getFullYear():null, to: rg?rg.to.getFullYear():null,
    top3: (con?con.top.slice(0,3):[]).map(v=>vendorShort(v.name)+'('+v.count+')')
  };
  const ids=Object.keys(agencySnaps);
  if(ids.length>SNAP_MAX){
    ids.sort((a,b)=>agencySnaps[a].at-agencySnaps[b].at)
       .slice(0,ids.length-SNAP_MAX).forEach(id=>delete agencySnaps[id]);
  }
  LS.set(K.SNAP,agencySnaps);
}

function toggleSnapSel(id,on){
  const i=snapSel.indexOf(id);
  if(on && i<0){ if(snapSel.length>=4){ toast('一次最多對比 4 個機關','warning'); renderAgencyCompare(); return; } snapSel.push(id); }
  if(!on && i>=0) snapSel.splice(i,1);
  LS.set(K.SNAPSEL,snapSel); renderAgencyCompare();
}
function dropSnap(id){
  delete agencySnaps[id]; LS.set(K.SNAP,agencySnaps);
  snapSel=snapSel.filter(x=>x!==id); LS.set(K.SNAPSEL,snapSel);
  renderAgencyCompare();
}
function clearSnaps(){
  if(!confirm('清掉所有機關快照？下次看機關輪廓時會重新產生。')) return;
  agencySnaps={}; snapSel=[]; LS.set(K.SNAP,agencySnaps); LS.set(K.SNAPSEL,snapSel);
  renderAgencyCompare();
}

/* 從一格顯示值裡抽出可比較的數字。fmtNum 會加千分位，不先去掉逗號的話
   "1,200" 會被讀成 1 而輸給 "999"。也要先去掉 HTML 標籤（有些格帶 <span>）。 */
function snapNum(raw){
  if(raw==null) return null;
  const m=String(raw).replace(/<[^>]*>/g,'').replace(/,/g,'').match(/-?[\d.]+/);
  if(!m) return null;
  const v=parseFloat(m[0]);
  return isNaN(v)?null:v;
}

const SNAP_ROWS = [
  ['資料涵蓋',   s=>s.total? (fmtNum(s.got)+' / '+fmtNum(s.total)+'（'+Math.round(s.got/s.total*100)+'%）') : fmtNum(s.got), 'text'],
  ['抓到頁數',   s=>s.pf+' / '+s.tp+(s.complete?'（完整）':'（未抓完）'), 'text'],
  ['公告年份',   s=>(s.from&&s.to)?(s.from+'–'+s.to):'—', 'text'],
  ['招標公告',   s=>fmtNum(s.tenders), 'num'],
  ['決標紀錄',   s=>fmtNum(s.awards), 'num'],
  ['無法決標',   s=>fmtNum(s.fails), 'num'],
  ['流標率',     s=>pct1(s.failRate), 'high-bad'],
  ['得標廠商家數', s=>fmtNum(s.vendors), 'num'],
  ['最大一家佔比', s=>pct1(s.cr1), 'high-bad'],
  ['前三大佔比',  s=>pct1(s.cr3), 'high-bad'],
  ['HHI 集中度',  s=>s.hhi!=null?(fmtNum(s.hhi)+'（'+s.band+'）'):'—', 'high-bad'],
  ['落標率中位數', s=>s.ratioMed!=null?(pct1(s.ratioMed)+' <span class="text-[10px] text-slate-400">'+s.ratioN+' 案</span>'):'—（金額未補齊）', 'text'],
  ['規律發包系列', s=>fmtNum(s.seriesReg)+' <span class="text-[10px] text-slate-400">+'+s.seriesIrr+' 不規律</span>', 'text'],
  ['120 日內預估招標', s=>fmtNum(s.soon120), 'num'],
  ['拒絕往來公告', s=>fmtNum(s.debarred), 'num'],
  ['前三大廠商',  s=>s.top3&&s.top3.length?s.top3.map(esc).join('<br>'):'—', 'text'],
  ['快照時間',    s=>new Date(s.at).toLocaleString('zh-TW',{hour12:false}).replace(/:\d\d$/,''), 'text']
];

function renderAgencyCompare(){
  const box=document.getElementById('agencyCompare'); if(!box) return;
  const ids=Object.keys(agencySnaps).sort((a,b)=>agencySnaps[b].at-agencySnaps[a].at);
  if(!ids.length){ box.innerHTML=''; return; }
  const sel=snapSel.filter(id=>agencySnaps[id]);
  /* 每次勾選都會重繪整個 <details>，只看 sel.length 決定 open 的話，
     勾第一個時面板會當場收起來。所以沿用目前的展開狀態。 */
  const wasOpen=!!(box.querySelector('details')||{}).open;

  let h='<details class="card p-0"'+((wasOpen||sel.length>=2)?' open':'')+'>'+
    '<summary class="p-4 cursor-pointer flex items-center justify-between flex-wrap gap-2">'+
      '<div><div class="eyebrow">AGENCY COMPARE</div>'+
      '<h3 class="font-bold text-ink-900 mt-1">機關對比</h3>'+
      '<p class="text-xs text-slate-500 mt-0.5">看過的機關會自動存一份指標快照，勾 2–4 個就能並排比。目前有 '+ids.length+' 個快照'+(sel.length?('，已勾 '+sel.length+' 個'):'')+'。</p></div>'+
      '<i class="fa-solid fa-chevron-down text-slate-300"></i>'+
    '</summary>'+
    '<div class="border-t p-4 space-y-4">';

  h+='<div class="flex flex-wrap gap-1.5 items-center">';
  ids.forEach(id=>{
    const sn=agencySnaps[id], on=sel.indexOf(id)>=0;
    h+='<label class="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg border cursor-pointer '+
      (on?'bg-jade-50 border-jade-300 text-jade-800 font-semibold':'bg-white hover:bg-slate-50 text-slate-600')+'">'+
      '<input type="checkbox" '+(on?'checked':'')+' onchange="toggleSnapSel('+jsArg(id)+',this.checked)">'+
      '<span>'+esc(vendorShort(sn.unit_name))+'</span>'+
      '<span class="text-slate-400">'+fmtNum(sn.got)+' 則</span>'+
      '<span onclick="event.preventDefault();event.stopPropagation();dropSnap('+jsArg(id)+')" class="text-slate-300 hover:text-rose-500 ml-0.5" title="刪除這份快照">✕</span>'+
      '</label>';
  });
  h+='<button onclick="clearSnaps()" class="text-[11px] text-slate-400 hover:text-rose-500 underline ml-1">全部清掉</button></div>';

  if(sel.length<2){
    h+='<p class="text-xs text-slate-400">再勾一個機關就會出現對比表。快照是看機關輪廓時自動存的，想加新機關就去點它一次。</p>';
    return void(box.innerHTML=h+'</div></details>');
  }

  const snaps=sel.map(id=>agencySnaps[id]);
  // 涵蓋率差距大就警告：指標會被資料量牽著走
  const pcts=snaps.map(s=>s.total?s.got/s.total:1);
  const spread=Math.max.apply(null,pcts)-Math.min.apply(null,pcts);
  if(spread>0.25){
    h+='<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">'+
      '<i class="fa-solid fa-triangle-exclamation mr-1"></i><strong>這幾個機關的資料涵蓋率差距很大（'+
      snaps.map(s=>esc(vendorShort(s.unit_name))+' '+(s.total?Math.round(s.got/s.total*100)+'%':'?')).join('、')+
      '）。</strong>件數類的指標會被資料量牽著走，比例類的（流標率、集中度、落標率）才勉強可比。要嚴謹比較，請先把各機關都抓完。</div>';
  }

  h+='<div class="overflow-x-auto"><table class="w-full text-xs border-collapse min-w-[560px]">'+
    '<thead><tr><th class="p-2 text-left bg-slate-50 border sticky left-0 z-10">指標</th>';
  snaps.forEach(sn=>{
    h+='<th class="p-2 text-left border bg-slate-50 align-top min-w-[140px]">'+
      '<div class="font-bold text-ink-900 leading-snug">'+esc(sn.unit_name)+'</div>'+
      '<div class="text-[10px] text-slate-400 font-mono mt-0.5">'+esc(sn.unit_id)+'</div></th>';
  });
  h+='</tr></thead><tbody>';
  SNAP_ROWS.forEach(([label,fn,kind])=>{
    const vals=snaps.map(sn=>{ try{ return fn(sn); }catch(e){ return '—'; } });
    if(vals.every(v=>v==='—')) return;
    // 數值列標出最高的那一格；比例類「越高越糟」用紅色，其餘用綠色
    let best=-1;
    if(kind==='num'||kind==='high-bad'){
      const nums=snaps.map(sn=>snapNum(fn(sn)));
      let bv=null; nums.forEach((v,i)=>{ if(v!=null&&(bv==null||v>bv)){ bv=v; best=i; } });
    }
    h+='<tr><td class="p-2 border bg-slate-50 font-semibold sticky left-0 z-10 align-top whitespace-nowrap">'+esc(label)+'</td>';
    vals.forEach((v,i)=>{
      const hi = i===best ? (kind==='high-bad'?'text-rose-600 font-bold':'text-jade-700 font-bold') : 'text-ink-900';
      h+='<td class="p-2 border align-top '+hi+'">'+v+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table></div>'+
    '<p class="text-[11px] text-slate-400 leading-relaxed">粗體標的是該列最高的一格：流標率、集中度這類「越高對新進者越不利」的用紅色，其餘用綠色。'+
    '快照只存算好的數字、不存原始公告，所以不會佔太多空間，但也<strong>不會自動更新</strong>——機關有新公告要再點一次那個機關才會刷新。</p>';
  box.innerHTML=h+'</div></details>';
}

function rhythmBlock(){
  const all=unitData.records;
  const series=buildSeries(all);
  const fails=buildFailed(all);
  const soon=series.filter(x=>x.regular&&x.daysToNext>=-30&&x.daysToNext<=120);
  const irregular=series.filter(x=>!x.regular).length;
  const openFails=fails.filter(f=>!f.reDate);
  const reLag=median(fails.filter(f=>f.lag!=null&&f.lag<1200).map(f=>f.lag));

  let h='<div class="card p-5">'+
    '<div class="eyebrow">PROCUREMENT RHYTHM</div>'+
    '<h3 class="font-bold text-ink-900 mt-1">發包節奏</h3>'+
    '<p class="text-xs text-slate-500 mt-1">把年度性標案的名稱正規化成系列（去掉「115年度」這類年份），用歷年招標日的間隔中位數推下一次。全部由這份公告清單算出，沒有另外打 API。</p>'+
    (function(){ const c=agencyCoverage();
      return (c&&!c.complete)
        ? '<p class="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2.5 mt-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i>公告只抓到 '+fmtNum(c.got)+' 則（第 1–'+c.pf+' / '+c.tp+' 頁），而且是最近的那些。<strong>早年的招標紀錄還沒進來，所以系列的次數會偏低、間隔可能算錯。</strong>要當預測用請先把公告抓完。</p>'
        : ''; })();

  if(!series.length && !fails.length){
    return h+'<p class="text-sm text-slate-400 text-center py-8">這個機關的公告裡找不到重複出現的標案系列，也沒有流標紀錄。</p></div>';
  }

  h+='<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">'+
    '<div class="rounded-xl bg-jade-50 border border-jade-100 p-3"><div class="text-xl font-bold text-jade-700">'+(series.length-irregular)+
      (irregular?'<span class="text-sm font-normal text-slate-400"> +'+irregular+' 不規律</span>':'')+
      '</div><div class="text-[11px] text-slate-500 mt-0.5">規律發包系列</div></div>'+
    '<div class="rounded-xl bg-amber-50 border border-amber-100 p-3"><div class="text-xl font-bold text-amber-700">'+soon.length+'</div><div class="text-[11px] text-slate-500 mt-0.5">規律且 120 日內招標</div></div>'+
    '<div class="rounded-xl bg-rose-50 border border-rose-100 p-3"><div class="text-xl font-bold text-rose-700">'+openFails.length+'</div><div class="text-[11px] text-slate-500 mt-0.5">流標後尚未重招</div></div>'+
    '<div class="rounded-xl bg-slate-50 border p-3"><div class="text-xl font-bold text-ink-900">'+(reLag!=null?reLag+' 天':'—')+'</div><div class="text-[11px] text-slate-500 mt-0.5">流標到重招中位數</div></div>'+
    '</div>';

  /* --- 週期預測表 --- */
  h+='<div class="mt-5"><div class="text-xs font-semibold text-slate-600 mb-2">下次招標預估（依接近程度排序，顯示前 40 個系列）</div>'+
     '<div class="overflow-x-auto"><table class="w-full text-xs border-collapse min-w-[640px]">'+
     '<thead><tr class="bg-slate-50 text-slate-600">'+
     '<th class="p-2 text-left border">標案系列</th><th class="p-2 text-center border whitespace-nowrap">週期</th>'+
     '<th class="p-2 text-center border whitespace-nowrap">次數</th>'+
     '<th class="p-2 text-center border whitespace-nowrap">最近招標</th><th class="p-2 text-center border whitespace-nowrap">間隔</th>'+
     '<th class="p-2 text-center border whitespace-nowrap">下次預估</th><th class="p-2 text-center border whitespace-nowrap">距今</th>'+
     '<th class="p-2 text-left border whitespace-nowrap">慣例月份</th></tr></thead><tbody>';
  series.slice(0,40).forEach(x=>{
    const dd=x.daysToNext;
    const cls = !x.regular ? 'text-slate-400' : dd<0 ? 'text-slate-400' : dd<=60 ? 'text-rose-600 font-bold' : dd<=120 ? 'text-amber-600 font-semibold' : 'text-slate-600';
    const near = x.regular && dd>=-30 && dd<=120;
    h+='<tr class="'+(near?'bg-amber-50/50':(x.regular?'':'opacity-60'))+'">'+
      '<td class="p-2 border"><div class="font-semibold text-ink-900 leading-snug">'+esc(x.title)+'</div>'+
        '<div class="text-[10px] text-slate-400 mt-0.5 font-mono">'+x.yearly.map(it=>fmtYmd(it.date)).join(' → ')+'</div></td>'+
      '<td class="p-2 border text-center whitespace-nowrap">'+
        (x.regular?'<span class="tag bg-jade-100 text-jade-700">'+x.cycle+'</span>'
                  :'<span class="tag bg-slate-100 text-slate-500">'+x.cycle+'</span>')+'</td>'+
      '<td class="p-2 border text-center">'+x.count+'</td>'+
      '<td class="p-2 border text-center whitespace-nowrap font-mono">'+fmtYmd(x.lastDate)+'</td>'+
      '<td class="p-2 border text-center whitespace-nowrap">'+x.gap+' 天</td>'+
      '<td class="p-2 border text-center whitespace-nowrap font-mono">'+fmtDateObj(x.next)+'</td>'+
      '<td class="p-2 border text-center whitespace-nowrap '+cls+'">'+(dd<0?('過了 '+(-dd)+' 天'):(dd+' 天'))+'</td>'+
      '<td class="p-2 border whitespace-nowrap text-slate-600">'+x.monthMode+' 月（'+x.monthHits+'/'+x.count+' 次）</td>'+
      '</tr>';
  });
  h+='</tbody></table></div>'+
     '<p class="text-[11px] text-slate-400 mt-2 leading-relaxed">「間隔」是各輪招標日相差天數的中位數。距離上一次不到 '+MIN_ROUND_GAP+' 天的視為<strong>同一輪</strong>（流標重招、分批、第2次公告），不會被算成一個短週期。'+
     '間隔接近 365／730／1095 天才標為年度／兩年／三年，其餘標<strong>不規律</strong>並淡化——那些多半是偶發採購，預估值沒有意義。'+
     '次數只有 2 次的預估很脆弱，要一起看「慣例月份」的命中比例。過期未出現的系列可能已經停辦、改名或併案。</p></div>';

  /* --- 流標重招 --- */
  if(fails.length){
    h+='<div class="mt-6"><div class="text-xs font-semibold text-slate-600 mb-2">流標與重招（共 '+fails.length+' 筆無法決標，未重招的排前面）</div><div class="space-y-2">';
    const ordered=openFails.concat(fails.filter(f=>f.reDate)).slice(0,25);
    ordered.forEach(f=>{
      const open=!f.reDate;
      h+='<div class="rounded-xl border p-3 '+(open?'bg-rose-50 border-rose-100':'bg-white')+'">'+
        '<div class="flex justify-between gap-3 flex-wrap">'+
          '<div class="min-w-0 flex-1"><div class="text-sm font-semibold text-ink-900 leading-snug">'+esc(f.title)+'</div>'+
          '<div class="text-[11px] text-slate-500 mt-1 font-mono">'+fmtYmd(f.date)+' 無法決標 · 案號 '+esc(f.job)+'</div></div>'+
          '<div class="text-[11px] '+(open?'text-rose-700 font-semibold':'text-slate-500')+' whitespace-nowrap self-center">'+
            (open?'尚未重招':('已於 '+fmtYmd(f.reDate)+' 重招'+(f.lag!=null?('（隔 '+f.lag+' 天）'):'')))+
          '</div>'+
        '</div></div>';
    });
    h+='</div><p class="text-[11px] text-slate-400 mt-2 leading-relaxed">「尚未重招」是指這個標案系列在流標日之後還沒有出現新的招標公告——通常代表機關會再來一次，也常伴隨放寬資格或調整預算。名稱比對用的是正規化後的系列鍵，改名重招可能認不出來。</p></div>';
  }

  return h+'</div>';
}

function tally(recs,fn){ const m={}; recs.forEach(r=>{ const k=fn(r); if(!k) return; m[k]=(m[k]||0)+1; });
  return Object.entries(m).sort((a,b)=>b[1]-a[1]); }
function yearTally(recs){ const m={}; recs.forEach(r=>{ const d=recDate(r); if(!d) return; const y=d.getFullYear(); m[y]=(m[y]||0)+1; });
  return Object.entries(m).sort((a,b)=>b[0]-a[0]).slice(0,10); }
function distBlock(title,rows,limit){
  if(!rows.length) return '';
  const top=rows.slice(0,limit), max=Math.max.apply(null,top.map(r=>r[1]))||1;
  let h='<div class="mt-4"><div class="text-xs font-semibold text-slate-600 mb-2">'+esc(title)+'</div>';
  top.forEach(([k,v])=>{ h+='<div class="mb-2"><div class="flex justify-between text-[11px]"><span class="text-slate-600 truncate pr-2">'+esc(k)+'</span><span class="font-bold text-ink-900">'+fmtNum(v)+'</span></div>'+
    '<div class="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden"><div class="h-full bg-jade-500 rounded-full" style="width:'+(v/max*100)+'%"></div></div></div>'; });
  return h+'</div>';
}
function renderVendorRank(){
  const box=document.getElementById('vendorRank'); if(!box) return;
  let vs=vendorStats(unitPeriodRecords());
  if(unitVendorQ) vs=vs.filter(v=>v.name.indexOf(unitVendorQ)>=0);
  vs.sort((a,b)=> unitSort==='amount' ? (b.amount-a.amount)||(b.count-a.count) : (b.count-a.count)||(b.amount-a.amount));
  if(!vs.length){ box.innerHTML='<p class="text-xs text-slate-400 py-6 text-center">'+(unitVendorQ?'沒有符合的廠商。':'這個期間沒有決標紀錄。')+'</p>'; return; }
  const con=concentration(vs);
  const show=vs.slice(0,50);
  let h='';
  if(con && !unitVendorQ){
    const tone={jade:'bg-jade-50 border-jade-100 text-jade-700',
                amber:'bg-amber-50 border-amber-100 text-amber-700',
                rose:'bg-rose-50 border-rose-100 text-rose-700'}[con.tone];
    h+='<div class="rounded-xl border '+tone+' p-3 mb-3">'+
      '<div class="flex items-center justify-between flex-wrap gap-2">'+
        '<div class="text-[11px] font-bold">市場集中度：'+con.band+'</div>'+
        '<div class="text-[11px] opacity-70">HHI '+fmtNum(con.hhi)+'（&lt;1500 分散 · 1500–2500 中度 · &gt;2500 高度）</div>'+
      '</div>'+
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2.5">'+
        '<div><div class="text-lg font-bold">'+pct1(con.cr1)+'</div><div class="text-[10px] opacity-70">最大一家佔比</div></div>'+
        '<div><div class="text-lg font-bold">'+pct1(con.cr3)+'</div><div class="text-[10px] opacity-70">前三大佔比</div></div>'+
        '<div><div class="text-lg font-bold">'+pct1(con.cr5)+'</div><div class="text-[10px] opacity-70">前五大佔比</div></div>'+
        '<div><div class="text-lg font-bold">'+fmtNum(con.vendors)+'</div><div class="text-[10px] opacity-70">得標廠商家數</div></div>'+
      '</div>'+
      '<p class="text-[10px] opacity-60 mt-2 leading-relaxed">以<strong>件數</strong>佔比計算（不是金額，金額多半沒補齊）。共同投標／複數決標的案子會同時計入每一家，件數總和 '+fmtNum(con.totalCount)+' 因此大於案件數，集中度會被略微低估。</p>'+
      '</div>';
  }
  h+='<div class="flex text-[11px] text-slate-400 px-2 pb-2 border-b"><span class="w-8">排名</span><span class="flex-1">廠商</span><span class="w-16 text-right">件數</span><span class="w-24 text-right">決標金額</span><span class="w-4"></span></div>';
  show.forEach((v,i)=>{
    h+='<div onclick="openVendorCases('+jsArg(v.name)+')" class="flex items-center px-2 py-2.5 border-b last:border-0 cursor-pointer hover:bg-slate-50 text-sm">'+
      '<span class="w-8 text-xs font-mono text-slate-400">'+String(i+1).padStart(2,'0')+'</span>'+
      '<span class="flex-1 min-w-0 truncate pr-2 text-ink-900">'+esc(vendorShort(v.name))+(v.multi?' <span class="tag bg-slate-100 text-slate-600">共同</span>':'')+'</span>'+
      '<span class="w-16 text-right font-semibold">'+v.count+' 件</span>'+
      '<span class="w-24 text-right font-semibold text-jade-700">'+(v.known?fmtWan(v.amount):'<span class="text-slate-300">未補齊</span>')+'</span>'+
      '<i class="fa-solid fa-chevron-right text-slate-300 w-4 text-right text-xs"></i></div>';
  });
  if(vs.length>show.length) h+='<div class="text-[11px] text-slate-400 text-center pt-3">另有 '+(vs.length-show.length)+' 家未顯示，用上面的搜尋框縮小範圍。</div>';
  box.innerHTML=h;
}
function listUnitRecords(){
  if(!unitData) return;
  go('tenders');
  document.getElementById('searchMeta').textContent=unitData.unit_name+'：全期間共 '+fmtNum(unitData.records.length)+' 則公告（顯示前 200 則）';
  const list=document.getElementById('searchResults'); list.innerHTML=''; document.getElementById('searchPager').innerHTML='';
  unitData.records.slice(0,200).forEach(x=>list.appendChild(tenderCard({...x,unit_name:x.unit_name||unitData.unit_name})));
}

