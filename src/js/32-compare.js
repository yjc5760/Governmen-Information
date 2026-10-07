/* ================= 標案比較 ================= */
const CMP_MAX = 6;
const CMP_SKIP = ['type','url','pkPmsMain','fetched_at'];
const CMP_PRESETS = {
  basic: { label:'基本', pats:['招標方式','決標方式','標的分類','採購性質','預算金額','截止投標','履約期限','履約地點','採購金額級距'] },
  gate:  { label:'投標門檻', pats:['是否屬統包','技師簽證','押標金','履約保證金','廠商資格摘要','基本資格','決標方式','是否採行協商措施','是否訂有底價','是否複數決標','是否屬特殊採購','政府採購協定','是否屬共同供應契約','投標文字','是否提供電子投標'] },
  money: { label:'金額與期限', pats:['預算金額','採購金額級距','是否訂有底價','押標金','履約保證金','履約期限','截止投標','開標時間','後續擴充','物價指數'] },
  all:   { label:'全部欄位', pats:null }
};
let cmpView = LS.get(K.CMPVIEW, { preset:'basic', diffOnly:false, custom:null, calc:true });
function saveCmpView(){ LS.set(K.CMPVIEW,cmpView); }
function setCmpPreset(k){ cmpView.preset=k; cmpView.custom=null; saveCmpView(); renderCompare(); }
function toggleCmpDiff(){ cmpView.diffOnly=!cmpView.diffOnly; saveCmpView(); renderCompare(); }
function toggleCmpCalc(){ cmpView.calc=!cmpView.calc; saveCmpView(); renderCompare(); }
function toggleCmpField(k,on){
  if(!cmpView.custom) cmpView.custom=cmpFields().slice();
  const i=cmpView.custom.indexOf(k);
  if(on && i<0) cmpView.custom.push(k);
  if(!on && i>=0) cmpView.custom.splice(i,1);
  saveCmpView(); renderCompare();
}
function cmpAllKeys(){
  const set=new Set();
  compareList.forEach(x=>Object.keys(x.detail||{}).forEach(k=>{ if(CMP_SKIP.indexOf(k)<0) set.add(k); }));
  return [...set];
}
function cmpFields(){
  const keys=cmpAllKeys();
  if(cmpView.custom) return cmpView.custom.filter(k=>keys.indexOf(k)>=0);
  const pats=(CMP_PRESETS[cmpView.preset]||CMP_PRESETS.basic).pats;
  if(!pats) return keys;
  return keys.filter(k=>pats.some(pt=>k.indexOf(pt)>=0));
}
function cmpLabel(k){ const i=k.lastIndexOf(':'); return i>=0?k.slice(i+1):k; }
function cmpSection(k){ const i=k.indexOf(':'); return i>=0?k.slice(0,i):'其他'; }

/* 算出來的比較列：原始公告沒有這些欄位，但比較時最需要 */
function cmpCalcRows(){
  const pubOf=x=>{ const d=String(x.date||''); return d.length===8?parseTwDate(d.slice(0,4)+'/'+d.slice(4,6)+'/'+d.slice(6)):null; };
  const budOf=x=>parseMoney(x.budget)||pickMoney(x.detail,['預算金額'])||null;
  const awOf =x=>{ const c=amountCache[x.unit_id+'|'+x.job_number]; return (c&&c.a)||null; };
  return [
    ['剩餘天數', x=>{ const l=daysLeft(parseTwDate(x.deadline)); return l==null?'':(l>=0?l+' 天':'已截止'); }],
    ['等標期',   x=>{ const p=pubOf(x), d=parseTwDate(x.deadline); return (p&&d)?Math.ceil((d-p)/86400000)+' 天':''; }],
    ['預算金額（數值）', x=>{ const b=budOf(x); return b?'$'+fmtNum(b):''; }],
    ['決標金額', x=>{ const a=awOf(x); return a?'$'+fmtNum(a):''; }],
    ['決標／預算比', x=>{ const a=awOf(x), b=budOf(x); return (a&&b)?(a/b*100).toFixed(1)+'%':''; }]
  ];
}

