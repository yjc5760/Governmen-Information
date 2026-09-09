/**
 * 煙霧測試：node --test  （或 npm test）
 * 不連外網，只用固定 fixture 驗證解析與靜態檔路徑判斷。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, parseRocDate, parseBudget, resolveStatic, applyFilters } from '../server.js';

test('parseRocDate 民國年轉西元', () => {
  assert.equal(parseRocDate('115/09/20').getFullYear(), 2026);
  assert.equal(parseRocDate('2026/09/20').getFullYear(), 2026);
  assert.equal(parseRocDate('115/09/20').getMonth(), 8);
  assert.equal(parseRocDate(''), null);
  assert.equal(parseRocDate('不是日期'), null);
});

test('parseBudget 處理千分位與雜訊', () => {
  assert.equal(parseBudget('12,345,678'), 12345678);
  assert.equal(parseBudget('$1,200 元'), 1200);
  assert.equal(parseBudget('未提供'), 0);
  assert.equal(parseBudget(''), 0);
  assert.equal(parseBudget('1234.00'), 1234, '小數應四捨五入成整數');
  assert.equal(parseBudget('預算 8,000,000 元整'), 8000000);
});

test('parseRows 解析標案列並過濾雜訊列', () => {
  const html = `<table>
    <tr><th>項次</th><th>機關名稱</th><th>標案案號</th><th>傳輸次數</th>
        <th>招標方式</th><th>採購性質</th><th>公告日期</th><th>截止投標</th><th>預算金額</th></tr>
    <tr>
      <td>1</td><td>台灣電力股份有限公司</td>
      <td>D115-0001 <a href="/tps/QueryTender/query/searchTenderDetail?x=1">
        <script>Geps3.CNS.pageCode2Img("興達電廠燃氣機組統包工程")</script></a>（招標公告）</td>
      <td>1</td><td>公開招標</td><td>工程</td><td>115/09/01</td><td>115/09/30</td><td>1,234,567,890</td>
    </tr>
    <tr>
      <td>2</td><td>圖例說明：若查不到請注意事項</td><td>◎ 說明</td>
      <td>1</td><td></td><td></td><td></td><td></td><td></td>
    </tr>
  </table>`;
  const rows = parseRows(html);
  assert.equal(rows.length, 1, '雜訊列應被過濾掉');
  const r = rows[0];
  assert.equal(r.caseId, 'D115-0001');
  assert.equal(r.name, '興達電廠燃氣機組統包工程', 'pageCode2Img 案名應被還原且去掉「招標公告」');
  assert.equal(r.orgName, '台灣電力股份有限公司');
  assert.equal(r.budget, 1234567890);
  assert.equal(r.tenderPeriod, 29);
  assert.ok(r.link.startsWith('https://web.pcc.gov.tw/'), '相對連結應補上網域');
  assert.ok(r.deadlineISO && r.publishISO);
});

test('resolveStatic 擋掉路徑穿越與非公開目錄', () => {
  assert.equal(resolveStatic('/..%2f..%2fetc/passwd'), null);
  assert.equal(resolveStatic('/..%2fpackage.json'), null);
  assert.equal(resolveStatic('/.git/config'), null);
  assert.equal(resolveStatic('/node_modules/cheerio/package.json'), null);
  assert.equal(resolveStatic('/沒有這個檔.html'), null);
  assert.ok(resolveStatic('/package.json'), '專案內的檔案應可服務');
  assert.ok(resolveStatic('/'), '根路徑應對應到 標案參謀室.html');
});

test('applyFilters 遇到壞參數不會清空結果', () => {
  const recs = [
    { name: 'A案', orgName: '台電', budget: 500, remainingDays: 3 },
    { name: 'B案', orgName: '中油', budget: 5000, remainingDays: 20 }
  ];
  const q = s => new URLSearchParams(s);
  assert.equal(applyFilters(recs, q('maxDays=abc')).length, 2, 'maxDays 非數字應視為未設定');
  assert.equal(applyFilters(recs, q('minBudget=xyz')).length, 2);
  assert.equal(applyFilters(recs, q('maxDays=7')).length, 1);
  assert.equal(applyFilters(recs, q('minBudget=1000')).length, 1);
  assert.equal(applyFilters(recs, q('exclude=中油')).length, 1);
  assert.equal(applyFilters(recs, q('sort=budget'))[0].name, 'B案');
  assert.equal(applyFilters(recs, q('sort=deadline'))[0].name, 'A案');
});
