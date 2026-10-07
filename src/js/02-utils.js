/* ================= 小工具 ================= */
/* HTML 跳脫。文字節點與「雙／單引號包住的屬性值」都安全。
   舊版借 div.textContent→innerHTML 來跳脫，只處理 & < >、不處理引號，
   所以 title="'+esc(x)+'" 這種屬性內插，資料裡一個 " 就能跳出屬性塞進事件處理器。
   網頁放上公開網址後，這就是能被 API 資料或匯入的備份檔觸發的 XSS。 */
const ESC_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function esc(s){ return s==null?'':String(s).replace(/[&<>"']/g,c=>ESC_MAP[c]); }
/* 外部連結只放行 http(s)。連結可能來自 proxy 解析或匯入的備份檔，
   不擋的話 javascript: 網址會在點擊時執行。 */
function safeUrl(u){ u=String(u==null?'':u).trim(); return /^https?:\/\//i.test(u)?u:''; }

/* 把字串當參數塞進 HTML 的 onclick／onchange 屬性時一定要用這個。
   屬性是用雙引號包的，而 JSON.stringify 產生的字串也帶雙引號，直接內插會讓
   HTML 解析器在第一個內層引號就把屬性截斷 ——
     onchange="toggleVsnapSel("亞新工程顧問",this.checked)"
                              ↑ 屬性到這裡就結束了
   handler 變成語法錯誤，按鈕完全沒反應，而且主控台不一定看得到錯誤。
   （廠商對比與機關對比的核取方塊就是這樣壞掉的。） */
function jsArg(v){
  return JSON.stringify(String(v==null?'':v)).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}
function toast(msg,type='info'){
  const ic={success:'fa-circle-check text-emerald-500',error:'fa-triangle-exclamation text-rose-500',warning:'fa-circle-exclamation text-amber-500',info:'fa-circle-info text-jade-600'};
  const t=document.createElement('div');
  t.className='pointer-events-auto flex items-start gap-2.5 px-4 py-3 bg-white border rounded-xl shadow-lg text-xs font-medium max-w-sm transition-all duration-300 translate-x-8 opacity-0';
  t.innerHTML='<i class="fa-solid '+(ic[type]||ic.info)+' mt-0.5"></i><span></span>';
  t.querySelector('span').textContent=msg;
  document.getElementById('toastContainer').appendChild(t);
  requestAnimationFrame(()=>t.classList.remove('translate-x-8','opacity-0'));
  setTimeout(()=>{t.classList.add('translate-x-8','opacity-0');setTimeout(()=>t.remove(),300);},4500);
}
function modal(id,show){ const m=document.getElementById(id); m.classList.toggle('hidden',!show); m.classList.toggle('flex',show);
  if(show&&id==='settingsModal'){
    document.getElementById('apiBaseInput').value=apiBase();
    document.getElementById('proxyBaseInput').value=proxyBase();
    document.getElementById('apiTokenInput').value=apiToken();
  } }
/* 說明文字（class="hint"）預設收起，畫面只留輸入框、按鈕與數字；
   頁首「說明」按鈕一次展開全部，選擇記在這台瀏覽器。
   資料不完整、涵蓋率、樣本數這類警示不是 hint，永遠顯示。 */
const HINT_KEY='pi_show_hints';
function applyHints(on){
  document.body.classList.toggle('show-hints',!!on);
  const b=document.getElementById('hintToggle');
  if(b){ b.classList.toggle('bg-jade-50',!!on); b.classList.toggle('text-jade-700',!!on); b.classList.toggle('border-jade-500',!!on); }
}
function toggleHints(){ const on=!document.body.classList.contains('show-hints'); LS.set(HINT_KEY,on); applyHints(on); }
function ymd(d){ return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); }
function fmtNum(n){ return (n==null||isNaN(n))?'—':Number(n).toLocaleString(); }

// 民國/西元日期字串 → Date
function parseTwDate(s){
  if(!s) return null;
  const m=String(s).match(/(\d{2,4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})[^\d]*(\d{1,2})?:?(\d{2})?/);
  if(!m) return null;
  let y=parseInt(m[1],10); if(y<1911) y+=1911;
  const d=new Date(y,parseInt(m[2],10)-1,parseInt(m[3],10),m[4]?parseInt(m[4],10):23,m[5]?parseInt(m[5],10):59);
  return isNaN(d.getTime())?null:d;
}
function daysLeft(dateObj){ if(!dateObj) return null; return Math.ceil((dateObj-new Date())/86400000); }
function parseMoney(s){ if(!s) return null; const n=String(s).replace(/[^\d]/g,''); return n?parseInt(n,10):null; }
/* ================= 公告類型判斷（一律走這裡） =================
   這個資料集的類型名稱大量共用子字串，隨手 indexOf 一定出錯。
   以台電總公司 30,000 筆實測的類型分布為例：
     '更正決標公告' 含 '決標公告'      → 誤算成決標，決標數虛增 20.9%（多 2,709 筆）
     '無法決標公告' 含 '決標'          → 「只看決標公告」會多列 2,937 筆
     '撤銷無法決標公告' 含 '無法決標'  → 其實是撤銷流標，語意相反
     '限制性招標(經公開評選…)公告' 不含 '招標公告' → 1,109 筆招標被漏掉
     '招標文件公開閱覽公告資料公告' 含 '招標' → 那是招標前的公開閱覽，不是招標本身

   而且「統計」與「顯示」需要的定義不同，所以刻意分成兩組，不要互用：
     統計用（一案一筆，排除更正）：isAward / isFailedAward / isTender
     顯示用（含更正，因為更正公告也是該類別的資訊）：isAwardNotice / isTenderNotice
   ============================================================= */
function isCorrection(t){ return String(t||'').indexOf('更正')>=0; }
function isRevoked(t){ return String(t||'').indexOf('撤銷')>=0; }
/* 這些類型名稱含「招標」但不是招標本身，或根本不是採購案 */
const TYPE_NOT_TENDER = ['公開閱覽','徵求廠商提供參考資料','財物變賣','財物出租','公示送達','定期彙送','拒絕往來'];

function isAward(t){            // 真正的決標：決標件數、廠商件數、落標率都用這個
  t=String(t||'');
  return t.indexOf('決標公告')>=0 && t.indexOf('無法')<0 && !isCorrection(t) && !isRevoked(t);
}
function isFailedAward(t){      // 無法決標（流標）
  t=String(t||'');
  return t.indexOf('無法決標')>=0 && !isCorrection(t) && !isRevoked(t);
}
function isTender(t){           // 招標公告（含公開取得、限制性、選擇性）
  t=String(t||'');
  if(isCorrection(t)) return false;
  if(TYPE_NOT_TENDER.some(x=>t.indexOf(x)>=0)) return false;
  if(t.indexOf('決標')>=0) return false;
  return t.indexOf('招標')>=0 || t.indexOf('公開取得')>=0;
}
function isDebarred(t){         // 拒絕往來廠商名單
  return String(t||'').indexOf('拒絕往來')>=0 && !isCorrection(t);
}
/* 顯示用：勾「只看決標公告」時，更正決標也是決標相關資訊，該一起顯示；
   但「無法決標」絕對不能混進來。 */
function isAwardNotice(t){
  t=String(t||'');
  return t.indexOf('決標公告')>=0 && t.indexOf('無法')<0;
}
function isTenderNotice(t){
  t=String(t||'');
  if(TYPE_NOT_TENDER.some(x=>t.indexOf(x)>=0)) return false;
  if(t.indexOf('決標')>=0) return false;
  return t.indexOf('招標')>=0 || t.indexOf('公開取得')>=0;
}

function pick(detail, keys){
  if(!detail) return '';
  for(const key of keys){ for(const k of Object.keys(detail)){ if(k.indexOf(key)>=0 && detail[k]) return String(detail[k]); } }
  return '';
}

/* 金額欄位不能用 pick()，有兩個實測踩到的陷阱：
   1. 「預算金額」旁邊有「預算金額是否公開」，值是「是」／「否」。pick() 用子字串比對，
      而決標公告的鍵順序是「已公告資料:預算金額是否公開」在「已公告資料:預算金額」之前，
      所以 pick 先撞到「是」，parseMoney('是') = 0。後果：落標率與「決標／預算比」
      永遠算不出來，而且打開決標公告的標案詳情時「採購預算」會顯示「是」。
   2. 「總決標金額」旁邊有「總決標金額:remind」（一段中文說明，無數字）與
      「投標廠商:投標廠商N:決標金額」（單一廠商金額，不是總額）。pick 會落到後者。
   所以：先比對鍵的最後一段是否完全相符、跳過說明類欄位、值一定要能解析成正數。 */
function budgetStr(detail,records){
  const v=pickMoney(detail,['預算金額']);
  const w=(v!=null)?v:pickMoneyAcross(records,['預算金額']);
  return w!=null?String(w):'';
}
const MONEY_BAD_KEY = /是否|remind|說明|備註|理由|方式|條件/;
function pickMoney(detail, keys){
  if(!detail) return null;
  const ks=Object.keys(detail);
  for(const key of keys){                    // 第一輪：鍵尾完全相符
    for(const k of ks){
      if(MONEY_BAD_KEY.test(k)) continue;
      if(k.slice(k.lastIndexOf(':')+1)!==key) continue;
      const v=parseMoney(detail[k]); if(v>0) return v;
    }
  }
  for(const key of keys){                    // 第二輪：退回子字串，仍跳過說明類
    for(const k of ks){
      if(MONEY_BAD_KEY.test(k)) continue;
      if(k.indexOf(key)<0) continue;
      const v=parseMoney(detail[k]); if(v>0) return v;
    }
  }
  return null;
}
/* 在整個標案的所有公告紀錄裡找金額：由新到舊，決標公告找不到就回頭看招標公告 */
function pickMoneyAcross(records, keys){
  for(const r of (records||[]).slice().reverse()){
    const v=pickMoney(r&&r.detail, keys);
    if(v!=null) return v;
  }
  return null;
}

