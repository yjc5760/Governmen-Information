# 標案參謀室 — 官網即時查 proxy

網頁本身純前端，但「官網即時查」這一頁需要這支本機小程式代為查詢政府電子採購網
（瀏覽器有 CORS 限制，沒辦法直接爬官網）。

## 安裝與啟動

需要 Node.js 20 以上。

**Windows**：雙擊 `start-windows.bat`。第一次會自動跑 `npm install`，之後直接啟動並開瀏覽器。

**macOS / Linux**：

```bash
cd proxy
npm install     # 只需第一次
npm start
```

啟動後開 <http://localhost:5178/>。這個網址會直接把 `標案參謀室.html` 服務出來，
比用 `file://` 開更順（不會有跨來源問題）。

想換連接埠：`PORT=8080 npm start`，同時到網頁的「設定 → 官網即時查 proxy」把位址改成一樣。

## 開機自動啟動（Windows）

按 `Win+R`，輸入 `shell:startup`，把 `start-windows.bat` 的捷徑丟進去。
不想每次跳出黑視窗的話，改用工作排程器建立「登入時」觸發、隱藏視窗執行 `node server.js` 的工作。

## API

| 端點 | 說明 |
| :--- | :--- |
| `GET /api/health` | 健康檢查，網頁用它判斷 proxy 在不在 |
| `GET /api/search?keyword=燃氣` | 單一關鍵字查詢，只回等標期內案件 |
| `GET /api/watch?keywords=燃氣,統包,監造` | 多關鍵字一次跑完、去重、附 14 日內截止清單 |

共同的篩選參數：`minBudget`（預算下限）、`maxDays`（幾日內截止）、`exclude`（排除字詞，逗號分隔）、`sort`（`deadline` 或 `budget`）。

回傳欄位：`caseId` `name` `orgName` `tenderWay` `tenderType` `publishDate` `deadline`
`remainingDays` `tenderPeriod` `budget` `link`。

## 對官網的節制

- 同一組查詢條件 10 分鐘內走記憶體快取，不重複打官網
- 兩次對外請求之間至少間隔 1.2 秒
- 只查公開的「標案查詢」頁面，不做登入、不大量掃頁

請不要把間隔調短或拿去大量抓取。官網 2025 年起有反爬機制，被擋通常是 403。

## 已知限制

- 只涵蓋**招標公告、等標期內**的案子。決標、歷史案件、廠商查詢仍走網頁裡的 g0v API
- 一次最多 100 筆，關鍵字太寬會被截斷，請縮小範圍
- 官網改版時 `parseRows()` 的欄位位置可能要跟著改
- 預算欄位官網有時不公開，會顯示「未提供」

## 來源與授權

網頁解析邏輯（`readTenderBasic` 查詢參數、Big5 編碼判斷、
`Geps3.CNS.pageCode2Img("…")` 案名還原、雜訊列過濾）參考自
[h30190/SearchProcurementTenders-crawler.Ver](https://github.com/h30190/SearchProcurementTenders-crawler.Ver)，MIT License，
作者：加號設計數位工程有限公司。

資料來源為行政院公共工程委員會政府電子採購網。依該站著作權聲明，
資訊可為個人非營利目的重製、或為研究等正當目的在合理範圍內引用，引用請註明出處。
投標決定前請自行至官網核實。
