/**
 * 把「標案參謀室」打包成單一 Windows 執行檔（.exe）。
 *
 *   node build/build-exe.mjs            → 產出 dist/標案參謀室.exe
 *   node build/build-exe.mjs --linux    → 順便產出 dist/標案參謀室（Linux，供驗證用）
 *
 * 原理：Node.js 官方的 SEA（Single Executable Application）。
 *   1. 用 esbuild 把 server.js＋相依套件＋HTML 打成一支 CommonJS 檔
 *      （SEA 的主程式只吃 CJS，而 HTML 用 text loader 內嵌成字串）
 *   2. node --experimental-sea-config 產生 blob
 *   3. 把 blob 用 postject 注入 node.exe
 *
 * 重要限制：**blob 必須由跟目標 node.exe 相同版本的 node 產生**。
 * 所以這支腳本會抓 node-win-x64@<當前 node 版本>；在 Windows 上執行時
 * 直接複製自己的 node.exe，最單純。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT  = path.join(ROOT, 'dist');
const TMP  = path.join(OUT, '.build');
const NODE_VER = process.versions.node;
const APP_NAME = '標案參謀室';
const APP_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
})();

const run = (cmd, args, opts={}) =>
  execFileSync(cmd, args, { stdio:'inherit', cwd:ROOT, ...opts });
const say = m => console.log('  ' + m);

fs.rmSync(OUT, { recursive:true, force:true });
fs.mkdirSync(TMP, { recursive:true });

/* ---------- 1. 打包成單一 CJS ---------- */
say('打包 server.js＋相依套件＋HTML …');
const bundle = path.join(TMP, 'app.cjs');
const esbuildBin = path.join(ROOT,'node_modules','.bin', process.platform==='win32' ? 'esbuild.cmd' : 'esbuild');
run(esbuildBin, [
  path.join(ROOT,'build','exe-entry.mjs'),
  '--bundle', '--platform=node', '--format=cjs', '--target=node20',
  '--loader:.html=text',
  // esbuild 的 --define 值是「JS 運算式」，所以字串要帶引號；只能包一層，
  // 包兩層會變成值本身含引號（v"1.1.0"）
  '--define:__APP_VERSION__=' + JSON.stringify(APP_VERSION),
  '--outfile=' + bundle,
  '--log-level=warning'
]);
say('bundle：' + (fs.statSync(bundle).size/1048576).toFixed(1) + ' MB');

/* ---------- 2. 產生 SEA blob ---------- */
say('產生 SEA blob …');
const seaCfg = path.join(TMP, 'sea-config.json');
const blob   = path.join(TMP, 'app.blob');
fs.writeFileSync(seaCfg, JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false          // code cache 綁 CPU 架構，跨平台打包不能開
}, null, 2));
run(process.execPath, ['--experimental-sea-config', seaCfg]);
say('blob：' + (fs.statSync(blob).size/1048576).toFixed(1) + ' MB');

/* ---------- 3. 取得目標平台的 node 執行檔 ---------- */
function winNodeExe(){
  if (process.platform === 'win32') {           // 在 Windows 上：直接用自己的
    say('複製本機 node.exe（v' + NODE_VER + '）');
    return process.execPath;
  }
  const pkgDir = path.join(TMP, 'winnode');
  fs.mkdirSync(pkgDir, { recursive:true });
  say('從 npm 取得 node-win-x64@' + NODE_VER + ' …');
  run('npm', ['pack', 'node-win-x64@' + NODE_VER, '--pack-destination', pkgDir],
      { stdio:['ignore','pipe','inherit'] });
  const tgz = fs.readdirSync(pkgDir).find(f=>f.endsWith('.tgz'));
  if (!tgz) throw new Error('抓不到 node-win-x64@' + NODE_VER +
    '，npm 上可能沒有這個版本。請改用相同版本的 node 執行本腳本。');
  run('tar', ['xzf', path.join(pkgDir,tgz), '-C', pkgDir]);
  const exe = path.join(pkgDir,'package','bin','node.exe');
  if (!fs.existsSync(exe)) throw new Error('套件內容不符預期，找不到 bin/node.exe');
  return exe;
}

function inject(srcBinary, outFile, isWindows){
  fs.copyFileSync(srcBinary, outFile);
  fs.chmodSync(outFile, 0o755);
  const args = [
    path.join(ROOT,'node_modules','postject','dist','cli.js'),
    outFile, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  ];
  if (isWindows) args.push('--macho-segment-name','NODE_SEA');   // Windows 走 PE resource，這參數無害
  run(process.execPath, args);
}

/* ---------- 4. 注入 ---------- */
const winOut = path.join(OUT, APP_NAME + '.exe');
say('注入 blob 到 node.exe …');
inject(winNodeExe(), winOut, true);
say('產出：' + winOut + '（' + (fs.statSync(winOut).size/1048576).toFixed(1) + ' MB）');

if (process.argv.includes('--linux') && process.platform === 'linux') {
  const linuxOut = path.join(OUT, APP_NAME);
  say('另外產出 Linux 版供驗證 …');
  inject(process.execPath, linuxOut, false);
  say('產出：' + linuxOut);
}

/* ---------- 5. 附上使用說明 ---------- */
fs.writeFileSync(path.join(OUT,'使用說明.txt'),
`標案參謀室 — 使用說明
${'='.repeat(46)}

怎麼用
  1. 雙擊「${APP_NAME}.exe」
  2. 會跳出一個黑色視窗，瀏覽器自動打開網頁
  3. 使用期間請保持黑色視窗開著；要結束就關掉它

不需要安裝任何東西（Node.js、Python 都不用）。

第一次開啟的注意事項
  ‧ Windows 可能出現「Windows 已保護您的電腦」→ 點「其他資訊」→「仍要執行」。
    這是因為這支程式沒有花錢買數位簽章，不是有毒。
  ‧ 防火牆可能問是否允許連線 → 選「允許」。它只在你自己電腦上開
    127.0.0.1:5178，不對外開放，同網段的人連不進來。
  ‧ 公司的防毒軟體有可能直接隔離它（未簽章又會開網路埠）。
    若被隔離，請改用資料夾版（node.exe + 檔案）或請 IT 加入白名單。

資料存在哪裡
  全部存在你自己的瀏覽器裡（localStorage），不會上傳到任何地方。
  換一台電腦或換瀏覽器就是空的。頁尾有「匯出備份／匯入備份」可以搬移。
  ※ 用不同的連接埠開啟（例如 5179）會被瀏覽器視為不同網站，資料是分開的。

網頁要更新時
  把新版的「標案參謀室.html」放在 exe 旁邊同一個資料夾，
  它會優先讀那一份，不用重新打包。黑色視窗會顯示讀到哪一份。

有些功能需要能連上網路
  ‧ 標案查詢、機關洞察、廠商查詢 → 連 g0v／openfun 標案 API
  ‧ 官網即時查 → 由這支程式代為連政府電子採購網
  公司若有網路代理，可能需要 IT 協助。

版本：v${APP_VERSION}
打包用的 Node.js：v${NODE_VER}
`, 'utf8');

fs.rmSync(TMP, { recursive:true, force:true });
console.log('');
say('完成。dist/ 內容：');
fs.readdirSync(OUT).forEach(f=>{
  const st=fs.statSync(path.join(OUT,f));
  say('  ' + f + '  ' + (st.size/1048576).toFixed(1) + ' MB');
});
