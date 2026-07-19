import { mkdir, writeFile, rm, readFile, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SNAPSHOT_CATEGORIES,
  SNAPSHOT_PRIMARY_CATEGORIES,
  LEGACY_CATEGORY_PACKS,
  buildCatalogViews,
  buildSnapshotIndexes,
  buildSnapshotRevision,
  crawlIncrementalCatalog,
  extractUpdatedAt,
  mergeSnapshotRows,
  normalizeSnapshotRows,
  snapshotRetentionGate,
} from '../src/snapshot-catalog.mjs';
import { buildSourceCategoryMap, crawlSourceWindow, normalizeCmsPayload, normalizeSourceRows, sourceRowsFromPrevious } from '../src/snapshot-source-crawler.mjs';
import { FULL_SNAPSHOT_SOURCES } from '../src/source-registry.mjs';
import { enrichRowsWithDoubanMetadata, tagReleaseBackfillRow } from '../src/release-metadata.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(process.env.SNAPSHOT_OUTPUT_DIR || path.join(ROOT, 'dist'));
const LATEST = path.join(DIST, 'snapshot', 'latest');
let SNAPSHOT_WRITE_ROOT = LATEST;
const SOURCE_BASE = (process.env.SNAPSHOT_SOURCE_BASE || process.env.TVBOX_SOURCE_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Number(process.env.SNAPSHOT_LIMIT || 24);
const CRAWL_LIMIT = Math.max(LIMIT, Number(process.env.SNAPSHOT_CRAWL_LIMIT || 96));
const MAX_CATALOG_PAGES = Math.max(2, Number(process.env.SNAPSHOT_MAX_PAGES || 500));
const SHARD_SIZE = Number(process.env.SNAPSHOT_SHARD_SIZE || 750);
const MAX_SNAPSHOT_FILES = Math.min(19_500, Math.max(1_000, Number(process.env.SNAPSHOT_MAX_FILES || 19_500)));
const MAX_FILE_BYTES = Math.min(25 * 1024 * 1024, Math.max(1024 * 1024, Number(process.env.SNAPSHOT_MAX_FILE_BYTES || 24 * 1024 * 1024)));
const BUILD_SCHEMA_VERSION = 4;
const SNAPSHOT_CRAWL_MODE = String(process.env.SNAPSHOT_CRAWL_MODE || 'direct-sources').trim().toLowerCase();
const SOURCE_PAGES_PER_RUN = Math.max(1, Number(process.env.SNAPSHOT_SOURCE_PAGES_PER_RUN || 40));
const SOURCE_CRAWL_CONCURRENCY = Math.max(1, Number(process.env.SNAPSHOT_SOURCE_CONCURRENCY || 3));
const SOURCE_PAGE_CONCURRENCY = Math.max(1, Number(process.env.SNAPSHOT_SOURCE_PAGE_CONCURRENCY || 6));
const RELEASE_BACKFILL_CONCURRENCY = Math.max(1, Number(process.env.RELEASE_BACKFILL_CONCURRENCY || 4));
const DOUBAN_METADATA_CONCURRENCY = Math.max(1, Number(process.env.DOUBAN_METADATA_CONCURRENCY || 2));
const DOUBAN_METADATA_MAX_PER_RUN = Math.max(0, Number(process.env.DOUBAN_METADATA_MAX_PER_RUN || 500));
const DOUBAN_METADATA_MIN_INTERVAL_MS = Math.max(100, Number(process.env.DOUBAN_METADATA_MIN_INTERVAL_MS || 350));
const DOUBAN_METADATA_URL_TEMPLATE = String(process.env.DOUBAN_METADATA_URL_TEMPLATE || 'https://m.douban.com/rexxar/api/v2/movie/{id}?ck=&for_mobile=1');
const FILTER_PACK_PAGE_COUNT = Number(process.env.FILTER_PACK_PAGE_COUNT || 0);
const FILTER_PACK_KEYS = new Set(['year', 'area', 'class', 'form', 'quality', 'state', 'episodes', 'duration', 'topic']);
const STATIC_SNAPSHOT_BASES = (process.env.STATIC_SNAPSHOT_BASES || [
  'https://raw.githubusercontent.com/webmoneyfeng/tvbox-source-hub-v73/snapshot/dist/snapshot/latest',
  'https://tvbox-source-hub-v73.pages.dev/snapshot/latest',
].join('|')).split('|').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean);
const CATEGORIES = SNAPSHOT_CATEGORIES.map(({ id, name, key }) => [id, name, key]);
const CATEGORY_BY_ID = new Map(SNAPSHOT_CATEGORIES.map((category) => [category.id, category]));
const LEGACY_CATEGORY_NAMES = Object.freeze({ 1: '\u7535\u5f71', 2: '\u5267\u96c6', 6: '\u77ed\u5267' });
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
const writtenSnapshotFiles = new Set();
async function writeJson(rel, data) {
  const snapshotPrefix = 'snapshot/latest/';
  const file = rel.startsWith(snapshotPrefix)
    ? path.join(SNAPSHOT_WRITE_ROOT, rel.slice(snapshotPrefix.length))
    : path.join(DIST, rel);
  const body = JSON.stringify(data, null, 2);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_FILE_BYTES) throw new Error(`${rel} exceeds ${MAX_FILE_BYTES} byte snapshot file limit`);
  if (rel.startsWith(snapshotPrefix)) {
    writtenSnapshotFiles.add(rel);
    if (writtenSnapshotFiles.size > MAX_SNAPSHOT_FILES) throw new Error(`snapshot file count exceeds ${MAX_SNAPSHOT_FILES}`);
  }
  await ensureDir(path.dirname(file));
  await writeFile(file, body, 'utf8');
}
async function readJsonFile(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJsonFileAtomic(file, data) {
  const temporary = `${file}.tmp-${process.pid}`;
  await ensureDir(path.dirname(file));
  await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
  if (existsSync(file)) await rm(file, { force: true });
  await rename(temporary, file);
}
async function countSnapshotFiles(root, relative = '') {
  let count = 0;
  let entries = [];
  try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (child === '.crawl' || child.startsWith(`.crawl${path.sep}`) || child === 'build-state.json') continue;
    count += entry.isDirectory() ? await countSnapshotFiles(root, child) : 1;
  }
  return count;
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

async function mapLimit(items, limit, worker) {
  const input = Array.from(items || []);
  if (!input.length) return [];
  const width = Math.max(1, Math.min(Math.trunc(Number(limit) || 1), input.length));
  const output = new Array(input.length);
  let next = 0;
  async function run() {
    while (next < input.length) {
      const index = next;
      next += 1;
      output[index] = await worker(input[index], index);
    }
  }
  await Promise.all(Array.from({ length: width }, run));
  return output;
}

function sourceEndpoint(source, params = {}) {
  const url = new URL(source.api);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
  }
  return url.href;
}

