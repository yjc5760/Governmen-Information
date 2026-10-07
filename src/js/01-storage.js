/* ================= 儲存層 ================= */
/* localStorage 只有約 5MB，而公告快取是唯一會長到 MB 級的東西。
   原本每個寫入點都直接 LS.set 且不看回傳值，一旦公告快取把配額吃滿，
   其他 30 幾個寫入就全部靜默失敗——「加入追蹤」會顯示成功、計數會增加、
   重載後消失，看起來像隨機的 bug。
   所以配額處理集中在這裡：寫不進去就先從公告快取回收空間再重試，
   真的還是失敗才明確告知。公告快取是唯一可犧牲的（重新同步就有）。 */
const LS = {
  get(k,d){ try{ const v=localStorage.getItem(k); return v===null?d:JSON.parse(v);}catch(e){return d;} },
  trySet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true;}catch(e){return false;} },
  set(k,v,label){
    if(this.trySet(k,v)) return true;
    if(reclaimDayCache() && this.trySet(k,v)){
      toast('儲存空間不足，已丟掉部分公告快取來騰出空間','warning');
      return true;
    }
    warnQuota(k,label);
    return false;
  },
  del(k){ try{ localStorage.removeItem(k);}catch(e){} }
};
/* 從公告快取丟掉最舊的日期來騰空間。回傳是否真的丟掉了東西。 */
function reclaimDayCache(){
  if(typeof dayCache!=='object' || !dayCache) return false;
  const keys=Object.keys(dayCache).sort();
  if(!keys.length) return false;
  let dropped=0;
  while(keys.length){ delete dayCache[keys.shift()]; dropped++;
    if(LS.trySet(K.DAYCACHE,dayCache)) break; }
  return dropped>0;
}
/* 同一個鍵的配額警告最多每 30 秒一次——saveAgencySnapshot 每次重繪都會寫，
   不節流會被洗版。 */
const quotaWarned={};
function warnQuota(k,label){
  const now=Date.now();
  if(quotaWarned[k] && now-quotaWarned[k]<30000) return;
  quotaWarned[k]=now;
  toast('儲存空間已滿，'+(label||'這筆變更')+'沒有存到（重開會不見）。請先「匯出備份」，再到頁尾「清除全部資料」或減少同步天數。','error');
}
const K = { BASE:'pi_api_base', TOKEN:'pi_api_token',
  DAYCACHE:'pi_daycache2', TRACKED:'pi_tracked', COMPARE:'pi_compare',
  PROXY:'pi_proxy_base', WATCH:'pi_watch_keywords', AMOUNT:'pi_amount_cache',
  AGENCY:'pi_agency_index', CMPVIEW:'pi_compare_view',
  SNAP:'pi_agency_snap', SNAPSEL:'pi_agency_snap_sel',
  RIVALS:'pi_rivals', VSNAP:'pi_vendor_snap2', VSNAPSEL:'pi_vendor_snap_sel',
  FLOPDETAIL:'pi_flop_detail', PREDETAIL:'pi_pre_detail',
  VPAGES:'pi_vendor_pages' };
/* 舊版快取沒有得標／未得標的判讀資料，留著只會繼續給錯數字又佔配額，開頁就清掉。 */
['pi_daycache','pi_vendor_snap'].forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });

/* pcc-viewer 公開設定檔裡的那組 token 已被 API 端擋掉（回 403）。
   openfun 這支 API 目前不帶 token 也能公開查詢，所以預設不送 Authorization。
   若之後自己申請到 token，到「設定 → API Token」填入即可。 */
const REVOKED_TOKENS = ['ofk_c925948ad0e7a5c6ed52db349bee0bf19ae4125c5c9aab87b4fec65d3e7747a3'];
const DEFAULT_TOKEN = '';
const apiBase  = () => LS.get(K.BASE, 'https://pcc-api.openfun.app');
const apiToken = () => { const t = LS.get(K.TOKEN, DEFAULT_TOKEN); return (t && REVOKED_TOKENS.indexOf(t)>=0) ? '' : t; };
(function(){ const t = LS.get(K.TOKEN, null); if(t && REVOKED_TOKENS.indexOf(t)>=0) LS.del(K.TOKEN); })();

/* ================= 狀態 ================= */
let dayCache      = LS.get(K.DAYCACHE, {});      // {'20260905':[{u,n,j,t,ty,f}]}
let tracked       = LS.get(K.TRACKED, []);        // [{unit_id,job_number,unit_name,title,date,deadline,budget,type}]
let compareList   = LS.get(K.COMPARE, []);
let watchKeywords = LS.get(K.WATCH, []);
let amountCache   = LS.get(K.AMOUNT, {});   // 'unit_id|job_number' -> {a:決標金額, d:決標日期, b:預算}
let agencyIndex   = LS.get(K.AGENCY, {});   // 機關名 -> unit_id；累積式，不隨公告快取一起被裁掉
let agencySnaps   = LS.get(K.SNAP, {});    // unit_id -> 機關指標快照，供機關對比用
let snapSel       = LS.get(K.SNAPSEL, []); // 目前勾選要對比的 unit_id
let rivals        = LS.get(K.RIVALS, []);  // 常駐追蹤的對手廠商名稱
const RIVAL_PAGES_DEFAULT = 6;                // 預設每家抓 6 頁；實際上限一律走 rivalLimit()
let vendorPages   = LS.get(K.VPAGES, RIVAL_PAGES_DEFAULT);      // 每家對手抓幾頁；0 = 抓到底
let preDetail     = LS.get(K.PREDETAIL, {});  // 'unit_id|job' -> 前置公告的預算與資格條款
let flopDetail    = LS.get(K.FLOPDETAIL, {}); // 'unit_id|job' -> 流標理由／各輪預算／是否沿用案號
let vendorSnaps   = LS.get(K.VSNAP, {});   // 廠商名 -> 指標快照，供廠商對比用
let vsnapSel      = LS.get(K.VSNAPSEL, []);
let proxyOk       = false;
let currentTender = null;
let calCursor     = new Date();


