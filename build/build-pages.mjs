/**
 * 產出 GitHub Pages 用的靜態網站 → site/
 *
 *   node build/build-pages.mjs      （或 npm run build:pages）
 *
 * - site/index.html ← 標案參謀室.html，另外插入 noindex，讓搜尋引擎不要收錄
 *   （網址採「知道網址就能開」，不想被搜到）
 * - site/.nojekyll  ← 叫 GitHub Pages 原樣提供檔案，不要跑 Jekyll
 *
 * site/ 是另一個獨立的 git repo（推到公開的 Pages repo），已列入本 repo 的 .gitignore。
 * 這裡只覆寫檔案，不會動到 site/.git。
 * 原始碼、docs、server.js 都不會進到 site/ —— 公開出去的只有那一個 HTML。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out  = join(root, 'site');

let html = readFileSync(join(root, '標案參謀室.html'), 'utf8');
const VIEWPORT = /<meta name="viewport"[^>]*>/;
if (!VIEWPORT.test(html)) throw new Error('找不到 viewport meta，插不進 noindex —— HTML 開頭被改過了？');
if (!/name="robots"/.test(html)) {
  html = html.replace(VIEWPORT, m => m + '\n<meta name="robots" content="noindex, nofollow">');
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, '.nojekyll'), '');

console.log('\n  已產出 site/index.html（' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB）與 site/.nojekyll\n');
