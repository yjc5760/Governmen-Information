# 標案參謀室 — 打包成單一 exe 的筆記

**前提修正**：這個專案**沒有用到 Python**。相依的是 **Node.js 20+**，所以打包的是 Node 執行檔。

## 怎麼重新打包

```
build\打包exe.bat        ← Windows 雙擊
npm run build:exe        ← 或用指令
```

產出 `dist/標案參謀室.exe`（約 86 MB）＋`使用說明.txt`。
在 Windows 上打包最單純（直接複製本機 `node.exe`），一分鐘內完成，
以後改網頁不必再從對話傳 20~30 MB 的檔案。

**只改網頁時根本不用重新打包**：把新的 `標案參謀室.html` 放在 exe 旁邊就會優先讀那份，
黑色視窗會顯示讀到哪一份。

## 為什麼用 Node SEA 而不是 pkg／nexe

用 Node.js 官方的 **SEA（Single Executable Application）**：
esbuild 打成一支 CJS → `node --experimental-sea-config` 產 blob → `postject` 注入 `node.exe`。

pkg 已封存、ESM 支援差；而且打包環境的**出口代理擋掉 nodejs.org 與 github.com**，
pkg／nexe 的 base binary 都在那裡拿不到。
SEA 這條路可行是因為 npm 上的 **`node-win-x64`** 套件裡就是官方的 Windows `node.exe`，
而且剛好有跟容器一致的版本（v22.22.2）——**blob 必須由相同版本的 node 產生**，這點是硬條件。

## ★ 第五個坑（也是最會讓人以為「exe 壞了」的）：.bat 不可以有中文

`打包exe.bat` 原本是 **UTF-8 ＋ 中文 ＋ LF 行尾**，而且第 2 行有 `chcp 65001`。
在 zh-TW 的 CMD 下雙擊它，畫面上是一整片：

```
'??鼗脹棟'  不是內部或外部命令、可執行的程式或批次檔。
'ho'  不是內部或外部命令、可執行的程式或批次檔。
'????dist\'  不是內部或外部命令、可執行的程式或批次檔。
's'  不是內部或外部命令、可執行的程式或批次檔。
```

**看起來像打包程式壞了，其實是批次檔自己被讀壞。**

### 不是 Big5 吃字元（我先猜錯了）

