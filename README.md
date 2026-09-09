# 標案參謀室

個人自用的政府標案情報站。由兩個部分組成：

| 部分 | 檔案 | 作用 |
| :--- | :--- | :--- |
| 前端網頁 | `標案參謀室.html` | 單一檔案，所有頁面與邏輯都在裡面，資料存在瀏覽器 localStorage |
| 本機 proxy | `server.js` | ①把網頁服務出去 ②代為查詢政府電子採購網官網（瀏覽器有 CORS 限制，沒辦法直接爬） |

網頁本身純前端，理論上雙擊 `標案參謀室.html` 就能開，但「官網即時查」這一頁一定要 proxy
才會有資料，所以**建議一律從 proxy 開**（`http://localhost:5178/`），不要用 `file://`。

---

## 快速開始

需要 Node.js 20 以上。

**Windows**：雙擊 `start-windows.bat`。第一次會自動跑 `npm install`，之後直接啟動並開瀏覽器。

**macOS / Linux**：

```bash
./start-mac-linux.sh
```

或手動：

```bash
npm install     # 只需第一次
npm start
```

啟動後開 <http://localhost:5178/>。

想換連接埠：`PORT=8080 npm start`，同時到網頁的「設定 → 官網即時查 proxy」把位址改成一樣。

proxy 預設只綁 `127.0.0.1`，同一台機器以外連不進來。想從手機或區網另一台機器看，
啟動時加 `HOST=0.0.0.0`（自負風險，這支程式沒有任何身分驗證）。

---

## 檔案結構

```
自用情報網站/
├── 標案參謀室.html      前端網頁（單檔，約 1300 行）
├── server.js            本機 proxy + 靜態檔伺服器
├── test/
│   └── parse.test.mjs   煙霧測試（不連外網）
├── package.json
├── start-windows.bat
├── start-mac-linux.sh
├── .gitignore
└── node_modules/        npm install 產生，不進版控
```

改版靠 git，不要再複製 `xxx.backup-日期.html` 放在資料夾裡（`.gitignore` 已經排除這種檔名）。
改壞了用 `git diff` / `git checkout -- 標案參謀室.html` 還原。

```bash
git log --oneline        # 看版本歷史
npm test                 # 改完 server.js 先跑這個
```

---

## 兩條資料來源

這是理解整個網頁最重要的一件事：兩條來源涵蓋範圍不同，不會互相補齊。

| | 走 g0v / openfun API | 走本機 proxy 打官網 |
| :--- | :--- | :--- |
| 涵蓋 | 招標、決標、歷史案件、廠商 | **只有招標公告，且只有等標期內** |
| 即時性 | 落後官網數小時到一天 | 即時 |
| 用在哪些頁面 | 總覽、標案情報中心、機關洞察、市場與廠商、採購行事曆 | 官網即時查 |
| 設定位置 | 設定 → 標案資料 API | 設定 → 官網即時查 proxy |

API 預設 `https://pcc-api.openfun.app`，備用 `https://pcc.g0v.ronny.tw`。
目前不帶 token 就能公開查詢，所以預設不送 `Authorization`
（`pcc-viewer` 公開設定檔裡那組 token 已被 API 端擋掉，網頁會自動忽略它）。
被限流的話到「設定 → API Token」填自己申請的。

---

## 八個頁面

| 頁面 | 做什麼 |
| :--- | :--- |
| **總覽** | 逐日同步全國公告存進瀏覽器（近 3／7／14 日，最多保留 21 天），加上追蹤中 14 日內截止的清單。機關洞察與行事曆都吃這份快取，所以第一次使用要先來這裡按「開始同步」 |
| **標案情報中心** | 按標案名稱或機關查詢，翻頁；點進去看標案詳情，可加入追蹤或比較 |
| **官網即時查** | 走本機 proxy 直接問官網，只回等標期內的案子。可設關鍵字清單一次跑完（「關鍵字監控」），附 14 日內截止 |
| **機關洞察** | 選一個機關，向 API 抓它**全期間**公告（不受同步天數限制），看得標廠商排行、採購輪廓、逐年件數 |
| **市場與廠商** | 用廠商名稱或統編查它的得標紀錄；另有「已同步期間的得標廠商排行」（吃快取） |
| **採購行事曆** | 月曆呈現快取裡的公告量與追蹤案的投標截止日 |
| **追蹤清單** | 收藏的案子，可一鍵回頭向 API 更新截止日與預算 |
| **標案比較** | 最多 4 案並排比 12 個欄位（採購性質、招標／決標方式、履約期限等） |

---

## proxy API

