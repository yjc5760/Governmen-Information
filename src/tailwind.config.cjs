/** Tailwind v3 設定（原本寫在網頁裡的 tailwind.config，現在建置時用）。
 *
 * content 只掃 src/：Tailwind 是用「字面上出現過的 class 名稱」決定要產生哪些樣式，
 * 所以 class 一定要寫完整，不能用字串拼出來——
 *   錯：'bg-'+tone+'-100'          → 建置時掃不到，畫面會沒顏色
 *   對：tone==='rose' ? 'bg-rose-100' : 'bg-slate-100'
 * build/build-html.mjs 會把漏掉的 class 列出來（見 checkClasses）。
 */
const path = require('node:path');
module.exports = {
  content: [path.join(__dirname, 'index.html'), path.join(__dirname, 'js/**/*.js')],
  theme: { extend: { colors: {
    ink:   { 900:'#0B2E2C', 800:'#103F3B', 700:'#16514B' },
    jade:  { 700:'#0B5F55', 600:'#0F7168', 500:'#159183', 100:'#DCEDE9', 50:'#EEF4F2' },
    paper: '#F6F8F7'
  } } }
};
