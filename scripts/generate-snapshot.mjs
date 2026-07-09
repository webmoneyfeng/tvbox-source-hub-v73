import { mkdir, writeFile, rm, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const LATEST = path.join(DIST, 'snapshot', 'latest');
let SNAPSHOT_WRITE_ROOT = LATEST;
const SOURCE_BASE = (process.env.SNAPSHOT_SOURCE_BASE || process.env.TVBOX_SOURCE_BASE || 'https://tvbox-source-hub.feng-yang.workers.dev').replace(/\/+$/, '');
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Number(process.env.SNAPSHOT_LIMIT || 24);
const FILTER_PACK_PAGE_COUNT = Number(process.env.FILTER_PACK_PAGE_COUNT || 2);
const FILTER_PACK_KEYS = new Set(['year', 'area', 'class', 'form', 'quality', 'state', 'episodes', 'duration', 'topic']);
const STATIC_SNAPSHOT_BASES = (process.env.STATIC_SNAPSHOT_BASES || [
  'https://raw.githubusercontent.com/webmoneyfeng/tvbox-source-hub-v73/main/dist/snapshot/latest',
  'https://tvbox-source-hub-v73.pages.dev/snapshot/latest',
  'https://tv.webhome.eu.org/static/snapshot/latest',
  'https://tv.webclound.eu.org/static/snapshot/latest',
].join('|')).split('|').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean);
const CATEGORIES = [
  ['0', '\u63a8\u8350'], ['1', '\u7535\u5f71'], ['2', '\u5267\u96c6'], ['3', '\u7efc\u827a'], ['4', '\u52a8\u6f2b'],
  ['5', '\u7eaa\u5f55\u7247'], ['6', '\u77ed\u5267'], ['7', '\u89e3\u8bf4'], ['8', '\u6587\u5a31\u77e5\u8bc6'], ['9', '\u6210\u4eba\u4f26\u7406'],
];
const SEARCH_TERMS = ['\u89e3\u8bf4', '\u7535\u5f71', '2026', '\u5929\u9053', '\u9065\u8fdc\u7684\u6551\u4e16\u4e3b', '\u738b\u5fd7\u6587'];
const CRITICAL_SEARCH_TERMS = new Set(['\u5929\u9053', '\u9065\u8fdc\u7684\u6551\u4e16\u4e3b', '\u738b\u5fd7\u6587']);
const SNAPSHOT_SEARCH_KNOWLEDGE = [
  { title: '\u5929\u9053', aliases: ['\u9065\u8fdc\u7684\u6551\u4e16\u4e3b'], actors: ['\u738b\u5fd7\u6587', '\u5de6\u5c0f\u9752'], year: '2008' },
  { title: '\u4eae\u5251', aliases: [], actors: ['\u674e\u5e7c\u658c'], year: '2005' },
  { title: '\u6f5c\u4f0f', aliases: [], actors: ['\u5b59\u7ea2\u96f7', '\u59da\u6668'], year: '2009' },
];
function normalizeSnapshotSearch(value) {
  return String(value || '').replace(/[\s\u00b7.,:;!?\-_/\\|\u3002\uff0c\uff1a\uff1b\uff01\uff1f\u2014]+/g, '').trim().toLowerCase();
}
function snapshotSearchVariants(wd) {
  const out = [];
  const add = (x) => { const v = String(x || '').trim(); if (v && !out.includes(v)) out.push(v); };
  const q = normalizeSnapshotSearch(wd);
  add(wd);
  for (const entry of SNAPSHOT_SEARCH_KNOWLEDGE) {
    const values = [entry.title, ...(entry.aliases || []), ...(entry.actors || [])];
    if (!values.some((x) => { const n = normalizeSnapshotSearch(x); return n && (n === q || n.includes(q) || q.includes(n)); })) continue;
    add(entry.title);
    for (const a of entry.aliases || []) add(a);
    if (entry.year) add(`${entry.title} ${entry.year}`);
  }
  return out.slice(0, 4);
}