| 端點 | 說明 |
| :--- | :--- |
| `GET /api/health` | 健康檢查，網頁用它判斷 proxy 在不在。回 `version` `node` `cachedKeywords` `uptimeSeconds` |
| `GET /api/search?keyword=燃氣` | 單一關鍵字查詢，只回等標期內案件 |
| `GET /api/watch?keywords=燃氣,統包,監造` | 多關鍵字一次跑完、去重、附 14 日內截止清單。關鍵字上限 20 個 |

共同的篩選參數：

| 參數 | 說明 |
| :--- | :--- |
| `minBudget` | 預算下限 |
| `maxDays` | 幾日內截止 |
| `exclude` | 排除字詞，逗號分隔，比對案名與機關名 |
| `sort` | `deadline`（預設）或 `budget` |
| `pageSize` | 1–100，預設 100，只有 `/api/search` 吃 |

非數字的 `minBudget` / `maxDays` 視為未設定（不會靜靜地把結果篩成空的）。

回傳欄位：

```
caseId  name  orgName  tenderWay  tenderType
publishDate  deadline  remainingDays  tenderPeriod
publishISO  deadlineISO          ← 已解析成 ISO 字串，方便前端排序
budget  link
```

`/api/watch` 的每筆另外帶 `matched`（這筆是被哪些關鍵字命中）。

除了 `/api/*` 以外的路徑一律當同資料夾的靜態檔服務，根路徑 `/` 對應 `標案參謀室.html`。
`.git/`、`node_modules/`、`.env*` 與資料夾以外的路徑不會被服務出去。

---

## 資料存在哪裡

全部在瀏覽器 localStorage，換瀏覽器或清網站資料就沒了。**沒有任何資料上傳到雲端。**

| 鍵 | 內容 |
| :--- | :--- |
| `pi_api_base` / `pi_api_token` | 標案資料 API 設定 |
| `pi_proxy_base` | proxy 位址 |
| `pi_daycache` | 逐日公告快取（最多 21 天；塞不下時自動丟最舊幾天） |
| `pi_tracked` | 追蹤清單 |
| `pi_compare` | 比較清單 |
| `pi_watch_keywords` | 關鍵字監控清單 |
| `pi_amount_cache` | 決標金額快取 |

頁尾的「匯出備份」只帶走**追蹤、比較、關鍵字**三項（`version: 3` 的 JSON），
快取類的資料不備份——重新同步就有。

---

## 開機自動啟動（Windows）

按 `Win+R`，輸入 `shell:startup`，把 `start-windows.bat` 的捷徑丟進去。
不想每次跳出黑視窗的話，改用工作排程器建立「登入時」觸發、隱藏視窗執行 `node server.js` 的工作。

---

## 對官網的節制

- 同一組查詢條件 10 分鐘內走記憶體快取，不重複打官網（快取上限 200 組，超過淘汰最舊的）
- 所有對外請求排成單一佇列，任何併發情況下間隔都不小於 1.2 秒
- 單次請求 20 秒逾時
- 只查公開的「標案查詢」頁面，不做登入、不大量掃頁

請不要把間隔調短或拿去大量抓取。官網 2025 年起有反爬機制，被擋通常是 403。

---

## 已知限制

- 官網即時查只涵蓋**招標公告、等標期內**的案子。決標、歷史案件、廠商查詢仍走 g0v / openfun API
- 一次最多 100 筆，關鍵字太寬會被截斷，請縮小範圍
- `parseRows()` 依賴官網表格的**欄位位置**（第 2、3、5、6、7、8、9 欄）。官網改版時要跟著改，
  改完跑 `npm test` 會抓到明顯的解析失敗
- 預算欄位官網有時不公開，會顯示「未提供」（API 回 `budget: 0`）
- `remainingDays` 用 `Math.ceil` 算到截止日 23:59，所以「今天截止」會顯示剩 1 天。前端算法一致，兩邊沒有落差
- 網頁用 CDN 載 Tailwind 與 Font Awesome，**完全離線時樣式會掉**（功能仍在）
- 前端是單一 1300 行 HTML 檔，大量 `innerHTML` 字串拼接。要大改的話值得先拆檔

---

## 來源與授權

網頁解析邏輯（`readTenderBasic` 查詢參數、Big5 編碼判斷、
`Geps3.CNS.pageCode2Img("…")` 案名還原、雜訊列過濾）參考自
[h30190/SearchProcurementTenders-crawler.Ver](https://github.com/h30190/SearchProcurementTenders-crawler.Ver)，MIT License，
作者：加號設計數位工程有限公司。

資料來源為行政院公共工程委員會政府電子採購網。依該站著作權聲明，
資訊可為個人非營利目的重製、或為研究等正當目的在合理範圍內引用，引用請註明出處。
投標決定前請自行至官網核實。
