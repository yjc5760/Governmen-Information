/**
 * 標案參謀室 — 官網即時查 proxy
 *
 * 直接查詢政府電子採購網的「標案查詢」頁面，解析成 JSON 給本機網頁使用，
 * 同時把同資料夾的 標案參謀室.html 當靜態檔服務出去。
 * 解析邏輯參考 h30190/SearchProcurementTenders-crawler.Ver (MIT)。
 *
 * 啟動： node server.js        （或 npm start）
 * 預設： http://localhost:5178
 * 換埠： PORT=8080 node server.js
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

/* 打包成單一執行檔時，bundler 會把 import.meta.url 變成空值，
   fileURLToPath 會拋錯，所以包起來。取不到就退回 cwd（打包後的入口會另外
   用 setStaticRoot() 指定 exe 所在資料夾）。 */
const selfPath = (() => { try { return fileURLToPath(import.meta.url); } catch { return ''; } })();
const __dirname = selfPath ? path.dirname(selfPath) : process.cwd();
let ROOT = path.resolve(__dirname);

/* 打包成單一執行檔（Node SEA）時，HTML 是內嵌在 exe 裡的，磁碟上不存在。
   但仍優先讀磁碟——這樣 exe 旁邊放一份新的 標案參謀室.html 就能直接覆蓋，
   不必為了改網頁重新打包。 */
const embedded = new Map();
export function setStaticRoot(dir){ ROOT = path.resolve(dir); }
export function addEmbeddedFile(name, content){
  embedded.set(name, Buffer.isBuffer(content) ? content : Buffer.from(String(content),'utf8'));
}

const PORT = Number(process.env.PORT) || 5178;
const HOST = process.env.HOST || '127.0.0.1';   // 只綁本機，不對外網開放
const BASE = 'https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic';

const CACHE_TTL     = 10 * 60 * 1000;   // 同一組查詢條件 10 分鐘內走快取
const CACHE_MAX     = 200;              // 快取上限，避免長時間執行後記憶體無上限成長
const MIN_GAP       = 1200;             // 兩次對官網的請求至少間隔（毫秒）
const FETCH_TIMEOUT = 20000;
const PAGE_SIZE_MAX = 100;

const INDEX_FILE = '標案參謀室.html';

/* 版號平常讀 package.json；打包成單一執行檔時旁邊沒有 package.json，
   所以由打包流程在編譯期呼叫 setVersion() 固化進去。 */
let VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch { return '0.0.0'; }
})();
export function setVersion(v){ if(v) VERSION = String(v); }
export function getVersion(){ return VERSION; }

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache'
};

const cache = new Map();            // 查詢鍵 -> { at, records }；Map 保留插入順序，用來做 LRU 淘汰
const startedAt = Date.now();

