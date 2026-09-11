/**
 * 畫面實測：node test/ui-smoke.mjs
 *
 * 需要另外裝 playwright（npm i -D playwright && npx playwright install chromium），
 * 所以刻意不叫 *.test.mjs，npm test 不會跑到它。
 *
 * 為什麼要有這支：純函式測試曾經「全綠但功能全壞」。當時事件屬性裡用了
 * JSON.stringify，產生的 HTML 屬性被雙引號截斷，9 個按鈕完全點不動，
 * 但測試是用 page.evaluate() 直接呼叫函式，繞過了真正的屬性。
 * 所以這裡一律用真的滑鼠點擊，驗證「渲染出來的東西能不能用」。
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, '..', '標案參謀室.html'), 'utf8');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port + '/';

// 案號 6331300004 的真實廠商名稱（泰興落標、吉興得標）
const TAI = '泰興工程顧問股份有限公司 (PACIFIC ENGINEERS & CONSTRUCTORS LTD.)';
const GIB = '吉興工程顧問股份有限公司 (GIBSIN Engineers, Ltd.)';

const snapA = { name:'泰興工程顧問', at:Date.now(), total:553, tp:6, pages:3, fetched:300,
  awards:40, lostCases:12, corrections:5,
  agencies:[['台灣電力股份有限公司核能火力發電工程處',18],['經濟部水利署',9]],
  partners:[['乙顧問',3]], rivals:[['吉興工程顧問股份有限公司',19],['甲顧問',7]],
  years:[['2024',10],['2025',30]], recent:[{d:'20260301',n:'台電',ti:'某案'}] };
const snapB = { ...snapA, name:'中興工程顧問', total:4681, tp:47, awards:120, lostCases:30,
  partners:[], rivals:[['台灣世曦工程顧問',40]] };

const exe = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(base);
await page.evaluate(([a, b, tai, gib]) => {
  localStorage.setItem('pi_rivals', JSON.stringify(['泰興工程顧問', '中興工程顧問']));
  localStorage.setItem('pi_vendor_snap2', JSON.stringify({ '泰興工程顧問': a, '中興工程顧問': b }));
  localStorage.setItem('pi_vendor_snap_sel', JSON.stringify([]));
  localStorage.setItem('pi_daycache2', JSON.stringify({ '20260901': [
    { u:'U1', n:'台電核火處', j:'6331300004', t:'台中電廠第二期新建燃氣機組計畫',
      ty:'決標公告', f:'', c:[tai, gib], w:[1] },          // 只有第 2 家得標
    { u:'U1', n:'台電核火處', j:'NOKEY', t:'沒有勝負資料的案子',
      ty:'決標公告', f:'', c:['丙公司'] }                   // w 缺席
  ] }));
}, [snapA, snapB, TAI, GIB]);
await page.reload();

// 1. 對手卡片：夥伴與對手必須分開
await page.click('.navitem[data-page="market"]');
await page.waitForTimeout(300);
const txt = await page.textContent('body');
assert.ok(txt.includes('共同得標夥伴'), '對手卡片要有「共同得標夥伴」');
assert.ok(txt.includes('常同場競標對手'), '對手卡片要有「常同場競標對手」');
assert.ok(!txt.includes('常見共同投標夥伴'), '舊標題「常見共同投標夥伴」不該還在');
assert.ok(txt.includes('得標 40 件') && txt.includes('落標 12 件'), '標頭要分開列得標與落標');

// 2. 真的用滑鼠點，不要用 page.evaluate 繞過渲染出來的屬性
await page.click('#vendorCompare summary');
await page.waitForTimeout(200);
let boxes = await page.$$('#vendorCompare input[type="checkbox"]');
assert.equal(boxes.length, 2, '應該有兩家可勾選，實際 ' + boxes.length);
await boxes[0].click();
await page.waitForTimeout(150);
boxes = await page.$$('#vendorCompare input[type="checkbox"]');
await boxes[1].click();
await page.waitForTimeout(250);

const table = await page.$('#vendorCompare table');
assert.ok(table, '勾兩家之後必須出現對比表');
const tt = await table.textContent();
for (const label of ['得標件數', '落標件數', '抓取範圍內得標率', '共同得標夥伴數', '常同場對手']) {
  assert.ok(tt.includes(label), '對比表缺少欄位：' + label);
}
assert.ok(!tt.includes('決標件數'), '舊欄位名「決標件數」不該還在');
assert.ok(tt.includes('吉興工程顧問股份有限公司(19)'), '吉興要落在「常同場對手」欄');
assert.ok((await page.textContent('#vendorCompare')).includes('300 筆上限'),
  '註腳的上限要用每頁 100 筆算');
const rows = await page.$$eval('#vendorCompare table tr', rs => rs.map(r => r.textContent));
const partnerRow = rows.find(t => t.startsWith('前三大夥伴'));
assert.ok(partnerRow && !partnerRow.includes('吉興'), '吉興不可出現在夥伴列：' + partnerRow);

// 3. 公告卡片要分清楚得標／投標／不知道
await page.evaluate(() => showDayList('20260901'));
await page.waitForTimeout(200);
const cards = await page.$$eval('#searchResults > div', ds => ds.map(d => d.textContent));
assert.ok(cards.length >= 2, '應該列出 2 張卡片');
assert.ok(cards[0].includes('得標') && cards[0].includes('吉興'), '有勝負資料要標「得標」：' + cards[0]);
assert.ok(!cards[0].includes('泰興'), '落標的泰興不該被列成得標者：' + cards[0]);
assert.ok(cards[1].includes('廠商丙公司') && !cards[1].includes('得標丙公司'),
  '分不出勝負時只能標中性的「廠商」：' + cards[1]);


// ── 4. 機關洞察：流標機會清單 ＋ 契約變更排除 ─────────────────────────
{
  const N = ns => ({ '決標品項:第1品項:得標廠商1:得標廠商': 1 } && ns);
  const co = names => ({ names, name_key: Object.fromEntries(
    names.map(n => [n, ['投標廠商:投標廠商1:廠商名稱', '決標品項:第1品項:得標廠商1:得標廠商']])) });
  const mk = (type, title, job, date, names) =>
    ({ unit_id: 'U', unit_name: '測試機關', job_number: job, date, filename: job + date,
       brief: { type, title, companies: names ? co(names) : { names: [], name_key: {} } } });

  const records = [
    // A：招標→流標→招標→流標→決標（已成案）
    mk('公開招標公告', 'A 統包工程', 'A', '20250101'),
    mk('無法決標公告', 'A 統包工程', 'A', '20250201'),
    mk('公開招標公告', 'A 統包工程', 'A', '20250301'),
    mk('無法決標公告', 'A 統包工程', 'A', '20250401'),
    mk('決標公告',     'A 統包工程', 'A', '20250501', ['甲工程顧問']),
    // B：流標三次，至今未決標 —— 這才是機會
    mk('無法決標公告', 'B 委託技術服務', 'B', '20250110'),
    mk('無法決標公告', 'B 委託技術服務', 'B', '20250310'),
    mk('無法決標公告', 'B 委託技術服務', 'B', '20250610'),
    // D：只有契約變更當決標，不可算成案
    mk('無法決標公告', 'D 設備採購', 'D', '20250401'),
    mk('決標公告', 'D 設備採購第1次契約變更', 'D', '20250501', ['甲工程顧問']),
    // E：沒流過標，不該進清單；另外兩則契約變更不可灌水廠商件數
    mk('公開招標公告', 'E 監造服務', 'E', '20250101'),
    mk('決標公告', 'E 監造服務', 'E', '20250201', ['甲工程顧問']),
    mk('決標公告', 'E 監造服務第2次契約變更', 'E2', '20250601', ['甲工程顧問']),
    mk('決標公告', 'E 監造服務第3次契約變更', 'E3', '20250701', ['甲工程顧問'])
  ];

  await page.evaluate(recs => {
    unitData = { unit_id: 'U', unit_name: '測試機關', records: recs,
                 total: recs.length, totalPages: 1, pagesFetched: 1, stop: { reason: 'done' } };
    unitPeriod = 0;
    go('agencies');
    renderAgencyDetail();
  }, records);
  await page.waitForTimeout(300);

  const detail = await page.textContent('#agencyDetail');
  assert.ok(detail.includes('流標機會清單'), '機關洞察要出現流標機會清單');
  assert.ok(detail.includes('曾流標 3 案'), '應為 3 案（E 沒流過標）：' + detail.slice(0, 0) + detail.match(/曾流標 \d+ 案/));
  assert.ok(detail.includes('至今未決標 2 案'), 'B 與 D 都算未成案：' + detail.match(/至今未決標 \d+ 案/));
  assert.ok(detail.includes('流標 3 次'), 'B 案要標出流標 3 次');
  assert.ok(detail.includes('間隔 59、92 天'), '要算出流標間隔');
  assert.ok(!/D 設備採購第1次契約變更/.test(detail), '流標清單的標題不可取契約變更那則');

  // 契約變更不可灌水得標件數：甲工程顧問實際只得標 2 件（A、E）
  const rank = await page.textContent('#vendorRank');
  const m = rank.match(/甲工程顧問[^0-9]*(\d+)/);
  assert.ok(m, '得標廠商排行要列出甲工程顧問：' + rank.slice(0, 200));
  assert.equal(m[1], '2', '四則決標裡兩則是契約變更，件數應為 2 不是 4');

  // 真的點開「已重招決標」摺疊區
  const sums = await page.$$('#agencyDetail details summary');
  const target = [];
  for (const s of sums) { if ((await s.textContent()).includes('已重招決標')) target.push(s); }
  assert.equal(target.length, 1, '應該有一個「已重招決標」摺疊區');
  await target[0].click();
  await page.waitForTimeout(150);
  const opened = await page.$eval('#agencyDetail details', d => d.open);
  assert.equal(opened, true, '點擊摘要要能展開');
  assert.ok((await page.textContent('#agencyDetail')).includes('歷時 89 天'), 'A 案第一次流標到成案 89 天（20250201→20250501）');

  // 補詳情按鈕要真的在（而且 onclick 沒被截斷）
  const btn = await page.$('#agencyDetail button[onclick*="fillFlopDetail"]');
  assert.ok(btn, '要有「補流標原因與預算變化」按鈕');
}

// CDN 載不到是離線環境的事，不算程式錯
const real = errs.filter(e => !/tailwind|Failed to load resource/i.test(e));
assert.equal(real.length, 0, '頁面有錯誤：\n' + real.join('\n'));

await browser.close();
srv.close();
console.log('UI 驗證全部通過');
