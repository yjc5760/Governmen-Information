/* ================= 市場與廠商 ================= */
function renderMarketRanking(){
  const box=document.getElementById('marketRanking');
  const counts={};
  cacheRecords().forEach(r=>(r.c||[]).forEach(n=>{ counts[n]=(counts[n]||0)+1; }));
  const list=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,20);
  if(!list.length){ box.innerHTML='<p class="text-xs text-slate-400">快取裡還沒有決標資料。先到總覽同步，或直接用上面的查詢。</p>'; return; }
  box.innerHTML='';
  list.forEach(([name,c],i)=>{
    const el=document.createElement('div');
    el.className='flex items-center gap-3 py-1.5 cursor-pointer hover:bg-slate-50 rounded-lg px-2';
    el.onclick=()=>{ document.getElementById('companyQuery').value=name; doCompanySearch(); };
    el.innerHTML='<span class="w-6 text-xs text-slate-400 font-mono">'+(i+1)+'</span><span class="flex-1 truncate">'+esc(name)+'</span><span class="text-xs font-bold text-jade-700">'+c+'</span>';
    box.appendChild(el);
  });
}
/* ================= 對手常駐追蹤與廠商對比 =================
   searchbycompanyname 每頁 100 筆（中興工程顧問實測 4,681 筆、47 頁；
   泰興工程顧問 553 筆、6 頁），所以不可能抓全。這裡預設每家抓 3 頁（300 筆），
   目的是看「最近在幹什麼」，不是統計全歷史——所有數字都標明是抓取範圍內的。
   注意 brief.companies.names 是該案「所有投標廠商」，得標落標都在裡面，
   要靠 name_key 分（見 splitCompanies）。分完才有辦法區分
   「一起得標的夥伴」和「同場競標的對手」——這兩件事以前被混成一項。 */
const RIVAL_PER_PAGE = 100;   // 實測值，不是 20
const RIVAL_PAGE_GAP = 400;
const VSNAP_MAX = 20;
const RIVAL_SUGGEST = ['中興工程顧問','台灣世曦工程顧問','亞新工程顧問','中鼎工程','泰興工程顧問','聯邦工程顧問'];

function sameVendor(a,b){
  const x=vendorShort(String(a||'')).replace(/[\s()（）]/g,'');
  const y=vendorShort(String(b||'')).replace(/[\s()（）]/g,'');
  if(!x||!y) return false;
  return x===y || x.indexOf(y)>=0 || y.indexOf(x)>=0;
}


/* 抓取深度可以設定：0 代表「抓到底」，其餘是頁數。每頁 100 筆。
   實測成本（頁間 400ms）：
     吉興 284 筆 / 3 頁      亞新 1,507 筆 / 16 頁 ≈ 15 秒
     泰興 553 筆 / 6 頁      中興 5,482 筆 / 55 頁 ≈ 55 秒
   所以多數顧問公司「抓到底」只要十幾秒，原本寫死 3 頁其實過度保守
   （那是從我誤以為每頁 20 筆、以及 listbyunit 會斷線的經驗延伸來的，
   但 searchbycompanyname 每頁只約 127KB，不是 listbyunit 的 630KB）。 */
const RIVAL_PAGE_CAP = 60;                 // 抓到底的硬上限，約 6,000 筆
const RIVAL_RETRY = [1200,3000,7000];      // 單頁失敗或回空值的退避重試
const VPAGE_CHOICES = [[3,'3 頁'],[6,'6 頁'],[12,'12 頁'],[0,'抓到底']];

function rivalLimit(){
  const v=parseInt(vendorPages,10);
  return (v>0 ? Math.min(v,RIVAL_PAGE_CAP) : RIVAL_PAGE_CAP);
}
function setVendorPages(v){
  vendorPages=parseInt(v,10)||0;
  LS.set(K.VPAGES,vendorPages,'抓取深度');
  renderRivals();
}
/* 抓 n 頁大約要幾秒：每頁一次請求約 0.6 秒，加上頁間間隔 */
function rivalEta(pages){ return Math.max(1, Math.round(pages*(0.6+RIVAL_PAGE_GAP/1000))); }