/* ---------- 工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseRocDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  let y = parseInt(m[1], 10);
  if (y < 1911) y += 1911;
  const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[3], 10), 23, 59, 59);
  return isNaN(d.getTime()) ? null : d;
}
function remainingDays(d) {
  if (!d) return null;
  return Math.ceil((d - new Date()) / 86400000);
}
function parseBudget(s) {
  if (!s) return 0;
  // 先去掉千分位與空白，再抓第一段數字；避免 "1.234.567" 被 parseFloat 讀成 1.234
  const cleaned = String(s).replace(/[,\s]/g, '');
  const m = cleaned.match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  const v = parseFloat(m[0]);
  return isNaN(v) ? 0 : Math.round(v);
}
function intParam(q, name, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const raw = q.get(name);
  if (raw === null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ---------- 快取 ---------- */
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= CACHE_TTL) { cache.delete(key); return null; }
  cache.delete(key); cache.set(key, hit);      // 命中就移到尾端，讓最舊的先被淘汰
  return hit.records;
}
function cacheSet(key, records) {
  cache.set(key, { at: Date.now(), records });
  for (const [k, v] of cache) {                 // 順手清掉過期的
    if (Date.now() - v.at >= CACHE_TTL) cache.delete(k);
  }
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/* ---------- 抓取與解析 ---------- */
function decodeHtml(buf, contentType) {
  const b = Buffer.from(buf);
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('big5')) return iconv.decode(b, 'big5');
  const utf = b.toString('utf8');
  if (/charset=["']?big5/i.test(utf.slice(0, 2048))) return iconv.decode(b, 'big5');
  return utf;
}

function parseRows(html) {
  const $ = cheerio.load(html);
  const out = [];

  $('table tr').each((_, el) => {
    const cols = $(el).find('td');
    if (cols.length < 9) return;

    const nameCol = $(cols[2]);
    const linkEl = nameCol.find('a');
    let link = linkEl.attr('href') || '';
    if (link && !link.startsWith('http')) link = 'https://web.pcc.gov.tw' + (link.startsWith('/') ? '' : '/') + link;

    // 案號
    const fullText = nameCol.text().trim().replace(/\s+/g, ' ');
    const idMatch = fullText.match(/([A-Za-z0-9\-.]{4,})/);
    const caseId = idMatch ? idMatch[1] : '';

    // 案名：官網把名稱包在 Geps3.CNS.pageCode2Img("…") 裡
    const innerHtml = nameCol.html() || '';
    let name = '';
    const img = innerHtml.match(/pageCode2Img\("([^"]+)"\)/);
    if (img) name = img[1];
    else name = linkEl.text().trim();
    name = name.replace(/\((更正|招標)公告\)/g, '').replace(/(更正|招標)公告/g, '').trim();

    const orgName = $(cols[1]).text().trim();

    // 雜訊列過濾
    if (!caseId || caseId.length > 30 || !name) return;
    if (/說明|◎|Geps3\./.test(caseId) || /Geps3\./.test(name)) return;
    if (/圖例說明|若查不到|注意事項/.test(orgName)) return;

    const tenderWay  = $(cols[4]).text().trim();
    const tenderType = $(cols[5]).text().trim();
    const publishRaw = $(cols[6]).text().trim();
    const endRaw     = $(cols[7]).text().trim();
    const budget     = parseBudget($(cols[8]).text().trim());

    const endDate = parseRocDate(endRaw);
    const pubDate = parseRocDate(publishRaw);
    const left = remainingDays(endDate);

    out.push({
      caseId, name, orgName, tenderWay, tenderType,
      publishDate: publishRaw,
      deadline: endRaw,
      deadlineISO: endDate ? endDate.toISOString() : null,
      publishISO: pubDate ? pubDate.toISOString() : null,
      remainingDays: left,
      tenderPeriod: (pubDate && endDate) ? Math.ceil((endDate - pubDate) / 86400000) : null,
      budget,
      link
    });
  });

  return out;
}

/* 對官網的請求全部排成一條佇列，確保任何併發情況下間隔都不小於 MIN_GAP */
let fetchChain = Promise.resolve();
let lastFetchAt = 0;
function throttled(fn) {
  const run = fetchChain.then(async () => {
    const gap = Date.now() - lastFetchAt;
    if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
    lastFetchAt = Date.now();
    return fn();
  });
  fetchChain = run.catch(() => {});   // 一次失敗不要卡住後面的請求
  return run;
}

async function fetchKeyword(keyword, opts = {}) {
  const norm = {
    tenderType: opts.tenderType || 'TENDER_DECLARATION',
    tenderWay:  opts.tenderWay  || 'TENDER_WAY_ALL_DECLARATION',
    pageSize:   Math.min(PAGE_SIZE_MAX, Math.max(1, Number(opts.pageSize) || PAGE_SIZE_MAX))
  };
  const key = JSON.stringify([keyword, norm.tenderType, norm.tenderWay, norm.pageSize]);

  const cached = cacheGet(key);
  if (cached) return { records: cached, cached: true };

  const qs = new URLSearchParams({
    pageSize: String(norm.pageSize),
    firstSearch: 'true',
    searchType: 'basic',
    isBinding: 'N',
    isLogIn: 'N',
    level_1: 'on',
    tenderName: keyword,
    tenderType: norm.tenderType,
    tenderWay: norm.tenderWay,
    dateType: 'isSpdt'   // 只抓等標期內
  });

  const records = await throttled(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    let resp;
    try {
      resp = await fetch(BASE + '?' + qs.toString(), { headers: HEADERS, signal: ctrl.signal });
    } catch (e) {
      throw new Error(e.name === 'AbortError'
        ? '官網逾時未回應（' + (FETCH_TIMEOUT / 1000) + ' 秒）'
        : '連線官網失敗：' + e.message);
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      throw new Error('官網回應 ' + resp.status + (resp.status === 403 ? '（可能被反爬機制擋下，請稍後再試）' : ''));
    }
    const buf = await resp.arrayBuffer();
    return parseRows(decodeHtml(buf, resp.headers.get('content-type')));
  });

  cacheSet(key, records);
  return { records, cached: false };
}

/* ---------- 回應 ---------- */
function json(res, code, body, { head = false } = {}) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(s)
  });
  return head ? res.end() : res.end(s);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.csv':  'text/csv; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.pdf':  'application/pdf'
};

