/**
 * 把 src/ 組回單一檔 標案參謀室.html   →   npm run build
 *
 *   src/index.html       版面（head／body 標記），<!-- @@CSS --> 與 <!-- @@JS --> 是插入點
 *   src/styles.css       自訂樣式 + Tailwind 指令
 *   src/tailwind.config.cjs
 *   src/js/NN-*.js       程式，依檔名排序串接成同一段 <script>
 *
 * 為什麼還是輸出單一檔：server.js、打包的 exe、GitHub Pages、前端測試
 * 都只認 標案參謀室.html 這一份，也方便直接雙擊開啟。拆檔只是為了好改。
 *
 * Tailwind 在這裡就編好並內嵌，不再用 Play CDN（cdn.tailwindcss.com）：
 * 那個做法每次開頁都要下載約 400KB 的編譯器、在瀏覽器裡現編，
 * 主控台還會警告不要用在正式環境；CDN 連不上時整頁沒樣式。
 *
 * 防呆：輸出檔第二行記著內容雜湊。如果有人直接改了 標案參謀室.html，
 * 重新建置會把那些修改蓋掉，所以偵測到就停下來（--force 才覆蓋）。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = join(ROOT, 'src');
export const OUT = join(ROOT, '標案參謀室.html');
const MARK = '<!-- 由 src/ 自動產生（npm run build）。請改 src/ 底下的檔案，不要直接改這份。 build-hash:';

/** src/js 依檔名排序串接（測試也用這個來確認輸出檔沒有落後 src） */
export function assembleJs(){
  const files = readdirSync(join(SRC, 'js')).filter(f => f.endsWith('.js')).sort();
  return files.map(f => readFileSync(join(SRC, 'js', f), 'utf8')).join('');
}

/** 從建好的 HTML 抽出主程式那段 <script> */
export function extractJs(html){
  const m = html.match(/<script>\n([\s\S]*)<\/script>\n<\/body>/);
  return m ? m[1] : null;
}

const hashOf = s => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** 字串拼 class 的寫法 Tailwind 掃不到，建置時直接點名 */
function checkDynamicClasses(js){
  const bad = [];
  js.split('\n').forEach((line, i) => {
    if (/['"`](?:[a-z]+:)?(?:bg|text|border|ring|from|to|via|fill|stroke)-['"`]\s*\+/.test(line)) bad.push(i + 1);
  });
  return bad;
}

async function compileCss(){
  const require = createRequire(join(ROOT, 'package.json'));
  let postcss, tailwind;
  try { postcss = require('postcss'); tailwind = require('tailwindcss'); }
  catch (e) {
    throw new Error('找不到 tailwindcss／postcss。請先在專案資料夾執行一次  npm install');
  }
  const config = require(join(SRC, 'tailwind.config.cjs'));
  const input = readFileSync(join(SRC, 'styles.css'), 'utf8');
  const out = await postcss([tailwind(config)]).process(input, { from: join(SRC, 'styles.css') });
  // 保守的壓縮：只拿掉註解、縮排與換行，不動規則內容
  return out.css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

export async function build({ force = false } = {}){
  if (!force && existsSync(OUT)) {
    const cur = readFileSync(OUT, 'utf8');
    const lines = cur.split('\n');
    const i = lines.findIndex(l => l.startsWith(MARK));
    if (i < 0) {
      throw new Error('標案參謀室.html 不是由建置產生的（沒有 build-hash）。確定要用 src/ 覆蓋它的話加 --force');
    }
    const recorded = lines[i].slice(MARK.length).replace(/\s*-->\s*$/, '');
    const body = lines.filter((_, k) => k !== i).join('\n');
    if (hashOf(body) !== recorded) {
      throw new Error('標案參謀室.html 在上次建置後被直接修改過，重新建置會蓋掉那些修改。\n' +
        '  請把修改搬到 src/ 對應的檔案，或確定不要了再加 --force');
    }
  }

  const tpl = readFileSync(join(SRC, 'index.html'), 'utf8');
  const js  = assembleJs();
  const bad = checkDynamicClasses(js);
  if (bad.length) console.warn('  注意：src/js 合併後第 ' + bad.join('、') + ' 行用字串拼 Tailwind class，建置時掃不到');
  const css = await compileCss();

  if (!tpl.includes('<!-- @@CSS -->') || !tpl.includes('<!-- @@JS -->')) throw new Error('src/index.html 少了 @@CSS 或 @@JS 插入點');
  const body = tpl
    .replace('<!-- @@CSS -->', () => '<style>\n' + css + '\n</style>')
    .replace('<!-- @@JS -->', () => '<script>\n' + js + '</script>');
  const [first, ...rest] = body.split('\n');                    // <!DOCTYPE html> 之後插標記行
  const unmarked = [first, ...rest].join('\n');
  const html = [first, MARK + hashOf(unmarked) + ' -->', ...rest].join('\n');
  writeFileSync(OUT, html);
  return { bytes: Buffer.byteLength(html), cssBytes: Buffer.byteLength(css), jsBytes: Buffer.byteLength(js) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = await build({ force: process.argv.includes('--force') });
    console.log('\n  已產生 標案參謀室.html（' + (r.bytes / 1024).toFixed(0) + ' KB；CSS ' +
      (r.cssBytes / 1024).toFixed(0) + ' KB、JS ' + (r.jsBytes / 1024).toFixed(0) + ' KB）\n');
  } catch (e) {
    console.error('\n  建置失敗：' + e.message + '\n');
    process.exit(1);
  }
}
