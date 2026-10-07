/* ================= API ================= */
/* ---------- API 限流（2026-10-07 實測） ----------
   openfun 對沒帶 token 的訪客有限流，行為是典型的 token bucket：
     · 閒置後可以連打約 10 次（剛好碰到補額度時看起來像 14 次）
     · 之後每 3 秒才補 1 次額度，也就是穩定速度約每分鐘 20 次
     · 超過回 HTTP 429「Too Many Requests. 訪客請求太頻繁」，沒有 Retry-After
   ⚠ 429 回應沒有 CORS 標頭（200 才有 Access-Control-Allow-Origin: *）。所以從
     localhost:5178 或 GitHub Pages 呼叫時，瀏覽器根本看不到 429，只會丟
     TypeError: Failed to fetch。以前記成「listbyunit 連抓約 15 頁就被斷線」、
     廠商「第 24 頁失敗」，其實都是這個限流。
   對策（集中在這裡，每個呼叫 API 的地方都受惠）：
     1. 所有請求排隊、共用一個客戶端額度，速度壓在限流之下（容量 8、每 3.2 秒補 1）
     2. 真的撞到（429 或 Failed to fetch）就把額度歸零、等一段時間再試，
        而且透過 onWait 把「為什麼在等、等多久」講出來，不要讓畫面像當掉
   有自己申請的 token（設定 → API Token）時不預先放慢，只保留撞到時的退避。 */
const API_BUCKET_CAP = 8;
const API_REFILL_MS  = 3200;
const API_LIMIT_WAIT = [6000, 12000, 20000, 30000];   // 撞到限流後的等待（大量抓取用）
const API_LIMIT_WAIT_QUICK = [6000];                  // 單次查詢：等一次就好，連不上要早點告訴人
let apiTokens = API_BUCKET_CAP, apiRefillAt = Date.now(), apiQueue = Promise.resolve();
function apiSleep(ms){ return new Promise(s=>setTimeout(s,ms)); }   // 函式宣告：測試可以換掉

function apiRefill(){
  const now=Date.now();
  apiTokens=Math.min(API_BUCKET_CAP, apiTokens+(now-apiRefillAt)/API_REFILL_MS);
  apiRefillAt=now;
}
/* 取得一次請求額度。請求一律排隊，避免多個迴圈同時搶額度。 */
async function apiSlot(onWait){
  const prev=apiQueue; let release; apiQueue=new Promise(r=>release=r);
  await prev;
  try{
    if(apiToken()) return;                       // 有 token：不預先放慢
    apiRefill();
    if(apiTokens<1){
      const ms=Math.ceil((1-apiTokens)*API_REFILL_MS);
      if(onWait) onWait(ms,'pace');
      await apiSleep(ms); apiRefill();
    }
    apiTokens-=1;
  }finally{ release(); }
}
/* 被限流了：本地額度歸零，接下來照補充速度走 */
function apiDrain(){ apiTokens=0; apiRefillAt=Date.now(); }

/* opt.onWait(ms, why)：why = 'pace'（主動放慢）或 'limit'（被限流，退避中）
   opt.patient：大量抓取（翻頁、逐案補資料）用，撞到限流會多等幾輪 */
async function api(path, opt){
  opt=opt||{};
  const waits=opt.patient?API_LIMIT_WAIT:API_LIMIT_WAIT_QUICK;
  const url=apiBase()+path;
  for(let i=0;;i++){
    await apiSlot(opt.onWait);
    const tk=apiToken();
    let r=null, netErr=null;
    try{
      r=await fetch(url, tk?{headers:{'Authorization':'Bearer '+tk}}:{});
      if(!r.ok && tk && (r.status===401||r.status===403)){
        r=await fetch(url);              // token 失效就退回不帶 token 的公開查詢
        if(r.ok) LS.del(K.TOKEN);
      }
    }catch(e){ netErr=e; }
    const limited = (r && r.status===429) || (netErr && !(typeof navigator!=='undefined' && navigator.onLine===false));
    if(!limited){
      if(netErr) throw new Error('連不上 API（'+netErr.message+'），請確認網路');
      if(!r.ok) throw new Error('API 回應 '+r.status+(r.status===403?'（可能被 Cloudflare 擋或 token 失效）':''));
      return r.json();
    }
    apiDrain();
    if(i>=waits.length){
      throw new Error('API 限流中（訪客請求太頻繁），等了 '+Math.round(waits.reduce((a,b)=>a+b,0)/1000)+
        ' 秒仍未恢復。稍等一兩分鐘再試；常用的話可到 data.openfun.tw 申請帳號，把 token 填進「設定 → API Token」');
    }
    if(opt.onWait) opt.onWait(waits[i],'limit');
    else apiLimitNotice(waits[i]);
    await apiSleep(waits[i]);
  }
}
/* 呼叫端沒有自己的進度訊息時（逐案補金額、更新追蹤等），用提示告訴人在等什麼；20 秒內不重複 */
let apiNoticeAt=0;
function apiLimitNotice(ms){
  const st=document.getElementById('apiStatus'); if(st) st.textContent=apiWaitText(ms,'limit');
  if(Date.now()-apiNoticeAt<20000) return;
  apiNoticeAt=Date.now(); toast(apiWaitText(ms,'limit')+'。資料不會漏，只是比較慢。','warning');
}
/* 給進度訊息用：把等待講成一句話 */
function apiWaitText(ms,why){
  return why==='limit' ? ('API 限流（請求太頻繁），等 '+Math.round(ms/1000)+' 秒後繼續')
                       : ('放慢速度避免被限流，'+Math.max(1,Math.round(ms/1000))+' 秒');
}
async function testApi(){
  const oldBase=LS.get(K.BASE,null), oldTok=LS.get(K.TOKEN,null);
  LS.set(K.BASE,document.getElementById('apiBaseInput').value);
  LS.set(K.TOKEN,document.getElementById('apiTokenInput').value.trim());
  try{ const info=await api('/api/getinfo'); toast('API 正常，資料筆數 '+fmtNum(pickInfoTotal(info)),'success'); }
  catch(e){ toast('API 失敗：'+e.message,'error'); if(oldBase!==null)LS.set(K.BASE,oldBase); if(oldTok!==null)LS.set(K.TOKEN,oldTok); }
}
function pickInfoTotal(info){
  if(!info) return null;
  for(const k of Object.keys(info)){ if(/筆數|數量|count|total/i.test(k) && !isNaN(parseInt(info[k],10))) return parseInt(info[k],10); }
  return null;
}
function saveSettingsModal(){
  LS.set(K.BASE,document.getElementById('apiBaseInput').value);
  LS.set(K.PROXY,document.getElementById('proxyBaseInput').value.trim()||'http://localhost:5178');
  LS.set(K.TOKEN,document.getElementById('apiTokenInput').value.trim());
  modal('settingsModal',false); toast('設定已儲存','success');
}