/* 只允許服務 ROOT 底下的一般檔案，且不碰 .git、node_modules 等非公開內容 */
const BLOCKED = [/(^|[\\/])\.git([\\/]|$)/i, /(^|[\\/])node_modules([\\/]|$)/i, /(^|[\\/])\.env/i];

function resolveStatic(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel === '/' || rel === '') rel = '/' + INDEX_FILE;
  if (rel.includes('\0')) return null;

  const full = path.resolve(ROOT, '.' + rel.replace(/\\/g, '/'));
  // 必須真的落在 ROOT 之內：加上分隔字元才不會讓同前綴的鄰居目錄（如 ..網站-secret）過關
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;

  const inside = path.relative(ROOT, full);
  if (BLOCKED.some(re => re.test(inside))) return null;

  let st;
  try { st = fs.statSync(full); } catch { st = null; }
  if (st && st.isFile()) return { full, size: st.size, mtime: st.mtime };

  // 磁碟上沒有 → 看看是不是內嵌在執行檔裡
  const name = path.basename(full);
  if (embedded.has(name)) {
    const buf = embedded.get(name);
    return { full, name, size: buf.length, mtime: new Date(0), buffer: buf };
  }
  return null;
}

function serveStatic(res, hit, { head = false } = {}) {
  const ext = path.extname(hit.full).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': hit.size,
    'Last-Modified': hit.mtime.toUTCString(),
    'Cache-Control': 'no-cache'
  });
  if (head) return res.end();
  if (hit.buffer) return res.end(hit.buffer);
  fs.createReadStream(hit.full).on('error', () => res.end()).pipe(res);
}

