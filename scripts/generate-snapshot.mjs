import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const LATEST = path.join(DIST, 'snapshot', 'latest');
const SOURCE_BASE = (process.env.SNAPSHOT_SOURCE_BASE || process.env.TVBOX_SOURCE_BASE || 'https://tvbox-source-hub.feng-yang.workers.dev').replace(/\/+$/, '');
const PUBLIC_BASE = (process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Number(process.env.SNAPSHOT_LIMIT || 24);
const CATEGORIES = [
  ['0', '\u63a8\u8350'], ['1', '\u7535\u5f71'], ['2', '\u5267\u96c6'], ['3', '\u7efc\u827a'], ['4', '\u52a8\u6f2b'],
  ['5', '\u7eaa\u5f55\u7247'], ['6', '\u77ed\u5267'], ['7', '\u89e3\u8bf4'], ['8', '\u6587\u5a31\u77e5\u8bc6'], ['9', '\u6210\u4eba\u4f26\u7406'],
];
const SEARCH_TERMS = ['\u89e3\u8bf4', '\u7535\u5f71', '2026'];

async function ensureDir(p) { await mkdir(p, { recursive: true }); }
async function writeJson(rel, data) {
  const file = path.join(DIST, rel);
  await ensureDir(path.dirname(file));
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
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
function endpoint(pathname) {
  const join = pathname.includes('?') ? '&' : '?';
  return SOURCE_BASE + pathname + join + 'force=dynamic';
}
function configJson() {
  return { spider: '', sites: [{ key: 'vod_unified', name: '\u5f71\u89c6\u70b9\u64ad', type: 1, api: PUBLIC_BASE + '/agg', searchable: 1, quickSearch: 1, filterable: 1, changeable: 1 }], lives: [{ name: '\u7cbe\u9009\u76f4\u64ad', type: 0, url: PUBLIC_BASE + '/live.txt', playerType: 1 }], parses: [], flags: [], wallpaper: '' };
}
async function main() {
  if (existsSync(LATEST)) await rm(LATEST, { recursive: true, force: true });
  await ensureDir(path.join(LATEST, 'catalog-packs'));
  await ensureDir(path.join(LATEST, 'detail-packs'));
  await ensureDir(path.join(LATEST, 'search-packs'));
  const generatedAt = new Date().toISOString();
  const categoryRows = [];
  const validation = { generatedAt, sourceBase: SOURCE_BASE, publicBase: PUBLIC_BASE, categories: [], search: [], errors: [] };

  await writeJson('config.json', configJson());
  await writeJson('status.json', { ok: true, version: '2026-07-04-aggregate-v7.3-domestic-free', generatedAt, publicBase: PUBLIC_BASE, sourceBase: SOURCE_BASE });

  for (const [t, name] of CATEGORIES) {
    for (const pg of [1, 2]) {
      const rel = `snapshot/latest/catalog-packs/t${t}-p${pg}-limit${LIMIT}.json`;
      try {
        const data = await fetchJson(endpoint(`/agg?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}&limit=${LIMIT}`));
        if (!Array.isArray(data.list) || data.list.length === 0) validation.errors.push(`category ${t} page ${pg} empty`);
        await writeJson(rel, data);
        if (pg === 1) {
          categoryRows.push({ type_id: t, type_name: name, count: data.list?.length || 0, total: data.total || 0, filterGroups: data.filters?.[t]?.length || data.filters?.[name]?.length || 0 });
          validation.categories.push({ t, name, count: data.list?.length || 0, total: data.total || 0, ok: (data.list?.length || 0) > 0 });
        }
      } catch (err) {
        validation.errors.push(`category ${t} page ${pg}: ${err.message}`);
      }
    }
  }

  for (const wd of SEARCH_TERMS) {
    try {
      const data = await fetchJson(endpoint(`/agg?wd=${encodeURIComponent(wd)}&pg=1&limit=${LIMIT}`));
      await writeJson(`snapshot/latest/search-packs/${encodeURIComponent(wd)}-p1-limit${LIMIT}.json`, data);
      validation.search.push({ wd, count: data.list?.length || 0, total: data.total || 0, ok: (data.list?.length || 0) > 0 });
    } catch (err) { validation.errors.push(`search ${wd}: ${err.message}`); }
  }

  const firstPack = await fetchJson(endpoint(`/agg?ac=videolist&t=1&pg=1&limit=6`));
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

  const manifest = { ok: validation.errors.length === 0, version: '2026-07-04-aggregate-v7.3-domestic-free', generatedAt, sourceBase: SOURCE_BASE, publicBase: PUBLIC_BASE, categories: categoryRows, files: { categories: 'categories.json', validation: 'validation.json' } };
  await writeJson('snapshot/latest/manifest.json', manifest);
  await writeJson('snapshot/latest/categories.json', { generatedAt, class: CATEGORIES.map(([type_id, type_name]) => ({ type_id, type_name })), rows: categoryRows });
  await writeJson('snapshot/latest/validation.json', validation);
  console.log(JSON.stringify({ ok: validation.errors.length === 0, generatedAt, errors: validation.errors, categories: validation.categories }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });

