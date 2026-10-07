/* ================= API ================= */
async function api(path){
  const url=apiBase()+path;
  const tk=apiToken();
  let r=await fetch(url, tk?{headers:{'Authorization':'Bearer '+tk}}:{});
  if(!r.ok && tk && (r.status===401||r.status===403)){
    r=await fetch(url);                 // token 失效就退回不帶 token 的公開查詢
    if(r.ok) LS.del(K.TOKEN);
  }
  if(!r.ok) throw new Error('API 回應 '+r.status+(r.status===403?'（可能被 Cloudflare 擋或 token 失效）':''));
  return r.json();
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

