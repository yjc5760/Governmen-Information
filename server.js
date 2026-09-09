/**
 * 標案參謀室 — 官網即時查 proxy
 *
 * 直接查詢政府電子採購網的「標案查詢」頁面，解析成 JSON 給本機網頁使用。
 * 解析邏輯參考 h30190/SearchProcurementTenders-crawler.Ver (MIT)。
 *
 * 啟動： node server.js
 * 預設： http://localhost:5178
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5178;
const BASE = 'https://web.pcc.gov.tw/prkms/tender/common/basic/readTenderBasic';
const CACHE_TTL = 10 * 60 * 1000;   // 同一關鍵字 10 分鐘內走快取
const MIN_GAP   = 1200;             // 兩次對官網的請求至少間隔（毫秒）

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache'
};

const cache = new Map();            // keyword -> { at, records }
let lastFetchAt = 0;

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
  const n = String(s).replace(/[^\d.]/g, '');
  const v = parseFloat(n);
  return isNaN(v) ? 0 : Math.round(v);
}

/* ---------- 抓取與解析 ---------- */
function decodeHtml(buf, contentType) {
  const utf = Buffer.from(buf).toString('utf8');
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('big5') || /charset=["']?big5/i.test(utf)) {
    return iconv.decode(Buffer.from(buf), 'big5');
  }
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

async function fetchKeyword(keyword, opts = {}) {
  const key = JSON.stringify([keyword, opts.tenderType, opts.tenderWay, opts.pageSize]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { records: hit.records, cached: true };

  const gap = Date.now() - lastFetchAt;
  if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
  lastFetchAt = Date.now();

  const qs = new URLSearchParams({
    pageSize: String(opts.pageSize || 100),
    firstSearch: 'true',
    searchType: 'basic',
    isBinding: 'N',
    isLogIn: 'N',
    level_1: 'on',
    tenderName: keyword,
    tenderType: opts.tenderType || 'TENDER_DECLARATION',
    tenderWay: opts.tenderWay || 'TENDER_WAY_ALL_DECLARATION',
    dateType: 'isSpdt'   // 只抓等標期內
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let resp;
  try {
    resp = await fetch(BASE + '?' + qs.toString(), { headers: HEADERS, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error('官網回應 ' + resp.status + (resp.status === 403 ? '（可能被反爬機制擋下）' : ''));

  const buf = await resp.arrayBuffer();
  const html = decodeHtml(buf, resp.headers.get('content-type'));
  const records = parseRows(html);

  cache.set(key, { at: Date.now(), records });
  return { records, cached: false };
}

/* ---------- 路由 ---------- */
function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(s)
  });
  res.end(s);
}

function applyFilters(records, q) {
  let r = records.slice();
  const minBudget = parseInt(q.get('minBudget') || '0', 10);
  const maxDays = q.get('maxDays') ? parseInt(q.get('maxDays'), 10) : null;
  const exclude = (q.get('exclude') || '').split(',').map(s => s.trim()).filter(Boolean);

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' });
    return res.end();
  }

  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, version: '1.0.0', cachedKeywords: cache.size, time: new Date().toISOString() });
    }

    if (url.pathname === '/api/search') {
      const kw = (url.searchParams.get('keyword') || '').trim();
      if (!kw) return json(res, 400, { error: '缺少 keyword' });
      const { records, cached } = await fetchKeyword(kw, {
        tenderType: url.searchParams.get('tenderType') || undefined,
        tenderWay: url.searchParams.get('tenderWay') || undefined,
        pageSize: parseInt(url.searchParams.get('pageSize') || '100', 10)
      });
      const filtered = applyFilters(records, url.searchParams);
      return json(res, 200, { keyword: kw, total: records.length, count: filtered.length, cached, records: filtered });
    }

    if (url.pathname === '/api/watch') {
      const kws = (url.searchParams.get('keywords') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!kws.length) return json(res, 400, { error: '缺少 keywords' });
      const seen = new Map();
      const errors = [];
      for (const kw of kws) {
        try {
          const { records } = await fetchKeyword(kw);
          for (const r of records) {
            const k = r.caseId + '|' + r.orgName;
            if (seen.has(k)) { if (!seen.get(k).matched.includes(kw)) seen.get(k).matched.push(kw); }
            else seen.set(k, { ...r, matched: [kw] });
          }
        } catch (e) { errors.push({ keyword: kw, message: e.message }); }
      }
      const all = applyFilters([...seen.values()], url.searchParams);
      return json(res, 200, {
        keywords: kws, count: all.length, errors,
        closingSoon: all.filter(x => x.remainingDays !== null && x.remainingDays >= 0 && x.remainingDays <= 14),
        records: all
      });
    }

    // 靜態檔：把同資料夾的 html 一起服務，直接開 http://localhost:5178/
    let file = url.pathname === '/' ? '/標案參謀室.html' : decodeURIComponent(url.pathname);
    const full = path.join(__dirname, file);
    if (full.startsWith(__dirname) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      return res.end(fs.readFileSync(full));
    }
    return json(res, 404, { error: 'not found' });

  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

export { parseRows, parseRocDate, parseBudget };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  server.listen(PORT, () => {
    console.log('');
    console.log('  標案參謀室 proxy 已啟動');
    console.log('  網頁：    http://localhost:' + PORT + '/');
    console.log('  健康檢查：http://localhost:' + PORT + '/api/health');
    console.log('  按 Ctrl+C 結束');
    console.log('');
  });
}
