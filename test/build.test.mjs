/**
 * 標案參謀室.html 由 src/ 建置產生（npm run build）。
 * 這裡只確認輸出檔沒有落後 src/js——不需要 tailwind，所以沒裝 devDependencies 也能跑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OUT, assembleJs, extractJs } from '../build/build-html.mjs';

test('標案參謀室.html 的程式與 src/js 一致（改了 src 要跑 npm run build）', () => {
  const js = extractJs(readFileSync(OUT, 'utf8'));
  assert.ok(js, '輸出檔裡找不到主程式 <script>');
  assert.ok(js === assembleJs(), 'src/js 改過但 標案參謀室.html 還沒重建：請執行 npm run build');
});

test('輸出檔不再依賴 Tailwind Play CDN', () => {
  const html = readFileSync(OUT, 'utf8');
  assert.ok(!html.includes('cdn.tailwindcss.com'));
  assert.ok(/<style>[\s\S]*\.bg-jade-600\{/.test(html) || /<style>[\s\S]*\.bg-jade-600 ?\{/.test(html), '內嵌 CSS 裡找不到自訂色 bg-jade-600');
});