async function fetchVendorPage(name,page,onRetry){
  let last;
  for(let i=0;i<=RIVAL_RETRY.length;i++){
    if(i){ if(onRetry) onRetry(i,RIVAL_RETRY[i-1]); await new Promise(s=>setTimeout(s,RIVAL_RETRY[i-1])); }
    try{ return await api('/api/searchbycompanyname?query='+encodeURIComponent(name)+'&page='+page); }
    catch(e){ last=e; }
  }
  throw last;
}

async function fetchVendor(name,pages,say){
  const recs=[];
  let total=null, tp=null, fetched=0, stop={reason:'done'};
  const limit=Math.min(pages||RIVAL_PAGE_CAP, RIVAL_PAGE_CAP);
  for(let p=1;p<=limit;p++){
    if(say) say('抓取 '+name+'：第 '+p+(tp?(' / '+tp):'')+' 頁…已取得 '+fmtNum(recs.length)+' 筆');
    let r;
    try{
      r=await fetchVendorPage(name,p,(i,ms)=>{ if(say) say('抓取 '+name+'：第 '+p+' 頁失敗，'+(ms/1000)+' 秒後重試（第 '+i+' 次）'); });
    }catch(e){
      stop={reason:'fail', page:p, msg:e.message};   // 保留前面抓到的，不整批丟掉
      break;
    }
    if(r.total_records!=null) total=r.total_records;
    tp=r.total_pages||tp;
    let rows=r.records||[];

    /* ⚠ 空頁不等於抓完。實測連續抓的時候偶爾會回一個空的 records
       （中興第 9 頁、亞新第 16 頁都遇過），單獨重抓同一頁又有 100 筆。
       原本寫成 `if(!rows.length) break;`，於是默默少抓整整一頁，
       畫面上還顯示成正常結束——這是「靜默截斷」在新的地方重演。
       所以只要 total_pages 說後面還有，就先重試，確認過才認定是結束。 */
    if(!rows.length && tp && p<tp){
      try{
        const r2=await fetchVendorPage(name,p,(i,ms)=>{ if(say) say('抓取 '+name+'：第 '+p+' 頁回空值，'+(ms/1000)+' 秒後重試'); });
        rows=r2.records||[];
      }catch(e){}
      if(!rows.length){ stop={reason:'empty', page:p}; break; }
    }

    rows.forEach(x=>{
      noteAgency(x.unit_id,x.unit_name);
      const cos=splitCompanies((x.brief&&x.brief.companies&&x.brief.companies.names)||[],
                               x.brief&&x.brief.companies&&x.brief.companies.name_key);
      recs.push({ u:x.unit_id, n:x.unit_name, d:String(x.date||''), j:x.job_number,
                  t:(x.brief&&x.brief.type)||'', ti:(x.brief&&x.brief.title)||'',
                  c:cos.map(o=>o.name),                     // 所有投標廠商
                  w:cos.filter(o=>o.won).map(o=>o.name) }); // 其中真正得標的
    });
    fetched=p;
    if(!rows.length) break;                 // tp 也說到底了
    if(tp && p>=tp) break;                  // 抓完最後一頁
    await new Promise(s=>setTimeout(s,RIVAL_PAGE_GAP));
  }
  if(stop.reason==='done' && tp && fetched<tp) stop={reason:'cap', page:fetched};
  persistAgencyIndex();
  return { recs, total, tp, pages:fetched, stop };
}

/* 抓取狀況一句話，講清楚「為什麼只有這麼多」 */
function vsnapCoverage(sn){
  if(!sn) return null;
  const st=sn.stop||{reason:'done'};
  const ratio=(sn.total>0)? sn.fetched/sn.total : null;
  const msg =
    st.reason==='done' ? '已抓完官方全部公告'
  : st.reason==='cap'  ? '到達設定的頁數上限，後面還有沒抓'
  : st.reason==='fail' ? ('第 '+st.page+' 頁重試多次仍失敗，後面沒抓到')
  : st.reason==='empty'? ('第 '+st.page+' 頁重試後仍是空的，後面沒抓到')
  : '';
  return { complete: st.reason==='done', ratio, msg, reason:st.reason };
}

