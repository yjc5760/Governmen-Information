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

test('jsArg 讓字串能安全塞進 HTML 屬性', () => {
  const f = app.jsArg;
  // JSON.stringify 產生的雙引號會把 onchange="..." 屬性截斷，必須轉成 &quot;
  assert.equal(f('亞新工程顧問'), '&quot;亞新工程顧問&quot;');
  assert.ok(!f('亞新工程顧問').includes('"'), '輸出不可含裸雙引號');
  // 名稱本身含引號、& 也要安全
  assert.ok(!f('某公司"特殊"名').includes('&quot;某公司"'), '內層引號也要跳脫');
  assert.ok(!/[^&]"/.test(f('A&B "C"')), '所有裸雙引號都要處理掉');
  assert.equal(f('A&B'), '&quot;A&amp;B&quot;');
  assert.equal(f(null), '&quot;&quot;');
  assert.equal(f(undefined), '&quot;&quot;');
  // 解碼回來要能還原成原字串（模擬瀏覽器解析屬性）
  const decode = t => t.replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  for (const v of ['亞新工程顧問','A&B','含"引號"的名稱',"含'單引號'"]) {
    assert.equal(JSON.parse(decode(f(v))), v, '往返後必須等於原字串：' + v);
  }
});

test('原始碼裡不可再出現「把 JSON.stringify 直接塞進事件屬性」的寫法', () => {
  // 這是實際發生過的 bug：屬性是雙引號包的，JSON.stringify 產生的字串也帶雙引號，
  //   onchange="toggleVsnapSel("亞新工程顧問",this.checked)"
  //                            ↑ HTML 解析器在這裡就把屬性結束掉
  // handler 變成語法錯誤，按鈕完全沒反應。當時廠商對比、機關對比的核取方塊、
  // 快速加入對手、更新／移除、重試按鈕全都是死的，而單元測試因為直接呼叫函式
  // 而不是點擊，完全沒抓到。這個測試掃原始碼，從源頭擋掉。
  const html = fs.readFileSync(HTML, 'utf8');
  const bad = [...html.matchAll(/on(?:click|change|input|submit)="[^"]*'\s*\+\s*JSON\.stringify\(/g)];
  assert.equal(bad.length, 0,
    '事件屬性裡要用 jsArg() 而不是 JSON.stringify()，發現 ' + bad.length + ' 處：' +
    bad.map(m => m[0]).join(' / '));
  // 而且 jsArg 必須真的有被用在事件屬性裡（避免有人把它整個拿掉）
  assert.ok(/on(?:click|change)="[^"]*'\s*\+\s*jsArg\(/.test(html),
    '事件屬性應該要透過 jsArg() 傳字串參數');
});

test('「只清快取」的名單不可誤含使用者資料', () => {
  // clearCaches() 會刪掉 CACHE_KEYS 裡的每個鍵。萬一有人把 TRACKED 之類加進去，
  // 使用者按「只清快取」就會靜靜失去自己輸入的資料——這個測試守著那條線。
  const cache = app.cacheKeyNames();
  const mustKeep = ['TRACKED','COMPARE','WATCH','RIVALS','AGENCY','CMPVIEW','BASE','TOKEN','PROXY'];
  mustKeep.forEach(k => assert.ok(cache.indexOf(k) < 0, k + ' 是使用者資料，不可列入可清除的快取'));
  // 反向：真正的快取都該在名單裡，否則「只清快取」清不乾淨、配額還是滿的
  ['DAYCACHE','AMOUNT','SNAP','VSNAP'].forEach(k =>
    assert.ok(cache.indexOf(k) >= 0, k + ' 是可重建的快取，應列入'));
  // 兩份名單必須把所有鍵剛好切開，沒有漏也沒有重複
  const user = app.userKeyNames();
  assert.equal(cache.length + user.length, cache.concat(user).filter((v,i,a)=>a.indexOf(v)===i).length,
    '快取名單與使用者資料名單不可重疊');
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

test('公告類型判斷：統計用一案一筆，顯示用含更正（實測踩到的虛增 20.9%）', () => {
  // 台電總公司 30,000 筆的真實類型分布告訴我們：'更正決標公告' 含 '決標公告'，
  // 舊的 isAwardRec 因此把 2,709 筆更正算成決標，決標數虛增 20.9%。
  assert.equal(app.isAward('決標公告'), true);
  assert.equal(app.isAward('更正決標公告'), false, '更正不可重複計入');
  assert.equal(app.isAward('無法決標公告'), false);
  assert.equal(app.isAward('更正無法決標公告'), false);
  assert.equal(app.isAward('撤銷無法決標公告'), false);
  assert.equal(app.isAward('公開招標公告'), false);

  assert.equal(app.isFailedAward('無法決標公告'), true);
  assert.equal(app.isFailedAward('更正無法決標公告'), false);
  assert.equal(app.isFailedAward('撤銷無法決標公告'), false, '撤銷流標語意相反，不是流標');
  assert.equal(app.isFailedAward('決標公告'), false);

  // 招標：這些名稱不含 '招標公告'，舊寫法會漏掉
  assert.equal(app.isTender('公開招標公告'), true);
  assert.equal(app.isTender('限制性招標(經公開評選或公開徵求)公告'), true, '1,109 筆曾被漏掉');
  assert.equal(app.isTender('選擇性招標(建立合格廠商名單)公告'), true);
  assert.equal(app.isTender('公開取得報價單或企劃書公告'), true);
  // 這些含 '招標' 或 '公開取得' 但不是招標本身
  assert.equal(app.isTender('招標文件公開閱覽公告資料公告'), false, '公開閱覽是招標前置作業');
  assert.equal(app.isTender('公開徵求廠商提供參考資料公告'), false);
  assert.equal(app.isTender('公開招標更正公告'), false);
  assert.equal(app.isTender('公開取得報價單或企劃書更正公告'), false, '更正不算一次招標');
  assert.equal(app.isTender('定期彙送'), false);
  assert.equal(app.isTender('財物變賣公告'), false);
  assert.equal(app.isTender('決標公告'), false);

  assert.equal(app.isDebarred('拒絕往來廠商名單公告'), true);
  assert.equal(app.isDebarred('拒絕往來廠商名單更正公告'), false);

  // 顯示用：更正該一起顯示，但無法決標絕不能混進「只看決標公告」
  assert.equal(app.isAwardNotice('決標公告'), true);
  assert.equal(app.isAwardNotice('更正決標公告'), true, '更正決標也是決標資訊');
  assert.equal(app.isAwardNotice('無法決標公告'), false, '這是「只看決標公告」原本多列 2,937 筆的原因');
  assert.equal(app.isTenderNotice('公開招標更正公告'), true);
  assert.equal(app.isTenderNotice('無法決標公告'), false);
  assert.equal(app.isTenderNotice('定期彙送'), false);
});

test('用真實類型分布驗證決標數不再虛增', () => {
  // 這是台電總公司 3.13.31 實測 30,000 筆的分布（節錄相關類型）
  const dist = { '決標公告':12936, '更正決標公告':2709, '無法決標公告':2937,
                 '更正無法決標公告':63, '撤銷無法決標公告':1, '公開招標公告':3943,
                 '限制性招標(經公開評選或公開徵求)公告':1109, '公開招標更正公告':768,
                 '招標文件公開閱覽公告資料公告':243, '定期彙送':938 };
  const sum = pred => Object.entries(dist).reduce((n,[t,c]) => n + (pred(t)?c:0), 0);
  assert.equal(sum(app.isAward), 12936, '決標數必須只有真正的決標公告');
  assert.equal(sum(app.isFailedAward), 2937, '流標數不含更正與撤銷');
  assert.equal(sum(app.isAwardNotice), 12936+2709, '顯示用含更正決標');
  assert.equal(sum(t=>t.indexOf('決標')>=0), 12936+2709+2937+63+1,
    '這是舊的「只看決標」寫法會撈到的量，用來對照');
});

/* 這三筆 name_key 是 2026-09 從 pcc-api 抓下來的原文，不是編的。
   案號 6331300004「台中電廠第二期新建燃氣機組計畫-電廠工程委託技術服務」，
   台電核能火力發電工程處。泰興投標落標、吉興投標得標，兩家都列在 names 裡，
   第三個名字只是泰興自己的英文名。 */
const REAL_6331300004 = {
  names: [
    '泰興工程顧問股份有限公司 (PACIFIC ENGINEERS & CONSTRUCTORS LTD.)',
    '吉興工程顧問股份有限公司 (GIBSIN Engineers, Ltd.)',
    'PACIFIC ENGINEERS & CONSTRUCTORS LTD.'
  ],
  name_key: {
    'PACIFIC ENGINEERS & CONSTRUCTORS LTD.': ['英文公告:廠商名稱'],
    '吉興工程顧問股份有限公司 (GIBSIN Engineers, Ltd.)':
      ['投標廠商:投標廠商2:廠商名稱', '決標品項:第1品項:得標廠商1:得標廠商'],
    '泰興工程顧問股份有限公司 (PACIFIC ENGINEERS & CONSTRUCTORS LTD.)':
      ['投標廠商:投標廠商1:廠商名稱', '決標品項:第1品項:未得標廠商1:未得標廠商']
  }
};
const TAI = REAL_6331300004.names[0];
const GIB = REAL_6331300004.names[1];

test('splitCompanies 用 name_key 分出勝負，並濾掉自己的英文名', () => {
  const out = app.splitCompanies(REAL_6331300004.names, REAL_6331300004.name_key);
  assert.equal(out.length, 2, '純英文名變體不可被當成第三家廠商');
  assert.equal(JSON.stringify(out.map(o => [o.name, o.won, o.lost])),
    JSON.stringify([[TAI, false, true], [GIB, true, false]]),
    '泰興落標、吉興得標');
});

test('recVendors 只回得標者，recBidders 回全部投標者', () => {
  const rec = { brief: { type: '決標公告', companies: REAL_6331300004 } };
  assert.equal(JSON.stringify(app.recVendors(rec)), JSON.stringify([GIB]),
    '得標統計不可把落標的泰興算進來');
  assert.equal(JSON.stringify(app.recBidders(rec)), JSON.stringify([TAI, GIB]),
    '顯示與比對要看得到所有投標廠商');
});

test('多品項一項得標一項落標，算得標', () => {
  // 2026-09-01「更正決標公告」實際資料：威農同一案有的品項得標、有的落標
  const names = ['威農農業資材行', '宏茂行'];
  const name_key = {
    '威農農業資材行': ['投標廠商:投標廠商6:廠商名稱',
      '決標品項:第1品項:得標廠商1:得標廠商', '決標品項:第14品項:未得標廠商2:未得標廠商'],
    '宏茂行': ['投標廠商:投標廠商7:廠商名稱', '決標品項:第3品項:未得標廠商2:未得標廠商']
  };
  const out = app.splitCompanies(names, name_key);
  assert.equal(JSON.stringify(out.map(o => [o.name, o.won, o.lost])),
    JSON.stringify([['威農農業資材行', true, true], ['宏茂行', false, true]]));
  assert.equal(JSON.stringify(app.winnersOf(out)), JSON.stringify(['威農農業資材行']));
});

test('共同投標得標的廠商也要算得標', () => {
  const name_key = { '甲工程': ['決標品項:第1品項:得標廠商1(共同投標廠商):得標廠商'] };
  const out = app.splitCompanies(['甲工程'], name_key);
  assert.equal(out[0].won, true, '(共同投標廠商) 後綴不可讓得標判斷失效');
  assert.equal(out[0].joint, true);
});

test('拒絕往來公告的廠商掛在標案內容，不能用得標欄位去撈', () => {
  // 2026-09-01 實際資料：僑邦室內裝修有限公司，key 是「標案內容:廠商名稱」
  const rec = { date: '20260901', job_number: 'X1',
    brief: { type: '拒絕往來廠商名單公告', title: '停權',
      companies: { names: ['僑邦室內裝修有限公司'],
                   name_key: { '僑邦室內裝修有限公司': ['標案內容:廠商名稱'] } } } };
  assert.equal(app.recVendors(rec).length, 0, '這種公告沒有得標廠商');
  const list = app.debarredList([rec]);
  assert.equal(list.length, 1);
  assert.equal(JSON.stringify(list[0].vendors), JSON.stringify(['僑邦室內裝修有限公司']),
    '拒絕往來名單必須列得出當事廠商');
});

test('完全沒有 name_key 時退回列出全部，而不是靜靜變空', () => {
  const rec = { brief: { type: '決標公告', companies: { names: ['甲', '乙'] } } };
  assert.equal(JSON.stringify(app.recVendors(rec)), JSON.stringify(['甲', '乙']));
});

test('buildVendorSnap 把共同得標夥伴與同場競標對手分開算', () => {
  const SELF = '泰興工程顧問';
  const mk = (t, agency, c, w) => ({ u:'U', n:agency, d:'20260301', j:'J', t, ti:'案', c, w });
  const recs = [
    mk('決標公告','台電核火處',[TAI, GIB],[GIB]),        // 自己落標，吉興得標 → 對手
    mk('決標公告','台電核火處',[TAI, '甲顧問'],[TAI]),    // 自己得標，甲落標 → 對手
    mk('決標公告','水利署',[TAI, '乙顧問'],[TAI, '乙顧問']), // 一起得標 → 夥伴
    mk('更正決標公告','台電核火處',[TAI],[TAI]),          // 不算決標
    mk('無法決標公告','台電核火處',[TAI],[])              // 不算決標
  ];
  const sn = app.buildVendorSnap(SELF, { recs, total:553, tp:6, pages:3 });
  assert.equal(sn.awards, 2, '只有真的得標的才算件數');
  assert.equal(sn.lostCases, 1, '同場落標要單獨算出來');
  assert.equal(JSON.stringify(sn.agencies),
    JSON.stringify([['台電核火處',1],['水利署',1]]), '機關只看得標的案子');
  assert.equal(JSON.stringify(sn.partners), JSON.stringify([['乙顧問',1]]),
    '夥伴只能是同案一起得標的');
  assert.equal(JSON.stringify(sn.rivals),
    JSON.stringify([['吉興工程顧問股份有限公司',1],['甲顧問',1]]),
    '吉興是對手不是夥伴');
  assert.ok(sn.partners.every(x => x[0].indexOf('泰興') < 0), '自己不可算成夥伴');
  assert.ok(sn.rivals.every(x => x[0].indexOf('泰興') < 0), '自己不可算成對手');
  assert.equal(sn.recent.length, 2, '最近得標只列真的得標的');
  assert.equal(sn.corrections, 1);
  assert.equal(sn.fetched, 5);
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

/* 這些標題都是 2026-09 從台電核能火力發電工程處（3.13.32.15）實際抓下來的原文。
   該機關 610 則決標裡有 170 則是契約變更（27.9%），不排除的話件數與落標率都會壞掉。 */
test('契約變更要排除，但不能誤殺真案子', () => {
  const 是變更 = [
    '台中電廠第二期新建燃氣機組計畫-電廠工程委託技術服務第3次契約變更',
    '台中1&2號機複循環機組採購案第八次契約變更「增設流量電腦報表計算參數及變更相關數值單位」',
    '龍門(核四)計畫一、二號機耐震級導引燈「增購支架材料一批」契約變更(第4次)',
    '大林電廠一、二號機組臨時供煤設施連續式卸煤機之契約變更案Amendment No.2',
    '龍門計畫一、二號機反應器圍阻體襯板組件契約「時程展延之契約變更」',
    // 全形康熙部首「⼗」(U+2F17)，不是「十」(U+5341)——用「第N次」比對會漏掉
    '⼤潭8&9號機主發電設備採購案第⼗一次契約變更-SYD CDCS RTU訊號整合'
  ];
  const 不是變更 = [
    '台中電廠第二期新建燃氣機組計畫-電廠工程委託技術服務',
    '通霄電廠二期更新改建計畫海底輸氣管線統包工程採購案',
    '某某道路工程變更設計委託技術服務',          // 「變更設計」是真案子
    '龍門計畫合約8749411E007C0增購試運轉期間必要之備品', // 「增購」也可能是真採購
    '「台中發電廠第2階段煤灰填海工程計畫」環境影響差異分析報告委託服務'
  ];
  是變更.forEach(t => assert.equal(app.isAmendment(t), true, '應判為契約變更：' + t));
  不是變更.forEach(t => assert.equal(app.isAmendment(t), false, '不可誤判為契約變更：' + t));
});

test('isAwardRec 排除更正、撤銷與契約變更', () => {
  const mk = (type, title) => ({ brief: { type, title } });
  assert.equal(app.isAwardRec(mk('決標公告', '某某統包工程')), true);
  assert.equal(app.isAwardRec(mk('決標公告', '某某工程第3次契約變更')), false, '契約變更不算一件決標');
  assert.equal(app.isAwardRec(mk('更正決標公告', '某某統包工程')), false);
  assert.equal(app.isAwardRec(mk('無法決標公告', '某某統包工程')), false);
  assert.equal(app.isAwardRec(mk('定期彙送', '某某統包工程')), false);
});

test('vendorStats 與 bidRatios 都不可把契約變更算進去', () => {
  const mk = (type, title, job, names) => ({ job_number: job, date: '20260301',
    brief: { type, title, companies: { names,
      name_key: Object.fromEntries(names.map(n => [n, ['決標品項:第1品項:得標廠商1:得標廠商']])) } } });
  const recs = [
    mk('決標公告', '原案：某某統包工程', 'J1', ['甲公司']),
    mk('決標公告', '某某統包工程第1次契約變更', 'J2', ['甲公司']),
    mk('決標公告', '某某統包工程第2次契約變更', 'J3', ['甲公司'])
  ];
  const vs = app.vendorStats(recs);
  assert.equal(vs.length, 1);
  assert.equal(vs[0].count, 1, '三則裡只有一則是真的決標，不是 3');
});

test('pickText 只吃鍵尾完全相符的欄位，不會撈到伴生欄位', () => {
  const d = {
    '無法決標公告:無法決標的理由:remind': '這是說明文字不是理由',
    '無法決標公告:無法決標的理由': '流標(無廠商投標或未達法定開標家數)',
    '無法決標公告:是否沿用本案號及原招標方式續行招標': '是'
  };
  assert.equal(app.pickText(d, ['無法決標的理由']), '流標(無廠商投標或未達法定開標家數)');
  assert.equal(app.pickText(d, ['是否沿用本案號及原招標方式續行招標']), '是');
  assert.equal(app.pickText(d, ['不存在的欄位']), '');
});

test('dayGap 算得出天數，壞日期回 null', () => {
  assert.equal(app.dayGap('20250814', '20260204'), 174);   // 實際的流標→重招間隔
  assert.equal(app.dayGap('20260301', '20260301'), 0);
  assert.equal(app.dayGap('', '20260301'), null);
  assert.equal(app.dayGap('2026', '20260301'), null);
});

test('flopSeries 串出流標序列，並分出成案與未成案', () => {
  const mk = (type, title, job, date) => ({ job_number: job, date, brief: { type, title } });
  const recs = [
    // A 案：招標 → 流標 → 招標 → 流標 → 決標（已成案）
    mk('公開招標公告', 'A 案', 'A', '20250101'),
    mk('無法決標公告', 'A 案', 'A', '20250201'),
    mk('公開招標公告', 'A 案', 'A', '20250301'),
    mk('無法決標公告', 'A 案', 'A', '20250401'),
    mk('決標公告',     'A 案', 'A', '20250501'),
    // B 案：流標三次，至今沒有決標
    mk('無法決標公告', 'B 案', 'B', '20250110'),
    mk('無法決標公告', 'B 案', 'B', '20250310'),
    mk('無法決標公告', 'B 案', 'B', '20250610'),
    // C 案：曾決標，但之後又流標 → 算未成案（那次決標是上一輪的事）
    mk('決標公告',     'C 案', 'C', '20250201'),
    mk('無法決標公告', 'C 案', 'C', '20250901'),
    // D 案：只有契約變更當決標 → 不可算成案
    mk('無法決標公告', 'D 案', 'D', '20250401'),
    mk('決標公告',     'D 案第1次契約變更', 'D', '20250501'),
    // E 案：從未流標，不該進清單
    mk('公開招標公告', 'E 案', 'E', '20250101'),
    mk('決標公告',     'E 案', 'E', '20250201')
  ];
  const rows = app.flopSeries(recs);
  assert.equal(rows.length, 4, '只有流過標的案號才進清單（E 案不該在）');
  assert.equal(rows[0].job, 'B', '流標次數最多的排最前');
  assert.equal(rows[0].fails, 3);
  assert.equal(JSON.stringify(rows[0].gaps), JSON.stringify([59, 92]), '間隔天數');
  assert.equal(rows[0].settled, false);

  const by = {}; rows.forEach(r => { by[r.job] = r; });
  assert.equal(by.A.settled, true, 'A 案最後一次流標之後有決標');
  assert.equal(by.A.settledDate, '20250501');
  assert.equal(by.A.span, 89, '第一次流標到成案的天數');
  assert.equal(by.C.settled, false, '決標在流標之前，不算成案');
  assert.equal(by.D.settled, false, '契約變更不能當成案');
  assert.equal(by.D.title, 'D 案', '標題取自流標公告，不是契約變更那則');
});

/* 這些公告類型名稱都是實際存在的變體（2026-09 實測），刻意混進容易誤判的鄰居 */
test('前置公告的類型判斷認得所有變體，也不誤收招標與決標', () => {
  const 公開閱覽 = ['招標文件公開閱覽公告資料公告', '招標文件公開閱覽公告資料'];
  const 公開徵求 = ['公開徵求廠商提供參考資料公告', '公開徵求廠商提供參考資料'];
  const 更正 = ['招標文件公開閱覽公告資料更正公告', '公開徵求廠商提供參考資料更正公告'];
  const 不是前置 = ['公開招標公告', '公開取得報價單或企劃書公告', '決標公告',
                   '無法決標公告', '經公開評選或公開徵求之限制性招標公告', '定期彙送'];
  公開閱覽.forEach(t => { assert.equal(app.isPreview(t), true, t); assert.equal(app.isPreTender(t), true, t); });
  公開徵求.forEach(t => { assert.equal(app.isRFI(t), true, t); assert.equal(app.isPreTender(t), true, t); });
  更正.forEach(t => assert.equal(app.isPreTender(t), false, '更正公告不另計一次：' + t));
  不是前置.forEach(t => assert.equal(app.isPreTender(t), false, t));
  // 「經公開評選或公開徵求之限制性招標公告」含「公開徵求」四個字，但它是招標公告
  assert.equal(app.isRFI('經公開評選或公開徵求之限制性招標公告'), false,
    '限制性招標含「公開徵求」字樣，不可誤判成 RFI');
  assert.equal(app.isTender('經公開評選或公開徵求之限制性招標公告'), true);
  // 前置公告不可被算進招標數
  公開閱覽.concat(公開徵求).forEach(t => assert.equal(app.isTender(t), false, '前置公告不是招標：' + t));
});

test('splitQual 拆出特定資格，沒有特定資格時回空字串', () => {
  // 興達電廠第二期更新改建計畫委託技術服務（6331400023a）公開閱覽公告原文
  const real = '基本資格:經中華民國政府機關核准設立之工程技術顧問公司，並加入全國商業同業公會或地方同業公會、納稅證明、信用證明。 特定資格:投標廠商於截止投標日前二十年內具有1部44萬瓩(含)以上之發電機組規劃設計整合之經驗，且該機組業已商轉，或前述期間累積110萬瓩(含)以上發電機組規劃設計整合之經驗，且該機組業已商轉。';
  const q = app.splitQual(real);
  assert.ok(q.special.indexOf('44萬瓩') >= 0, '特定資格要含門檻數字：' + q.special);
  assert.ok(q.special.indexOf('基本資格') < 0, '特定資格不可含基本資格那段');
  assert.ok(q.basic.indexOf('工程技術顧問公司') >= 0);
  assert.ok(q.basic.indexOf('44萬瓩') < 0, '基本資格不可含特定資格那段');

  const onlyBasic = app.splitQual('基本資格：具公司登記或商業登記、納稅證明。');
  assert.equal(onlyBasic.special, '', '沒有特定資格要回空字串，這本身是門檻低的訊號');
  assert.ok(onlyBasic.basic.indexOf('公司登記') >= 0);
  assert.equal(JSON.stringify(app.splitQual('')), JSON.stringify({ basic: '', special: '' }));
});

test('preTenderList 配對前置公告與招標，並標出反常資料', () => {
  const mk = (type, title, job, date) => ({ job_number: job, date, brief: { type, title } });
  const recs = [
    // A：公開閱覽 → 34 天後招標 → 決標（實測協和 LNG 那件的形狀）
    mk('招標文件公開閱覽公告資料公告', 'A 技術服務', 'A', '20260701'),
    mk('經公開評選或公開徵求之限制性招標公告', 'A 技術服務', 'A', '20260804'),
    mk('決標公告', 'A 技術服務', 'A', '20260930'),
    // B：公開閱覽，至今未招標（實測興達那件的形狀）
    mk('招標文件公開閱覽公告資料公告', 'B 委託技術服務', 'B', '20260714'),
    // C：公開徵求 → 招標
    mk('公開徵求廠商提供參考資料', 'C 設備採購', 'C', '20260601'),
    mk('公開招標公告', 'C 設備採購', 'C', '20260615'),
    // D：招標日早於前置公告日 —— 實測有這種反常資料
    mk('招標文件公開閱覽公告資料公告', 'D 工程', 'D', '20260801'),
    mk('公開招標公告', 'D 工程', 'D', '20260720'),
    // E：沒有前置公告，不該進清單
    mk('公開招標公告', 'E 工程', 'E', '20260101'),
    mk('決標公告', 'E 工程', 'E', '20260301')
  ];
  const rows = app.preTenderList(recs);
  assert.equal(rows.length, 4, '只有帶前置公告的案號才進清單（E 不該在）');
  assert.equal(rows[0].job, 'B', '真正還沒招標的排最前面（D 的日期反常，不算機會）');
  assert.equal(rows[0].tenderDate, null);
  assert.equal(rows[0].odd, false);
  assert.equal(rows[0].kind, '公開閱覽');

  const by = {}; rows.forEach(r => { by[r.job] = r; });
  assert.equal(by.A.gap, 34, '2026/07/01 → 08/04 是 34 天');
  assert.equal(by.A.awardDate, '20260930');
  assert.equal(by.A.odd, false);
  assert.equal(by.C.kind, '公開徵求');
  assert.equal(by.C.gap, 14);
  // D 的招標早於前置公告 → 不可配成 −12 天的間隔
  assert.equal(by.D.tenderDate, null, '前置公告之前的招標不可被配對');
  assert.equal(by.D.gap, null);
  assert.equal(by.D.odd, true, '要標成日期反常');
  assert.equal(by.D.oddTenderDate, '20260720');
  assert.equal(by.D.waiting, null, '日期反常的不可顯示成「已過 N 天還沒招標」');
});

test('preLeadStats 樣本不足不給推估，反常值不入統計', () => {
  const rows = [{ gap: 20 }, { gap: 28 }, { gap: 40 }, { gap: -12 }, { gap: 900 }, { gap: null }];
  const st = app.preLeadStats(rows);
  assert.equal(st.n, 3, '負值與超過 400 天的都要剔除');
  assert.equal(st.med, 28);
  assert.equal(app.preLeadStats([{ gap: null }]), null, '完全沒有可用樣本要回 null');
});

test('rivalEta 預估秒數會隨頁數增加，且不會回 0', () => {
  // vendorPages 是 let 宣告，vm 沙箱拿不到，所以只驗純函式部分
  assert.ok(app.rivalEta(1) >= 1, '再少也要回 1 秒，不可顯示「約 0 秒」');
  assert.ok(app.rivalEta(6) < app.rivalEta(16), '6 頁要比 16 頁快');
  assert.ok(app.rivalEta(16) < app.rivalEta(55), '16 頁要比 55 頁快');
  assert.ok(app.rivalEta(16) <= 30, '16 頁（亞新）實測 15 秒，預估不該離譜：' + app.rivalEta(16));
});

test('vsnapCoverage 把「為什麼只有這麼多」講成一句話', () => {
  const mk = (fetched, total, stop) => ({ fetched, total, stop });
  const done = app.vsnapCoverage(mk(553, 553, { reason: 'done' }));
  assert.equal(done.complete, true);
  assert.equal(done.ratio, 1);
  assert.ok(done.msg.indexOf('已抓完') >= 0);

  const cap = app.vsnapCoverage(mk(300, 1507, { reason: 'cap', page: 3 }));
  assert.equal(cap.complete, false);
  assert.ok(Math.abs(cap.ratio - 300 / 1507) < 1e-9);
  assert.ok(cap.msg.indexOf('頁數上限') >= 0, '要說是頁數上限：' + cap.msg);

  const empty = app.vsnapCoverage(mk(800, 5482, { reason: 'empty', page: 9 }));
  assert.equal(empty.complete, false);
  assert.ok(empty.msg.indexOf('第 9 頁') >= 0 && empty.msg.indexOf('空') >= 0,
    '空頁要指出是第幾頁：' + empty.msg);

  const fail = app.vsnapCoverage(mk(400, 5482, { reason: 'fail', page: 5, msg: 'Failed to fetch' }));
  assert.ok(fail.msg.indexOf('第 5 頁') >= 0 && fail.msg.indexOf('失敗') >= 0, fail.msg);

  // 舊快照沒有 stop 欄位時要當成已抓完，而不是爆掉
  const old = app.vsnapCoverage({ fetched: 60, total: 553 });
  assert.equal(old.complete, true);
  assert.equal(app.vsnapCoverage(null), null);
});

test('vsnapFairness：涵蓋率落差大就判定件數不可比', () => {
  const mk = (fetched, total) => ({ fetched, total, stop: { reason: 'cap' } });
  // 螢幕上那三家：300/553=54%、300/1507=20%、300/823=36% → 落差 2.7 倍
  const unfair = app.vsnapFairness([mk(300, 553), mk(300, 1507), mk(300, 823)]);
  assert.equal(unfair.fair, false, '54% 對 20% 不可比');
  assert.ok(Math.abs(unfair.lo - 300 / 1507) < 1e-9);
  assert.ok(Math.abs(unfair.hi - 300 / 553) < 1e-9);

  // 都抓到底 → 三家都是 100%，可比
  const fair = app.vsnapFairness([mk(553, 553), mk(1507, 1507), mk(823, 823)]);
  assert.equal(fair.fair, true, '都抓完就可以比件數');

  // 只有一家沒得比，視為公平（不要無意義地標「不可比」）
  assert.equal(app.vsnapFairness([mk(300, 553)]).fair, true);
  // 官方總筆數缺失時不要當成 0 去除
  assert.equal(app.vsnapFairness([mk(300, 0), mk(300, 0)]).fair, true);
});

/* fetchVendor 是 async 且會打 api()，所以把 api 換成假的來測。
   api 是函式宣告，會成為 vm context 的屬性，所以覆寫得掉。
   這一段專門守住「空頁不等於抓完」——那是原本的 bug，
   而且純資料測試抓不到，一定要跑一次 fetchVendor 本體。 */
test('fetchVendor：空頁要重試，不可當成抓完', async () => {
  const realApi = app.api;
  const page = n => ({ total_records: 553, total_pages: 6,
    records: Array.from({ length: n }, (_, i) => ({
      unit_id: 'U', unit_name: '某機關', date: '20260301', job_number: 'J' + i,
      brief: { type: '決標公告', title: '案 ' + i,
               companies: { names: ['甲公司'], name_key: { '甲公司': ['決標品項:第1品項:得標廠商1:得標廠商'] } } } })) });

  const calls = [];
  let emptyOnce = true;
  app.api = async path => {
    const p = +(path.match(/page=(\d+)/) || [])[1];
    calls.push(p);
    // 第 3 頁第一次故意回空的 records（實測中興第 9 頁、亞新第 16 頁就是這樣）
    if (p === 3 && emptyOnce) { emptyOnce = false; return page(0); }
    return page(p === 6 ? 53 : 100);
  };
  try {
    const res = await app.fetchVendor('測試廠商', 6, () => {});
    assert.equal(res.recs.length, 553, '空頁重試後要拿到完整 553 筆，不是 200 筆');
    assert.equal(res.pages, 6);
    assert.equal(res.stop.reason, 'done');
    assert.equal(calls.filter(p => p === 3).length, 2, '第 3 頁要被重抓一次');
  } finally { app.api = realApi; }
});

test('fetchVendor：頁數上限要記成 cap，不可說成抓完', async () => {
  const realApi = app.api;
  app.api = async path => {
    const p = +(path.match(/page=(\d+)/) || [])[1];
    return { total_records: 1507, total_pages: 16,
      records: Array.from({ length: 100 }, (_, i) => ({
        unit_id: 'U', unit_name: '某機關', date: '20260301', job_number: 'J' + p + '_' + i,
        brief: { type: '決標公告', title: 't', companies: { names: [], name_key: {} } } })) };
  };
  try {
    const res = await app.fetchVendor('測試廠商', 3, () => {});
    assert.equal(res.recs.length, 300);
    assert.equal(res.pages, 3);
    assert.equal(res.stop.reason, 'cap', '只抓 3 / 16 頁必須記成 cap');
    const cv = app.vsnapCoverage({ fetched: res.recs.length, total: res.total, stop: res.stop });
    assert.equal(cv.complete, false);
    assert.ok(cv.msg.indexOf('頁數上限') >= 0);
  } finally { app.api = realApi; }
});

test('fetchVendor：真的到最後一頁才算抓完', async () => {
  const realApi = app.api;
  app.api = async path => {
    const p = +(path.match(/page=(\d+)/) || [])[1];
    const n = p === 3 ? 84 : 100;          // 284 筆 / 3 頁（吉興實測的形狀）
    return { total_records: 284, total_pages: 3,
      records: Array.from({ length: n }, (_, i) => ({
        unit_id: 'U', unit_name: '某機關', date: '20260301', job_number: 'J' + p + '_' + i,
        brief: { type: '決標公告', title: 't', companies: { names: [], name_key: {} } } })) };
  };
  try {
    const res = await app.fetchVendor('測試廠商', 0, () => {});   // 0 = 抓到底
    assert.equal(res.recs.length, 284);
    assert.equal(res.stop.reason, 'done');
    assert.equal(app.vsnapCoverage({ fetched: 284, total: 284, stop: res.stop }).ratio, 1);
  } finally { app.api = realApi; }
});

test('esc 連引號都跳脫：屬性內插不能被資料跳出', () => {
  assert.equal(app.esc('a"b\'c<d>&'), 'a&quot;b&#39;c&lt;d&gt;&amp;');
  assert.equal(app.esc(null), '');
  assert.equal(app.esc(0), '0');
  const evil = 'x" onmouseover="alert(1)';
  assert.ok(!app.esc(evil).includes('"'), '雙引號沒跳脫就能跳出 title="…"');
});

test('safeUrl 只放行 http(s)', () => {
  assert.equal(app.safeUrl('https://web.pcc.gov.tw/a?b=1'), 'https://web.pcc.gov.tw/a?b=1');
  assert.equal(app.safeUrl(' HTTP://x.tw '), 'HTTP://x.tw');
  assert.equal(app.safeUrl('javascript:alert(1)'), '');
  assert.equal(app.safeUrl('  JavaScript:alert(1)'), '');
  assert.equal(app.safeUrl('data:text/html,x'), '');
  assert.equal(app.safeUrl(undefined), '');
});

test('buildFailed 改成分組＋二分搜尋後，結果與舊的逐筆掃描完全相同', () => {
  // 舊寫法（流標數 × 招標數）照抄當參考答案
  const ref = recs => {
    const fails = recs.filter(r => app.isFailedAward(app.recTy(r)));
    const tenders = recs.map(r => ({ r, d: app.recDate(r) })).filter(o => o.d && app.isTender(app.recTy(o.r)));
    return fails.map(f => {
      const fd = app.recDate(f); if (!fd) return null;
      const title = (f.brief && f.brief.title) || ''; const k = app.seriesKey(title);
      const re = tenders.filter(o => o.d > fd && app.seriesKey((o.r.brief && o.r.brief.title) || '') === k)
                        .sort((a, b) => a.d - b.d)[0];
      return { title, date: f.date, job: f.job_number,
               reDate: re ? re.r.date : null, reJob: re ? re.r.job_number : null,
               lag: re ? Math.round((re.d - fd) / 86400000) : null };
    }).filter(Boolean).sort((a, b) => app.recDate({ date: b.date }) - app.recDate({ date: a.date }));
  };
  let seed = 3; const rnd = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
  const types = ['公開招標公告', '無法決標公告', '決標公告', '更正公告', '限制性招標(經公開評選或公開徵求)公告'];
  const subj = ['鍋爐維護', '冷卻水塔清洗', '消防設備保養', ''];
  const recs = Array.from({ length: 3000 }, (_, i) => {
    const y = 2018 + Math.floor(rnd() * 8), m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 3); // 刻意製造同日
    return { job_number: 'J' + i, date: '' + y + String(m).padStart(2, '0') + String(d).padStart(2, '0'),
             brief: { type: types[Math.floor(rnd() * types.length)],
                      title: (y - 1911) + '年度' + subj[Math.floor(rnd() * subj.length)] } };
  });
  const strip = rows => JSON.stringify(rows.map(x => [x.title, x.date, x.job, x.reDate, x.reJob, x.lag]));
  assert.equal(strip(app.buildFailed(recs)), strip(ref(recs)));
});

test('recDateRange 取頭尾、ymdDash 用本地日期（不可早一天）', () => {
  const rg = app.recDateRange([{ date: '20240105' }, { date: 'bad' }, { date: '20190301' }, { date: '20260930' }]);
  assert.equal(app.ymdDash(rg.from), '2019-03-01');
  assert.equal(app.ymdDash(rg.to), '2026-09-30');
  assert.equal(app.recDateRange([{ date: '' }]), null);
});