/* ---------- 篩選 ---------- */
function applyFilters(records, q) {
  let r = records.slice();
  const minBudget = intParam(q, 'minBudget', { min: 0, fallback: 0 });
  const maxDays   = intParam(q, 'maxDays',   { min: 0, fallback: null });
  const exclude   = (q.get('exclude') || '').split(',').map(s => s.trim()).filter(Boolean);

  if (minBudget > 0) r = r.filter(x => x.budget >= minBudget);
  if (maxDays !== null) r = r.filter(x => x.remainingDays !== null && x.remainingDays <= maxDays);
  if (exclude.length) r = r.filter(x => !exclude.some(w => x.name.includes(w) || x.orgName.includes(w)));

  const sort = q.get('sort') || 'deadline';
  if (sort === 'budget') r.sort((a, b) => b.budget - a.budget);
  else r.sort((a, b) => {
    const A = a.remainingDays == null ? 9999 : a.remainingDays;
    const B = b.remainingDays == null ? 9999 : b.remainingDays;
    return A - B;
  });
  return r;
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const head = req.method === 'HEAD';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      // 讓放在 GitHub Pages（https 公網）的網頁也能呼叫這台電腦上的 proxy：
      // Chrome 的 Private Network Access 預檢要看到這個標頭才放行
      'Access-Control-Allow-Private-Network': 'true'
    });
    return res.end();
  }
  if (req.method !== 'GET' && !head) {
    res.writeHead(405, { 'Allow': 'GET, HEAD, OPTIONS' });
    return res.end();
  }

  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return json(res, 400, { error: '網址格式不正確' }, { head }); }

  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        version: VERSION,
        node: process.version,
        cachedKeywords: cache.size,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        time: new Date().toISOString()
      }, { head });
    }

    if (url.pathname === '/api/search') {
      const kw = (url.searchParams.get('keyword') || '').trim();
      if (!kw) return json(res, 400, { error: '缺少 keyword' }, { head });
      const { records, cached } = await fetchKeyword(kw, {
        tenderType: url.searchParams.get('tenderType') || undefined,
        tenderWay: url.searchParams.get('tenderWay') || undefined,
        pageSize: intParam(url.searchParams, 'pageSize', { min: 1, max: PAGE_SIZE_MAX, fallback: PAGE_SIZE_MAX })
      });
      const filtered = applyFilters(records, url.searchParams);
      return json(res, 200, {
        keyword: kw, total: records.length, count: filtered.length, cached, records: filtered
      }, { head });
    }

    if (url.pathname === '/api/watch') {
      const kws = [...new Set((url.searchParams.get('keywords') || '')
        .split(',').map(s => s.trim()).filter(Boolean))];
      if (!kws.length) return json(res, 400, { error: '缺少 keywords' }, { head });
      if (kws.length > 20) return json(res, 400, { error: '關鍵字最多 20 個，請縮小範圍' }, { head });

      const seen = new Map();
      const errors = [];
      for (const kw of kws) {
        try {
          const { records } = await fetchKeyword(kw);
          for (const r of records) {
            const k = r.caseId + '|' + r.orgName;
            const prev = seen.get(k);
            if (prev) { if (!prev.matched.includes(kw)) prev.matched.push(kw); }
            else seen.set(k, { ...r, matched: [kw] });
          }
        } catch (e) { errors.push({ keyword: kw, message: e.message }); }
      }
      const all = applyFilters([...seen.values()], url.searchParams);
      return json(res, 200, {
        keywords: kws, count: all.length, errors,
        closingSoon: all.filter(x => x.remainingDays !== null && x.remainingDays >= 0 && x.remainingDays <= 14),
        records: all
      }, { head });
    }

    if (url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: '沒有這個端點', endpoints: ['/api/health', '/api/search', '/api/watch'] }, { head });
    }

    const hit = resolveStatic(url.pathname);
    if (hit) return serveStatic(res, hit, { head });
    return json(res, 404, { error: 'not found' }, { head });

  } catch (e) {
    console.error('[error]', url.pathname, e.message);
    return json(res, 500, { error: e.message }, { head });
  }
});

/* 啟動伺服器。連接埠被占用時往上找下一個（同仁可能會不小心開兩次）。 */
export function start({ port = PORT, host = HOST, tries = 10 } = {}){
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryListen = () => {
      const onError = e => {
        server.removeListener('listening', onOk);
        if (e.code === 'EADDRINUSE' && ++attempt < tries) {
          port += 1;
          setImmediate(tryListen);
        } else reject(e);
      };
      const onOk = () => {
        server.removeListener('error', onError);
        resolve({ server, port, host });
      };
      server.once('error', onError);
      server.once('listening', onOk);
      server.listen(port, host);
    };
    tryListen();
  });
}

export { server, parseRows, parseRocDate, parseBudget, resolveStatic, applyFilters, INDEX_FILE };

/* 直接用 node server.js 跑才自動啟動；被 import（含打包進 exe）時不要自己 listen */
const isMainModule = !!selfPath && !!process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(selfPath);
if (isMainModule) {
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error('\n  連接埠 ' + PORT + ' 已被占用。');
      console.error('  可能是已經有一個 proxy 在跑（先開 http://localhost:' + PORT + '/ 看看），');
      console.error('  或改用其他埠：PORT=8080 node server.js\n');
    } else {
      console.error('\n  伺服器啟動失敗：' + e.message + '\n');
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  標案參謀室 proxy v' + VERSION + ' 已啟動');
    console.log('  網頁：    http://localhost:' + PORT + '/');
    console.log('  健康檢查：http://localhost:' + PORT + '/api/health');
    console.log('  按 Ctrl+C 結束');
    console.log('');
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log('\n  正在關閉…');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000);
    });
  }
}
