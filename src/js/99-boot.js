/* ================= 啟動 ================= */
window.addEventListener('DOMContentLoaded',()=>{
  ['searchQuery','agencyQuery','vendorQuery','vendorIdQuery'].forEach(id=>{
    document.getElementById(id).addEventListener('keydown',e=>{ if(e.key==='Enter') doSearch(1); });
  });
  document.getElementById('companyQuery').addEventListener('keydown',e=>{ if(e.key==='Enter') doCompanySearch(); });
  document.getElementById('liveKeyword').addEventListener('keydown',e=>{ if(e.key==='Enter') doLiveSearch(); });
  document.getElementById('watchInput').addEventListener('keydown',e=>{ if(e.key==='Enter') addWatchKeyword(); });
  document.getElementById('agencyFilter').addEventListener('keydown',e=>{ if(e.key==='Enter') renderAgencies(); });
  document.getElementById('rivalPanel').addEventListener('keydown',e=>{
    if(e.key==='Enter' && e.target && e.target.id==='rivalInput') addRival(); });
  applyHints(LS.get(HINT_KEY,false));
  renderWatchChips(); checkProxy(false);
  updateCounters(); renderOverview(); renderStorageMeter();
});
