const BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Number(process.env.TEST_LIMIT || 8);
const CATS = Array.from({ length: 10 }, (_, i) => String(i));
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
  return text === '\u5f71\u89c6\u70b9\u64ad' || /^影视点播 · \d{12}$/.test(text) || /^影视点播 · 源更新 \d{2}-\d{2} \d{2}:\d{2}$/.test(text);
}

function validAggregateApi(api, clean = false) {
  const value = String(api || '');
  if (clean) return /\/agg-clean(?:\/u\d{12})?$/.test(value);
  return /\/agg(?:\/u\d{12})?$/.test(value);
}

function validCleanSiteName(name) {
  const text = String(name || '');
  return text === '\u5f71\u89c6\u70b9\u64ad\u6d01\u51c0' || /^影视点播洁净 · \d{12}$/.test(text);
}
function hasAdultText(value) {
  return /成人|伦理/.test(String(value || ''));
}
function payloadHasAdultExposure(data) {
  const classText = JSON.stringify(data?.class || []);
  const filterText = JSON.stringify(data?.filters || {});
  const listText = JSON.stringify((data?.list || []).map((x) => [x.type_id, x.type_name, x.vod_name, x.vod_remarks, x.vod_class, x.semantic_tags]));
  return hasAdultText(classText) || hasAdultText(filterText) || hasAdultText(listText);
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
assert(validAggregateApi(config.data?.sites?.[0]?.api, false), 'api is not /agg or /agg/u{code}', failures);

const cleanConfig = await fetchJson('/config-clean.json');
report.cleanConfig = { status: cleanConfig.status, sites: cleanConfig.data?.sites?.length, siteName: cleanConfig.data?.sites?.[0]?.name, api: cleanConfig.data?.sites?.[0]?.api };
assert(cleanConfig.status === 200, 'clean config status != 200', failures);
assert(cleanConfig.data?.sites?.length === 1, 'clean visible_sites != 1', failures);
assert(validCleanSiteName(cleanConfig.data?.sites?.[0]?.name), 'clean site_name invalid', failures);
assert(validAggregateApi(cleanConfig.data?.sites?.[0]?.api, true), 'clean api is not /agg-clean or /agg-clean/u{code}', failures);
assert(!payloadHasAdultExposure(cleanConfig.data), 'clean config exposes adult wording', failures);

for (const path of ['/status.json', '/snapshot.json', '/mirrors.json', `/agg?limit=${LIMIT}`, `/agg?ac=videolist&t=1&pg=1&limit=${LIMIT}`, `/agg?ac=detail&t=1&pg=1&limit=${LIMIT}`, `/agg?wd=${encodeURIComponent('\u89e3\u8bf4')}&limit=${LIMIT}`, `/agg?f=${encodeURIComponent(JSON.stringify({ year: '2026', class: '\u52a8\u4f5c' }))}&limit=${LIMIT}`]) {
  const got = await fetchJson(path);
  report.endpoints.push({ path, status: got.status, count: got.data?.list?.length || 0, total: got.data?.total || 0, ok: got.status === 200 });
  assert(got.status === 200, `${path} status ${got.status}`, failures);
  if (path.startsWith('/agg')) assert((got.data?.list?.length || 0) > 0, `${path} empty list`, failures);
}

for (const path of [`/agg-clean?limit=${LIMIT}`, `/agg-clean?ac=videolist&t=1&pg=1&limit=${LIMIT}`, `/agg-clean?wd=${encodeURIComponent('\u7535\u5f71')}&limit=${LIMIT}`, `/agg-clean?f=${encodeURIComponent(JSON.stringify({ year: '2026', class: '\u52a8\u4f5c' }))}&limit=${LIMIT}`]) {
  const got = await fetchJson(path);
  report.endpoints.push({ path, status: got.status, count: got.data?.list?.length || 0, total: got.data?.total || 0, ok: got.status === 200, content_policy: got.data?.content_policy });
  assert(got.status === 200, `${path} status ${got.status}`, failures);
  assert((got.data?.list?.length || 0) > 0, `${path} empty list`, failures);
  assert(got.data?.content_policy === 'clean-no-adult', `${path} content_policy invalid`, failures);
  assert(!payloadHasAdultExposure(got.data), `${path} exposes adult content`, failures);
}

for (const t of CATS) {
  const got = await fetchJson(`/agg?ac=videolist&t=${t}&pg=1&limit=${LIMIT}`);
  const filters = got.data?.filters?.[t] || got.data?.filters?.[String(t)] || [];
  report.categories.push({ t, status: got.status, count: got.data?.list?.length || 0, total: got.data?.total || 0, filterGroups: filters.length });
  assert(got.status === 200, `category ${t} status ${got.status}`, failures);
  assert((got.data?.list?.length || 0) > 0, `category ${t} empty`, failures);
  assert(filters.length >= 2, `category ${t} filters < 2`, failures);
}

for (const t of CATS.filter((x) => x !== '9')) {
  const got = await fetchJson(`/agg-clean?ac=videolist&t=${t}&pg=1&limit=${LIMIT}`);
  const filters = got.data?.filters?.[t] || got.data?.filters?.[String(t)] || [];
  report.categories.push({ t: `clean-${t}`, status: got.status, count: got.data?.list?.length || 0, total: got.data?.total || 0, filterGroups: filters.length, content_policy: got.data?.content_policy });
  assert(got.status === 200, `clean category ${t} status ${got.status}`, failures);
  assert((got.data?.list?.length || 0) > 0, `clean category ${t} empty`, failures);
  assert(filters.length >= 2, `clean category ${t} filters < 2`, failures);
  assert(!payloadHasAdultExposure(got.data), `clean category ${t} exposes adult content`, failures);
}

const sample = (await fetchJson(`/agg?ac=videolist&t=1&pg=1&limit=5`)).data?.list || [];
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
