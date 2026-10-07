/* ================= 儲存空間 =================
   localStorage 滿了會讓所有寫入靜默失敗，所以把用量攤在頁尾讓它看得見，
   而不是等到「加入追蹤按了沒反應」才發現。 */
const CACHE_KEYS = ['DAYCACHE','AMOUNT','SNAP','SNAPSEL','VSNAP','VSNAPSEL','FLOPDETAIL','PREDETAIL'];  // 可重建，可安全清除
/* 「只清快取」會刪掉 CACHE_KEYS 裡的每個鍵，所以這份名單絕不能混進使用者自己輸入的資料
   （追蹤、比較、關鍵字、對手清單、機關索引）。test/frontend.test.mjs 有測試守著。 */
function cacheKeyNames(){ return CACHE_KEYS.slice(); }
function userKeyNames(){ return Object.keys(K).filter(x=>CACHE_KEYS.indexOf(x)<0); }
function storageUsage(){
  const per={}; let total=0;
  Object.keys(K).forEach(name=>{
    let len=0;
    try{ const v=localStorage.getItem(K[name]); len=v?v.length:0; }catch(e){}
    per[name]=len; total+=len;
  });
  const cache=CACHE_KEYS.reduce((n,k)=>n+(per[k]||0),0);
  return { per, total, cache, user: total-cache };
}
function renderStorageMeter(){
  const box=document.getElementById('storageMeter'); if(!box) return;
  const u=storageUsage();
  // localStorage 以 UTF-16 計算，所以位元組約為字元數的兩倍；瀏覽器上限通常約 5MB
  const mb=x=>(x*2/1048576).toFixed(1);
  const LIMIT=5*1048576/2;                       // 換算成字元數
  const pctAll=Math.min(100,Math.round(u.total/LIMIT*100));
  const pctCache=Math.min(100,Math.round(u.cache/LIMIT*100));
  const tone = pctAll>=90 ? 'bg-rose-500' : pctAll>=70 ? 'bg-amber-500' : 'bg-jade-500';
  box.innerHTML=
    '<div class="flex justify-between text-[10px] text-slate-400 mb-1">'+
      '<span>本機儲存 '+mb(u.total)+' MB（約 '+pctAll+'%）</span>'+
      '<span>可重建快取 '+mb(u.cache)+' MB · 你的資料 '+mb(u.user)+' MB</span>'+
    '</div>'+
    '<div class="h-1.5 bg-slate-200 rounded-full overflow-hidden flex">'+
      '<div class="h-full '+tone+'" style="width:'+pctCache+'%"></div>'+
      '<div class="h-full bg-slate-400" style="width:'+Math.min(100-pctCache,Math.round(u.user/LIMIT*100))+'%"></div>'+
    '</div>'+
    (pctAll>=70?('<p class="text-[10px] text-amber-600 mt-1">快接近瀏覽器上限（通常約 5 MB）。按「只清快取」可以釋出 '+mb(u.cache)+' MB，你的追蹤與比較不會動到。</p>'):'');
}
function clearCaches(){
  const u=storageUsage();
  const mb=(u.cache*2/1048576).toFixed(1);
  if(!confirm('會清掉可重建的快取：公告快取、決標金額快取、機關與廠商快照（約 '+mb+' MB）。\n\n追蹤、比較、關鍵字、對手清單、機關索引都保留。確定？')) return;
  CACHE_KEYS.forEach(name=>LS.del(K[name]));
  dayCache={}; amountCache={}; agencySnaps={}; snapSel=[]; vendorSnaps={}; vsnapSel=[];
  renderStorageMeter();
  toast('已清除快取，釋出約 '+mb+' MB','success');
  renderOverview();
}

/* ================= 備份 ================= */
function exportBackup(){
  const data={version:6,exportedAt:new Date().toISOString(),
    tracked,compare:compareList,watch:watchKeywords,agencies:agencyIndex,rivals,
    compareView:cmpView};
  dl(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'標案參謀室備份_'+ymdDash(new Date())+'.json');
  toast('備份已下載','success');
}
document.getElementById('backupInput').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const d=JSON.parse(await f.text());
    // 匯入是最可能撞到配額的時機（把備份還原到一台快取已滿的機器），
    // 而使用者可能已經把備份 JSON 刪了，所以每一筆都要確認真的寫進去
    const results=[];
    if(Array.isArray(d.tracked)){ tracked=d.tracked; results.push(['追蹤清單',LS.set(K.TRACKED,tracked,'追蹤清單')]); }
    if(Array.isArray(d.compare)){ compareList=d.compare; results.push(['比較清單',LS.set(K.COMPARE,compareList,'比較清單')]); }
    if(Array.isArray(d.watch)){ watchKeywords=d.watch; results.push(['關鍵字',LS.set(K.WATCH,watchKeywords,'關鍵字清單')]); renderWatchChips(); }
    if(d.agencies&&typeof d.agencies==='object'){ Object.assign(agencyIndex,d.agencies); results.push(['機關索引',persistAgencyIndex()]); }
    if(Array.isArray(d.rivals)){ d.rivals.forEach(x=>{ if(!rivals.some(y=>sameVendor(y,x))) rivals.push(x); }); results.push(['對手清單',LS.set(K.RIVALS,rivals,'對手追蹤清單')]); }
    if(d.compareView&&typeof d.compareView==='object'){ cmpView=d.compareView; results.push(['比較欄位偏好',LS.set(K.CMPVIEW,cmpView,'比較欄位偏好')]); }
    updateCounters(); renderStorageMeter();
    const failed=results.filter(r=>!r[1]).map(r=>r[0]);
    if(!results.length) toast('備份裡沒有可匯入的資料','warning');
    else if(failed.length) toast('匯入未完全成功，這些沒存到：'+failed.join('、')+'。請先清除公告快取再匯入','error');
    else toast('備份已匯入（'+results.length+' 項）','success');
  }catch(err){ toast('匯入失敗：格式不對','error'); }
  e.target.value='';
});
function wipeAll(){
  if(!confirm('會清掉全部本機資料：追蹤、比較、關鍵字、對手清單、機關索引、機關與廠商快照、決標金額快取、公告快取，以及 API／proxy 設定。\n\n建議先「匯出備份」。確定要清除？')) return;
  Object.values(K).forEach(k=>LS.del(k)); location.reload();
}