/* 一則決標公告裡這家廠商可能是得標的，也可能只是落標的陪標廠商。
   分開之後才有三件不同的事可講：
     awards   實際得標件數（以前把落標也算進來）
     partners 同一案「一起得標」的別家＝真正的共同投標夥伴
     rivals   同一案出現、但不是一起得標的別家＝同場競標的對手
   以前只有一項 partners，而且吃的是全部廠商名單，所以把對手當成了夥伴。 */
function buildVendorSnap(name,res){
  const awards=res.recs.filter(r=>isAward(r.t) && !isAmendment(r.ti));
  const wonHere=r=>(r.w||[]).some(o=>sameVendor(o,name));
  const won=awards.filter(wonHere);
  const lost=awards.filter(r=>!wonHere(r) && (r.c||[]).some(o=>sameVendor(o,name)));
  const agencies={}, partners={}, rivals={}, years={};
  const bump=(obj,r,list,skipWinners)=>{
    const seen={};
    (list||[]).forEach(o=>{
      if(sameVendor(o,name)) return;                                  // 排除自己
      if(skipWinners && (r.w||[]).some(w=>sameVendor(w,o))) return;   // 已算進夥伴
      const k=vendorShort(o); if(!k||seen[k]) return; seen[k]=1;
      obj[k]=(obj[k]||0)+1;
    });
  };
  won.forEach(r=>{
    if(r.n) agencies[r.n]=(agencies[r.n]||0)+1;
    const y=r.d.slice(0,4); if(y) years[y]=(years[y]||0)+1;
    bump(partners, r, r.w, false);
  });
  awards.forEach(r=>bump(rivals, r, r.c, wonHere(r)));
  const top=(obj,k)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,k);
  return {
    name, at:Date.now(), total:res.total, tp:res.tp, pages:res.pages,
    stop:res.stop||{reason:'done'},
    fetched:res.recs.length, awards:won.length, lostCases:lost.length,
    corrections:res.recs.filter(r=>String(r.t).indexOf('更正')>=0).length,
    agencies:top(agencies,30), partners:top(partners,15), rivals:top(rivals,15),
    years:Object.entries(years).sort(),
    recent:won.slice(0,8).map(r=>({d:r.d,n:r.n,ti:r.ti}))
  };
}

function persistVendorSnaps(){
  const names=Object.keys(vendorSnaps);
  if(names.length>VSNAP_MAX){
    names.sort((a,b)=>vendorSnaps[a].at-vendorSnaps[b].at)
         .slice(0,names.length-VSNAP_MAX).forEach(x=>delete vendorSnaps[x]);
  }
  LS.set(K.VSNAP,vendorSnaps);
}