function cmpRows(){
  const rows=[];
  rows.push(['機關', x=>x.unit_name]);
  rows.push(['案號', x=>x.job_number]);
  rows.push(['公告類型', x=>x.type]);
  rows.push(['公告日', x=>fmtYmd(x.date)]);
  rows.push(['投標截止', x=>x.deadline]);
  if(cmpView.calc) cmpCalcRows().forEach(r=>rows.push(r));
  cmpFields().forEach(k=>rows.push([cmpLabel(k), x=>(x.detail||{})[k], k]));
  return rows;
}

function renderCompare(){
  const bar=document.getElementById('compareToolbar');
  const box=document.getElementById('compareTable');
  if(!compareList.length){
    bar.innerHTML='';
    box.innerHTML='<p class="p-6 text-center text-sm text-slate-400">還沒有加入比較的標案。在標案詳情按「加入比較」，最多 '+CMP_MAX+' 案。</p>';
    return;
  }

  const keys=cmpAllKeys();
  const rows=cmpRows();
  // 先算出每列的值，判斷有無差異
  const built=rows.map(([label,fn,key])=>{
    const vals=compareList.map(x=>{ let v=''; try{ v=fn(x)||''; }catch(e){ v=''; } return String(v); });
    const nonEmpty=vals.filter(Boolean);
    const same=nonEmpty.length>1 && nonEmpty.every(v=>v===nonEmpty[0]) && nonEmpty.length===vals.length;
    return { label, key, vals, same, empty:!nonEmpty.length };
  }).filter(r=>!r.empty);
  const shown=cmpView.diffOnly ? built.filter(r=>!r.same) : built;
  const diffCount=built.filter(r=>!r.same).length;

  /* --- 工具列 --- */
  const pbtn=(k,l)=>'<button onclick="setCmpPreset(\''+k+'\')" class="px-3 py-1.5 text-xs rounded-lg '+
    ((!cmpView.custom&&cmpView.preset===k)?'bg-jade-600 text-white font-semibold':'bg-white border hover:bg-slate-50')+'">'+l+'</button>';
  let t='<div class="card p-4 mb-4 space-y-3">'+
    '<div class="flex items-center justify-between flex-wrap gap-2">'+
      '<div><div class="eyebrow">COMPARE</div><h3 class="font-bold text-ink-900 mt-1">'+compareList.length+' 案並排 · '+built.length+' 個欄位，其中 '+diffCount+' 個有差異</h3></div>'+
      '<div class="flex gap-2 flex-wrap">'+
        '<button onclick="exportCompareCsv()" class="px-3 py-1.5 text-xs border rounded-lg hover:bg-slate-50"><i class="fa-solid fa-file-csv mr-1"></i>匯出 CSV</button>'+
        '<button onclick="clearCompare()" class="px-3 py-1.5 text-xs border rounded-lg hover:bg-rose-50 text-rose-600">全部清空</button>'+
      '</div>'+
    '</div>'+
    '<div class="flex items-center gap-2 flex-wrap">'+
      '<span class="text-[11px] text-slate-500 mr-1">欄位組合</span>'+
      pbtn('basic',CMP_PRESETS.basic.label)+pbtn('gate',CMP_PRESETS.gate.label)+pbtn('money',CMP_PRESETS.money.label)+pbtn('all',CMP_PRESETS.all.label)+
      (cmpView.custom?'<span class="tag bg-jade-100 text-jade-700">自選 '+cmpView.custom.length+' 欄</span>':'')+
      '<label class="flex items-center gap-1.5 text-xs ml-2 cursor-pointer select-none"><input type="checkbox" '+(cmpView.diffOnly?'checked':'')+' onchange="toggleCmpDiff()">只看有差異的列</label>'+
      '<label class="flex items-center gap-1.5 text-xs cursor-pointer select-none"><input type="checkbox" '+(cmpView.calc?'checked':'')+' onchange="toggleCmpCalc()">含計算欄位</label>'+
    '</div>';

  // 欄位自選（依公告的分區分組）
  const sections={};
  keys.forEach(k=>{ const g=cmpSection(k); (sections[g]=sections[g]||[]).push(k); });
  const active=cmpFields();
  t+='<details class="border rounded-xl"><summary class="p-2.5 text-xs font-semibold cursor-pointer text-slate-600">自選欄位（可用的 '+keys.length+' 個，目前選了 '+active.length+' 個）</summary>'+
     '<div class="border-t p-3 max-h-72 overflow-y-auto space-y-3">';
  Object.keys(sections).forEach(g=>{
    t+='<div><div class="text-[11px] font-bold text-jade-700 mb-1.5">'+esc(g)+'</div><div class="grid sm:grid-cols-2 gap-1">';
    sections[g].forEach(k=>{
      const on=active.indexOf(k)>=0;
      t+='<label class="flex items-start gap-1.5 text-[11px] cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">'+
        '<input type="checkbox" class="mt-0.5" '+(on?'checked':'')+' onchange="toggleCmpField('+jsArg(k)+',this.checked)">'+
        '<span class="'+(on?'text-ink-900 font-medium':'text-slate-500')+'">'+esc(cmpLabel(k))+'</span></label>';
    });
    t+='</div></div>';
  });
  t+='</div></details></div>';
  bar.innerHTML=t;

  /* --- 表格 --- */
  if(!shown.length){
    box.innerHTML='<p class="p-6 text-center text-sm text-slate-400">'+(cmpView.diffOnly?'選到的欄位在這幾案完全相同，沒有差異可看。':'選到的欄位在這幾案都是空的。')+'</p>';
    return;
  }
  let h='<table class="w-full text-xs border-collapse min-w-[620px]"><thead><tr>'+
    '<th class="p-2 text-left bg-slate-50 border sticky left-0 z-10">項目</th>';
  compareList.forEach((x,i)=>{
    h+='<th class="p-2 text-left border bg-slate-50 align-top min-w-[160px]">'+
      '<div class="text-[10px] text-jade-700 font-semibold truncate">'+esc(x.unit_name)+'</div>'+
      '<div class="font-bold text-ink-900 leading-snug mt-0.5">'+esc(x.title)+'</div>'+
      '<button onclick="removeCompare('+i+')" class="text-[11px] text-rose-500 mt-1 hover:underline">移除</button></th>';
  });
  h+='</tr></thead><tbody>';
  shown.forEach(r=>{
    h+='<tr class="'+(r.same?'':'bg-amber-50/40')+'">'+
      '<td class="p-2 border bg-slate-50 font-semibold sticky left-0 z-10 align-top">'+esc(r.label)+
      (r.same?'':' <i class="fa-solid fa-not-equal text-amber-500 text-[9px] ml-0.5" title="各案不同"></i>')+'</td>';
    r.vals.forEach(v=>{ h+='<td class="p-2 border align-top '+(r.same?'text-slate-500':'text-ink-900 font-medium')+' whitespace-pre-wrap break-words">'+esc(v||'—')+'</td>'; });
    h+='</tr>';
  });
  h+='</tbody></table>'+
     '<p class="text-[11px] text-slate-400 mt-3 leading-relaxed">淡黃底、標 <i class="fa-solid fa-not-equal text-amber-500"></i> 的列代表各案值不同，是實際要比的地方；全部相同的列已淡化。「決標金額」與「決標／預算比」來自本機的決標金額快取，沒補齊的案子會是空的——到機關洞察按「補齊決標金額」。</p>';
  box.innerHTML=h;
}

function clearCompare(){
  if(!compareList.length) return;
  if(!confirm('清空比較清單？')) return;
  compareList=[]; LS.set(K.COMPARE,compareList); updateCounters(); renderCompare();
}
function exportCompareCsv(){
  const rows=cmpRows();
  const head=['項目'].concat(compareList.map(x=>x.unit_name+' / '+x.title));
  const lines=[head];
  rows.forEach(([label,fn])=>{
    const vals=compareList.map(x=>{ let v=''; try{ v=fn(x)||''; }catch(e){ v=''; } return String(v); });
    if(vals.some(Boolean)) lines.push([label].concat(vals));
  });
  const q=v=>'"'+String(v).replace(/"/g,'""').replace(/\r?\n/g,' ')+'"';
  const csv='\ufeff'+lines.map(r=>r.map(q).join(',')).join('\r\n');
  dl(new Blob([csv],{type:'text/csv;charset=utf-8'}),'標案比較_'+ymdDash(new Date())+'.csv');
  toast('已匯出 '+(lines.length-1)+' 列','success');
}
function removeCompare(i){ compareList.splice(i,1); LS.set(K.COMPARE,compareList); renderCompare(); updateCounters(); }

function dl(blob,name){ const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(u),1000); }
