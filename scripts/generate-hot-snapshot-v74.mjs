#!/usr/bin/env node
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const HOT_ROOT = path.join(DIST, 'hot');
const LATEST = path.join(HOT_ROOT, 'latest');
const BUILDING = path.join(HOT_ROOT, `.building-${Date.now()}-${process.pid}`);
const SOURCE_BASE = (process.env.HOT_SOURCE_BASE || process.env.SNAPSHOT_SOURCE_BASE || process.env.TVBOX_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Math.min(48, Math.max(8, Number(process.env.HOT_SNAPSHOT_LIMIT || 24) || 24));
const FETCH_TIMEOUT_MS = Number(process.env.HOT_FETCH_TIMEOUT_MS || 20000);
const MAX_DURATION_MS = Number(process.env.HOT_MAX_DURATION_MS || 180000);
const VERSION = '2026-07-04-aggregate-v7.3-domestic-free';

const HOT_CATEGORIES = [
  { t: '0', name: '\u63a8\u8350' },
  { t: '1', name: '\u7535\u5f71' },
  { t: '2', name: '\u5267\u96c6' },
  { t: '6', name: '\u77ed\u5267' },
  { t: '7', name: '\u89e3\u8bf4' },
  { t: '8', name: '\u6587\u5a31\u77e5\u8bc6' },
].map((x) => ({ ...x, name: JSON.parse(`"${x.name}"`) }));
const HOT_SEARCH_TERMS = ['\u5929\u9053', '\u9065\u8fdc\u7684\u6551\u4e16\u4e3b', '\u738b\u5fd7\u6587', '2026', '\u7535\u5f71', '\u89e3\u8bf4', '\u6f14\u5531\u4f1a', '\u516c\u5f00\u8bfe'].map((x) => JSON.parse(`"${x}"`));

function formatChinaReverseUpdateCode(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}`.split('').reverse().join('');
}
function endpoint(pathname) {
  const join = pathname.includes('?') ? '&' : '?';
  return `${SOURCE_BASE}${pathname}${join}fresh=1&probe=${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function fetchText(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'TVBoxSourceHubHotSnapshot/7.4', accept: 'application/json,text/plain,*/*', 'cache-control': 'no-cache' }, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, headers: Object.fromEntries(res.headers.entries()) };
  } finally {
    clearTimeout(timer);
  }
}
async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const got = await fetchText(url, timeoutMs);
  let data = null;
  try { data = JSON.parse(got.text); } catch { data = { raw: got.text.slice(0, 500) }; }
  return { ...got, data };
}
function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s\u3000\u00b7\u30fb,??.!???:?;?\-?_()[\]????<>??]/g, '')
    .replace(/\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\d]+\u5b63/g, '')
    .toLowerCase();
}
function rowYear(item) {
  const values = [item?.vod_year, item?.vod_name, item?.vod_remarks, item?.type_name, item?.semantic_tags];
  for (const value of values) {
    const m = String(value || '').match(/(?:19|20)\d{2}/);
    if (m) return m[0];
  }
  return '';
}
function lineCount(item) {
  const from = String(item?.vod_play_from || '');
  if (from) return from.split('$$$').filter(Boolean).length;
  const remark = String(item?.vod_remarks || '');
  const m = remark.match(/(\d+)\s*\u7ebf/);
  return m ? Number(m[1]) : 0;
}
function qualityRank(item) {
  const t = JSON.stringify([item?.vod_name, item?.vod_remarks, item?.semantic_tags, item?.vod_content]).toUpperCase();
  if (/4K|2160/.test(t)) return 5;
  if (/1080|FHD/.test(t)) return 4;
  if (/HD|\u9ad8\u6e05|\u84dd\u5149/.test(t)) return 3;
  if (/TC|TS|CAM|\u62a2\u5148/.test(t)) return 1;
  return 2;
}
function dedupKey(item) {
  const title = normalizeTitle(item?.vod_name) || String(item?.vod_id || '').trim().toLowerCase();
  const year = rowYear(item);
  const macro = String(item?.type_id || item?.type_name || '').trim();
  return `${title}|${year}|${macro}`;
}
function betterRow(a, b) {
  const al = lineCount(a), bl = lineCount(b);
  if (al !== bl) return al > bl ? a : b;
  const aq = qualityRank(a), bq = qualityRank(b);
  if (aq !== bq) return aq > bq ? a : b;
  return String(a?.vod_name || '').length <= String(b?.vod_name || '').length ? a : b;
}
function uniqueRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row?.vod_id && !row?.vod_name) continue;
    const key = dedupKey(row);
    const old = map.get(key);
    map.set(key, old ? betterRow(old, row) : row);
  }
  return [...map.values()];
}
function packFromResponse(data, extra = {}) {
  const list = uniqueRows(Array.isArray(data?.list) ? data.list : []);
  return {
    code: Number(data?.code || 1),
    msg: data?.msg || 'ok',
    class: Array.isArray(data?.class) ? data.class : [],
    filters: data?.filters || {},
    page: Number(data?.page || 1),
    pagecount: Number(data?.pagecount || 1),
    limit: LIMIT,
    total: Number(data?.total || list.length),
    list,
    ...extra,
  };
}
function parseLiveTxt(text) {
  const rows = [];
  let group = '\u672a\u5206\u7ec4';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes('#genre#')) {
      group = line.split(',')[0]?.trim() || group;
      continue;
    }
    const idx = line.indexOf(',');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const url = line.slice(idx + 1).trim();
    if (!name || !/^https?:\/\//i.test(url)) continue;
    rows.push({ group, name, url });
  }
  return rows;
}
async function writeJson(rel, data) {
  const file = path.join(BUILDING, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}
async function main() {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const generatedAt = startedAt;
  const visibleUpdateText = formatChinaReverseUpdateCode(generatedAt);
  const validation = { ok: false, generatedAt, sourceBase: SOURCE_BASE, publicBase: PUBLIC_BASE, limit: LIMIT, categories: [], search: [], live: null, errors: [], warnings: [] };
  await rm(BUILDING, { recursive: true, force: true });
  await mkdir(BUILDING, { recursive: true });

  const categoryResults = await Promise.allSettled(HOT_CATEGORIES.map(async (cat) => {
    const data = await fetchJson(endpoint(`/agg?ac=videolist&t=${encodeURIComponent(cat.t)}&pg=1&limit=${LIMIT}`));
    const pack = packFromResponse(data.data, { hot_category: cat });
    return { cat, status: data.status, pack };
  }));
  const catalog = [];
  for (const result of categoryResults) {
    if (result.status !== 'fulfilled') {
      validation.errors.push(`category fetch failed: ${result.reason?.message || result.reason}`);
      continue;
    }
    const { cat, status, pack } = result.value;
    const ok = status === 200 && pack.list.length > 0;
    validation.categories.push({ t: cat.t, name: cat.name, status, count: pack.list.length, total: pack.total, ok });
    if (!ok) validation.errors.push(`hot category ${cat.t}/${cat.name} empty or status ${status}`);
    await writeJson(`catalog/${cat.t}.json`, pack);
    catalog.push({ t: cat.t, name: cat.name, count: pack.list.length, total: pack.total, list: pack.list });
  }

  const searchResults = await Promise.allSettled(HOT_SEARCH_TERMS.map(async (wd) => {
    const data = await fetchJson(endpoint(`/agg?wd=${encodeURIComponent(wd)}&limit=${LIMIT}`));
    const pack = packFromResponse(data.data, { hot_search: { wd } });
    return { wd, status: data.status, pack };
  }));
  const search = [];
  for (const result of searchResults) {
    if (result.status !== 'fulfilled') {
      validation.errors.push(`search fetch failed: ${result.reason?.message || result.reason}`);
      continue;
    }
    const { wd, status, pack } = result.value;
    const ok = status === 200 && pack.list.length > 0;
    validation.search.push({ wd, status, count: pack.list.length, total: pack.total, ok });
    if (!ok) validation.errors.push(`hot search ${wd} empty or status ${status}`);
    await writeJson(`search/${encodeURIComponent(wd)}.json`, pack);
    search.push({ wd, count: pack.list.length, total: pack.total, list: pack.list });
  }

  try {
    const got = await fetchText(endpoint('/live.txt'), FETCH_TIMEOUT_MS);
    const channels = parseLiveTxt(got.text);
    const groupCounts = {};
    for (const ch of channels) groupCounts[ch.group] = (groupCounts[ch.group] || 0) + 1;
    validation.live = { status: got.status, count: channels.length, groups: groupCounts, ok: got.status === 200 && channels.length > 0 };
    if (!validation.live.ok) validation.errors.push(`live hot list empty or status ${got.status}`);
    await writeJson('live-hot.json', { generatedAt, source: SOURCE_BASE + '/live.txt', count: channels.length, groups: groupCounts, channels });
  } catch (err) {
    validation.errors.push(`live fetch failed: ${err.message}`);
    validation.live = { ok: false, error: err.message };
  }

  const durationMs = Date.now() - started;
  if (durationMs > MAX_DURATION_MS) validation.errors.push(`duration ${durationMs}ms exceeded ${MAX_DURATION_MS}ms`);
  validation.durationMs = durationMs;
  validation.ok = validation.errors.length === 0;

  const catalogRows = uniqueRows(catalog.flatMap((x) => x.list));
  const searchRows = uniqueRows(search.flatMap((x) => x.list));
  await writeJson('catalog-hot.json', { generatedAt, visibleUpdateText, sourceBase: SOURCE_BASE, categories: catalog.map(({ list, ...x }) => x), totalUnique: catalogRows.length, list: catalogRows });
  await writeJson('search-hot.json', { generatedAt, visibleUpdateText, sourceBase: SOURCE_BASE, terms: search.map(({ list, ...x }) => x), totalUnique: searchRows.length, list: searchRows });
  await writeJson('validation.json', validation);
  const manifest = {
    ok: validation.ok,
    version: VERSION,
    generatedAt,
    finishedAt: new Date().toISOString(),
    durationMs,
    visibleUpdateText,
    visibleUpdateFormat: 'reverse-yyyyMMddHHmm',
    sourceBase: SOURCE_BASE,
    publicBase: PUBLIC_BASE,
    maxDurationMs: MAX_DURATION_MS,
    limit: LIMIT,
    categoryCount: validation.categories.length,
    searchCount: validation.search.length,
    liveChannelCount: validation.live?.count || 0,
    itemCount: catalogRows.length + searchRows.length,
    errors: validation.errors,
    warnings: validation.warnings,
    files: {
      catalog: 'catalog-hot.json',
      search: 'search-hot.json',
      live: 'live-hot.json',
      validation: 'validation.json',
    },
  };
  await writeJson('manifest.json', manifest);

  if (!validation.ok) {
    await rm(BUILDING, { recursive: true, force: true });
    console.log(JSON.stringify({ ok: false, generatedAt, durationMs, errors: validation.errors, warnings: validation.warnings }, null, 2));
    process.exit(1);
  }
  await rm(LATEST, { recursive: true, force: true });
  await rename(BUILDING, LATEST);
  console.log(JSON.stringify({ ok: true, generatedAt, visibleUpdateText, durationMs, categories: validation.categories.length, search: validation.search.length, live: validation.live?.count || 0, itemCount: manifest.itemCount }, null, 2));
}

main().catch(async (err) => {
  await rm(BUILDING, { recursive: true, force: true }).catch(() => {});
  console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