function addRival(name){
  const v=String(name!=null?name:document.getElementById('rivalInput').value||'').trim();
  if(!v) return;
  if(rivals.some(x=>sameVendor(x,v))){ toast('已經在追蹤清單裡','info'); return; }
  rivals.push(v);
  if(!LS.set(K.RIVALS,rivals,'對手追蹤清單')){ rivals.pop(); renderRivals(); return; }
  const inp=document.getElementById('rivalInput'); if(inp) inp.value='';
  renderRivals();
  refreshOneRival(v);
}
function removeRival(name){
  rivals=rivals.filter(x=>x!==name); LS.set(K.RIVALS,rivals);
  delete vendorSnaps[name]; persistVendorSnaps();
  vsnapSel=vsnapSel.filter(x=>x!==name); LS.set(K.VSNAPSEL,vsnapSel);
  renderRivals(); renderVendorCompare();
}
async function refreshOneRival(name){
  const box=document.getElementById('rivalStatus');
  const say=t=>{ if(box) box.innerHTML='<i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i>'+esc(t); };
  try{
    const res=await fetchVendor(name,rivalLimit(),say);
    vendorSnaps[name]=buildVendorSnap(name,res); persistVendorSnaps();
    if(box) box.innerHTML='';
    renderRivals(); renderVendorCompare();
    toast(name+'：抓到 '+fmtNum(res.recs.length)+' 筆（官方共 '+fmtNum(res.total)+' 筆）','success');
  }catch(e){
    if(box) box.innerHTML='<span class="text-rose-600">'+esc(name)+' 更新失敗：'+esc(e.message)+'</span>';
  }
}
async function refreshAllRivals(){
  if(!rivals.length){ toast('追蹤清單是空的','warning'); return; }
  const box=document.getElementById('rivalStatus');
  const say=t=>{ if(box) box.innerHTML='<i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i>'+esc(t); };
  let ok=0, fail=[];
  for(const name of rivals){
    try{ const res=await fetchVendor(name,rivalLimit(),say);
      vendorSnaps[name]=buildVendorSnap(name,res); ok++; }
    catch(e){ fail.push(name); }
    await new Promise(s=>setTimeout(s,RIVAL_PAGE_GAP));
  }
  persistVendorSnaps();
  if(box) box.innerHTML='';
  renderRivals(); renderVendorCompare();
  toast('更新完成：'+ok+' 家'+(fail.length?('，'+fail.length+' 家失敗（'+fail.join('、')+'）'):''), fail.length?'warning':'success');
}
function toggleVsnapSel(name,on){
  const i=vsnapSel.indexOf(name);
  if(on && i<0){ if(vsnapSel.length>=4){ toast('一次最多對比 4 家','warning'); renderVendorCompare(); return; } vsnapSel.push(name); }
  if(!on && i>=0) vsnapSel.splice(i,1);
  LS.set(K.VSNAPSEL,vsnapSel); renderVendorCompare();
}

