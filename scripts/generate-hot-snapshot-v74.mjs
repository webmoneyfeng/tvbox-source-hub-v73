#!/usr/bin/env node
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNAPSHOT_CATEGORIES, mergeSnapshotRows } from '../src/snapshot-catalog.mjs';

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
  ...SNAPSHOT_CATEGORIES.map((category) => ({ t: category.id, key: category.key, name: category.name, canonical: true })),
  { t: '1', key: 'movie', name: '电影', canonical: false },
  { t: '2', key: 'tv', name: '剧集', canonical: false },
];
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
function uniqueRows(rows) {
  return mergeSnapshotRows(rows || []).rows;
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
    validation.categories.push({ t: cat.t, key: cat.key, name: cat.name, canonical: cat.canonical !== false, status, count: pack.list.length, total: pack.total, ok });
    if (!ok) validation.errors.push(`hot category ${cat.t}/${cat.name} empty or status ${status}`);
    await writeJson(`catalog/${cat.t}.json`, pack);
    catalog.push({ t: cat.t, key: cat.key, name: cat.name, canonical: cat.canonical !== false, count: pack.list.length, total: pack.total, list: pack.list });
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
    canonicalCategoryCount: validation.categories.filter((row) => row.canonical !== false).length,
    compatibilityCategoryCount: validation.categories.filter((row) => row.canonical === false).length,
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