第一個猜測是 Big5 惡名昭彰的「次位元組是 `\`」問題——把整份檔案當 cp950 重讀一遍
模擬過，**這份檔案裡沒有任何換行、空白或反斜線被吃掉**，每一行都還是以 `echo` 開頭。
所以那個機制不成立。

### 真正的原因：`chcp 65001` ＋ 非 ASCII 內容

CMD 讀批次檔時，是用「**舊字碼頁算出的位元組位置**」記住讀到哪裡。
`chcp 65001` 執行之後，接下來的讀取改用 UTF-8 解碼，但位置是用 cp950 的算法算的，
於是**接在某個字元的中間**，之後每一行都位移。位移的結果就是命令名稱被切掉開頭：

| 原本 | 被切成 |
| :--- | :--- |
| `echo` | `ho` |
| `start` | `s` |

線索很明顯：**畫面上連 `====` 橫幅都沒印出來**，只有錯誤訊息。如果只是中文變亂碼，
橫幅（純 ASCII）會照樣印出來才對。

### 規則：批次檔一律純 ASCII ＋ CRLF

純 ASCII 時位元組數等於字元數，不管字碼頁怎麼切換都不會位移。所以：

1. **`.bat` 內容只放 ASCII**（檔名本身有中文沒關係，那是檔案系統的事）
2. **行尾一律 CRLF**（CMD 對只有 LF 的批次檔行為不穩定）
3. **中文訊息改由 node 腳本 `console.log`**——`chcp 65001` 留著，
   它的作用是讓 Node 的 UTF-8 輸出顯示正確，這在 .bat 本身沒有多位元組字元時是安全的
4. `使用說明.txt` 要加 **UTF-8 BOM**（`'\uFEFF' + 內容`），
   Windows 10 1903 之前的記事本沒有 BOM 會整篇亂碼，而那份是要給同仁看的

`test/parse.test.mjs` 有五支測試守著這件事（純 ASCII、CRLF、
「chcp 與非 ASCII 不可共存」的組合、中文提示沒有跟著 .bat 一起消失、txt 的 BOM），
而且三種壞法都實際放回去確認過測試會失敗。

## 踩過的四個坑

1. **CJS 不支援 top-level await** → `exe-entry.mjs` 把啟動流程包進 `main()`。
2. **bundler 把 `import.meta.url` 變成空值**，`fileURLToPath` 會拋錯。
   `server.js` 改用 `selfPath`（try/catch 包住），並據此判斷是否為主程式——
   被 import（含打包）時不會自己 `listen`，所以 `npm test` 的行為完全不變。
3. **版號在 exe 裡讀不到 `package.json`** → 打包時用 `--define:__APP_VERSION__` 固化。
   ⚠️ `--define` 的值是 **JS 運算式**，`JSON.stringify` 只能包**一層**；
   包兩層會變成 `v"1.1.0"`（第一次就是這樣錯的，而且要跑起來才看得出來）。
4. **`node node_modules/esbuild/bin/esbuild` 會失敗且吞掉錯誤訊息**
   → 改成直接呼叫 `node_modules/.bin/esbuild`。

## 驗證方式（Windows exe 無法在 Linux 執行）

分兩路，不要只做結構檢查就宣稱可用：

- **功能**：用**同一份 bundle** 另外產出 Linux SEA 並實際執行 →
  版號、`/api/health`、內嵌 HTML（與原始檔位元組完全相同）、
  路徑穿越阻擋、連接埠備援、外部 HTML 覆蓋，全部實測。
- **結構**：確認 exe 是 PE32+ x86-64、含 `NODE_SEA_BLOB` 資源與 fuse 標記、
  exe 內找得到網頁內容（用 **ASCII 標記**如 `pi_agency_index` 搜尋；
  用含破折號的中文字串搜尋會失敗，那是編碼問題不是打包失敗）。

**唯一沒驗到的是「在 Windows 上真的跑起來」**，那必須由 YJC 自己測一次。

## 已知風險：防毒／SmartScreen

官方 `node.exe` 本身有數位簽章，注入 blob 後**簽章失效**
（postject 會印 `The signature seems corrupted!`）。

- Windows SmartScreen 會警告 →「其他資訊 → 仍要執行」
- 防火牆會問 → 允許（只綁 `127.0.0.1`，同網段連不進來）
- **公司防毒可能直接隔離**「未簽章又會開網路埠」的執行檔

那份失效簽章**刻意沒有動手移除**——手改 PE 標頭在無法實測 Windows 的情況下風險太高，
弄壞了同仁也無法 debug。若真的被隔離，退路是**資料夾版**：
一份 `node.exe` ＋ `server.js` ＋ `標案參謀室.html` ＋ 啟動用 `.bat`，壓成 zip。
沒有單一 exe 的隔離問題，也更好更新。

## 分享時要先講的事

- 資料存在**各人自己的瀏覽器**裡，換人換電腦就是空的；搬移用頁尾的匯出／匯入備份
- ⚠️ **不同連接埠在瀏覽器眼中是不同網站，localStorage 資料是分開的**。
  同仁若因為 5178 被占用而跑在 5179，資料會跟 5178 那份分開
- 標案查詢等功能需要能連上 g0v／openfun API；官網即時查需要能連政府電子採購網。
  公司若有網路代理可能要 IT 協助

## 傳輸限制備忘

- `SendUserFile` 上限 **30 MiB**：zip（-9）壓到 32.1 MB 過不了，`tar.xz -9e` 是 22 MB 才過關。
  Windows 11 檔案總管可直接開 `.tar.xz`，Windows 10 需要 7-Zip。
- `device_commit_files` 每檔上限 **20 MB**，所以 exe 無法直接寫回本機磁碟，只能走對話下載。
- 結論：**以後在 Windows 上用 `打包exe.bat` 自己產最省事。**
