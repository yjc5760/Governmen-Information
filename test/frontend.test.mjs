/**
 * 前端邏輯測試：node --test  （或 npm test）
 *
 * 不需要瀏覽器，也不裝任何額外套件。做法是把 標案參謀室.html 裡最大的那段
 * <script> 抽出來，丟進 node:vm，配一組剛好夠用的 DOM 假物件執行，
 * 然後直接呼叫裡面的純函式。函式宣告會成為 vm context 的屬性，所以取得到。
 *
 * 這裡只測「算得對不對」的純邏輯（發包週期、流標重招、系列鍵正規化），
 * 不測畫面。畫面行為請用瀏覽器實際點。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(HERE, '..', '標案參謀室.html');

function loadApp(){
  const html = fs.readFileSync(HTML, 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length, '在 標案參謀室.html 裡找不到 <script> 區塊');
  const code = blocks.reduce((a, b) => (b.length > a.length ? b : a), '');
  assert.ok(code.includes('function buildSeries'), '抽到的 <script> 不是主程式（找不到 buildSeries）');

  // 剛好夠讓主程式頂層跑完的假 DOM
  const store = new Map();
  const elStub = () => ({
    value: '', textContent: '', innerHTML: '', checked: false, disabled: false, files: [],
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    style: {}, dataset: {},
    addEventListener(){}, removeEventListener(){}, appendChild(){}, removeChild(){},
    querySelector(){ return elStub(); }, querySelectorAll(){ return []; },
    scrollTo(){}, focus(){}, click(){}
  });
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: fn => fn(),
    fetch: () => Promise.reject(new Error('測試環境不連網')),
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    location: { reload(){} },
    confirm: () => false,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL(){} },
    Blob: class { constructor(p){ this.parts = p; } },
    document: {
      getElementById: () => elStub(),
      createElement: () => {
        const o = { _t: '', innerHTML: '' };
        Object.defineProperty(o, 'textContent', {
          get(){ return o._t; },
          set(v){ o._t = v;
            o.innerHTML = String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                   .replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
        });
        return o;
      },
      querySelectorAll: () => [],
      querySelector: () => elStub(),
      body: elStub()
    },
    window: { addEventListener(){}, scrollTo(){}, open(){} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(code, { filename: '標案參謀室.html<script>' }).runInContext(sandbox);
  return sandbox;
}

const app = loadApp();
const rec = (date, type, title, job) =>
  ({ date, job_number: job, brief: { type, title, companies: { names: [], ids: [] } } });

test('seriesKey 把年度標案名稱正規化成系列鍵', () => {
  const k = app.seriesKey;
  assert.equal(k('115年度大林發電廠昇降機維護工作'), '大林發電廠昇降機維護工作');
  assert.equal(k('114年大林發電廠昇降機維護工作'),   '大林發電廠昇降機維護工作');
  assert.equal(k('114~115年大一、二機控制閥及驅動設備大修維護工作'),
                 '大一、二機控制閥及驅動設備大修維護工作');
  assert.equal(k('115-117年電力修護處電廠大修電動堆高機租賃'),
                 '電力修護處電廠大修電動堆高機租賃');
  // 流標重招的「第2次」要被吃掉，否則認不出是同一系列
  assert.equal(k('115年度輸卸煤系統空調設備維護工作（第2次）'),
               k('115年度輸卸煤系統空調設備維護工作'));
  // 機組編號是識別的一部分，不能被當年份剝掉
  assert.ok(app.seriesKey('115年度#1機鍋爐水冷壁更新工程').includes('#1機'));
  assert.notEqual(k('115年度#1機大修工程'), k('115年度#2機大修工程'));
});

test('buildSeries 算出週期並排除更正公告', () => {
  const recs = [
    rec('20220310','公開招標公告','111年度昇降機維護工作','A-111'),
    rec('20230314','公開招標公告','112年度昇降機維護工作','A-112'),
    rec('20240312','公開招標公告','113年度昇降機維護工作','A-113'),
    rec('20250311','公開招標公告','114年度昇降機維護工作','A-114'),
    rec('20260309','公開招標公告','115年度昇降機維護工作','A-115'),
    rec('20260320','公開招標更正公告','115年度昇降機維護工作','A-115'),
    rec('20260415','決標公告','114年度昇降機維護工作','A-114')
  ];
  const s = app.buildSeries(recs);
  assert.equal(s.length, 1, '應該只認出一個系列');
  const x = s[0];
  assert.equal(x.count, 5, '更正公告與決標公告都不該被算成一次招標');
  assert.equal(x.yearly.length, 5);
  assert.ok(Math.abs(x.gap - 365) <= 5, '年度案的間隔中位數應接近 365，實得 ' + x.gap);
  assert.equal(x.monthMode, 3);
  assert.equal(x.monthHits, 5);
  assert.equal(x.next.getFullYear(), 2027, '下次預估應落在 2027 年');
});

test('buildSeries 認得兩年一次的系列，且單次案不算系列', () => {
  const recs = [
    rec('20210620','公開招標公告','110~111年控制閥大修維護工作','C-110'),
    rec('20230625','公開招標公告','112~113年控制閥大修維護工作','C-112'),
    rec('20250627','公開招標公告','114~115年控制閥大修維護工作','C-114'),
    rec('20260101','公開招標公告','115年度只辦過一次的特別採購','Z-1')
  ];
  const s = app.buildSeries(recs);
  assert.equal(s.length, 1, '只出現一次的標案不應被當成系列');
  assert.ok(s[0].gap > 700 && s[0].gap < 760, '兩年一次的間隔應約 730 天，實得 ' + s[0].gap);
});

test('cycleLabel 只把接近真實週期的間隔標為規律', () => {
  const c = app.cycleLabel;
  assert.equal(c(365).label, '年度');   assert.equal(c(365).ok, true);
  assert.equal(c(370).label, '年度');
  assert.equal(c(730).label, '兩年一次');
  assert.equal(c(1095).label, '三年一次');
  // 實測在台電資料裡踩到的：流標後 174 天重招，不可被當成半年週期。
  // 刻意不設「半年」類 —— 單一個 150~250 天的間隔無法跟流標重招區分。
  assert.equal(c(174).ok, false, '174 天應判為不規律');
  assert.equal(c(183).ok, false, '刻意不把 183 天當成規律的半年週期');
  assert.equal(c(250).ok, false);
  assert.equal(c(500).ok, false);
});

test('buildSeries 不把跨曆年的流標重招算成短週期（實測踩到的 bug）', () => {
  // 台電實例：2025/08/14 招標 → 流標 → 2026/02/04 重招，相隔 174 天。
  // 原本按「每曆年取最早一次」去重，這兩筆分屬 2025 與 2026 年而雙雙留下，
  // 於是 174 天被當成半年一次的循環，還跟 5/5 命中的年度案並列。
  const recs = [
    rec('20250814','公開招標公告','114年緊急應變中心設施更新','F-114'),
    rec('20260204','公開招標公告','115年緊急應變中心設施更新','F-115')
  ];
  const s = app.buildSeries(recs);
  assert.equal(s.length, 0, '相隔不到 240 天應收攏成同一輪，收攏後只剩一輪就不算系列');
});

test('buildSeries 收攏同一輪，但保留真正的年度間隔', () => {
  const recs = [
    rec('20250310','公開招標公告','114年度清潔勞務工作','B-114'),
    rec('20250420','公開招標公告','114年度清潔勞務工作（第2次）','B-114-2'), // 41 天後重招 → 同一輪
    rec('20260315','公開招標公告','115年度清潔勞務工作','B-115')
  ];
  const s = app.buildSeries(recs);
  assert.equal(s.length, 1);
  assert.equal(s[0].count, 2, '同一輪的重招不該讓輪數變成 3');
  assert.ok(Math.abs(s[0].gap - 370) <= 10, '間隔應是 2025/03→2026/03，實得 ' + s[0].gap);
  assert.equal(s[0].regular, true);
  assert.equal(s[0].cycle, '年度');
});

test('buildSeries 不規律的系列會被標記且排在規律的後面', () => {
  const recs = [
    // 規律年度案
    rec('20240310','公開招標公告','113年度昇降機維護工作','A-113'),
    rec('20250311','公開招標公告','114年度昇降機維護工作','A-114'),
    rec('20260309','公開招標公告','115年度昇降機維護工作','A-115'),
    // 間隔 250 天，不規律
    rec('20250101','公開招標公告','某偶發設施改善工程','G-1'),
    rec('20250908','公開招標公告','某偶發設施改善工程','G-2')
  ];
  const s = app.buildSeries(recs);
  assert.equal(s.length, 2);
  assert.equal(s[0].regular, true, '規律的應排在前面');
  assert.equal(s[1].regular, false);
  assert.equal(s[1].cycle, '不規律');
});

test('unitRecKey 能認出分頁重抓造成的完全重複，但不誤殺同案同日的不同紀錄', () => {
  const k = app.unitRecKey;
  const a = { filename:'RML-1-70008398', job_number:'0141300008', date:20260707,
              brief:{ type:'拒絕往來廠商名單公告', title:'X', companies:{ names:['協富消防安全設備股份有限公司'] } } };
  const aCopy = JSON.parse(JSON.stringify(a));
  // 實測案例：同案號、同日、同類型，但廠商與 filename 不同 —— 這是兩筆不同的紀錄
  const b = { filename:'RML-1-70008397', job_number:'0141300008', date:20260707,
              brief:{ type:'拒絕往來廠商名單公告', title:'X', companies:{ names:['世詠消防安全設備有限公司'] } } };
  assert.equal(k(a), k(aCopy), '一字不差的重複應產生同一個鍵');
  assert.notEqual(k(a), k(b), '同案同日不同廠商不可被當成重複');
});

test('buildSeries 同年多次招標只取當年最早一次', () => {
  const recs = [
    rec('20250310','公開招標公告','114年度清潔勞務工作','B-114'),
    rec('20250620','公開招標公告','114年度清潔勞務工作（第2次）','B-114-2'),
    rec('20260315','公開招標公告','115年度清潔勞務工作','B-115')
  ];
  const s = app.buildSeries(recs);
  assert.equal(s.length, 1);
  assert.equal(s[0].count, 2, '同一年的重招不該讓次數變成 3');
  assert.ok(Math.abs(s[0].gap - 370) <= 10, '間隔應是 2025/03→2026/03，實得 ' + s[0].gap);
});

test('buildFailed 分出已重招與尚未重招', () => {
  const recs = [
    rec('20260401','無法決標公告','115年度輸卸煤系統空調設備維護工作','D-115'),
    rec('20260520','公開招標公告','115年度輸卸煤系統空調設備維護工作（第2次）','D-115-2'),
    rec('20260820','無法決標公告','115年泛水機組勵磁系統PLC購置','E-115')
  ];
  const f = app.buildFailed(recs);
  assert.equal(f.length, 2);
  assert.equal(f[0].date, '20260820', '應依流標日新到舊排序');
  assert.equal(f[0].reDate, null, '這筆還沒重招');
  const done = f.find(x => x.job === 'D-115');
  assert.equal(done.reDate, '20260520');
  assert.equal(done.lag, 49, '流標到重招應為 49 天');
});

test('median 處理奇偶數與空陣列', () => {
  assert.equal(app.median([1,2,3]), 2);
  assert.equal(app.median([1,2,3,4]), 3);   // 偶數取兩中位數平均後四捨五入
  assert.equal(app.median([]), null);
});

test('cmpLabel / cmpSection 拆解公告欄位的分區前綴', () => {
  assert.equal(app.cmpLabel('招標資料:是否屬統包'), '是否屬統包');
  assert.equal(app.cmpSection('招標資料:是否屬統包'), '招標資料');
  assert.equal(app.cmpLabel('領投標資料:是否須繳納押標金:押標金額度'), '押標金額度');
  assert.equal(app.cmpSection('領投標資料:是否須繳納押標金:押標金額度'), '領投標資料');
  assert.equal(app.cmpSection('fetched_at'), '其他');
});