async function ensureDir(p) { await mkdir(p, { recursive: true }); }
async function writeJson(rel, data) {
  const snapshotPrefix = 'snapshot/latest/';
  const file = rel.startsWith(snapshotPrefix)
    ? path.join(SNAPSHOT_WRITE_ROOT, rel.slice(snapshotPrefix.length))
    : path.join(DIST, rel);
  await ensureDir(path.dirname(file));
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}
async function readAuditJson(rel) {
  try { return JSON.parse(await readFile(path.join(ROOT, rel), 'utf8')); } catch { return null; }
}
function formatChinaReverseUpdateCode(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}`.split('').reverse().join('');
}
async function fetchJson(url, timeoutMs = 18000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'TVBoxSourceHubSnapshot/7.3', accept: 'application/json,*/*' }, signal: c.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}
function hasList(data) {
  return Array.isArray(data?.list) && data.list.length > 0;
}
async function fetchStaticSnapshot(rel, timeoutMs = 12000) {
  for (const base of STATIC_SNAPSHOT_BASES) {
    try {
      const relUrl = rel.replace(/^\/+/, '').replace(/%/g, '%25');
      const data = await fetchJson(base + '/' + relUrl, timeoutMs);
      if (data && typeof data === 'object') return data;
    } catch {}
  }
  return null;
}
async function fetchCatalogPack(t, pg) {
  let dynamic = null;
  try { dynamic = await fetchJson(endpoint(`/agg?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}&limit=${LIMIT}`)); } catch (err) { dynamic = { code: 1, msg: 'dynamic fetch failed', list: [], error: err.message }; }
  if (hasList(dynamic)) return { data: dedupePack(dynamic), source: 'dynamic' };
  const fallback = await fetchStaticSnapshot(`catalog-packs/t${t}-p${pg}-limit${LIMIT}.json`);
  if (hasList(fallback)) return { data: dedupePack(fallback), source: 'static-snapshot' };
  return { data: dynamic, source: 'dynamic-empty' };
}
async function fetchSearchPack(wd) {
  let dynamic = null;
  const variants = snapshotSearchVariants(wd);
  for (const term of variants) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        dynamic = await fetchJson(endpoint(`/agg?wd=${encodeURIComponent(term)}&pg=1&limit=${LIMIT}&snapshot_probe=${Date.now()}_${attempt}`));
        if (hasList(dynamic)) return { data: dedupePack(dynamic), source: term === wd ? 'dynamic' : `dynamic-variant:${term}` };
      } catch (err) { dynamic = { code: 1, msg: 'dynamic fetch failed', list: [], error: err.message }; }
    }
  }
  for (const term of variants) {
    const fallback = await fetchStaticSnapshot(`search-packs/${encodeURIComponent(term)}-p1-limit${LIMIT}.json`);
    if (hasList(fallback)) return { data: dedupePack(fallback), source: term === wd ? 'static-snapshot' : `static-variant:${term}` };
  }
  return { data: dynamic || { code: 1, msg: 'dynamic empty', list: [] }, source: 'dynamic-empty' };
}
function endpoint(pathname) {
  const join = pathname.includes('?') ? '&' : '?';
  return SOURCE_BASE + pathname + join + 'force=dynamic';
}
function filterToken(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}
function filterPackRel(t, key, value, pg) {
  return `snapshot/latest/filter-packs/t${t}/${key}-${filterToken(value)}-p${pg}-limit${LIMIT}.json`;
}
function visibleFilterOptions(data, t) {
  const groups = data?.filters?.[String(t)] || data?.class?.find((c) => String(c.type_id) === String(t))?.filters || [];
  const out = [];
  for (const group of groups) {
    if (!FILTER_PACK_KEYS.has(group?.key)) continue;
    for (const opt of group.value || []) {
      const value = String(opt?.v || '').trim();
      if (!value) continue;
      out.push({ key: group.key, filterName: group.name || group.key, optionName: opt.n || value, value });
    }
  }
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.key}\u0000${x.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function catalogText(item) {
  return [item?.type_name, item?.vod_name, item?.vod_sub, item?.vod_remarks, item?.vod_class, item?.vod_state, item?.vod_area, item?.vod_lang, item?.vod_year, item?.vod_content, item?.vod_play_from, item?.semantic_tags, item?.snapshot_filter_evidence].join(' ');
}
function catalogYear(item) {
  const m = catalogText(item).match(/(?:19|20)\d{2}/);
  return m ? m[0] : '';
}
function catalogTitleYear(item) {
  const m = String(item?.vod_name || '').match(/(?:19|20)\d{2}/);
  return m ? m[0] : '';
}
function catalogQualityRank(item) {
  const t = catalogText(item).toUpperCase();
  if (/4K|2160/.test(t)) return 70;
  if (/1080|\u84dd\u5149|BD|B1080/.test(t)) return 60;
  if (/TC|TS|\u62a2\u5148|\u67aa\u7248/.test(t)) return 15;
  if (/HD|\u9ad8\u6e05|\u6b63\u7247|\u5b8c\u7ed3/.test(t)) return 50;
  return 30;
}
function catalogClassMatches(value, item) {
  const v = String(value || '').trim();
  if (!v) return true;
  const hay = catalogText(item);
  const rules = [
    ['\u60ac\u7591\u72af\u7f6a', /(\u60ac\u7591|\u72af\u7f6a|\u63a8\u7406|\u5211\u4fa6|\u8b66\u532a|\u6848\u4ef6)/],
    ['\u79d1\u5e7b\u5947\u5e7b', /(\u79d1\u5e7b|\u5947\u5e7b|\u9b54\u5e7b|\u707e\u96be|\u5192\u9669)/],
    ['\u6050\u6016\u60ca\u609a', /(\u6050\u6016|\u60ca\u609a|\u7075\u5f02)/],
    ['\u6218\u4e89\u5386\u53f2', /(\u6218\u4e89|\u5386\u53f2|\u53e4\u88c5|\u4f20\u8bb0)/],
    ['\u6e2f\u53f0', /(\u6e2f\u53f0|\u9999\u6e2f|\u6e2f\u5267|\u6e2f\u6fb3|\u53f0\u6e7e|\u53f0\u5267)/],
    ['\u65e5\u97e9', /(\u65e5\u97e9|\u65e5\u672c|\u65e5\u5267|\u65e5\u6f2b|\u97e9\u56fd|\u97e9\u5267|\u97e9\u6f2b)/],
    ['\u6b27\u7f8e', /(\u6b27\u7f8e|\u7f8e\u56fd|\u82f1\u56fd|\u6cd5\u56fd|\u5fb7\u56fd|\u7f8e\u5267|\u82f1\u5267)/],
    ['\u56fd\u6f2b', /(\u56fd\u6f2b|\u56fd\u4ea7\u52a8\u6f2b|\u4e2d\u56fd\u52a8\u6f2b)/],
    ['\u65e5\u6f2b', /(\u65e5\u6f2b|\u65e5\u672c\u52a8\u6f2b|\u65e5\u97e9\u52a8\u6f2b|\u756a\u5267)/],
    ['\u97f3\u4e50\u73b0\u573a', /(\u97f3\u4e50\u73b0\u573a|\u97f3\u4e50\u4f1a|\u6f14\u5531\u4f1a|LIVE|\u73b0\u573a|\u97f3\u4e50\u8282)/i],
    ['\u751f\u6d3b\u65c5\u884c', /(\u751f\u6d3b|\u65c5\u884c|vlog|VLOG|\u65c5\u6e38|\u63a2\u5e97)/],
    ['\u7f8e\u98df\u5065\u8eab', /(\u7f8e\u98df|\u70f9\u996a|\u5065\u8eab|\u8fd0\u52a8|\u745c\u4f3d)/],
    ['\u6e38\u620f\u79d1\u6280', /(\u6e38\u620f|\u79d1\u6280|\u6d4b\u8bc4|\u6570\u7801|\u7535\u7ade)/],
    ['\u4f53\u80b2\u8d5b\u4e8b', /(\u4f53\u80b2|\u8d5b\u4e8b|\u6bd4\u8d5b|\u96c6\u9526|\u56de\u653e|\u7bee\u7403|\u8db3\u7403|\u683c\u6597)/],
    ['\u5c11\u513f\u4eb2\u5b50', /(\u5c11\u513f|\u513f\u7ae5|\u4eb2\u5b50|\u513f\u6b4c|\u65e9\u6559|\u542f\u8499)/],
    ['\u7535\u5f71', /(\u7535\u5f71|\u52a8\u4f5c|\u559c\u5267|\u7231\u60c5|\u79d1\u5e7b|\u6050\u6016|\u60ca\u609a|\u60ac\u7591|\u5267\u60c5|\u6218\u4e89|\u72af\u7f6a|\u5f71\u7247|\u9662\u7ebf)/],
    ['\u5267\u96c6', /(\u5267\u96c6|\u7535\u89c6\u5267|\u8fde\u7eed\u5267|\u56fd\u4ea7\u5267|\u7f8e\u5267|\u82f1\u5267|\u6e2f\u5267|\u53f0\u5267|\u97e9\u5267|\u65e5\u5267|\u6cf0\u5267)/],
    ['\u6587\u5a31\u77e5\u8bc6', /(\u6587\u5a31|\u77e5\u8bc6|\u6f14\u5531\u4f1a|\u97f3\u4e50|MV|LIVE|\u516c\u5f00\u8bfe|\u6559\u7a0b|\u8bb2\u5ea7|\u79d1\u666e|\u7f8e\u98df|\u65c5\u884c|\u6e38\u620f|\u4f53\u80b2|\u5c11\u513f)/i],
  ];
  const found = rules.find(([name]) => name === v);
  return found ? found[1].test(hay) : hay.includes(v);
}
function catalogForm(item) {
  const t = catalogText(item);
  if (/(\u89e3\u8bf4|\u8bb2\u89e3|\u5f71\u8bc4|\u76d8\u70b9|\u5267\u60c5\u89e3\u8bf4|\u7535\u5f71\u89e3\u8bf4|\u5f71\u89c6\u89e3\u8bf4|\u8bf4\u7535\u5f71|\u770b\u7535\u5f71)/.test(t)) return '\u89e3\u8bf4';
  if (/(\u516c\u5f00\u8bfe|\u8bfe\u7a0b|\u6559\u7a0b|\u6559\u5b66|\u8bb2\u5ea7|\u8bfe\u5802|\u57f9\u8bad)/.test(t)) return '\u8bfe\u7a0b';
  if (/(\u6f14\u5531\u4f1a|\u97f3\u4e50\u4f1a|\u5de1\u6f14|\bLIVE\b|\u73b0\u573a|\u821e\u53f0|\u97f3\u4e50\u8282|\u665a\u4f1a)/i.test(t)) return '\u73b0\u573a';
  if (/(\u5408\u96c6|\u5927\u5168|\u5168\u96c6|\u7cfb\u5217|\u4e13\u9898|\u76d8\u70b9|\u96c6\u9526)/.test(t)) return '\u5408\u96c6';
  if (/(\u9884\u544a|\u82b1\u7d6e|\u7247\u82b1|\u7247\u6bb5|\u7cbe\u5f69\u7247\u6bb5|\u5148\u5bfc)/.test(t)) return '\u7247\u6bb5';
  if (/(\u77ed\u89c6\u9891|\u5feb\u770b|\u901f\u770b)/.test(t)) return '\u77ed\u89c6\u9891';
  return '\u6b63\u7247';
}
function catalogFilterMatches(item, key, value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (key === 'year') {
    const y = catalogYear(item);
    if (!y) return false;
    const n = Number(y);
    if (/^\d{4}$/.test(v)) return y === v;
    if (v === '2020-2022') return n >= 2020 && n <= 2022;
    if (v === '2010s') return n >= 2010 && n <= 2019;
    if (v === 'older') return n > 0 && n < 2010;
    return true;
  }
  if (key === 'area' || key === 'class' || key === 'topic') return catalogClassMatches(v, item);
  if (key === 'form') return catalogForm(item) === v || catalogText(item).includes(v);
  if (key === 'quality') {
    if (v === 'hd') return catalogQualityRank(item) >= 50;
    if (v === '\u6b63\u7247') return catalogForm(item) === '\u6b63\u7247';
    return catalogText(item).toUpperCase().includes(v.toUpperCase());
  }
  if (key === 'state') {
    const t = catalogText(item);
    const complete = /(\u5b8c\u7ed3|\u5168\d{1,4}\u96c6|\u5168\u96c6|\u5df2\u5b8c\u7ed3)/.test(t);
    const updating = /(\u66f4\u65b0|\u66f4\u65b0\u81f3|\u8fde\u8f7d)/.test(t) && !complete;
    if (v === '\u5df2\u5b8c\u7ed3') return complete;
    if (v === '\u66f4\u65b0\u4e2d') return updating || !complete;
    if (v === '\u5408\u96c6') return catalogForm(item) === '\u5408\u96c6';
  }
  if (key === 'episodes') {
    const m = catalogText(item).match(/(?:\u5168|\u7b2c|\u66f4\u65b0\u81f3)?(\d{1,4})\u96c6/);
    if (!m) return false;
    const n = Number(m[1]);
    if (v === '0-30') return n <= 30;
    if (v === '31-80') return n >= 31 && n <= 80;
    if (v === '80+') return n > 80;
  }
  if (key === 'duration') {
    const form = catalogForm(item);
    if (v === '\u5408\u96c6') return form === '\u5408\u96c6';
    if (v === '\u77ed\u89c6\u9891') return form === '\u77ed\u89c6\u9891' || /\b([1-9]|1\d|2\d)\s*(min|\u5206\u949f)/i.test(catalogText(item));
    if (v === '\u957f\u89c6\u9891') return form !== '\u77ed\u89c6\u9891';
  }
  return catalogText(item).includes(v);
}
function categoryCompatible(item, job) {
  if (String(job.t) === '0') return true;
  return String(item?.type_id || '') === String(job.t) || String(item?.type_name || '') === String(job.name) || catalogText(item).includes(job.name);
}
function catalogTitleKey(value) {
  return String(value || '')
    .replace(/[\[【(（].*?[\]】)）]/g, '')
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/[\s\u00b7.\u3002,\uff0c:\uff1a;\uff1b!\uff01?\uff1f_\-\u2014|]+/g, '')
    .trim()
    .toLowerCase();
}
function catalogLineCount(item) {
  return Number(String(item?.vod_remarks || '').match(/(\d+)\s*?/)?.[1] || 0);
}
function catalogDedupKey(item) {
  const title = catalogTitleKey(item?.vod_name) || String(item?.vod_name || item?.vod_id || '').trim().toLowerCase();
  return [title, catalogTitleYear(item) || catalogYear(item), item?.type_name || ''].join('|');
}
function betterCatalogRow(a, b) {
  const al = catalogLineCount(a), bl = catalogLineCount(b);
  if (al !== bl) return al > bl ? a : b;
  const aq = catalogQualityRank(a), bq = catalogQualityRank(b);
  if (aq !== bq) return aq > bq ? a : b;
  return String(a?.vod_name || '').length <= String(b?.vod_name || '').length ? a : b;
}
function uniqueRows(rows) {
  const map = new Map();
  for (const item of rows) {
    const key = catalogDedupKey(item);
    if (!key) continue;
    const old = map.get(key);
    map.set(key, old ? betterCatalogRow(old, item) : item);
  }
  return [...map.values()];
}
function dedupePack(data) {
  if (!data || !Array.isArray(data.list)) return data;
  const list = uniqueRows(data.list);
  return { ...data, list, total: Math.max(Number(data.total || 0), list.length) };
}
function decorateRows(rows, job, evidence) {
  return rows.map((item) => {
    const tags = new Set(String(item?.semantic_tags || '').split(/[,\s|/]+/).filter(Boolean));
    for (const tag of [job.key, job.value, job.filterName, job.optionName]) if (tag) tags.add(String(tag));
    return { ...item, semantic_tags: [...tags].join(' '), snapshot_filter_evidence: evidence };
  });
}
function searchTermsForJob(job) {
  const v = String(job.value || '').trim();
  if (!v) return [];
  if (job.key === 'year') return [v];
  if (job.key === 'area') return [`${v}${job.name}`, v];
  if (job.key === 'class' || job.key === 'topic') return [`${v}${job.name}`, v];
  if (job.key === 'form') return [`${v}${job.name}`, v];
  if (job.key === 'quality') return [job.optionName || v, v];
  return [v];
}
async function backfillRowsForJob(job, cache) {
  const rows = [];
  for (const term of searchTermsForJob(job)) {
    if (!cache.has(term)) cache.set(term, fetchSearchPack(term).catch(() => ({ data: { list: [] }, source: 'error' })));
    const fetched = await cache.get(term);
    const list = Array.isArray(fetched?.data?.list) ? fetched.data.list : [];
    rows.push(...list.filter((item) => categoryCompatible(item, job) && catalogFilterMatches(item, job.key, job.value)));
    if (rows.length) return decorateRows(uniqueRows(rows), job, `search-backfill:${term}`);
    if (job.key === 'area' || job.key === 'class' || job.key === 'topic') {
      const weak = list.filter((item) => categoryCompatible(item, job));
      if (weak.length) return decorateRows(uniqueRows(weak), job, `source-search-evidence:${term}`);
    }
  }
  return [];
}
async function backfillRowsByDynamicFilter(job, cache) {
  const cacheKey = `${job.t}\u0000${job.key}\u0000${job.value}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      const rows = [];
      for (let pg = 1; pg <= FILTER_PACK_PAGE_COUNT; pg++) {
        const params = new URLSearchParams();
        params.set('ac', 'videolist');
        params.set('t', String(job.t));
        params.set('pg', String(pg));
        params.set('limit', String(LIMIT));
        params.set('f', JSON.stringify({ [job.key]: job.value }));
        params.set('snapshot_filter_backfill', `${Date.now()}_${pg}`);
        try {
          const data = await fetchJson(endpoint(`/agg?${params.toString()}`));
          if (Array.isArray(data?.list) && data.list.length) rows.push(...data.list);
        } catch {}
      }
      return decorateRows(uniqueRows(rows), job, 'dynamic-filter-backfill');
    })());
  }
  return cache.get(cacheKey);
}
async function buildFilterRows(job, catalogRows, cache) {
  const direct = catalogRows.filter((item) => catalogFilterMatches(item, job.key, job.value));
  if (direct.length) return decorateRows(uniqueRows(direct), job, 'catalog-derived');
  return backfillRowsForJob(job, cache);
}
function filterPackFromRows(basePack, filteredRows, job, pg) {
  const filtered = Array.isArray(filteredRows) ? filteredRows : [];
  const start = (pg - 1) * LIMIT;
  return {
    ...basePack,
    page: pg,
    pagecount: Math.max(1, Math.ceil(filtered.length / LIMIT)),
    limit: LIMIT,
    total: filtered.length,
    list: filtered.slice(start, start + LIMIT),
    snapshot_mode: 'generated-filter-pack',
    snapshot_filter: { key: job.key, value: job.value },
  };
}
function pruneFiltersForCategory(data, t, viableOptions) {
  const clone = JSON.parse(JSON.stringify(data || {}));
  function pruneGroups(groups) {
    return (groups || []).map((group) => {
      if (group.key === 'sort') return group;
      const values = [];
      for (const opt of group.value || []) {
        const value = String(opt?.v || '').trim();
        if (!value || viableOptions.has(`${t}\u0000${group.key}\u0000${value}`)) values.push(opt);
      }
      return { ...group, value: values };
    }).filter((group) => group.key === 'sort' || (group.value || []).some((opt) => String(opt?.v || '').trim()));
  }
  if (clone.filters?.[String(t)]) clone.filters[String(t)] = pruneGroups(clone.filters[String(t)]);
  if (Array.isArray(clone.class)) {
    clone.class = clone.class.map((c) => String(c.type_id) === String(t) ? { ...c, filters: pruneGroups(c.filters || []) } : c);
  }
  return clone;
}
function configJson(visibleUpdateText = '', policy = {}) {
  const clean = policy.includeAdult === false;
  const baseName = clean ? '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0' : '\u5f71\u89c6\u70b9\u64ad';
  const name = visibleUpdateText ? `${baseName} \u00b7 ${visibleUpdateText}` : baseName;
  return { spider: '', sites: [{ key: clean ? 'vod_unified_clean' : 'vod_unified', name, type: 1, api: PUBLIC_BASE + (clean ? '/agg-clean' : '/agg'), searchable: 1, quickSearch: 1, filterable: 1, changeable: 1 }], lives: [{ name: '\u7cbe\u9009\u76f4\u64ad', type: 0, url: PUBLIC_BASE + '/live.txt', playerType: 1 }], parses: [], flags: [], wallpaper: '' };
}
async function main() {
  const building = path.join(DIST, 'snapshot', `.building-${Date.now()}-${process.pid}`);
  SNAPSHOT_WRITE_ROOT = building;
  if (existsSync(building)) await rm(building, { recursive: true, force: true });
  await ensureDir(path.join(building, 'catalog-packs'));
  await ensureDir(path.join(building, 'detail-packs'));
  await ensureDir(path.join(building, 'filter-packs'));
  await ensureDir(path.join(building, 'search-packs'));
  const generatedAt = new Date().toISOString();
  const sourceAudit = await readAuditJson('audit/source-discovery-latest.json');
  const coverageAudit = await readAuditJson('audit/coverage-latest.json');
  const sourceDiscoveryAt = sourceAudit?.generatedAt || '';
  const coverageAuditAt = coverageAudit?.generatedAt || '';
  const visibleUpdateText = formatChinaReverseUpdateCode(generatedAt);
  const sourceSummary = sourceAudit ? { candidateCount: sourceAudit.candidateCount, active: sourceAudit.active, watch: sourceAudit.watch, rejected: sourceAudit.rejected, blocked: sourceAudit.blocked } : null;
  const coverageSummary = coverageAudit ? { total: coverageAudit.total, pass: coverageAudit.pass, warn: coverageAudit.warn, fail: coverageAudit.fail, byRootCause: coverageAudit.byRootCause } : null;
  const categoryRows = [];
  const filterJobs = [];
  const catalogPacksByCategory = new Map();
  const searchBackfillCache = new Map();
  const dynamicFilterBackfillCache = new Map();
  const viableFilterOptions = new Set();
  let filterPackFileCount = 0;
  const validation = { generatedAt, sourceBase: SOURCE_BASE, publicBase: PUBLIC_BASE, staticSnapshotBases: STATIC_SNAPSHOT_BASES, categories: [], filters: [], search: [], errors: [], warnings: [] };

  for (const [t, name] of CATEGORIES) {
    for (const pg of [1, 2]) {
      const rel = `snapshot/latest/catalog-packs/t${t}-p${pg}-limit${LIMIT}.json`;
      try {
        const fetched = await fetchCatalogPack(t, pg);
        const data = fetched.data;
        if (!Array.isArray(data.list) || data.list.length === 0) validation.errors.push(`category ${t} page ${pg} empty`);
        else if (fetched.source !== 'dynamic') validation.warnings.push(`category ${t} page ${pg} used ${fetched.source}`);
        await writeJson(rel, data);
        if (!catalogPacksByCategory.has(t)) catalogPacksByCategory.set(t, []);
        catalogPacksByCategory.get(t).push({ pg, data });
        if (pg === 1) {
          categoryRows.push({ type_id: t, type_name: name, count: data.list?.length || 0, total: data.total || 0, filterGroups: data.filters?.[t]?.length || data.filters?.[name]?.length || 0 });
          validation.categories.push({ t, name, count: data.list?.length || 0, total: data.total || 0, ok: (data.list?.length || 0) > 0 });
          for (const opt of visibleFilterOptions(data, t)) filterJobs.push({ t, name, ...opt });
        }
      } catch (err) {
        validation.errors.push(`category ${t} page ${pg}: ${err.message}`);
      }
    }
  }

  for (const job of filterJobs) {
    const packs = (catalogPacksByCategory.get(job.t) || []).sort((a, b) => a.pg - b.pg);
    const basePack = packs[0]?.data || { code: 1, msg: 'ok', class: [], filters: {}, list: [] };
    const catalogRows = packs.flatMap((p) => Array.isArray(p.data?.list) ? p.data.list : []);
    let filterRows = await buildFilterRows(job, catalogRows, searchBackfillCache);
    if (!filterRows.length) filterRows = await backfillRowsByDynamicFilter(job, dynamicFilterBackfillCache);
    if (!filterRows.length) {
      validation.filters.push({ t: job.t, category: job.name, key: job.key, filterName: job.filterName, optionName: job.optionName, value: job.value, page: 1, count: 0, total: 0, evidence: '', ok: false });
      validation.warnings.push(`filter ${job.t}/${job.key}/${job.value} page 1 empty`);
      continue;
    }
    viableFilterOptions.add(`${job.t}\u0000${job.key}\u0000${job.value}`);
    for (let pg = 1; pg <= FILTER_PACK_PAGE_COUNT; pg++) {
      try {
        const data = filterPackFromRows(basePack, filterRows, job, pg);
        await writeJson(filterPackRel(job.t, job.key, job.value, pg), data);
        filterPackFileCount++;
        const row = { t: job.t, category: job.name, key: job.key, filterName: job.filterName, optionName: job.optionName, value: job.value, page: pg, count: data.list?.length || 0, total: data.total || 0, evidence: data.list?.[0]?.snapshot_filter_evidence || '', ok: (data.list?.length || 0) > 0 };
        validation.filters.push(row);
        if (pg === 1 && !row.ok) validation.warnings.push(`filter ${job.t}/${job.key}/${job.value} page 1 empty`);
      } catch (err) {
        validation.warnings.push(`filter ${job.t}/${job.key}/${job.value} page ${pg}: ${err.message}`);
      }
    }
  }

  for (const [t, packs] of catalogPacksByCategory.entries()) {
    for (const pack of packs) {
      const pruned = pruneFiltersForCategory(pack.data, t, viableFilterOptions);
      pack.data = pruned;
      await writeJson(`snapshot/latest/catalog-packs/t${t}-p${pack.pg}-limit${LIMIT}.json`, pruned);
      if (pack.pg === 1) {
        const row = categoryRows.find((x) => String(x.type_id) === String(t));
        if (row) row.filterGroups = pruned.filters?.[String(t)]?.length || pruned.class?.find((c) => String(c.type_id) === String(t))?.filters?.length || 0;
      }
    }
  }

  for (const wd of SEARCH_TERMS) {
    try {
      const fetched = await fetchSearchPack(wd);
      const data = fetched.data;
      await writeJson(`snapshot/latest/search-packs/${encodeURIComponent(wd)}-p1-limit${LIMIT}.json`, data);
      const searchCount = data.list?.length || 0;
      validation.search.push({ wd, count: searchCount, total: data.total || 0, ok: searchCount > 0, source: fetched.source });
      if (fetched.source !== 'dynamic') validation.warnings.push(`search ${wd} used ${fetched.source}`);
      if (CRITICAL_SEARCH_TERMS.has(wd) && searchCount <= 0) validation.errors.push(`critical search ${wd} empty`);
    } catch (err) { validation.errors.push(`search ${wd}: ${err.message}`); }
  }

  const firstPack = (catalogPacksByCategory.get('1') || []).find((x) => x.pg === 1)?.data || await fetchJson(endpoint(`/agg?ac=videolist&t=1&pg=1&limit=6`));
  const detailRows = [];
  for (const item of (firstPack.list || []).slice(0, 3)) {
    if (!item.vod_id) continue;
    try {
      const detail = await fetchJson(endpoint(`/agg?ac=detail&ids=${encodeURIComponent(item.vod_id)}`));
      detailRows.push({ id: item.vod_id, name: item.vod_name, ok: (detail.list || []).length > 0, lines: String(detail.list?.[0]?.vod_play_from || '').split('$$$').filter(Boolean).length });
    } catch (err) { detailRows.push({ id: item.vod_id, name: item.vod_name, ok: false, error: err.message }); }
  }
  await writeJson('snapshot/latest/detail-packs/sample.json', { generatedAt, rows: detailRows });
  validation.detailSample = detailRows;

  const manifest = { ok: validation.errors.length === 0, version: '2026-07-04-aggregate-v7.3-domestic-free', generatedAt, sourceDiscoveryAt, coverageAuditAt, snapshotGeneratedAt: generatedAt, visibleUpdateText, visibleUpdateFormat: 'reverse-yyyyMMddHHmm', sourceSummary, coverageSummary, sourceBase: SOURCE_BASE, publicBase: PUBLIC_BASE, entries: { full: PUBLIC_BASE + '/config.json', clean: PUBLIC_BASE + '/config-clean.json' }, contentPolicies: ['full', 'clean-no-adult'], packLimit: LIMIT, clientLimits: [8, 12, 24, 48], categories: categoryRows, filterPackCount: filterPackFileCount, visibleFilterOptions: viableFilterOptions.size, files: { categories: 'categories.json', validation: 'validation.json' } };
  await writeJson('snapshot/latest/manifest.json', manifest);
  await writeJson('snapshot/latest/categories.json', { generatedAt, class: CATEGORIES.map(([type_id, type_name]) => ({ type_id, type_name })), rows: categoryRows });
  await writeJson('snapshot/latest/validation.json', validation);
  if (validation.errors.length) {
    await rm(building, { recursive: true, force: true });
    console.log(JSON.stringify({ ok: false, generatedAt, errors: validation.errors, categories: validation.categories }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (existsSync(LATEST)) await rm(LATEST, { recursive: true, force: true });
  await rename(building, LATEST);
  SNAPSHOT_WRITE_ROOT = LATEST;
  await writeJson('config.json', configJson(visibleUpdateText));
  await writeJson('config-clean.json', configJson(visibleUpdateText, { includeAdult: false }));
  await writeJson('status.json', { ok: true, version: '2026-07-04-aggregate-v7.3-domestic-free', generatedAt, sourceDiscoveryAt, coverageAuditAt, snapshotGeneratedAt: generatedAt, visibleUpdateText, visibleUpdateFormat: 'reverse-yyyyMMddHHmm', sourceSummary, coverageSummary, publicBase: PUBLIC_BASE, sourceBase: SOURCE_BASE, entries: { full: PUBLIC_BASE + '/config.json', clean: PUBLIC_BASE + '/config-clean.json' }, updateCadence: { target: 'hot probe <= 15 minutes by Cloudflare Cron, full snapshot <= 2 hours by GitHub Actions', configCacheSeconds: 0 } });
  console.log(JSON.stringify({ ok: validation.errors.length === 0, generatedAt, errors: validation.errors, categories: validation.categories }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
