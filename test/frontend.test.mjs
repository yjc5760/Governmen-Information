/**
 * 前端邏輯測試：node --test  （或 npm test）
 *
 * 不需要瀏覽器，也不裝任何額外套件。做法是把 標案參謀室.html 裡最大的那段
 * <script> 抽出來，丟進 node:vm，配一組剛好夠用的 DOM 假物件執行，
 * 然後直接呼叫裡面的純函式。函式宣告會成為 vm context 的屬性，所以取得到。
 *
 * 這裡只測「算得對不對」的純邏輯（發包週期、流標重招、系列鍵正規化、
 * 集中度、落標率、金額取值、廠商快照），不測畫面。畫面行為請用瀏覽器實際點。
 *
 * 注意跨 realm 的坑：函式在 vm 沙箱裡建立的物件／陣列，原型屬於沙箱的 realm，
 * 所以 assert.deepEqual（strict 模式下即 deepStrictEqual）會因原型不符而失敗，
 * 即使值一模一樣。比較這類回傳值請改用 JSON.stringify。
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

test('pickDriver 依選擇性挑主查詢：統編 › 廠商名稱 › 標案名稱', () => {
  const f = app.pickDriver;
  // API 一次只能用一個條件查，所以要挑選擇性最高的當主查詢
  assert.equal(f({vid:'12345678', vendor:'中興', title:'統包'}), 'vid', '統編最精確');
  assert.equal(f({vendor:'中興', title:'統包'}), 'vendor');
  assert.equal(f({title:'統包'}), 'title');
  // 機關不能當主查詢——API 沒有機關查詢端點
  assert.equal(f({agency:'台灣電力'}), null, '只填機關時沒有可用的主查詢');
  assert.equal(f({agency:'台灣電力', title:'統包'}), 'title', '機關只能當前端篩選');
  assert.equal(f({}), null);
  assert.equal(f(null), null);
});

test('driverEndpoint 對應到正確的 API 端點', () => {
  assert.equal(app.driverEndpoint('title'), 'searchbytitle');
  assert.equal(app.driverEndpoint('vendor'), 'searchbycompanyname');
  assert.equal(app.driverEndpoint('vid'), 'searchbycompanyid');
  assert.equal(app.driverEndpoint('agency'), null, '機關沒有對應端點');
  assert.equal(app.driverEndpoint(null), null);
});

test('applyConds 四個條件是 AND，且不複篩主查詢欄位', () => {
  const mk = (agency,title,names,ids) =>
    ({ unit_name:agency, brief:{ type:'決標公告', title, companies:{ names, ids } } });
  const recs = [
    mk('台灣電力股份有限公司大林發電廠','#1機統包工程',['中興工程顧問股份有限公司'],['12345678']),
    mk('台灣電力股份有限公司大林發電廠','例行維護工作',['中興工程顧問股份有限公司'],['12345678']),
    mk('台灣中油股份有限公司','#2機統包工程',['中興工程顧問股份有限公司'],['12345678']),
    mk('台灣電力股份有限公司大林發電廠','#3機統包工程',['別家工程有限公司'],['87654321'])
  ];
  const c = { title:'統包', agency:'台灣電力', vendor:'中興', vid:'' };
  // 四個條件同時成立，只有第 1 筆
  assert.equal(app.applyConds(recs, c, null).length, 1);
  assert.equal(app.applyConds(recs, c, null)[0].brief.title, '#1機統包工程');

  // skip 主查詢欄位：伺服器已比對過，不再複篩（免得比伺服器更嚴而誤刪）
  const skipped = app.applyConds(recs, c, 'title');
  assert.equal(skipped.length, 2, '跳過標案名稱後，大林+中興的兩筆都留下');

  // 統編條件
  assert.equal(app.applyConds(recs, {vid:'87654321'}, null).length, 1);
  // 沒有任何條件 → 原樣回傳
  assert.equal(app.applyConds(recs, {}, null).length, 4);
});

test('matchAgencies 從機關索引比對，短名稱（上層機關）排前面', () => {
  // 機關索引是「機關 AND 標案名稱」能不能走精準路徑的依據
  app.noteAgency('3.13.31',    '台灣電力股份有限公司');
  app.noteAgency('3.13.31.48', '台灣電力股份有限公司大林發電廠');
  app.noteAgency('3.13.31.49', '台灣電力股份有限公司興達發電廠');
  app.noteAgency('3.9.1',      '台灣中油股份有限公司');

  const many = app.matchAgencies('台灣電力');
  assert.equal(many.length, 3, '台灣電力應命中總公司與兩個電廠');
  assert.equal(many[0][0], '台灣電力股份有限公司', '較短的排前面');
  assert.equal(many[0][1], '3.13.31', '要帶回 unit_id');

  const one = app.matchAgencies('大林發電廠');
  assert.equal(one.length, 1, '唯一命中才會走精準路徑');
  assert.equal(one[0][1], '3.13.31.48');

  assert.equal(app.matchAgencies('發電廠').length, 2);
  assert.equal(app.matchAgencies('完全不存在的機關').length, 0);
  assert.equal(app.matchAgencies('').length, 0);
  assert.equal(app.matchAgencies(null).length, 0);
  assert.equal(app.matchAgencies('  ').length, 0, '空白字串不可命中全部');
});

test('sameVendor 認得同一家廠商的不同寫法', () => {
  const f = app.sameVendor;
  // 廠商查詢回傳的名稱可能帶英文後綴
  assert.ok(f('中興工程顧問股份有限公司 (Sinotech Engineering Consultants, Ltd.)', '中興工程顧問'));
  assert.ok(f('中興工程顧問股份有限公司', '中興工程顧問'));
  assert.ok(f('中興工程顧問', '中興工程顧問股份有限公司'), '兩個方向都要成立');
  assert.ok(!f('中興工程顧問', '台灣世曦工程顧問'));
  assert.ok(!f('', '中興工程顧問'));
  assert.ok(!f('中興工程顧問', ''));
});

test('isRealAward 只認真正的決標公告', () => {
  const f = app.isRealAward;
  assert.equal(f('決標公告'), true);
  assert.equal(f('更正決標公告'), false, '更正不能重複計入');
  assert.equal(f('無法決標公告'), false);
  assert.equal(f('更正無法決標公告'), false);
  assert.equal(f('定期彙送'), false);
  assert.equal(f('公開招標公告'), false);
  assert.equal(f(''), false);
});

test('buildVendorSnap 算出決標件數、機關分布與共同投標夥伴', () => {
  const SELF1 = '中興工程顧問股份有限公司 (Sinotech Engineering Consultants, Ltd.)';
  const SELF2 = '中興工程顧問股份有限公司';
  const PARTNER = '杜風工程顧問有限公司';
  const mk = (t, agency, names) => ({ u:'U', n:agency, d:'20260301', j:'J', t, ti:'案', c:names });
  const recs = [
    mk('決標公告','台北市政府',[SELF1, SELF2, PARTNER]),   // 自己出現兩種寫法 + 一個夥伴
    mk('決標公告','台北市政府',[SELF2]),
    mk('決標公告','新北市政府',[SELF2, PARTNER]),
    mk('更正決標公告','台北市政府',[SELF2]),                // 不算決標
    mk('更正無法決標公告','台北市政府',[]),                  // 不算決標
    mk('定期彙送','雜訊機關',[]),                            // 不算決標
    mk('無法決標公告','台北市政府',[])                       // 不算決標
  ];
  const sn = app.buildVendorSnap('中興工程顧問', { recs, total:4681, tp:47, pages:3 });
  assert.equal(sn.awards, 3, '只有 3 筆真決標');
  assert.equal(sn.corrections, 2, '更正決標與更正無法決標都算更正');
  assert.equal(sn.fetched, 7);
  assert.equal(sn.total, 4681);
  // 跨 realm：用 JSON 比較，不用 deepEqual（見檔頭說明）
  assert.equal(JSON.stringify(sn.agencies), JSON.stringify([['台北市政府',2],['新北市政府',1]]),
    '機關統計只看真決標');
  assert.equal(JSON.stringify(sn.partners), JSON.stringify([[PARTNER,2]]),
    '自己不可被算成夥伴，且同一案只算一次');
  assert.ok(sn.partners.every(x => x[0].indexOf('中興') < 0), '含英文後綴的自己也要排除');
});

test('gateBlock 標出投標門檻，沒門檻時明說沒有', () => {
  const demanding = {
    '招標資料:是否屬統包':'是',
    '招標資料:是否應依公共工程專業技師簽證規則實施技師簽證':'是',
    '招標資料:是否屬特殊採購':'是',
    '招標資料:決標方式':'最低標',
    '招標資料:是否訂有底價':'否',
    '採購資料:是否適用條約或協定之採購:是否適用WTO政府採購協定(GPA)':'是',
    '領投標資料:是否須繳納押標金:押標金額度':'標價之百分之五',
    '領投標資料:是否須繳納履約保證金':'是'
  };
  const h = app.gateBlock(demanding);
  assert.match(h, /8 項需要留意/);
  assert.match(h, /統包，需設計與施工整合/);
  assert.match(h, /須依技師簽證規則辦理/);
  assert.match(h, /以價格競爭為主/);
  assert.match(h, /未訂底價/);
  assert.match(h, /外商可參與/);
  assert.match(h, /須繳押標金/);
  assert.match(h, /須繳履約保證金/);

  const easy = {
    '招標資料:是否屬統包':'否',
    '招標資料:是否應依公共工程專業技師簽證規則實施技師簽證':'否',
    '招標資料:決標方式':'最有利標',
    '招標資料:是否訂有底價':'是',
    '領投標資料:是否須繳納押標金':'否',
    '領投標資料:是否須繳納履約保證金':'否'
  };
  assert.match(app.gateBlock(easy), /沒有額外門檻/);
  assert.equal(app.gateBlock(null), '');
  assert.equal(app.gateBlock({}), '');
});

test('pickMoney 不會被「是否公開」與 remind 說明騙走（實測踩到的 bug）', () => {
  // 這是真實的決標公告 detail 鍵順序：「是否公開」排在金額前面。
  // 原本用 pick() 子字串比對會先撞到它，parseMoney('是') = 0，
  // 導致落標率與「決標／預算比」永遠算不出來、標案詳情的採購預算顯示「是」。
  const award = {
    '投標廠商:投標廠商2:決標金額': '4,788,000元',
    '決標品項:第1品項:得標廠商1:決標金額': '4,788,000元',
    '決標資料:總決標金額:remind': '決標金額是否係依預估條件估算之預估金額。估算方式：本案採實做實算。',
    '決標資料:總決標金額': '4,788,000元',
    '決標資料:總決標金額是否公開': '是',
    '已公告資料:預算金額是否公開': '是',
    '已公告資料:預算金額': '5,853,750元'
  };
  assert.equal(app.pickMoney(award, ['預算金額']), 5853750, '不可取到「是」');
  assert.equal(app.pickMoney(award, ['總決標金額','決標金額']), 4788000, '要取總額，不是單一廠商金額');
  assert.equal(app.pickMoney({}, ['預算金額']), null);
  assert.equal(app.pickMoney(null, ['預算金額']), null);

  // 招標公告的鍵順序相反（金額在前），兩種順序都要對
  const tender = { '採購資料:預算金額': '5,853,750元', '採購資料:預算金額是否公開': '是' };
  assert.equal(app.pickMoney(tender, ['預算金額']), 5853750);

  // 只有「是否公開」而沒有金額時，必須回 null 而不是 0 或「是」
  assert.equal(app.pickMoney({ '已公告資料:預算金額是否公開':'否' }, ['預算金額']), null);
});

test('pickMoneyAcross 決標公告沒有預算時回頭找招標公告', () => {
  const records = [
    { detail: { '採購資料:預算金額': '1,000,000元' } },              // 招標公告
    { detail: { '決標資料:總決標金額': '900,000元' } }                // 決標公告（無預算欄位）
  ];
  assert.equal(app.pickMoneyAcross(records, ['預算金額']), 1000000);
  assert.equal(app.pickMoneyAcross(records, ['總決標金額']), 900000);
  assert.equal(app.pickMoneyAcross([], ['預算金額']), null);
  assert.equal(app.pickMoneyAcross(null, ['預算金額']), null);
});

test('budgetStr 回傳純數字字串，讓顯示端能 parseMoney', () => {
  const award = { '已公告資料:預算金額是否公開':'是', '已公告資料:預算金額':'5,853,750元' };
  assert.equal(app.budgetStr(award, []), '5853750');
  // 決標公告沒有預算欄位時，退回整案紀錄去找
  assert.equal(app.budgetStr({}, [{ detail:{ '採購資料:預算金額':'2,500,000元' } }]), '2500000');
  assert.equal(app.budgetStr({}, []), '');
});

test('concentration 算出 CR 與 HHI', () => {
  // A 5 件、B 3 件、C 2 件，共 10 件
  // CR1 = 50%、CR3 = 100%、HHI = 50² + 30² + 20² = 3800 → 高度集中
  const vs = [{name:'A',count:5},{name:'B',count:3},{name:'C',count:2}];
  const c = app.concentration(vs);
  assert.equal(c.vendors, 3);
  assert.equal(c.totalCount, 10);
  assert.equal(c.cr1, 0.5);
  assert.equal(c.cr3, 1);
  assert.equal(c.hhi, 3800);
  assert.equal(c.band, '高度集中');
  // 獨家包走 → HHI 上限 10000
  assert.equal(app.concentration([{name:'X',count:6}]).hhi, 10000);
  // 十家均分 → HHI = 10 × 10² = 1000 → 分散
  const ten = Array.from({length:10}, (_,i) => ({name:'V'+i, count:1}));
  assert.equal(app.concentration(ten).hhi, 1000);
  assert.equal(app.concentration(ten).band, '分散');
  // 分級門檻：佔比 30/25/20/15/10 → HHI = 900+625+400+225+100 = 2250 → 中度集中
  const mid = app.concentration([{name:'A',count:30},{name:'B',count:25},
    {name:'C',count:20},{name:'D',count:15},{name:'E',count:10}]);
  assert.equal(mid.hhi, 2250);
  assert.equal(mid.band, '中度集中');
  // 35/35/30 的 HHI 是 3350，已經算高度集中（門檻 2500）
  assert.equal(app.concentration([{name:'A',count:35},{name:'B',count:35},{name:'C',count:30}]).hhi, 3350);
  assert.equal(app.concentration([]), null);
});

test('ratioStats 算落標率中位數與分佈', () => {
  const rows = [0.60,0.85,0.90,1.05].map((ratio,i) =>
    ({ ratio, job:'J'+i, title:'案'+i, date:'2025'+String(i+1).padStart(2,'0')+'01',
       award:ratio*1e6, budget:1e6, year:'2025' }));
  const st = app.ratioStats(rows);
  assert.equal(st.n, 4);
  assert.equal(st.median, 0.875, '偶數筆應取兩中位數平均，不可四捨五入');
  const d = Object.fromEntries(st.dist);
  assert.equal(d['< 70%'], 1);
  assert.equal(d['80–90%'], 1);
  assert.equal(d['90–95%'], 1);
  assert.equal(d['≥ 100%'], 1);
  assert.equal(d['70–80%'], 0);
  assert.equal(st.lowest[0].ratio, 0.60, '最低的排第一');
  assert.equal(st.highest[0].ratio, 1.05, '最高的排第一');
  assert.equal(st.years.length, 1);
  assert.equal(st.years[0].n, 4);
  assert.equal(app.ratioStats([]), null);
});

test('debarredList 抓出停權公告並保留各廠商', () => {
  const rec = (date,type,title,job,vendors=[]) =>
    ({ date, job_number:job, brief:{ type, title, companies:{ names:vendors, ids:[] } } });
  const recs = [
    rec('20260105','拒絕往來廠商名單公告','違約案','D1',['甲公司']),
    rec('20260106','拒絕往來廠商名單公告','違約案','D2',['乙公司']),
    rec('20260107','拒絕往來廠商名單更正公告','違約案','D3',['丙公司']),
    rec('20260108','決標公告','一般案','A1',['丁公司'])
  ];
  const list = app.debarredList(recs);
  assert.equal(list.length, 3, '只取拒絕往來相關公告');
  assert.equal(list[0].date, '20260107', '應依日期新到舊');
  assert.equal(list[0].correction, true, '更正公告要標記');
  assert.equal(list[2].correction, false);
  assert.equal(JSON.stringify(list[1].vendors), JSON.stringify(['乙公司']));
});

test('snapNum 抽數字時要先去掉千分位（否則 1,200 會輸給 999）', () => {
  const f = app.snapNum;
  assert.equal(f('1,200'), 1200);
  assert.equal(f('999'), 999);
  assert.ok(f('1,200') > f('999'), '這正是加逗號前會弄錯的比較');
  assert.equal(f('12,936'), 12936);
  assert.equal(f('16.7%'), 16.7);
  assert.equal(f('87.5% <span class="x">4 案</span>'), 87.5, '要先去掉 HTML 標籤');
  assert.equal(f('10,000（高度集中）'), 10000);
  assert.equal(f('—'), null);
  assert.equal(f(null), null);
});

test('medianF 不四捨五入（落標率要保留小數）', () => {
  assert.equal(app.medianF([1,2,3]), 2);
  assert.equal(app.medianF([0.85,0.90]), 0.875);
  assert.equal(app.medianF([]), null);
});

test('cmpLabel / cmpSection 拆解公告欄位的分區前綴', () => {
  assert.equal(app.cmpLabel('招標資料:是否屬統包'), '是否屬統包');
  assert.equal(app.cmpSection('招標資料:是否屬統包'), '招標資料');
  assert.equal(app.cmpLabel('領投標資料:是否須繳納押標金:押標金額度'), '押標金額度');
  assert.equal(app.cmpSection('領投標資料:是否須繳納押標金:押標金額度'), '領投標資料');
  assert.equal(app.cmpSection('fetched_at'), '其他');
});