async function fetchSourcePayload(source, params, timeoutMs = 18000) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const data = await fetchJson(sourceEndpoint(source, params), timeoutMs);
      if (data && typeof data === 'object' && data.ok !== false) return data;
      lastError = new Error(`HTTP ${data?.status || 0}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
  }
  throw lastError || new Error('source fetch failed');
}
let doubanNextRequestAt = 0;
async function waitForDoubanRequestSlot() {
  const now = Date.now();
  const slot = Math.max(now, doubanNextRequestAt);
  doubanNextRequestAt = slot + DOUBAN_METADATA_MIN_INTERVAL_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}
async function fetchDoubanReleaseMetadata(id, timeoutMs = 12000) {
  const url = DOUBAN_METADATA_URL_TEMPLATE.replace('{id}', encodeURIComponent(String(id)));
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForDoubanRequestSlot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json,*/*',
          referer: `https://movie.douban.com/subject/${encodeURIComponent(String(id))}/`,
          'user-agent': 'Mozilla/5.0 TVBoxSourceHubReleaseMetadata/7.3',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Douban HTTP ${response.status}`);
      const data = JSON.parse(body.replace(/^\uFEFF/u, '').trim());
      if (!data || typeof data !== 'object') throw new Error('Douban metadata is not an object');
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Douban release metadata unavailable');
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
async function fetchCatalogPack(t, pg, limit = LIMIT) {
  let dynamic = null;
  try { dynamic = await fetchJson(endpoint(`/agg?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}&limit=${limit}`)); } catch (err) { dynamic = { code: 1, msg: 'dynamic fetch failed', list: [], error: err.message }; }
  if (hasList(dynamic)) return { data: dedupePack(dynamic), source: 'dynamic' };
  const fallback = await fetchStaticSnapshot(`catalog-packs/t${t}-p${pg}-limit${limit}.json`);
  if (hasList(fallback)) return { data: dedupePack(fallback), source: 'static-snapshot' };
  return { data: dynamic, source: 'dynamic-empty' };
}
async function fetchSearchPack(wd, { collectAll = false } = {}) {
  let dynamic = null;
  const variants = snapshotSearchVariants(wd);
  const collected = [];
  const sources = [];
  for (const term of variants) {
    let termMatched = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        dynamic = await fetchJson(endpoint(`/agg?wd=${encodeURIComponent(term)}&pg=1&limit=${LIMIT}&snapshot_probe=${Date.now()}_${attempt}`));
        if (!hasList(dynamic)) continue;
        const source = term === wd ? 'dynamic' : `dynamic-variant:${term}`;
        if (!collectAll) return { data: dedupePack(dynamic), source };
        collected.push(...dynamic.list);
        sources.push(source);
        termMatched = true;
        break;
      } catch (err) { dynamic = { code: 1, msg: 'dynamic fetch failed', list: [], error: err.message }; }
    }
    if (termMatched) continue;
    const fallback = await fetchStaticSnapshot(`search-packs/${encodeURIComponent(term)}-p1-limit${LIMIT}.json`);
    if (!hasList(fallback)) continue;
    const source = term === wd ? 'static-snapshot' : `static-variant:${term}`;
    if (!collectAll) return { data: dedupePack(fallback), source };
    collected.push(...fallback.list);
    sources.push(source);
  }
  if (collected.length) {
    return {
      data: { code: 1, msg: 'ok', list: collected, total: collected.length },
      source: [...new Set(sources)].join('+'),
    };
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
  return [item?.type_name, item?.primary_category, item?.vod_name, item?.vod_sub, item?.vod_remarks, item?.vod_class, item?.vod_state, item?.vod_area, item?.vod_lang, item?.vod_year, item?.vod_actor, item?.vod_director, item?.vod_content, item?.vod_play_from, item?.semantic_tags, item?.snapshot_filter_evidence].join(' ');
}
function catalogYear(item) {
  const m = String(item?.vod_year || '').match(/(?:19|20)\d{2}/) || catalogText(item).match(/(?:19|20)\d{2}/);
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
    ['\u5927\u9646', /(\u5927\u9646|\u5185\u5730|\u4e2d\u56fd|\u56fd\u4ea7)/],
    ['\u6e2f\u53f0', /(\u6e2f\u53f0|\u9999\u6e2f|\u6e2f\u5267|\u6e2f\u6fb3|\u53f0\u6e7e|\u53f0\u5267)/],
    ['\u65e5\u97e9', /(\u65e5\u97e9|\u65e5\u672c|\u65e5\u5267|\u65e5\u6f2b|\u97e9\u56fd|\u97e9\u5267|\u97e9\u6f2b)/],
    ['\u6b27\u7f8e', /(\u6b27\u7f8e|\u7f8e\u56fd|\u82f1\u56fd|\u6cd5\u56fd|\u5fb7\u56fd|\u7f8e\u5267|\u82f1\u5267)/],
    ['\u6cf0\u56fd', /(\u6cf0\u56fd|\u6cf0\u5267|\u9a6c\u6cf0)/],
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

function filterOption(name, value) {
  return { n: name, v: value };
}

function categoryClassCandidates(categoryKey) {
  const map = {
    recommend: ['\u7535\u5f71', '\u5267\u96c6', '\u89e3\u8bf4', '\u6587\u5a31\u77e5\u8bc6'],
    theatrical_movie: ['\u52a8\u4f5c', '\u559c\u5267', '\u7231\u60c5', '\u60ac\u7591\u72af\u7f6a', '\u79d1\u5e7b\u5947\u5e7b', '\u6050\u6016\u60ca\u609a', '\u5267\u60c5', '\u6218\u4e89\u5386\u53f2'],
    web_movie: ['\u52a8\u4f5c', '\u559c\u5267', '\u7231\u60c5', '\u60ac\u7591\u72af\u7f6a', '\u79d1\u5e7b\u5947\u5e7b', '\u6050\u6016\u60ca\u609a', '\u5267\u60c5'],
    other_movie: ['\u52a8\u4f5c', '\u559c\u5267', '\u7231\u60c5', '\u60ac\u7591\u72af\u7f6a', '\u79d1\u5e7b\u5947\u5e7b', '\u6050\u6016\u60ca\u609a', '\u5267\u60c5', '\u6218\u4e89\u5386\u53f2'],
    tv_series: ['\u56fd\u4ea7', '\u6e2f\u53f0', '\u65e5\u97e9', '\u6b27\u7f8e', '\u6cf0\u56fd', '\u6d77\u5916'],
    web_series: ['\u56fd\u4ea7', '\u6e2f\u53f0', '\u65e5\u97e9', '\u6b27\u7f8e', '\u6cf0\u56fd'],
    web_short: ['\u90fd\u5e02', '\u53e4\u88c5', '\u9006\u88ad', '\u751c\u5ba0', '\u6218\u795e', '\u8c6a\u95e8', '\u840c\u5b9d'],
    variety: ['\u5927\u9646\u7efc\u827a', '\u65e5\u97e9\u7efc\u827a', '\u6e2f\u53f0\u7efc\u827a', '\u6b27\u7f8e\u7efc\u827a', '\u771f\u4eba\u79c0', '\u8131\u53e3\u79c0'],
    anime: ['\u56fd\u6f2b', '\u65e5\u6f2b', '\u6b27\u7f8e\u52a8\u6f2b', '\u52a8\u753b\u7535\u5f71', '\u5c11\u513f'],
    documentary: ['\u81ea\u7136', '\u5386\u53f2', '\u4eba\u6587', '\u79d1\u6280', '\u793e\u4f1a', '\u4eba\u7269'],
    explainer: ['\u7535\u5f71\u89e3\u8bf4', '\u5267\u96c6\u89e3\u8bf4', '\u52a8\u6f2b\u89e3\u8bf4', '\u7eaa\u5f55\u89e3\u8bf4', '\u6848\u4ef6\u89e3\u8bf4', '\u6e38\u620f\u89e3\u8bf4'],
    knowledge: ['\u97f3\u4e50\u73b0\u573a', '\u516c\u5f00\u8bfe', '\u6559\u7a0b', '\u79d1\u666e', '\u751f\u6d3b\u65c5\u884c', '\u7f8e\u98df\u5065\u8eab', '\u6e38\u620f\u79d1\u6280', '\u4f53\u80b2\u8d5b\u4e8b', '\u5c11\u513f\u4eb2\u5b50'],
    adult: ['\u4f26\u7406', '\u7406\u8bba', '\u6210\u4eba', '\u5267\u60c5'],
  };
  return map[categoryKey] || [];
}

function deriveFilterGroups(category, rows) {
  const valuesWithHits = (key, candidates) => candidates
    .map((candidate) => typeof candidate === 'string' ? filterOption(candidate, candidate) : candidate)
    .filter((option) => rows.some((row) => catalogFilterMatches(row, key, option.v)));
  const years = [...new Set(rows.map(catalogYear).filter(Boolean))].sort((left, right) => Number(right) - Number(left)).slice(0, 5);
  const groups = [
    { key: 'sort', name: '\u6392\u5e8f', init: 'latest', value: [filterOption('\u6700\u65b0', 'latest'), filterOption('\u9ad8\u6e05\u4f18\u5148', 'quality'), filterOption('\u591a\u7ebf\u8def\u4f18\u5148', 'lines'), filterOption('\u7247\u540d\u6392\u5e8f', 'name')] },
    { key: 'year', name: '\u5e74\u4efd', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('year', [
      ...years.map((year) => filterOption(year, year)),
      filterOption('2020-2022', '2020-2022'),
      filterOption('2010\u5e74\u4ee3', '2010s'),
      filterOption('\u66f4\u65e9', 'older'),
    ])] },
    { key: 'area', name: '\u5730\u533a', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('area', ['\u5927\u9646', '\u6e2f\u53f0', '\u65e5\u97e9', '\u6b27\u7f8e', '\u6cf0\u56fd'])] },
    { key: 'class', name: category.key === 'documentary' ? '\u4e3b\u9898' : '\u7c7b\u578b', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('class', categoryClassCandidates(category.key)).slice(0, 8)] },
    { key: 'form', name: '\u5185\u5bb9\u5f62\u6001', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('form', ['\u6b63\u7247', '\u89e3\u8bf4', '\u5408\u96c6', '\u73b0\u573a', '\u8bfe\u7a0b', '\u7247\u6bb5', '\u77ed\u89c6\u9891'])] },
    { key: 'quality', name: '\u6e05\u6670\u5ea6', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('quality', [filterOption('\u9ad8\u6e05', 'hd'), filterOption('4K', '4K'), filterOption('1080P', '1080P'), filterOption('\u6b63\u7247', '\u6b63\u7247'), filterOption('\u62a2\u5148', '\u62a2\u5148')])] },
  ];
  if (['tv_series', 'web_series', 'variety', 'anime'].includes(category.key)) {
    groups.splice(4, 1, { key: 'state', name: '\u72b6\u6001', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('state', ['\u5df2\u5b8c\u7ed3', '\u66f4\u65b0\u4e2d', '\u5408\u96c6'])] });
  } else if (category.key === 'web_short') {
    groups.splice(3, 1, { key: 'episodes', name: '\u96c6\u6570', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('episodes', [filterOption('30\u96c6\u5185', '0-30'), filterOption('31-80\u96c6', '31-80'), filterOption('80\u96c6\u4ee5\u4e0a', '80+')])] });
    groups.splice(4, 1, { key: 'state', name: '\u72b6\u6001', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('state', ['\u5df2\u5b8c\u7ed3', '\u66f4\u65b0\u4e2d'])] });
  } else if (category.key === 'explainer') {
    groups.splice(4, 1, { key: 'duration', name: '\u65f6\u957f', init: '', value: [filterOption('\u5168\u90e8', ''), ...valuesWithHits('duration', ['\u77ed\u89c6\u9891', '\u957f\u89c6\u9891', '\u5408\u96c6'])] });
  }
  return groups.filter((group) => group.key === 'sort' || group.value.length >= 2).slice(0, 6);
}
function categoryCompatible(item, job) {
  if (String(job.t) === '0') return true;
  const category = String(item?.primary_category || '').trim();
  if (job.categoryKeys?.length) return job.categoryKeys.includes(category);
  const canonical = CATEGORY_BY_ID.get(String(job.t));
  return category === canonical?.key
    || String(item?.type_id || '') === String(job.t)
    || String(item?.type_name || '') === String(job.name)
    || catalogText(item).includes(job.name);
}
function catalogTitleKey(value) {
  return String(value || '')
    .replace(/[\[【(（].*?[\]】)）]/g, '')
    .replace(/(?:19|20)\d{2}/g, '')
    .replace(/[\s\u00b7.\u3002,\uff0c:\uff1a;\uff1b!\uff01?\uff1f_\-\u2014|]+/g, '')
    .trim()
    .toLowerCase();
}
function dedupeAdmittedSources(rows) {
  const selected = new Map();
  for (const row of rows || []) {
    let physicalSourceKey = String(row?.physicalSourceKey || '').trim().toLowerCase().replace(/^www\./u, '');
    try {
      if (!physicalSourceKey) physicalSourceKey = new URL(row.api).hostname.toLowerCase().replace(/^www\./u, '');
    } catch {
      continue;
    }
    if (!physicalSourceKey || selected.has(physicalSourceKey)) continue;
    selected.set(physicalSourceKey, { ...row, physicalSourceKey });
  }
  return [...selected.values()];
}
function catalogLineCount(item) {
  return Number(String(item?.vod_remarks || '').match(/(\d+)\s*?/)?.[1] || 0);
}
function catalogDedupKey(item) {
  return String(item?.canonical_id || '').trim()
    || catalogTitleKey(item?.vod_name)
    || String(item?.vod_name || item?.vod_id || '').trim().toLowerCase();
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
      const backfillPageCount = FILTER_PACK_PAGE_COUNT > 0 ? FILTER_PACK_PAGE_COUNT : 2;
      for (let pg = 1; pg <= backfillPageCount; pg++) {
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

function categoryClassList(categories = SNAPSHOT_CATEGORIES) {
  return categories.map(({ id, key, name }) => ({ type_id: id, type_name: name, key }));
}

function categoryResponse(baseData, category, rows, pg, visibleCategories = SNAPSHOT_CATEGORIES) {
  const base = baseData && typeof baseData === 'object' ? baseData : {};
  const sourceFilters = base.filters?.[category.id]
    || base.class?.find((entry) => String(entry.type_id) === String(category.id))?.filters
    || [];
  const pagecount = Math.max(1, Math.ceil(rows.length / LIMIT));
  const start = (pg - 1) * LIMIT;
  return {
    ...base,
    code: 1,
    msg: 'ok',
    page: pg,
    pagecount,
    limit: LIMIT,
    total: rows.length,
    class: categoryClassList(visibleCategories),
    filters: { ...(base.filters || {}), [category.id]: sourceFilters },
    list: rows.slice(start, start + LIMIT),
    content_revision: base.content_revision || '',
    snapshot_mode: 'canonical-catalog',
  };
}

async function loadRowsFromShardManifest(manifest) {
  const rows = [];
  const files = manifest?.indexes?.full?.catalogShards || [];
  for (const entry of files) {
    const file = typeof entry === 'string' ? entry : entry?.file;
    if (!file) continue;
    const data = await readJsonFile(path.join(LATEST, file), null);
    if (Array.isArray(data?.rows)) rows.push(...data.rows);
  }
  return rows;
}

async function loadPreviousCatalogRows(previousManifest) {
  const sharded = await loadRowsFromShardManifest(previousManifest);
  if (sharded.length) return mergeSnapshotRows(sharded).rows;
  const rows = [];
  try {
    for (const file of await readdir(path.join(LATEST, 'catalog-packs'))) {
      if (!/^t\d+-p\d+-limit\d+\.json$/u.test(file)) continue;
      const data = await readJsonFile(path.join(LATEST, 'catalog-packs', file), null);
      if (Array.isArray(data?.list)) rows.push(...data.list);
    }
  } catch {}
  return mergeSnapshotRows(rows).rows;
}

async function loadCollectedRows(building, categoryId, state) {
  const rows = [];
  const pages = Array.isArray(state?.pages) ? state.pages : [];
  for (const page of pages) {
    const data = await readJsonFile(path.join(building, '.crawl', `t${categoryId}`, `p${page}.json`), null);
    if (Array.isArray(data?.list)) rows.push(...data.list);
    else if (Array.isArray(data?.pageData?.list)) rows.push(...data.pageData.list);
  }
  return rows;
}

async function crawlDirectSources({ admittedSources, previousRows, previousWatermarks, buildState, buildStateFile, building }) {
  if (!buildState.sources || typeof buildState.sources !== 'object') buildState.sources = {};
  const crawledRows = [];
  const crawlReports = [];
  const sourceWatermarks = {};
  const crawlWarnings = [];
  const sourceContexts = new Map();
  let succeeded = 0;

  for (let offset = 0; offset < admittedSources.length; offset += SOURCE_CRAWL_CONCURRENCY) {
    const batch = admittedSources.slice(offset, offset + SOURCE_CRAWL_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (source) => {
      const relativeFile = `.crawl/sources/${source.slug}.json`;
      const absoluteFile = path.join(building, relativeFile);
      const state = buildState.sources[source.slug] || {};
      if (state.complete && existsSync(absoluteFile)) {
        const saved = await readJsonFile(absoluteFile, null);
        if (Array.isArray(saved?.rows)) return { source, result: saved, resumed: true, relativeFile };
      }
      const previousSourceRows = sourceRowsFromPrevious(previousRows, source);
      const persisted = previousWatermarks?.sources?.[source.slug] || {};
      const result = await crawlSourceWindow({
        source,
        previousRows: previousSourceRows,
        state: { nextPage: state.nextPage || persisted.nextPage || 2 },
        pagesPerRun: SOURCE_PAGES_PER_RUN,
        concurrency: SOURCE_PAGE_CONCURRENCY,
        fetchClasses: async () => {
          const data = await fetchSourcePayload(source, { ac: 'list' });
          return Array.isArray(data?.class) ? data.class : [];
        },
        fetchPage: async (page) => fetchSourcePayload(source, { ac: 'videolist', pg: page }),
      });
      const representativeClassIds = [];
      const representedCategories = new Set();
      for (const record of result.classes || []) {
        const id = String(record?.type_id ?? record?.id ?? '').trim();
        const category = result.categoryMap?.[id] || '';
        if (!id || !category || representedCategories.has(category)) continue;
        representedCategories.add(category);
        representativeClassIds.push({ id, category });
      }
      const targeted = await mapLimit(representativeClassIds, SOURCE_PAGE_CONCURRENCY, async ({ id, category }) => {
        try {
          const payload = await fetchSourcePayload(source, { ac: 'videolist', t: id, pg: 1 });
          return { id, category, rows: normalizeSourceRows({ ...payload, class: result.classes }, source, result.categoryMap), error: '' };
        } catch (error) {
          return { id, category, rows: [], error: error.message };
        }
      });
      const targetedRows = targeted.flatMap((entry) => entry.rows || []);
      const combined = mergeSnapshotRows([...(result.rows || []), ...targetedRows]);
      result.rows = combined.rows;
      result.freshRows = mergeSnapshotRows([...(result.freshRows || []), ...targetedRows]).rows;
      result.watermark = extractUpdatedAt(result.rows);
      result.targetedCategories = targeted.map((entry) => ({ id: entry.id, category: entry.category, count: entry.rows.length, ok: !entry.error && entry.rows.length > 0, error: entry.error }));
      result.errors.push(...targeted.filter((entry) => entry.error).map((entry) => `category ${entry.id}/${entry.category}: ${entry.error}`));
      return { source, result, resumed: false, relativeFile };
    }));

    for (const entry of batchResults) {
      const { source, result, relativeFile, resumed } = entry;
      sourceContexts.set(source.slug, {
        classes: Array.isArray(result.classes) ? result.classes : [],
        categoryMap: result.categoryMap && typeof result.categoryMap === 'object'
          ? result.categoryMap
          : buildSourceCategoryMap(result.classes || []),
      });
      if (!resumed) await writeJson(`snapshot/latest/${relativeFile}`, result);
      crawledRows.push(...(result.rows || []));
      if (result.ok) succeeded += 1;
      for (const error of result.errors || []) crawlWarnings.push(`${source.slug}: ${error}`);
      buildState.sources[source.slug] = {
        complete: true,
        nextPage: result.nextPage || 2,
        pagecount: result.pagecount || 0,
        watermark: result.watermark || '',
        rowCount: result.rows?.length || 0,
        lastRunOk: Boolean(result.ok),
        updatedAt: new Date().toISOString(),
        file: relativeFile,
      };
      sourceWatermarks[source.slug] = {
        nextPage: result.nextPage || 2,
        pagecount: result.pagecount || 0,
        updatedAt: result.watermark || '',
        lastRunOk: Boolean(result.ok),
      };
      crawlReports.push({
        kind: 'source-window',
        slug: source.slug,
        name: source.name,
        ok: Boolean(result.ok),
        resumed,
        pages: result.pages || [],
        nextPage: result.nextPage || 2,
        pagecount: result.pagecount || 0,
        count: result.rows?.length || 0,
        freshCount: result.freshRows?.length || 0,
        watermark: result.watermark || '',
        targetedCategories: result.targetedCategories || [],
        errors: result.errors || [],
      });
    }
    await writeJsonFileAtomic(buildStateFile, buildState);
  }

  return {
    crawledRows,
    crawlReports,
    sourceWatermarks,
    crawlWarnings,
    sourceContexts,
    sourceQuorum: {
      required: Math.ceil(admittedSources.length * 0.6),
      succeeded,
      total: admittedSources.length,
      ratio: admittedSources.length ? Number((succeeded / admittedSources.length).toFixed(4)) : 0,
    },
  };
}

const RELEASE_BACKFILL_SPECS = Object.freeze([
  { category: 'web_movie', terms: ['\u7f51\u7edc\u7535\u5f71', '\u7f51\u5927'] },
  { category: 'web_series', terms: ['\u7f51\u7edc\u5267', '\u7f51\u5267'] },
]);

async function fetchReleaseBackfillRows(admittedSources, sourceContexts = new Map()) {
  const rows = [];
  const reports = [];
  const jobs = admittedSources.flatMap((source) => RELEASE_BACKFILL_SPECS.flatMap((spec) => spec.terms.map((term) => ({ source, spec, term }))));
  const results = await mapLimit(jobs, RELEASE_BACKFILL_CONCURRENCY, async ({ source, spec, term }) => {
    try {
      const payload = normalizeCmsPayload(await fetchSourcePayload(source, { ac: 'videolist', wd: term }));
      const tagged = (payload.list || []).map((row) => tagReleaseBackfillRow(row, spec.category)).filter(Boolean);
      if (!tagged.length) return { source: source.slug, category: spec.category, term, rows: [], ok: true, count: 0 };
      const context = sourceContexts.get(source.slug) || {};
      const classes = context.classes || payload.class || [];
      const categoryMap = context.categoryMap || buildSourceCategoryMap(classes);
      const normalized = normalizeSourceRows({ ...payload, class: classes, list: tagged }, source, categoryMap)
        .filter((row) => row.primary_category === spec.category);
      return { source: source.slug, category: spec.category, term, rows: normalized, ok: true, count: normalized.length };
    } catch (error) {
      return { source: source.slug, category: spec.category, term, rows: [], ok: false, count: 0, error: error.message };
    }
  });
  for (const result of results) {
    rows.push(...(result.rows || []));
    reports.push({ source: result.source, category: result.category, term: result.term, count: result.count, ok: result.ok, error: result.error || '' });
  }
  return { rows: mergeSnapshotRows(rows).rows, reports };
}

async function writeCategoryPackSet(views, category, baseData, contentRevision, visibleCategories = SNAPSHOT_CATEGORIES) {
  const rows = views.canonical[category.key] || [];
  const pageCount = Math.max(1, Math.ceil(rows.length / LIMIT));
  const packs = [];
  for (let pg = 1; pg <= pageCount; pg += 1) {
    const data = categoryResponse(baseData, category, rows, pg, visibleCategories);
    data.content_revision = contentRevision;
    await writeJson(`snapshot/latest/catalog-packs/t${category.id}-p${pg}-limit${LIMIT}.json`, data);
    packs.push({ pg, data });
  }
  return packs;
}

async function writeLegacyPackSet(views, legacyId, contentRevision, visibleCategories = SNAPSHOT_CATEGORIES) {
  const categoryKeys = LEGACY_CATEGORY_PACKS[legacyId] || [];
  const rows = mergeSnapshotRows(categoryKeys.flatMap((key) => views.canonical[key] || [])).rows;
  const category = {
    id: String(legacyId),
    key: legacyId === '1' ? 'movie' : legacyId === '2' ? 'tv' : 'short',
    name: LEGACY_CATEGORY_NAMES[legacyId] || `legacy-${legacyId}`,
  };
  const pageCount = Math.max(1, Math.ceil(rows.length / LIMIT));
  const packs = [];
  for (let pg = 1; pg <= pageCount; pg += 1) {
    const data = categoryResponse({ filters: {} }, category, rows, pg, visibleCategories);
    data.class = categoryClassList(visibleCategories);
    data.content_revision = contentRevision;
    data.legacy_category = { id: String(legacyId), canonical_keys: categoryKeys };
    await writeJson(`snapshot/latest/catalog-packs/t${legacyId}-p${pg}-limit${LIMIT}.json`, data);
    packs.push({ pg, data });
  }
  return packs;
}

async function writeIndexShards(indexes) {
  const refs = {};
  for (const policy of ['full', 'clean']) {
    const index = indexes[policy];
    const catalogShards = [];
    for (const shard of index.catalogShards) {
      const file = `catalog-shards/${policy}/${shard.id}.json`;
      await writeJson(`snapshot/latest/${file}`, shard);
      catalogShards.push({ file, id: shard.id, count: shard.count });
    }
    const searchShards = [];
    for (const shard of index.searchShards) {
      const file = `search-index/${policy}/${shard.id}.json`;
      await writeJson(`snapshot/latest/${file}`, shard);
      searchShards.push({ file, id: shard.id, count: shard.count });
    }
    refs[policy] = { revision: index.revision, total: index.total, catalogShards, searchShards };
  }
  return refs;
}

function splitSnapshotSearchTerms(value) {
  return [value].flat().flatMap((entry) => String(entry || '').split(/[,\uff0c\u3001/|;\uff1b]+/u))
    .map(normalizeSnapshotSearch).filter(Boolean);
}
function snapshotSearchKnowledgeMatches(wd) {
  const query = normalizeSnapshotSearch(wd);
  if (!query) return [];
  return SNAPSHOT_SEARCH_KNOWLEDGE.filter((entry) => [entry.title, ...(entry.aliases || []), ...(entry.actors || [])]
    .map(normalizeSnapshotSearch)
    .some((value) => value && (value === query || value.includes(query) || query.includes(value))));
}
function entryValues(entries, field) {
  return entries.flatMap((entry) => field === 'title' ? [entry.title] : (entry[field] || []))
    .map(normalizeSnapshotSearch).filter(Boolean);
}
function snapshotSearchSemanticScore(row, wd) {
  const query = normalizeSnapshotSearch(wd);
  if (!query) return 0;
  const title = normalizeSnapshotSearch(row.vod_name || row.name || row.title);
  const aliases = splitSnapshotSearchTerms([row.aliases, row.vod_sub, row.original_title]);
  const actors = splitSnapshotSearchTerms(row.vod_actor || row.actors);
  const directors = splitSnapshotSearchTerms(row.vod_director || row.directors);
  const text = normalizeSnapshotSearch([
    row.vod_name, row.aliases, row.vod_sub, row.original_title, row.vod_actor, row.vod_director,
    row.vod_year, row.vod_area, row.vod_class, row.type_name, row.primary_category, row.content_form,
    row.vod_content,
  ].join(' '));
  if (title === query) return 1000;
  if (aliases.some((value) => value === query)) return 900;
  if (actors.some((value) => value === query) || directors.some((value) => value === query)) return 800;
  const knowledge = snapshotSearchKnowledgeMatches(wd);
  if (knowledge.some((entry) => normalizeSnapshotSearch(entry.title) === title)) {
    if (entryValues(knowledge, 'aliases').includes(query)) return 900;
    if (entryValues(knowledge, 'actors').includes(query)) return 800;
    return 850;
  }
  if (title.includes(query)) return 700;
  if (text.includes(query)) return 500;
  return 0;
}
function snapshotSearchContentRank(row) {
  const category = String(row.primary_category || '').trim();
  const form = normalizeSnapshotSearch(row.content_form || catalogForm(row));
  if (/(\u7247\u6bb5|\u9884\u544a|\u82b1\u7d6e|\u77ed\u89c6\u9891)/u.test(form)) return 0;
  if (category === 'explainer' || category === 'web_short' || category === 'anime' || category === 'knowledge') return 1;
  return 2;
}
function snapshotSearchPlayableRank(row) {
  return ((Array.isArray(row.play_lines) && row.play_lines.some((line) => String(line?.url || '').trim()))
    || String(row.vod_play_url || '').trim()) ? 1 : 0;
}
function rankSnapshotSearchRows(rows, wd) {
  return mergeSnapshotRows(rows).rows.map((row) => ({
    row,
    semantic: snapshotSearchSemanticScore(row, wd),
    content: snapshotSearchContentRank(row),
    playable: snapshotSearchPlayableRank(row),
    sources: Array.isArray(row.source_candidates) ? row.source_candidates.length : 0,
  })).filter((entry) => entry.semantic > 0)
    .sort((left, right) => right.semantic - left.semantic
      || right.content - left.content
      || right.playable - left.playable
      || right.sources - left.sources
      || Number(right.row.vod_year || 0) - Number(left.row.vod_year || 0)
      || String(left.row.vod_name || '').localeCompare(String(right.row.vod_name || ''), 'zh-CN'))
    .map(({ row }) => row);
}
function searchLocalRows(rows, wd) {
  return rankSnapshotSearchRows(rows, wd);
}
function legacySearchLocalRows(rows, wd) {
  const query = normalizeSnapshotSearch(wd);
  if (!query) return [];
  const scored = [];
  for (const row of rows) {
    const title = normalizeSnapshotSearch(row.vod_name || row.name || row.title);
    const aliases = [row.aliases, row.vod_sub, row.original_title].flatMap((value) => String(value || '').split(/[,\uff0c\u3001/|;\uff1b]+/u)).map(normalizeSnapshotSearch).filter(Boolean);
    const actors = String(row.vod_actor || row.actors || '').split(/[,\uff0c\u3001/|;\uff1b]+/u).map(normalizeSnapshotSearch).filter(Boolean);
    const directors = String(row.vod_director || row.directors || '').split(/[,\uff0c\u3001/|;\uff1b]+/u).map(normalizeSnapshotSearch).filter(Boolean);
    const text = normalizeSnapshotSearch([
      row.vod_name, row.aliases, row.vod_sub, row.original_title, row.vod_actor, row.vod_director,
      row.vod_year, row.vod_area, row.vod_class, row.type_name, row.primary_category, row.content_form,
    ].join(' '));
    let score = 0;
    if (title === query) score = 1000;
    else if (aliases.some((value) => value === query)) score = 900;
    else if (actors.some((value) => value === query) || directors.some((value) => value === query)) score = 800;
    else if (title.includes(query)) score = 700;
    else if (text.includes(query)) score = 500;
    if (!score) continue;
    if (row.primary_category === 'explainer' || row.primary_category === 'knowledge') score -= 10;
    scored.push({ row, score });
  }
  return scored.sort((left, right) => right.score - left.score
    || Number(right.row.vod_year || 0) - Number(left.row.vod_year || 0)
    || String(left.row.vod_name || '').localeCompare(String(right.row.vod_name || ''), 'zh-CN'))
    .map(({ row }) => row);
}
function configJson(visibleUpdateText = '', policy = {}) {
  const clean = policy.includeAdult === false;
  const baseName = clean ? '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0' : '\u5f71\u89c6\u70b9\u64ad';
  const name = visibleUpdateText ? `${baseName} · ${visibleUpdateText}` : baseName;
  const api = PUBLIC_BASE + (clean ? '/agg-clean' : '/agg') + (visibleUpdateText ? `/u${visibleUpdateText}` : '');
  return { spider: '', sites: [{ key: clean ? 'vod_unified_clean' : 'vod_unified', name, type: 1, api, searchable: 1, quickSearch: 1, filterable: 1, changeable: 1 }], lives: [{ name: '\u7cbe\u9009\u76f4\u64ad', type: 0, url: PUBLIC_BASE + '/live.txt', playerType: 1 }], parses: [], flags: [], wallpaper: '' };
}
async function legacySnapshotMain() {
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

async function main() {
  const snapshotRoot = path.join(DIST, 'snapshot');
  const building = path.join(snapshotRoot, '.building');
  const buildStateFile = path.join(building, 'build-state.json');
  const previousManifest = await readJsonFile(path.join(LATEST, 'manifest.json'), {});
  const previousWatermarks = await readJsonFile(path.join(LATEST, 'state', 'watermarks.json'), { categories: {}, sources: {} });
  const categorySignature = SNAPSHOT_PRIMARY_CATEGORIES.map((category) => category.id).join(',');
  let buildState = await readJsonFile(buildStateFile, null);
  const resumable = buildState?.schemaVersion === BUILD_SCHEMA_VERSION
    && buildState?.sourceBase === SOURCE_BASE
    && buildState?.crawlMode === SNAPSHOT_CRAWL_MODE
    && buildState?.categorySignature === categorySignature
    && Number(buildState?.crawlLimit) === CRAWL_LIMIT;
  if (existsSync(building) && !resumable) await rm(building, { recursive: true, force: true });
  await ensureDir(building);
  SNAPSHOT_WRITE_ROOT = building;
  buildState = resumable ? buildState : {
    schemaVersion: BUILD_SCHEMA_VERSION,
    sourceBase: SOURCE_BASE,
    crawlMode: SNAPSHOT_CRAWL_MODE,
    categorySignature,
    crawlLimit: CRAWL_LIMIT,
    startedAt: new Date().toISOString(),
    categories: {},
  };
  await writeJsonFileAtomic(buildStateFile, buildState);

  for (const directory of [
    'catalog-packs', 'detail-packs', 'filter-packs', 'search-packs',
    'catalog-shards/full', 'catalog-shards/clean', 'search-index/full', 'search-index/clean', 'state',
  ]) {
    await rm(path.join(building, directory), { recursive: true, force: true });
    await ensureDir(path.join(building, directory));
  }

  const sourceAudit = await readAuditJson('audit/source-discovery-latest.json');
  const coverageAudit = await readAuditJson('audit/coverage-latest.json');
  const sourceDiscoveryAt = sourceAudit?.generatedAt || '';
  const coverageAuditAt = coverageAudit?.generatedAt || '';
  const sourceSummary = sourceAudit ? {
    candidateCount: sourceAudit.candidateCount,
    active: sourceAudit.active,
    watch: sourceAudit.watch,
    rejected: sourceAudit.rejected,
    blocked: sourceAudit.blocked,
  } : null;
  const auditedByPhysicalKey = new Map((Array.isArray(sourceAudit?.rows) ? sourceAudit.rows : [])
    .map((row) => [String(row?.physicalSourceKey || '').trim().toLowerCase().replace(/^www\./u, ''), row])
    .filter(([key]) => key));
  const admittedSources = dedupeAdmittedSources(FULL_SNAPSHOT_SOURCES.map((row) => {
    const audit = auditedByPhysicalKey.get(row.physicalSourceKey) || null;
    return {
      slug: row.slug,
      key: row.key,
      short: row.short,
      name: row.name,
      api: row.api,
      tier: row.tier,
      status: row.status,
      physicalSourceKey: row.physicalSourceKey,
      checks: audit?.checks || { classOk: false, searchOk: false, detailOk: false, playOk: false, auditMissing: true },
      metrics: audit?.metrics || {},
      auditStatus: audit?.status || 'MISSING',
    };
  }));
  const coverageSummary = coverageAudit ? {
    total: coverageAudit.total,
    pass: coverageAudit.pass,
    warn: coverageAudit.warn,
    fail: coverageAudit.fail,
    byRootCause: coverageAudit.byRootCause,
  } : null;

  const previousRows = await loadPreviousCatalogRows(previousManifest);
  const previousViews = buildCatalogViews(previousRows);
  let crawledRows = [];
  const categoryBases = new Map();
  let crawlReports = [];
  const nextWatermarks = {};
  const crawlErrors = [];
  let crawlWarnings = [];
  let sourceWatermarks = {};
  let sourceContexts = new Map();
  let releaseBackfillReports = [];
  let releaseMetadataStats = { eligibleIds: 0, cacheHits: 0, fetched: 0, failed: 0, deferred: 0, classified: 0 };
  let sourceQuorum = { required: 0, succeeded: 0, total: admittedSources.length, ratio: 0 };

  if (SNAPSHOT_CRAWL_MODE === 'direct-sources') {
    const direct = await crawlDirectSources({ admittedSources, previousRows, previousWatermarks, buildState, buildStateFile, building });
    crawledRows = direct.crawledRows;
    crawlReports = direct.crawlReports;
    crawlWarnings = direct.crawlWarnings;
    sourceWatermarks = direct.sourceWatermarks;
    sourceContexts = direct.sourceContexts;
    sourceQuorum = direct.sourceQuorum;
    if (sourceQuorum.succeeded < sourceQuorum.required) {
      crawlErrors.push(`direct source quorum ${sourceQuorum.succeeded}/${sourceQuorum.total} below required ${sourceQuorum.required}`);
    }
  } else for (const category of SNAPSHOT_PRIMARY_CATEGORIES) {
    const categoryState = buildState.categories[category.id] || { pages: [], nextPage: 1, consecutiveStalePages: 0 };
    const previousCategoryRows = previousViews.canonical[category.key] || [];
    const collectedRawRows = await loadCollectedRows(building, category.id, categoryState);
    const firstPageFile = path.join(building, '.crawl', `t${category.id}`, 'p1.json');
    let firstPageData = await readJsonFile(firstPageFile, null);
    const fetchSources = [];
    let result;

    try {
      if (categoryState.complete) {
        result = {
          ...mergeSnapshotRows([...previousCategoryRows, ...normalizeSnapshotRows(collectedRawRows)]),
          nextPage: categoryState.nextPage,
          consecutiveStalePages: categoryState.consecutiveStalePages,
          fetchedPages: 0,
          stopReason: categoryState.stopReason || 'resumed-complete',
          watermark: categoryState.watermark || extractUpdatedAt(previousCategoryRows),
        };
      } else {
        result = await crawlIncrementalCatalog({
          previousRows: previousCategoryRows,
          collectedRows: collectedRawRows,
          watermark: previousWatermarks?.categories?.[category.id]?.updatedAt
            || previousWatermarks?.categories?.[category.id]
            || previousManifest?.sourceUpdatedAt
            || '',
          resume: {
            nextPage: categoryState.nextPage || 1,
            consecutiveStalePages: categoryState.consecutiveStalePages || 0,
          },
          maxPages: MAX_CATALOG_PAGES,
          fetchPage: async (page) => {
            const fetched = await fetchCatalogPack(category.id, page, CRAWL_LIMIT);
            fetchSources.push({ page, source: fetched.source });
            if (page === 1 && fetched.data && typeof fetched.data === 'object') firstPageData = fetched.data;
            return fetched.data || { code: 1, msg: 'empty', page, pagecount: page, list: [] };
          },
          onCheckpoint: async (checkpoint) => {
            await writeJson(`snapshot/latest/.crawl/t${category.id}/p${checkpoint.page}.json`, checkpoint.pageData || { list: [] });
            const pages = [...new Set([...(categoryState.pages || []), checkpoint.page])].sort((left, right) => left - right);
            Object.assign(categoryState, {
              pages,
              nextPage: checkpoint.nextPage,
              consecutiveStalePages: checkpoint.consecutiveStalePages,
              stopReason: checkpoint.stopReason || '',
              updatedAt: new Date().toISOString(),
            });
            buildState.categories[category.id] = categoryState;
            await writeJsonFileAtomic(buildStateFile, buildState);
          },
        });
      }
    } catch (error) {
      crawlErrors.push(`category ${category.id} crawl failed: ${error.message}`);
      result = {
        ...mergeSnapshotRows([...previousCategoryRows, ...normalizeSnapshotRows(collectedRawRows)]),
        nextPage: categoryState.nextPage || 1,
        consecutiveStalePages: categoryState.consecutiveStalePages || 0,
        fetchedPages: 0,
        stopReason: 'fetch-error',
        watermark: extractUpdatedAt(previousCategoryRows),
      };
    }

    const firstSource = fetchSources.find((entry) => entry.page === 1)?.source || '';
    const firstPageUnavailable = result.stopReason === 'empty-page' && firstSource === 'dynamic-empty';
    const incomplete = result.stopReason === 'max-pages' || result.stopReason === 'fetch-error';
    categoryState.complete = !incomplete && !(firstPageUnavailable && result.rows.length === 0);
    categoryState.nextPage = categoryState.complete ? result.nextPage : 1;
    categoryState.stopReason = result.stopReason;
    categoryState.watermark = result.watermark;
    categoryState.rowCount = result.rows.length;
    buildState.categories[category.id] = categoryState;
    await writeJsonFileAtomic(buildStateFile, buildState);

    if (!firstPageData) firstPageData = await readJsonFile(firstPageFile, null);
    categoryBases.set(category.id, firstPageData || {});
    crawledRows.push(...result.rows);
    nextWatermarks[category.id] = { key: category.key, updatedAt: result.watermark || '' };
    crawlReports.push({
      id: category.id,
      key: category.key,
      name: category.name,
      previousCount: previousCategoryRows.length,
      count: result.rows.length,
      fetchedPages: result.fetchedPages,
      stopReason: result.stopReason,
      nextPage: result.nextPage,
      watermark: result.watermark,
      fetchSources,
    });
  }

  if (SNAPSHOT_CRAWL_MODE === 'direct-sources') {
    const backfill = await fetchReleaseBackfillRows(admittedSources, sourceContexts);
    crawledRows.push(...backfill.rows);
    releaseBackfillReports = backfill.reports;
    for (const report of releaseBackfillReports.filter((entry) => !entry.ok)) {
      crawlWarnings.push(`release backfill ${report.source}/${report.category}/${report.term}: ${report.error}`);
    }
  }

  const previousReleaseMetadataCache = buildState.releaseMetadataCache
    || await readJsonFile(path.join(LATEST, 'state', 'release-metadata.json'), { entries: {} });
  const releaseEnrichment = await enrichRowsWithDoubanMetadata(crawledRows, {
    cache: previousReleaseMetadataCache,
    concurrency: DOUBAN_METADATA_CONCURRENCY,
    maxFetch: DOUBAN_METADATA_MAX_PER_RUN,
    fetchMetadata: fetchDoubanReleaseMetadata,
  });
  crawledRows = releaseEnrichment.rows;
  releaseMetadataStats = releaseEnrichment.stats;
  buildState.releaseMetadataCache = releaseEnrichment.cache;
  await writeJsonFileAtomic(buildStateFile, buildState);
  await writeJson('snapshot/latest/state/release-metadata.json', releaseEnrichment.cache);
  if (releaseMetadataStats.failed) crawlWarnings.push(`Douban release metadata failures: ${releaseMetadataStats.failed}`);
  if (releaseMetadataStats.deferred) crawlWarnings.push(`Douban release metadata deferred: ${releaseMetadataStats.deferred}`);

  const mergedCatalog = mergeSnapshotRows(crawledRows);
  const retentionGate = snapshotRetentionGate({
    previousCount: previousRows.length,
    nextCount: mergedCatalog.rows.length,
    sourceQuorumRatio: sourceQuorum.ratio,
  });
  const views = buildCatalogViews(mergedCatalog.rows);
  const visibleCategories = SNAPSHOT_CATEGORIES.filter((category) => (views.canonical[category.key] || []).length > 0);
  if (SNAPSHOT_CRAWL_MODE === 'direct-sources') {
    for (const category of visibleCategories) {
      categoryBases.set(category.id, { filters: { [category.id]: deriveFilterGroups(category, views.canonical[category.key] || []) } });
    }
  }
  const revision = buildSnapshotRevision(views.rows);
  const generatedAt = new Date().toISOString();
  const previousRevision = previousManifest?.content_revision || previousManifest?.revision || '';
  const contentChangedAt = previousRevision === revision
    ? (previousManifest?.content_changed_at || previousManifest?.contentChangedAt || previousManifest?.generatedAt || generatedAt)
    : generatedAt;
  const visibleUpdateText = formatChinaReverseUpdateCode(contentChangedAt);
  const indexes = buildSnapshotIndexes(views.rows, { revision, shardSize: SHARD_SIZE });
  const indexRefs = await writeIndexShards(indexes);
  const sourceUpdatedAt = extractUpdatedAt(views.rows);
  const categoryRows = [];
  const catalogPacksByCategory = new Map();
  const filterJobs = [];
  const validation = {
    generatedAt,
    sourceBase: SOURCE_BASE,
    publicBase: PUBLIC_BASE,
    staticSnapshotBases: STATIC_SNAPSHOT_BASES,
    revision,
    crawlMode: SNAPSHOT_CRAWL_MODE,
    sourceUpdatedAt,
    duplicateCount: mergedCatalog.duplicate_count,
    catalogRetention: retentionGate,
    categories: [],
    crawl: crawlReports,
    releaseBackfill: releaseBackfillReports,
    releaseMetadata: releaseMetadataStats,
    sourceQuorum,
    filters: [],
    search: [],
    shards: {
      shardSize: SHARD_SIZE,
      fullCatalog: indexRefs.full.catalogShards.length,
      fullSearch: indexRefs.full.searchShards.length,
      cleanCatalog: indexRefs.clean.catalogShards.length,
      cleanSearch: indexRefs.clean.searchShards.length,
    },
    errors: [...crawlErrors],
    warnings: [...crawlWarnings],
  };
  if (!retentionGate.ok) {
    validation.errors.push(`catalog retention ${retentionGate.nextCount}/${retentionGate.previousCount} (${retentionGate.ratio}) below ${retentionGate.minimumRatio}`);
  }
  if (!admittedSources.length) validation.errors.push('admitted source registry is empty');

  for (const category of SNAPSHOT_CATEGORIES) {
    const rows = views.canonical[category.key] || [];
    const visible = rows.length > 0;
    const packs = visible
      ? await writeCategoryPackSet(views, category, categoryBases.get(category.id), revision, visibleCategories)
      : [];
    catalogPacksByCategory.set(category.id, packs);
    const first = packs[0]?.data || categoryResponse({}, category, [], 1, visibleCategories);
    const filterGroups = first.filters?.[category.id]?.length
      || first.class?.find((entry) => String(entry.type_id) === category.id)?.filters?.length
      || 0;
    categoryRows.push({
      type_id: category.id,
      type_key: category.key,
      type_name: category.name,
      count: first.list?.length || 0,
      total: rows.length,
      filterGroups,
      updatedAt: extractUpdatedAt(rows),
      visible,
      root_cause: visible ? 'OK' : 'SOURCE_COVERAGE_GAP',
    });
    validation.categories.push({ id: category.id, key: category.key, name: category.name, count: rows.length, visible, ok: visible, root_cause: visible ? 'OK' : 'SOURCE_COVERAGE_GAP' });
    if (!visible) validation.errors.push(`required category ${category.id}/${category.name} empty`);
    for (const option of visible ? visibleFilterOptions(first, category.id) : []) {
      filterJobs.push({ t: category.id, categoryKey: category.key, categoryKeys: [category.key], name: category.name, ...option });
    }
  }

  const legacyPacks = {};
  for (const legacyId of Object.keys(LEGACY_CATEGORY_PACKS)) {
    if (CATEGORY_BY_ID.has(String(legacyId))) {
      legacyPacks[legacyId] = {
        canonicalKeys: LEGACY_CATEGORY_PACKS[legacyId],
        files: (catalogPacksByCategory.get(String(legacyId)) || []).length,
      };
      continue;
    }
    const packs = await writeLegacyPackSet(views, legacyId, revision, visibleCategories);
    legacyPacks[legacyId] = { canonicalKeys: LEGACY_CATEGORY_PACKS[legacyId], files: packs.length };
  }

  const searchBackfillCache = new Map();
  const dynamicFilterBackfillCache = new Map();
  const viableFilterOptions = new Set();
  let filterPackFileCount = 0;
  for (const job of filterJobs) {
    const packs = catalogPacksByCategory.get(job.t) || [];
    const basePack = packs[0]?.data || { code: 1, msg: 'ok', class: categoryClassList(visibleCategories), filters: {}, list: [] };
    const catalogRows = views.canonical[job.categoryKey] || [];
    let filterRows = await buildFilterRows(job, catalogRows, searchBackfillCache);
    if (!filterRows.length) filterRows = await backfillRowsByDynamicFilter(job, dynamicFilterBackfillCache);
    if (!filterRows.length) {
      validation.filters.push({ t: job.t, category: job.name, key: job.key, optionName: job.optionName, value: job.value, page: 1, count: 0, total: 0, evidence: '', ok: false });
      validation.warnings.push(`filter ${job.t}/${job.key}/${job.value} empty after source and parser checks`);
      continue;
    }
    filterRows = mergeSnapshotRows(filterRows).rows;
    viableFilterOptions.add(`${job.t}\u0000${job.key}\u0000${job.value}`);
    const availablePages = Math.max(1, Math.ceil(filterRows.length / LIMIT));
    const pageCount = FILTER_PACK_PAGE_COUNT > 0 ? Math.min(FILTER_PACK_PAGE_COUNT, availablePages) : availablePages;
    for (let pg = 1; pg <= pageCount; pg += 1) {
      const data = filterPackFromRows(basePack, filterRows, job, pg);
      data.content_revision = revision;
      await writeJson(filterPackRel(job.t, job.key, job.value, pg), data);
      filterPackFileCount += 1;
      validation.filters.push({
        t: job.t,
        category: job.name,
        key: job.key,
        optionName: job.optionName,
        value: job.value,
        page: pg,
        count: data.list?.length || 0,
        total: data.total || 0,
        evidence: data.list?.[0]?.snapshot_filter_evidence || '',
        ok: (data.list?.length || 0) > 0,
      });
    }
  }

  for (const category of SNAPSHOT_CATEGORIES) {
    const packs = catalogPacksByCategory.get(category.id) || [];
    for (const pack of packs) {
      const pruned = pruneFiltersForCategory(pack.data, category.id, viableFilterOptions);
      pruned.content_revision = revision;
      pack.data = pruned;
      await writeJson(`snapshot/latest/catalog-packs/t${category.id}-p${pack.pg}-limit${LIMIT}.json`, pruned);
    }
    const row = categoryRows.find((entry) => entry.type_id === category.id);
    const first = packs[0]?.data;
    if (row && first) row.filterGroups = first.filters?.[category.id]?.length || 0;
  }

  for (const wd of SEARCH_TERMS) {
    let rows = [];
    for (const variant of snapshotSearchVariants(wd)) rows.push(...searchLocalRows(views.rows, variant));
    rows = rankSnapshotSearchRows(rows, wd);
    const catalogRowCount = rows.length;
    let source = 'catalog-index';
    if (!rows.length || CRITICAL_SEARCH_TERMS.has(wd)) {
      const fetched = await fetchSearchPack(wd, { collectAll: CRITICAL_SEARCH_TERMS.has(wd) });
      rows = rankSnapshotSearchRows([...rows, ...(fetched.data?.list || [])], wd);
      source = catalogRowCount > 0
        ? `catalog-index+${fetched.source}`
        : fetched.source;
    }
    const pack = {
      code: 1,
      msg: 'ok',
      page: 1,
      pagecount: Math.max(1, Math.ceil(rows.length / LIMIT)),
      limit: LIMIT,
      total: rows.length,
      class: categoryClassList(visibleCategories),
      list: rows.slice(0, LIMIT),
      content_revision: revision,
      snapshot_mode: 'catalog-search-index',
    };
    await writeJson(`snapshot/latest/search-packs/${encodeURIComponent(wd)}-p1-limit${LIMIT}.json`, pack);
    const cleanRows = rows.filter((row) => row.primary_category !== 'adult');
    await writeJson(`snapshot/latest/search-packs/clean/${encodeURIComponent(wd)}-p1-limit${LIMIT}.json`, {
      ...pack,
      total: cleanRows.length,
      pagecount: Math.max(1, Math.ceil(cleanRows.length / LIMIT)),
      list: cleanRows.slice(0, LIMIT),
      policy: 'clean-no-adult',
    });
    validation.search.push({ wd, count: pack.list.length, total: rows.length, ok: rows.length > 0, source });
    if (CRITICAL_SEARCH_TERMS.has(wd) && !rows.length) validation.errors.push(`critical search ${wd} empty`);
  }

  const detailCandidates = [
    ...(views.canonical.theatrical_movie || []),
    ...(views.canonical.web_movie || []),
    ...(views.canonical.other_movie || []),
    ...views.rows,
  ];
  const detailRows = [];
  for (const item of mergeSnapshotRows(detailCandidates).rows.slice(0, 3)) {
    if (!item.vod_id) continue;
    try {
      const detail = await fetchJson(endpoint(`/agg?ac=detail&ids=${encodeURIComponent(item.vod_id)}`));
      detailRows.push({
        id: item.vod_id,
        canonical_id: item.canonical_id,
        name: item.vod_name,
        ok: (detail.list || []).length > 0,
        lines: String(detail.list?.[0]?.vod_play_from || '').split('$$$').filter(Boolean).length,
      });
    } catch (error) {
      detailRows.push({ id: item.vod_id, canonical_id: item.canonical_id, name: item.vod_name, ok: false, error: error.message });
    }
  }
  await writeJson('snapshot/latest/detail-packs/sample.json', { generatedAt, revision, rows: detailRows });
  await writeJson('snapshot/latest/sources.json', {
    ok: admittedSources.length > 0,
    generatedAt,
    revision,
    count: admittedSources.length,
    rows: admittedSources,
  });
  validation.detailSample = detailRows;

  const manifest = {
    ok: validation.errors.length === 0,
    schemaVersion: BUILD_SCHEMA_VERSION,
    version: '2026-07-18-commercial-zero-bill-snapshot-v3',
    revision,
    content_revision: revision,
    generatedAt,
    content_changed_at: contentChangedAt,
    sourceUpdatedAt,
    sourceDiscoveryAt,
    coverageAuditAt,
    snapshotGeneratedAt: generatedAt,
    visibleUpdateText,
    visibleUpdateFormat: 'reverse-yyyyMMddHHmm',
    sourceSummary,
    coverageSummary,
    releaseMetadataSummary: releaseMetadataStats,
    sourceBase: SOURCE_BASE,
    publicBase: PUBLIC_BASE,
    entries: { full: PUBLIC_BASE + '/config.json', clean: PUBLIC_BASE + '/config-clean.json' },
    contentPolicies: ['full', 'clean-no-adult'],
    crawlMode: SNAPSHOT_CRAWL_MODE,
    sourceQuorum,
    variants: {
      full: { revision, total: indexes.full.total },
      clean: { revision, total: indexes.clean.total },
    },
    packLimit: LIMIT,
    crawlLimit: CRAWL_LIMIT,
    shardSize: SHARD_SIZE,
    clientLimits: [8, 12, 24, 48],
    categories: categoryRows,
    visibleCategoryCount: visibleCategories.length,
    categorySchemaCount: SNAPSHOT_CATEGORIES.length,
    legacyPacks,
    indexes: indexRefs,
    filterPackCount: filterPackFileCount,
    visibleFilterOptions: viableFilterOptions.size,
    fileBudget: { written: writtenSnapshotFiles.size, maximum: MAX_SNAPSHOT_FILES, maximumBytesPerFile: MAX_FILE_BYTES },
    files: { categories: 'categories.json', sources: 'sources.json', validation: 'validation.json', watermarks: 'state/watermarks.json' },
  };
  await writeJson('snapshot/latest/state/watermarks.json', { generatedAt, revision, sourceUpdatedAt, crawlMode: SNAPSHOT_CRAWL_MODE, categories: nextWatermarks, sources: sourceWatermarks });
  await writeJson('snapshot/latest/manifest.json', manifest);
  await writeJson('snapshot/latest/categories.json', {
    generatedAt,
    revision,
    class: categoryClassList(visibleCategories),
    schema: categoryClassList(SNAPSHOT_CATEGORIES),
    legacy: Object.fromEntries(Object.entries(LEGACY_CATEGORY_PACKS).map(([id, canonicalKeys]) => [id, { name: LEGACY_CATEGORY_NAMES[id], canonicalKeys }])),
    rows: categoryRows,
  });
  await writeJson('snapshot/latest/validation.json', validation);
  const actualSnapshotFileCount = await countSnapshotFiles(building);
  const retainedPreviousFileCount = existsSync(LATEST) ? await countSnapshotFiles(LATEST) : 0;
  const projectedSnapshotFileCount = actualSnapshotFileCount + retainedPreviousFileCount;
  manifest.fileBudget.actual = actualSnapshotFileCount;
  manifest.fileBudget.retainedPrevious = retainedPreviousFileCount;
  manifest.fileBudget.projectedWithPrevious = projectedSnapshotFileCount;
  if (projectedSnapshotFileCount >= 20_000 || projectedSnapshotFileCount > MAX_SNAPSHOT_FILES) {
    validation.errors.push(`latest + previous snapshot file count ${projectedSnapshotFileCount} exceeds budget ${MAX_SNAPSHOT_FILES}`);
  }
  manifest.ok = validation.errors.length === 0;
  await writeJson('snapshot/latest/manifest.json', manifest);
  await writeJson('snapshot/latest/validation.json', validation);

  if (validation.errors.length) {
    console.log(JSON.stringify({ ok: false, generatedAt, revision, errors: validation.errors, categories: validation.categories }, null, 2));
    process.exitCode = 1;
    return;
  }

  await rm(path.join(building, '.crawl'), { recursive: true, force: true });
  await rm(buildStateFile, { force: true });
  const previous = path.join(snapshotRoot, 'previous');
  if (existsSync(previous)) await rm(previous, { recursive: true, force: true });
  let latestMoved = false;
  try {
    if (existsSync(LATEST)) {
      await rename(LATEST, previous);
      latestMoved = true;
    }
    await rename(building, LATEST);
  } catch (error) {
    if (!existsSync(LATEST) && latestMoved && existsSync(previous)) await rename(previous, LATEST);
    throw error;
  }
  SNAPSHOT_WRITE_ROOT = LATEST;
  await writeJson('config.json', configJson(visibleUpdateText));
  await writeJson('config-clean.json', configJson(visibleUpdateText, { includeAdult: false }));
  await writeJson('status.json', {
    ok: true,
    version: manifest.version,
    revision,
    content_revision: revision,
    generatedAt,
    content_changed_at: contentChangedAt,
    sourceUpdatedAt,
    sourceDiscoveryAt,
    coverageAuditAt,
    snapshotGeneratedAt: generatedAt,
    visibleUpdateText,
    visibleUpdateFormat: 'reverse-yyyyMMddHHmm',
    sourceSummary,
    coverageSummary,
    releaseMetadataSummary: releaseMetadataStats,
    publicBase: PUBLIC_BASE,
    sourceBase: SOURCE_BASE,
    entries: manifest.entries,
    variants: manifest.variants,
    updateCadence: { target: 'Worker hot catalog <= 5 minutes; full snapshot <= 6 hours', configCacheSeconds: 0 },
  });
  console.log(JSON.stringify({ ok: true, generatedAt, revision, categories: validation.categories, shards: validation.shards }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