function renderRivals(){
  const box=document.getElementById('rivalPanel'); if(!box) return;
  let h='<div class="card p-5">'+
    '<div class="eyebrow">RIVAL WATCH</div>'+
    '<h3 class="font-bold text-ink-900 mt-1">對手常駐追蹤</h3>'+
    '<p class="text-xs text-slate-500 mt-1">建一份對手清單，一鍵看它們得標什麼、在哪些機關、跟誰一起得標、跟誰同場競標。</p>'+
    '<div class="mt-2.5 flex flex-wrap items-center gap-2 text-xs bg-slate-50 border rounded-xl p-2.5">'+
      '<i class="fa-solid fa-layer-group text-slate-400"></i><span class="text-slate-600">抓取深度</span>'+
      VPAGE_CHOICES.map(([v,label])=>'<button onclick="setVendorPages('+v+')" class="px-2.5 py-1 rounded-lg '+
        ((parseInt(vendorPages,10)||0)===v?'bg-ink-800 text-white font-semibold':'bg-white border hover:bg-slate-50')+'">'+label+'</button>').join('')+
      '<span class="text-[11px] text-slate-400">每頁 '+RIVAL_PER_PAGE+' 筆'+
        ((parseInt(vendorPages,10)||0)>0
          ? ('，最多 '+fmtNum(rivalLimit()*RIVAL_PER_PAGE)+' 筆／家，約 '+rivalEta(rivalLimit())+' 秒')
          : ('，抓到官方全部為止（上限 '+RIVAL_PAGE_CAP+' 頁；中興這種 55 頁的約 '+rivalEta(55)+' 秒）'))+'</span>'+
    '</div>'+
    '<div class="flex gap-2 mt-3">'+
      '<input id="rivalInput" type="text" placeholder="輸入廠商名稱，例如：中興工程顧問" class="flex-1 px-3 py-2 border rounded-xl text-sm">'+
      '<button onclick="addRival()" class="px-4 py-2 bg-jade-600 hover:bg-jade-700 text-white rounded-xl text-sm font-medium">加入</button>'+
      (rivals.length?'<button onclick="refreshAllRivals()" class="px-3 py-2 border rounded-xl text-xs hover:bg-slate-50 whitespace-nowrap"><i class="fa-solid fa-rotate mr-1"></i>全部更新</button>':'')+
    '</div>';

  const notYet=RIVAL_SUGGEST.filter(x=>!rivals.some(r=>sameVendor(r,x)));
  if(notYet.length){
    h+='<div class="mt-2.5 flex flex-wrap gap-1.5 items-center">'+
      '<span class="text-[11px] text-slate-400">常見工程顧問：</span>'+
      notYet.map(x=>'<button onclick="addRival('+jsArg(x)+')" class="tag bg-slate-100 hover:bg-jade-100 text-slate-600 hover:text-jade-700">+ '+esc(x)+'</button>').join('')+
      '</div>';
  }
  h+='<div id="rivalStatus" class="text-xs text-jade-700 mt-2"></div>';

  if(!rivals.length){
    return void(box.innerHTML=h+'<p class="text-xs text-slate-400 mt-3">還沒有追蹤任何對手。加入後會自動去抓它最近的得標紀錄。</p></div>');
  }

  h+='<div class="mt-4 space-y-3">';
  rivals.forEach(name=>{
    const sn=vendorSnaps[name];
    h+='<div class="rounded-xl border p-3">'+
      '<div class="flex items-start justify-between gap-2 flex-wrap">'+
        '<div class="min-w-0"><div class="text-sm font-bold text-ink-900">'+esc(name)+'</div>'+
        (sn?(function(){ const cv=vsnapCoverage(sn);
             return '<div class="text-[11px] text-slate-500 mt-0.5">官方共 '+fmtNum(sn.total)+' 筆'+
             (sn.tp?('（'+sn.tp+' 頁）'):'')+' · 已抓 '+fmtNum(sn.fetched)+' 筆'+
             (cv&&cv.ratio!=null?('（'+Math.round(cv.ratio*100)+'%）'):'')+
             ' · 得標 '+fmtNum(sn.awards)+' 件'+
             (sn.lostCases?(' · 落標 '+fmtNum(sn.lostCases)+' 件'):'')+' · 快照 '+
             new Date(sn.at).toLocaleDateString('zh-TW')+'</div>'+
             (cv&&!cv.complete?('<div class="text-[11px] text-amber-700 mt-0.5"><i class="fa-solid fa-triangle-exclamation mr-1"></i>'+esc(cv.msg)+'</div>'):''); })()
            :'<div class="text-[11px] text-slate-400 mt-0.5">還沒抓過</div>')+
        '</div>'+
        '<div class="flex gap-1.5 flex-shrink-0">'+
          '<button onclick="refreshOneRival('+jsArg(name)+')" class="px-2.5 py-1.5 text-[11px] border rounded-lg hover:bg-slate-50">更新</button>'+
          '<button onclick="removeRival('+jsArg(name)+')" class="px-2 py-1.5 text-[11px] text-slate-400 hover:text-rose-500">移除</button>'+
        '</div>'+
      '</div>';
    if(sn){
      if(sn.agencies.length){
        h+='<div class="mt-2.5 grid sm:grid-cols-2 gap-3">'+
          '<div><div class="text-[11px] font-semibold text-slate-600 mb-1">主要機關</div><div class="space-y-0.5">'+
          sn.agencies.slice(0,4).map(([a,c])=>'<div class="flex justify-between text-[11px] gap-2"><span class="truncate text-slate-700">'+esc(vendorShort(a))+'</span><span class="font-bold text-jade-700 flex-shrink-0">'+c+'</span></div>').join('')+
          '</div></div>'+
          '<div><div class="text-[11px] font-semibold text-slate-600 mb-1">共同得標夥伴 <span class="font-normal text-slate-400">同案一起得標</span></div>'+
          (sn.partners.length?('<div class="space-y-0.5">'+sn.partners.slice(0,4).map(([a,c])=>'<div class="flex justify-between text-[11px] gap-2"><span class="truncate text-slate-700">'+esc(a)+'</span><span class="font-bold text-slate-500 flex-shrink-0">'+c+'</span></div>').join('')+'</div>')
                            :'<div class="text-[11px] text-slate-400">抓取範圍內沒有共同得標</div>')+
          '</div></div>'+
          '<div class="mt-2"><div class="text-[11px] font-semibold text-slate-600 mb-1">常同場競標對手 <span class="font-normal text-slate-400">同案出現但不是一起得標</span></div>'+
          ((sn.rivals&&sn.rivals.length)?('<div class="grid sm:grid-cols-2 gap-x-3 gap-y-0.5">'+sn.rivals.slice(0,6).map(([a,c])=>'<div class="flex justify-between text-[11px] gap-2"><span class="truncate text-slate-700">'+esc(a)+'</span><span class="font-bold text-rose-500 flex-shrink-0">'+c+'</span></div>').join('')+'</div>')
                            :'<div class="text-[11px] text-slate-400">抓取範圍內沒有同場競標的別家</div>')+
          '</div>';
      }
      if(sn.recent.length){
        h+='<details class="mt-2.5"><summary class="text-[11px] font-semibold text-slate-600 cursor-pointer">最近得標 '+sn.recent.length+' 筆</summary>'+
          '<div class="mt-1.5 space-y-1.5">'+
          sn.recent.map(r=>'<div class="text-[11px] border-l-2 border-jade-200 pl-2"><div class="text-ink-900 leading-snug">'+esc(r.ti)+'</div>'+
            '<div class="text-slate-400 font-mono">'+fmtYmd(r.d)+' · '+esc(vendorShort(r.n))+'</div></div>').join('')+
          '</div></details>';
      }
    }
    h+='</div>';
  });
  h+='</div>';
  box.innerHTML=h+'</div>';
}

