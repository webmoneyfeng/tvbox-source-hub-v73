const BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
import { SNAPSHOT_CATEGORIES } from '../src/snapshot-catalog.mjs';
import { configUpdateCode, payloadHasAdultExposure } from './audit-tv-remote-full-v73.mjs';

const LIMIT = Number(process.env.TEST_LIMIT || 8);
const FULL_CATEGORY_IDS = SNAPSHOT_CATEGORIES.map((category) => category.id);
const CLEAN_CATEGORY_IDS = SNAPSHOT_CATEGORIES.filter((category) => category.key !== 'adult').map((category) => category.id);
const TIMEOUT = Number(process.env.TEST_TIMEOUT_MS || 20000);
const RETRIES = Number(process.env.TEST_RETRIES || 3);

async function fetchJson(path) {
  let lastError = null;
  for (let i = 0; i < RETRIES; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const res = await fetch(BASE + path, { headers: { accept: 'application/json,*/*', 'user-agent': 'TVBoxSourceHubValidator/7.3' }, signal: controller.signal });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
      return { status: res.status, data };
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 800 + i * 1200));
    } finally { clearTimeout(timer); }
  }
  return { status: 0, data: { error: lastError?.message || String(lastError || 'fetch failed') } };
}
function assert(cond, msg, failures) { if (!cond) failures.push(msg); }
function validSiteName(name) {
  const text = String(name || '');
  return /^影视点播 · \d{12}$/.test(text);
}

function validAggregateApi(api, clean = false) {
  const value = String(api || '');
  if (clean) return /\/agg-clean\/u\d{12}$/.test(value);
  return /\/agg\/u\d{12}$/.test(value);
}

function validCleanSiteName(name) {
  const text = String(name || '');
  return /^影视点播洁净 · \d{12}$/.test(text);
}

const failures = [];
const OPS_PATHS = new Set(['/status.json', '/snapshot.json', '/mirrors.json']);
const report = { base: BASE, generatedAt: new Date().toISOString(), categories: [], endpoints: [], detail: [], ops: {} };

const config = await fetchJson('/config.json');
report.config = { status: config.status, sites: config.data?.sites?.length, siteName: config.data?.sites?.[0]?.name, api: config.data?.sites?.[0]?.api };
assert(config.status === 200, 'config status != 200', failures);
assert(config.data?.sites?.length === 1, 'visible_sites != 1', failures);
assert(validSiteName(config.data?.sites?.[0]?.name), 'site_name invalid', failures);
assert(!String(config.data?.sites?.[0]?.name || '').includes('\u5907\u7528'), 'site_name contains forbidden wording', failures);
assert(validAggregateApi(config.data?.sites?.[0]?.api, false), 'api is not /agg/u{code}', failures);
const fullUpdateCode = configUpdateCode(config.data, { clean: false });
assert(Boolean(fullUpdateCode), 'full config update code mismatch', failures);

const cleanConfig = await fetchJson('/config-clean.json');
report.cleanConfig = { status: cleanConfig.status, sites: cleanConfig.data?.sites?.length, siteName: cleanConfig.data?.sites?.[0]?.name, api: cleanConfig.data?.sites?.[0]?.api };
assert(cleanConfig.status === 200, 'clean config status != 200', failures);
assert(cleanConfig.data?.sites?.length === 1, 'clean visible_sites != 1', failures);
assert(validCleanSiteName(cleanConfig.data?.sites?.[0]?.name), 'clean site_name invalid', failures);
assert(validAggregateApi(cleanConfig.data?.sites?.[0]?.api, true), 'clean api is not /agg-clean/u{code}', failures);
const cleanUpdateCode = configUpdateCode(cleanConfig.data, { clean: true });
assert(Boolean(cleanUpdateCode), 'clean config update code mismatch', failures);
assert(Boolean(fullUpdateCode && cleanUpdateCode && fullUpdateCode === cleanUpdateCode), 'full and clean visible update codes differ', failures);
assert(!payloadHasAdultExposure(cleanConfig.data), 'clean config exposes adult wording', failures);

for (const path of ['/status.json', '/snapshot.json', '/mirrors.json', `/agg?limit=${LIMIT}`, `/agg?ac=videolist&t=10&pg=1&limit=${LIMIT}`, `/agg?ac=detail&t=10&pg=1&limit=${LIMIT}`, `/agg?wd=${encodeURIComponent('\u89e3\u8bf4')}&limit=${LIMIT}`, `/agg?f=${encodeURIComponent(JSON.stringify({ year: '2026', class: '\u52a8\u4f5c' }))}&limit=${LIMIT}`]) {
  const got = await fetchJson(path);
  report.endpoints.push({ path, status: got.status, count: got.data?.list?.length || 0, total: got.data?.total || 0, ok: got.status === 200, hot_overlay_applied: got.data?.hot_overlay_applied || false, hot_rows_used: got.data?.hot_rows_used || 0, hot_duplicate_removed: got.data?.hot_duplicate_removed || 0, hot_search_terms_hit: got.data?.hot_search_terms_hit || [] });
  assert(got.status === 200, `${path} status ${got.status}`, failures);
  if (path.startsWith('/agg')) assert((got.data?.list?.length || 0) > 0, `${path} empty list`, failures);
}

