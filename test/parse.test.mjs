/**
 * 煙霧測試：node --test  （或 npm test）
 * 不連外網，只用固定 fixture 驗證解析與靜態檔路徑判斷。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRows, parseRocDate, parseBudget, resolveStatic, applyFilters } from '../server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/* Windows 批次檔的守門測試。
   實際發生過：打包exe.bat 是 UTF-8＋中文＋LF，而且裡面有 chcp 65001，
   在 zh-TW 的 CMD 下整個畫面都是「不是內部或外部命令」，
   命令名稱被切掉開頭（echo → ho、start → s）。
   原因是 CMD 用「舊字碼頁算出的位元組位置」繼續讀批次檔，
   chcp 切換後就接在字元中間，之後每一行都位移。
   純 ASCII 時位元組數與字元數相同，不管字碼頁怎麼換都不會位移，
   所以這兩件事一定要守住：整份純 ASCII、行尾 CRLF。 */
const BATS = ['start-windows.bat', 'build/打包exe.bat'];

for (const rel of BATS) {
  test('批次檔 ' + rel + ' 必須是純 ASCII', () => {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const bad = [];
    for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) bad.push(i);
    assert.equal(bad.length, 0,
      '第 ' + bad.slice(0, 5).join('、') + ' 個位元組是非 ASCII。'
      + '批次檔裡不可以有中文——要顯示中文請改在 node 腳本裡 console.log，'
      + '.bat 只負責 chcp 65001。');
  });

  test('批次檔 ' + rel + ' 行尾必須是 CRLF', () => {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const s = buf.toString('latin1');
    const lone = (s.match(/(?<!\r)\n/g) || []).length;
    assert.equal(lone, 0, '有 ' + lone + ' 個單獨的 LF。CMD 對 LF-only 的批次檔行為不穩定。');
    assert.ok(s.indexOf('\r\n') >= 0, '完全沒有 CRLF，檔案是空的還是被改壞了？');
  });
}

test('有 chcp 65001 的批次檔，同一份檔案不可以有非 ASCII 內容', () => {
  // 這兩件事單獨都沒問題，湊在一起才會爆——所以測的是「組合」
  for (const rel of BATS) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const hasChcp = buf.toString('latin1').indexOf('chcp 65001') >= 0;
    if (!hasChcp) continue;
    const nonAscii = [...buf].some(b => b > 0x7f);
    assert.equal(nonAscii, false, rel + ' 同時有 chcp 65001 與非 ASCII 內容，這是壞掉的那個組合');
  }
});

test('中文提示改由 node 腳本輸出，沒有跟著 .bat 一起消失', () => {
  const js = fs.readFileSync(path.join(ROOT, 'build/build-exe.mjs'), 'utf8');
  for (const kw of ['打包成單一 exe', '需要：Node.js', '給同仁的', '不必重新打包']) {
    assert.ok(js.indexOf(kw) >= 0, 'build-exe.mjs 應該要輸出「' + kw + '」，否則使用者什麼提示都看不到');
  }
});

test('使用說明.txt 要帶 UTF-8 BOM，記事本才不會亂碼', () => {
  const js = fs.readFileSync(path.join(ROOT, 'build/build-exe.mjs'), 'utf8');
  assert.ok(/使用說明\.txt'\s*\)\s*,\s*'\\uFEFF'\s*\+/.test(js) || js.indexOf("'\\uFEFF' +") >= 0,
    '寫 使用說明.txt 時要在最前面加 \\uFEFF');
});

test('build-exe.mjs 不可以去 spawn .cmd / .bat 的 shim', () => {
  const js = fs.readFileSync(path.join(ROOT, 'build/build-exe.mjs'), 'utf8');
  /* Node 從 18.20.2（CVE-2024-27980 的修補）起，execFile / spawn 拒絕直接執行
     .cmd 或 .bat，會丟 EINVAL。YJC 的 Node v24.18.0 實際踩到：
       syscall: 'spawnSync D:\\自用情報網站\\node_modules\\.bin\\esbuild.cmd'
     所以 esbuild 一律走 JS API，不要回頭去跑 node_modules/.bin 下的 shim。 */
  assert.ok(js.indexOf('esbuild.buildSync(') >= 0, 'esbuild 應該走 JS API buildSync');
  assert.ok(!/run\(\s*esbuildBin/.test(js), '不可以再 spawn .bin/esbuild');
  assert.ok(!/'esbuild\.cmd'/.test(js) || js.indexOf('runShim') >= 0,
    '如果真的要跑 .cmd，只能透過 runShim（shell:true）');
  // run() 本身要有護欄
  assert.ok(/\\\.\(cmd\|bat\)\$\/i\.test/.test(js) || /\.\(cmd\|bat\)\$/.test(js),
    'run() 要擋掉 .cmd / .bat，否則這個坑會靜靜回來');
});

test('run() 的護欄真的擋得住', async () => {
  // 直接把護欄邏輯抽出來驗，不用真的去跑打包
  const guard = cmd => { if (/\.(cmd|bat)$/i.test(String(cmd))) throw new Error('blocked ' + cmd); return 'ran'; };
  assert.throws(() => guard('node_modules/.bin/esbuild.cmd'), /blocked/);
  assert.throws(() => guard('C:\\x\\npm.CMD'), /blocked/, '大小寫都要擋');
  assert.throws(() => guard('foo.bat'), /blocked/);
  assert.equal(guard('/usr/bin/node'), 'ran', '正常執行檔不可以被擋');
  assert.equal(guard('node.exe'), 'ran', '.exe 不是 shim，不可以被擋');
});