/* 各家的涵蓋率（已抓／官方總數）差太多時，件數類欄位不可直接比——
   「已抓 300 / 553」跟「已抓 300 / 1,507」的得標件數放在一起比，
   標出誰最高只會誤導。落差超過這個倍數就停掉件數類的「最佳」標示。 */
const VSNAP_FAIR_RATIO = 1.25;
function vsnapFairness(snaps){
  const rs=snaps.map(s=>{ const c=vsnapCoverage(s); return c?c.ratio:null; }).filter(r=>r!=null&&r>0);
  if(rs.length<2) return { fair:true, lo:null, hi:null };
  const lo=Math.min.apply(null,rs), hi=Math.max.apply(null,rs);
  return { fair: (hi/lo) <= VSNAP_FAIR_RATIO, lo, hi };
}

const VSNAP_ROWS = [
  ['官方總筆數',   s=>fmtNum(s.total), 'num'],
  ['已抓取',       s=>fmtNum(s.fetched)+' 筆（'+s.pages+' / '+(s.tp||'?')+' 頁）', 'text'],
  ['涵蓋率',       s=>{ const c=vsnapCoverage(s); return (c&&c.ratio!=null)?pct1(c.ratio):'—'; }, 'num'],
  ['得標件數',     s=>fmtNum(s.awards), 'count'],
  ['落標件數',     s=>s.lostCases==null?'—':fmtNum(s.lostCases), 'count-bad'],
  ['抓取範圍內得標率', s=>{ const t=s.awards+(s.lostCases||0); return t?pct1(s.awards/t):'—'; }, 'num'],
  ['更正公告',     s=>fmtNum(s.corrections), 'count'],
  ['涉及機關數',   s=>fmtNum(s.agencies.length), 'count'],
  ['最大機關佔比', s=>{ const t=s.agencies.reduce((a,x)=>a+x[1],0); return (t&&s.agencies.length)?pct1(s.agencies[0][1]/t):'—'; }, 'high-bad'],
  ['前三大機關',   s=>s.agencies.slice(0,3).map(x=>esc(vendorShort(x[0]))+'('+x[1]+')').join('<br>')||'—', 'text'],
  ['共同得標夥伴數', s=>fmtNum(s.partners.length), 'count'],
  ['前三大夥伴',   s=>s.partners.slice(0,3).map(x=>esc(x[0])+'('+x[1]+')').join('<br>')||'—', 'text'],
  ['常同場對手',   s=>(s.rivals||[]).slice(0,3).map(x=>esc(x[0])+'('+x[1]+')').join('<br>')||'—', 'text'],
  ['公告年份',     s=>s.years.length?(s.years[0][0]+'–'+s.years[s.years.length-1][0]):'—', 'text'],
  ['快照時間',     s=>new Date(s.at).toLocaleString('zh-TW',{hour12:false}).replace(/:\d\d$/,''), 'text']
];