for (const path of [`/agg-clean?limit=${LIMIT}`, `/agg-clean?ac=videolist&t=10&pg=1&limit=${LIMIT}`, `/agg-clean?wd=${encodeURIComponent('\u7535\u5f71')}&limit=${LIMIT}`, `/agg-clean?f=${encodeURIComponent(JSON.stringify({ year: '2026', class: '\u52a8\u4f5c' }))}&limit=${LIMIT}`]) {
  const got = await fetchJson(path);
  report.endpoints.push({ path, status: got.status, count: got.data?.list?.length || 0, total: got.data?.total || 0, ok: got.status === 200, content_policy: got.data?.content_policy, hot_overlay_applied: got.data?.hot_overlay_applied || false, hot_rows_used: got.data?.hot_rows_used || 0, hot_duplicate_removed: got.data?.hot_duplicate_removed || 0, hot_search_terms_hit: got.data?.hot_search_terms_hit || [] });
  assert(got.status === 200, `${path} status ${got.status}`, failures);
  assert((got.data?.list?.length || 0) > 0, `${path} empty list`, failures);
  assert(got.data?.content_policy === 'clean-no-adult', `${path} content_policy invalid`, failures);
  assert(!payloadHasAdultExposure(got.data), `${path} exposes adult content`, failures);
}

const fullCategoryTotals = new Map();
for (const t of FULL_CATEGORY_IDS) {
  const got = await fetchJson(`/agg?ac=videolist&t=${t}&pg=1&limit=${LIMIT}`);
  const filters = got.data?.filters?.[t] || got.data?.filters?.[String(t)] || [];
  fullCategoryTotals.set(String(t), Number(got.data?.total || 0));
  report.categories.push({ t, status: got.status, count: got.data?.list?.length || 0, total: got.data?.total || 0, filterGroups: filters.length, hot_overlay_applied: got.data?.hot_overlay_applied || false, hot_rows_used: got.data?.hot_rows_used || 0, hot_duplicate_removed: got.data?.hot_duplicate_removed || 0 });
  assert(got.status === 200, `category ${t} status ${got.status}`, failures);
  assert((got.data?.list?.length || 0) > 0, `category ${t} empty`, failures);
  assert(filters.length >= 2, `category ${t} filters < 2`, failures);
}

for (const t of CLEAN_CATEGORY_IDS) {
  const got = await fetchJson(`/agg-clean?ac=videolist&t=${t}&pg=1&limit=${LIMIT}`);
  const filters = got.data?.filters?.[t] || got.data?.filters?.[String(t)] || [];
  const fullTotal = fullCategoryTotals.get(String(t)) || 0;
  const expectedTotal = String(t) === '0' ? Math.max(0, fullTotal - (fullCategoryTotals.get('9') || 0)) : fullTotal;
  const cleanTotal = Number(got.data?.total || 0);
  report.categories.push({ t: `clean-${t}`, status: got.status, count: got.data?.list?.length || 0, total: cleanTotal, expectedTotal, filterGroups: filters.length, content_policy: got.data?.content_policy, hot_overlay_applied: got.data?.hot_overlay_applied || false, hot_rows_used: got.data?.hot_rows_used || 0, hot_duplicate_removed: got.data?.hot_duplicate_removed || 0 });
  assert(got.status === 200, `clean category ${t} status ${got.status}`, failures);
  assert((got.data?.list?.length || 0) > 0, `clean category ${t} empty`, failures);
  assert(filters.length >= 2, `clean category ${t} filters < 2`, failures);
  assert(!payloadHasAdultExposure(got.data), `clean category ${t} exposes adult content`, failures);
  assert(cleanTotal === expectedTotal, `clean category ${t} total ${cleanTotal} != expected ${expectedTotal}`, failures);
}

const fullRevisionProbe = await fetchJson('/agg?limit=1');
const cleanRevisionProbe = await fetchJson('/agg-clean?limit=1');
assert(Boolean(fullRevisionProbe.data?.content_revision), 'full content_revision missing', failures);
assert(Boolean(cleanRevisionProbe.data?.content_revision), 'clean content_revision missing', failures);
assert(fullRevisionProbe.data?.content_revision === cleanRevisionProbe.data?.content_revision, 'full and clean content_revision differ', failures);

const sample = (await fetchJson(`/agg?ac=videolist&t=10&pg=1&limit=5`)).data?.list || [];
for (const item of sample.slice(0, 3)) {
  const got = await fetchJson(`/agg?ac=detail&ids=${encodeURIComponent(item.vod_id)}`);
  const vod = got.data?.list?.[0];
  const lines = String(vod?.vod_play_from || '').split('$$$').filter(Boolean).length;
  report.detail.push({ name: item.vod_name, status: got.status, ok: got.status === 200 && lines > 0, lines });
  assert(got.status === 200 && lines > 0, `detail failed ${item.vod_name}`, failures);
}

report.pass = failures.length === 0;
report.failures = failures;
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
