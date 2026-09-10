/**
 * 單一執行檔（.exe）的入口。
 *
 * 給沒有安裝 Node.js 的同仁用：雙擊 exe → 啟動本機伺服器 → 自動開瀏覽器。
 * 網頁 HTML 在打包時內嵌進 exe，所以只要一個檔案就能跑；
 * 但 exe 旁邊若放了一份 標案參謀室.html，會優先讀那份（改網頁不必重新打包）。
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { start, setStaticRoot, addEmbeddedFile, setVersion, getVersion, INDEX_FILE } from '../server.js';

/* 打包時由 esbuild --define 填入；直接用 node 跑時是 undefined，就沿用 package.json */
const BUILD_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;
if (BUILD_VERSION) setVersion(BUILD_VERSION);

// esbuild 會把這個 import 換成內嵌的字串（--loader:.html=text）
import INDEX_HTML from '../標案參謀室.html';

/* 判斷是不是被打包成執行檔跑：執行檔名不叫 node 就是。
   （node:sea 模組在 bundle 裡不好取用，這個判斷簡單又可靠） */
const exeName = path.basename(process.execPath).toLowerCase();
const isPackaged = exeName !== 'node' && exeName !== 'node.exe';

/* 打包後 exe 旁邊才是使用者看得到的資料夾，__dirname 沒有意義 */
const baseDir = isPackaged ? path.dirname(process.execPath) : process.cwd();
setStaticRoot(baseDir);
addEmbeddedFile(INDEX_FILE, INDEX_HTML);

function openBrowser(url){
  try{
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached:true, stdio:'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached:true, stdio:'ignore' }).unref();
    else spawn('xdg-open', [url], { detached:true, stdio:'ignore' }).unref();
  }catch(e){ /* 開不起來就算了，網址已經印在畫面上 */ }
}

const line = '─'.repeat(52);

async function main(){
try{
  const { port } = await start({ port: Number(process.env.PORT) || 5178, host: '127.0.0.1' });
  const url = 'http://localhost:' + port + '/';
  const override = fs.existsSync(path.join(baseDir, INDEX_FILE));

  console.log('');
  console.log('  ' + line);
  console.log('   標案參謀室  v' + getVersion());
  console.log('  ' + line);
  console.log('');
  console.log('   網頁已啟動： ' + url);
  console.log('');
  console.log('   ‧ 瀏覽器應該會自動打開，沒有的話請自己複製上面網址');
  console.log('   ‧ 使用期間請保持這個黑色視窗開著');
  console.log('   ‧ 要結束請關掉這個視窗，或按 Ctrl+C');
  console.log('');
  if (override) console.log('   已讀取 exe 旁邊的 ' + INDEX_FILE + '（覆蓋內建版本）');
  else          console.log('   使用 exe 內建的網頁');
  console.log('   資料只存在你自己的瀏覽器裡，不會上傳到任何地方。');
  console.log('');
  openBrowser(url);
}catch(e){
  console.error('');
  console.error('  啟動失敗：' + e.message);
  if (e.code === 'EADDRINUSE') {
    console.error('  連接埠 5178～5187 都被占用了。可能已經有一個在跑，');
    console.error('  先開 http://localhost:5178/ 看看。');
  }
  console.error('');
  console.error('  按 Enter 關閉…');
  try{ fs.readSync(0, Buffer.alloc(1), 0, 1, null); }catch(_){}
  process.exit(1);
}
}

for (const sig of ['SIGINT','SIGTERM']) process.on(sig, () => { console.log('\n  再見。'); process.exit(0); });

main();