function renderVendorCompare(){
  const box=document.getElementById('vendorCompare'); if(!box) return;
  const names=Object.keys(vendorSnaps).sort((a,b)=>vendorSnaps[b].at-vendorSnaps[a].at);
  if(names.length<2){ box.innerHTML=''; return; }
  const sel=vsnapSel.filter(x=>vendorSnaps[x]);
  const wasOpen=!!(box.querySelector('details')||{}).open;   // 同上：勾選重繪不可把面板收起來

  let h='<details class="card p-0"'+((wasOpen||sel.length>=2)?' open':'')+'>'+
    '<summary class="p-4 cursor-pointer flex items-center justify-between flex-wrap gap-2">'+
      '<div><div class="eyebrow">VENDOR COMPARE</div>'+
      '<h3 class="font-bold text-ink-900 mt-1">廠商對比</h3>'+
      '<p class="text-xs text-slate-500 mt-0.5">勾 2–4 家並排比。目前有 '+names.length+' 份廠商快照'+(sel.length?('，已勾 '+sel.length+' 家'):'')+'。</p></div>'+
      '<i class="fa-solid fa-chevron-down text-slate-300"></i>'+
    '</summary><div class="border-t p-4 space-y-4">'+
    '<div class="flex flex-wrap gap-1.5">';
  names.forEach(nm=>{
    const on=sel.indexOf(nm)>=0;
    h+='<label class="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg border cursor-pointer '+
      (on?'bg-jade-50 border-jade-300 text-jade-800 font-semibold':'bg-white hover:bg-slate-50 text-slate-600')+'">'+
      '<input type="checkbox" '+(on?'checked':'')+' onchange="toggleVsnapSel('+jsArg(nm)+',this.checked)">'+
      '<span>'+esc(nm)+'</span></label>';
  });
  h+='</div>';

  if(sel.length<2){
    return void(box.innerHTML=h+'<p class="text-xs text-slate-400">再勾一家就會出現對比表。</p></div></details>');
  }

  const snaps=sel.map(nm=>vendorSnaps[nm]);
  // 機關重疊：抓取範圍內同時出現在多家對手名單上的機關
  const agSets=snaps.map(s=>new Set(s.agencies.map(x=>x[0])));
  const overlapAll=[...agSets[0]].filter(a=>agSets.every(st=>st.has(a)));

  // 涵蓋率落差大就先講清楚，不要讓人以為件數可以直接比
  const fair0=vsnapFairness(snaps);
  if(!fair0.fair){
    h+='<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-3 text-[11px] text-amber-900 leading-relaxed">'+
      '<i class="fa-solid fa-scale-unbalanced text-amber-600 mr-1"></i>'+
      '<strong>這幾家的涵蓋率差距大（'+Math.round(fair0.lo*100)+'% – '+Math.round(fair0.hi*100)+'%），件數不可直接比。</strong>'+
      '抓得多的那家件數自然高，跟它實際比較活躍無關。'+
      '件數欄位已停掉「最佳」標示並標上「不可比」；要公平比就把<strong>抓取深度調成「抓到底」</strong>後各家重新更新一次，'+
      '或只看比例類（得標率、最大機關佔比）與名單類欄位。</div>';
  }
  h+='<div class="overflow-x-auto"><table class="w-full text-xs border-collapse min-w-[520px]">'+
    '<thead><tr><th class="p-2 text-left bg-slate-50 border sticky left-0 z-10">指標</th>';
  snaps.forEach(s=>{ const cv=vsnapCoverage(s);
    h+='<th class="p-2 text-left border bg-slate-50 align-top min-w-[140px]"><div class="font-bold text-ink-900 leading-snug">'+esc(s.name)+'</div>'+
      (cv&&!cv.complete?'<div class="text-[10px] font-normal text-amber-700 mt-0.5">未抓完</div>':
        '<div class="text-[10px] font-normal text-jade-700 mt-0.5">已抓完</div>')+'</th>'; });
  h+='</tr></thead><tbody>';
  const fair=fair0;
  VSNAP_ROWS.forEach(([label,fn,kind])=>{
    const vals=snaps.map(s=>{ try{ return fn(s); }catch(e){ return '—'; } });
    if(vals.every(v=>v==='—')) return;
    const isCount = kind==='count' || kind==='count-bad';
    const bad = kind==='high-bad' || kind==='count-bad';
    // 件數類在涵蓋率落差大時不標最佳，比例類與全歷史類不受影響
    const rank = (kind==='num'||kind==='high-bad') || (isCount && fair.fair);
    let best=-1;
    if(rank){
      const nums=snaps.map(s=>snapNum(fn(s)));
      let bv=null; nums.forEach((v,i)=>{ if(v!=null&&(bv==null||v>bv)){ bv=v; best=i; } });
    }
    h+='<tr><td class="p-2 border bg-slate-50 font-semibold sticky left-0 z-10 align-top whitespace-nowrap">'+esc(label)+
      (isCount&&!fair.fair?'<span class="ml-1 text-[10px] font-normal text-amber-700" title="各家涵蓋率不同，件數不可直接比">不可比</span>':'')+'</td>';
    vals.forEach((v,i)=>{
      const hi = i===best ? (bad?'text-rose-600 font-bold':'text-jade-700 font-bold') : 'text-ink-900';
      h+='<td class="p-2 border align-top '+hi+'">'+v+'</td>';
    });
    h+='</tr>';
  });
  h+='<tr><td class="p-2 border bg-slate-50 font-semibold sticky left-0 z-10 align-top whitespace-nowrap">共同機關</td>'+
    '<td class="p-2 border align-top" colspan="'+snaps.length+'">'+
    (overlapAll.length
      ? '<span class="font-bold text-ink-900">'+overlapAll.length+' 個機關</span>這幾家都有得標：'+
        overlapAll.slice(0,8).map(a=>'<span class="tag bg-amber-100 text-amber-800 ml-1">'+esc(vendorShort(a))+'</span>').join('')+
        (overlapAll.length>8?('<span class="text-slate-400 ml-1">…另 '+(overlapAll.length-8)+' 個</span>'):'')
      : '<span class="text-slate-400">抓取範圍內沒有共同的機關</span>')+
    '</td></tr>';
  h+='</tbody></table></div>'+
    '<p class="text-[11px] text-slate-400 leading-relaxed">件數類的數字只涵蓋<strong>各家已抓取的範圍</strong>，'+
    '「官方總筆數」才是全歷史。涵蓋率差距大的時候件數不可直接比，表格會停掉件數欄位的「最佳」標示並在上方提醒。'+
    '<strong>「共同得標夥伴」是同一案一起得標的別家；「常同場對手」是同一案出現、但不是一起得標的別家</strong>——'+
    '公告的廠商名單把得標與落標列在一起，兩者很容易被混為一談。</p>';
  box.innerHTML=h+'</div></details>';
}

async function doCompanySearch(){
  const q=document.getElementById('companyQuery').value.trim();
  if(!q){ toast('請輸入廠商名稱或統編','warning'); return; }
  const isId=/^\d{8}$/.test(q);
  const box=document.getElementById('companyResults');
  box.innerHTML='<div class="card p-6 text-center text-sm text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>查詢中…</div>';
  try{
    const r=await api('/api/'+(isId?'searchbycompanyid':'searchbycompanyname')+'?query='+encodeURIComponent(q)+'&page=1');
    const recs=r.records||[];
    recs.forEach(x=>noteAgency(x.unit_id,x.unit_name)); persistAgencyIndex();
    box.innerHTML='<div class="text-xs text-slate-500 mb-2">共 '+fmtNum(r.total_records)+' 筆，顯示第 1 頁</div>';
    recs.forEach(x=>box.appendChild(tenderCard(x)));
    if(!recs.length) box.innerHTML='<div class="card p-8 text-center text-sm text-slate-400">查無資料。</div>';
  }catch(e){ box.innerHTML='<div class="card p-6 text-sm text-rose-600">查詢失敗：'+esc(e.message)+'</div>'; }
}

