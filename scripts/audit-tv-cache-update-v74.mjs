import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const PRIMARY_BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const SECONDARY_BASE = (process.env.TVBOX_SECONDARY_BASE || 'https://tv.webclound.eu.org').replace(/\/+$/, '');
const STALE_CODE = process.env.TVBOX_STALE_UPDATE_CODE || '111111111111';
const TIMEOUT_MS = Number(process.env.TV_CACHE_UPDATE_TIMEOUT_MS || 20000);
const MAX_DRIFT_MS = Number(process.env.TV_CACHE_UPDATE_MAX_DRIFT_MS || 2 * 60 * 1000);
const WARN_DRIFT_MS = Number(process.env.TV_CACHE_UPDATE_WARN_DRIFT_MS || 6 * 60 * 1000);
const HOT_FRESH_MS = Number(process.env.TV_CACHE_UPDATE_HOT_FRESH_MS || 6 * 60 * 1000);

const ROOT_CAUSES = {
  OK: 'OK',
  API_ERROR: 'API_ERROR',
  SCHEMA_REGRESSION: 'SCHEMA_REGRESSION',
  CONFIG_CACHE_STALE: 'CONFIG_CACHE_STALE',
  CLEAN_DRIFT: 'CLEAN_DRIFT',
  STATUS_CACHE_STALE: 'STATUS_CACHE_STALE',
  MIRROR_DRIFT: 'MIRROR_DRIFT',
  OLD_API_PATH_STALE: 'OLD_API_PATH_STALE',
  CACHE_HEADER_GAP: 'CACHE_HEADER_GAP',
  HOT_PROBE_STALE: 'HOT_PROBE_STALE',
};

function withProbe(url) {
  const u = new URL(url);
  u.searchParams.set('probe', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return u.href;
}

function extractFirstUpdateCode(value) {
  const m = String(value || '').match(/(\d{12})/);
  return m ? m[1] : '';
}

function parseReverseUpdateCode(code) {
  if (!/^\d{12}$/.test(String(code || ''))) return { time: null, iso: '' };
  const normal = String(code).split('').reverse().join('');
  const y = Number(normal.slice(0, 4));
  const mo = Number(normal.slice(4, 6));
  const d = Number(normal.slice(6, 8));
  const h = Number(normal.slice(8, 10));
  const mi = Number(normal.slice(10, 12));
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return { time: null, iso: '' };
  const time = Date.UTC(y, mo - 1, d, h - 8, mi, 0);
  return { time, iso: new Date(time).toISOString() };
}

function parseIso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? { time, iso: new Date(time).toISOString() } : { time: null, iso: '' };
}

function minutes(ms) {
  if (ms === null || ms === undefined) return null;
  return Math.round(ms / 6000) / 10;
}

function buildCachedAggPath(apiUrl, staleCode = STALE_CODE) {
  let pathname = String(apiUrl || '/agg');
  try { pathname = new URL(pathname).pathname; } catch {}
  const isClean = pathname.includes('/agg-clean');
  const base = isClean ? '/agg-clean' : '/agg';
  return `${base}/u${staleCode}?ac=videolist&t=0&pg=1&limit=8&fresh=1`;
}

function schemaOkFor(kind, data) {
  if (kind === 'config') return Array.isArray(data?.sites) && data.sites.length === 1 && typeof data.sites[0]?.name === 'string' && typeof data.sites[0]?.api === 'string';
  if (kind === 'status') return data && typeof data === 'object' && typeof data.visibleUpdateText === 'string';
  if (kind === 'agg') return Array.isArray(data?.class) && data.class.length > 0 && Array.isArray(data?.list);
  return Boolean(data && typeof data === 'object');
}

function extractUpdate(kind, data) {
  let code = '';
  let evidence = '';
  let source = '';
  let explicitAt = '';
  let api_code = '';
  if (kind === 'config') {
    const site = data?.sites?.[0] || {};
    code = extractFirstUpdateCode(site.name || '');
    api_code = extractFirstUpdateCode(site.api || '');
    evidence = site.name || '';
  } else if (kind === 'status') {
    code = extractFirstUpdateCode(data?.visibleUpdateText || '');
    source = String(data?.visibleUpdateSource || '');
    explicitAt = data?.visibleUpdateAt || data?.hotUpdate?.generatedAt || '';
    evidence = data?.visibleUpdateText || '';
  } else if (kind === 'agg') {
    code = extractFirstUpdateCode(data?.visible_update_text || '');
    const klass = (data?.class || []).find((x) => String(x?.type_id) === '0' || /^\u63a8\u8350/.test(String(x?.type_name || ''))) || data?.class?.[0];
    if (!code) code = extractFirstUpdateCode(klass?.type_name || '');
    source = String(data?.update_label_strategy || '');
    evidence = data?.visible_update_text || klass?.type_name || '';
  }
  const explicit = parseIso(explicitAt);
  const parsed = parseReverseUpdateCode(code);
  return { update_code: code, api_code, update_time: explicit.time ?? parsed.time, update_iso: explicit.iso || parsed.iso, update_source: source, update_evidence: evidence };
}

async function fetchRecord(base, pathOrUrl, id, kind) {
  const url = /^https?:\/\//i.test(String(pathOrUrl)) ? String(pathOrUrl) : base + pathOrUrl;
  const requestUrl = withProbe(url);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(requestUrl, {
      headers: { accept: 'application/json,text/plain,*/*', 'user-agent': 'TVBoxSourceHubCacheUpdateAudit/7.4', 'cache-control': 'no-cache' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await res.text();
    let data = null;
    try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 500) }; }
    const schema_ok = schemaOkFor(kind, data);
    return {
      id,
      kind,
      url,
      request_url: requestUrl,
      http_status: res.status,
      ok: res.ok,
      schema_ok,
      cache_control: res.headers.get('cache-control') || '',
      cf_cache_status: res.headers.get('cf-cache-status') || '',
      duration_ms: Date.now() - startedAt,
      site_name: data?.sites?.[0]?.name || '',
      api: data?.sites?.[0]?.api || '',
      class0: data?.class?.[0]?.type_name || '',
      list_count: Array.isArray(data?.list) ? data.list.length : 0,
      content_policy: data?.content_policy || '',
      ...extractUpdate(kind, data),
      result: res.ok && schema_ok ? 'PASS' : 'FAIL',
      root_cause: res.ok ? (schema_ok ? ROOT_CAUSES.OK : ROOT_CAUSES.SCHEMA_REGRESSION) : ROOT_CAUSES.API_ERROR,
      error: res.ok ? '' : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { id, kind, url, request_url: requestUrl, http_status: 0, ok: false, schema_ok: false, cache_control: '', cf_cache_status: '', duration_ms: Date.now() - startedAt, update_code: '', api_code: '', update_time: null, update_iso: '', update_source: '', update_evidence: '', result: 'FAIL', root_cause: ROOT_CAUSES.API_ERROR, error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function classifyCacheUpdateRelation(id, left, right, options = {}) {
  const maxDriftMs = options.maxDriftMs ?? MAX_DRIFT_MS;
  const warnDriftMs = options.warnDriftMs ?? WARN_DRIFT_MS;
  const failRoot = options.failRoot || ROOT_CAUSES.CONFIG_CACHE_STALE;
  const warnRoot = options.warnRoot || failRoot;
  const missing = !left || !right || !left.update_code || !right.update_code || !Number.isFinite(Number(left.update_time)) || !Number.isFinite(Number(right.update_time));
  if (missing) return { id, left: left?.id || '', right: right?.id || '', result: 'FAIL', root_cause: ROOT_CAUSES.SCHEMA_REGRESSION, drift_ms: null, drift_minutes: null, message: 'missing update code/time' };
  const drift = Math.abs(Number(left.update_time) - Number(right.update_time));
  if (drift <= maxDriftMs) return { id, left: left.id, right: right.id, result: 'PASS', root_cause: ROOT_CAUSES.OK, drift_ms: drift, drift_minutes: minutes(drift), message: 'within expected drift' };
  if (drift <= warnDriftMs) return { id, left: left.id, right: right.id, result: 'WARN', root_cause: warnRoot, drift_ms: drift, drift_minutes: minutes(drift), message: `short-lived drift over ${minutes(maxDriftMs)} minutes and within ${minutes(warnDriftMs)} minutes` };
  return { id, left: left.id, right: right.id, result: 'FAIL', root_cause: failRoot, drift_ms: drift, drift_minutes: minutes(drift), message: `drift over ${minutes(warnDriftMs)} minutes` };
}

function cachedAggContentCheck(record) {
  const hasList = Number(record?.list_count || 0) > 0;
  const codeVisible = Boolean(record?.update_code && extractFirstUpdateCode(record?.class0 || '') === record.update_code);
  const ok = hasList && codeVisible;
  return {
    id: `${record?.id || 'unknown'}.content_visible`,
    target: record?.id || '',
    result: ok ? 'PASS' : 'FAIL',
    root_cause: ok ? ROOT_CAUSES.OK : ROOT_CAUSES.OLD_API_PATH_STALE,
    list_count: record?.list_count || 0,
    update_code: record?.update_code || '',
    class0: record?.class0 || '',
    message: ok ? 'cached aggregate path returns non-empty list and visible current code' : 'cached aggregate path is empty or does not show current code in category name',
  };
}

function cacheHeaderCheck(record, expectedNoStore = true) {
  const cache = String(record?.cache_control || '').toLowerCase();
  const ok = expectedNoStore ? /no-store|max-age=0/.test(cache) : Boolean(cache);
  return { id: `${record?.id || 'unknown'}.cache_header`, target: record?.id || '', result: ok ? 'PASS' : 'WARN', root_cause: ok ? ROOT_CAUSES.OK : ROOT_CAUSES.CACHE_HEADER_GAP, cache_control: record?.cache_control || '', message: ok ? 'cache policy acceptable' : 'cache header may allow stale TV client state' };
}

function freshnessCheck(record) {
  if (!record || !Number.isFinite(Number(record.update_time))) return { id: 'status.hot_freshness', target: record?.id || '', result: 'FAIL', root_cause: ROOT_CAUSES.SCHEMA_REGRESSION, age_ms: null, age_minutes: null, message: 'missing hot update time' };
  const age = Date.now() - Number(record.update_time);
  return { id: 'status.hot_freshness', target: record.id, result: age <= HOT_FRESH_MS ? 'PASS' : 'FAIL', root_cause: age <= HOT_FRESH_MS ? ROOT_CAUSES.OK : ROOT_CAUSES.HOT_PROBE_STALE, age_ms: age, age_minutes: minutes(age), message: age <= HOT_FRESH_MS ? 'hot probe fresh' : `hot probe stale over ${minutes(HOT_FRESH_MS)} minutes` };
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows || []) {
    const value = String(row?.[key] || 'UNKNOWN');
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function formatMinuteValue(value) {
  return value === null || value === undefined ? 'n/a' : `${value}min`;
}

function renderMarkdown(report) {
  const bad = (report.checks || []).filter((x) => x.result !== 'PASS');
  return [
    '# v7.4 \u7535\u89c6\u7aef\u7f13\u5b58\u66f4\u65b0\u65f6\u95f4\u5ba1\u8ba1',
    '',
    `- \u751f\u6210\u65f6\u95f4\uff1a${report.generatedAt}`,
    `- \u4e3b\u5165\u53e3\uff1a${report.primaryBase}`,
    `- \u540c\u6784\u5165\u53e3\uff1a${report.secondaryBase}`,
    `- \u6a21\u62df\u65e7\u7801\uff1a${report.staleCode}`,
    `- PASS/WARN/FAIL\uff1a${report.summary.pass}/${report.summary.warn}/${report.summary.fail}`,
    `- cache_update_gate\uff1a${report.cache_update_gate}`,
    '',
    '## \u7aef\u70b9\u8bc1\u636e',
    '',
    ...report.records.map((x) => `- ${x.result}\uff1b${x.id}\uff1bstatus=${x.http_status}\uff1bcode=${x.update_code || 'none'}\uff1bapiCode=${x.api_code || 'n/a'}\uff1bcache=${x.cache_control || 'n/a'}\uff1bclass0=${x.class0 || 'n/a'}\uff1blist=${x.list_count}`),
    '',
    '## \u7f13\u5b58\u8def\u5f84\u5173\u7cfb\u68c0\u67e5',
    '',
    ...report.checks.map((x) => `- ${x.result}\uff1b${x.id}\uff1broot=${x.root_cause}\uff1bdrift=${formatMinuteValue(x.drift_minutes)}\uff1bage=${formatMinuteValue(x.age_minutes)}\uff1b${x.message || ''}`),
    '',
    '## \u9700\u8981\u5173\u6ce8',
    '',
    ...(bad.length ? bad.map((x) => `- ${x.result}\uff1b${x.id}\uff1b${x.root_cause}\uff1b${x.message || ''}`) : ['- \u5f53\u524d\u65e0 FAIL/WARN\u3002']),
    '',
    '## \u5224\u5b9a\u53e3\u5f84',
    '',
    '- config\u3001config-clean\u3001status\u3001\u65e7 /agg/u\u65e7\u7801\u3001\u65e7 /agg-clean/u\u65e7\u7801 \u5fc5\u987b\u540c\u7801\u6216\u5728 2 \u5206\u949f\u5185\u3002',
    '- 2-6 \u5206\u949f\u6f02\u79fb\u89c6\u4e3a WARN\uff0c\u8d85\u8fc7 6 \u5206\u949f\u89c6\u4e3a FAIL\u3002',
    '- config \u4e0e agg \u7c7b\u7aef\u70b9\u5fc5\u987b no-store\uff0c\u907f\u514d\u7535\u89c6\u7aef\u7ee7\u7eed\u4f7f\u7528\u65e7\u914d\u7f6e\u3002',
    '- \u65e7\u7801\u8def\u5f84\u5fc5\u987b\u8fd4\u56de\u5217\u8868\u5e76\u5728\u5206\u7c7b\u540d\u4e2d\u5c55\u793a\u5f53\u524d\u66f4\u65b0\u65f6\u95f4\u7801\u3002',
    '',
  ].join('\n');
}

async function auditTvCacheUpdate() {
  const generatedAt = new Date().toISOString();
  const baseSpecs = [
    { prefix: 'primary', base: PRIMARY_BASE },
    { prefix: 'secondary', base: SECONDARY_BASE },
  ];
  const records = [];
  for (const spec of baseSpecs) {
    const config = await fetchRecord(spec.base, '/config.json', `${spec.prefix}.config`, 'config');
    const cleanConfig = await fetchRecord(spec.base, '/config-clean.json', `${spec.prefix}.config_clean`, 'config');
    const status = await fetchRecord(spec.base, '/status.json?fresh=1', `${spec.prefix}.status`, 'status');
    records.push(config, cleanConfig, status);
    const staleFullPath = buildCachedAggPath(config.api || '/agg', STALE_CODE);
    const staleCleanPath = buildCachedAggPath(cleanConfig.api || '/agg-clean', STALE_CODE);
    records.push(await fetchRecord(spec.base, staleFullPath, `${spec.prefix}.cached_full_agg`, 'agg'));
    records.push(await fetchRecord(spec.base, staleCleanPath, `${spec.prefix}.cached_clean_agg`, 'agg'));
  }
  const byId = Object.fromEntries(records.map((x) => [x.id, x]));
  const endpointFailures = records.filter((x) => x.result === 'FAIL').map((x) => ({ id: `endpoint.${x.id}`, target: x.id, result: 'FAIL', root_cause: x.root_cause, message: x.error || 'endpoint failed' }));
  const checks = [
    ...endpointFailures,
    cacheHeaderCheck(byId['primary.config']),
    cacheHeaderCheck(byId['primary.config_clean']),
    cacheHeaderCheck(byId['primary.cached_full_agg']),
    cacheHeaderCheck(byId['primary.cached_clean_agg']),
    cachedAggContentCheck(byId['primary.cached_full_agg']),
    cachedAggContentCheck(byId['primary.cached_clean_agg']),
    cachedAggContentCheck(byId['secondary.cached_full_agg']),
    cachedAggContentCheck(byId['secondary.cached_clean_agg']),
    classifyCacheUpdateRelation('primary.config_vs_clean', byId['primary.config'], byId['primary.config_clean'], { maxDriftMs: 0, warnDriftMs: 0, failRoot: ROOT_CAUSES.CLEAN_DRIFT }),
    classifyCacheUpdateRelation('primary.status_vs_config', byId['primary.status'], byId['primary.config'], { failRoot: ROOT_CAUSES.STATUS_CACHE_STALE }),
    classifyCacheUpdateRelation('primary.cached_full_vs_config', byId['primary.cached_full_agg'], byId['primary.config'], { failRoot: ROOT_CAUSES.OLD_API_PATH_STALE }),
    classifyCacheUpdateRelation('primary.cached_clean_vs_clean_config', byId['primary.cached_clean_agg'], byId['primary.config_clean'], { failRoot: ROOT_CAUSES.OLD_API_PATH_STALE }),
    classifyCacheUpdateRelation('secondary.config_vs_clean', byId['secondary.config'], byId['secondary.config_clean'], { maxDriftMs: 0, warnDriftMs: 0, failRoot: ROOT_CAUSES.CLEAN_DRIFT }),
    classifyCacheUpdateRelation('secondary.status_vs_config', byId['secondary.status'], byId['secondary.config'], { failRoot: ROOT_CAUSES.STATUS_CACHE_STALE }),
    classifyCacheUpdateRelation('secondary.cached_full_vs_config', byId['secondary.cached_full_agg'], byId['secondary.config'], { failRoot: ROOT_CAUSES.OLD_API_PATH_STALE }),
    classifyCacheUpdateRelation('secondary.cached_clean_vs_clean_config', byId['secondary.cached_clean_agg'], byId['secondary.config_clean'], { failRoot: ROOT_CAUSES.OLD_API_PATH_STALE }),
    classifyCacheUpdateRelation('primary_vs_secondary.config', byId['primary.config'], byId['secondary.config'], { failRoot: ROOT_CAUSES.MIRROR_DRIFT, warnRoot: ROOT_CAUSES.MIRROR_DRIFT }),
    freshnessCheck(byId['primary.status']),
  ];
  const summary = {
    pass: checks.filter((x) => x.result === 'PASS').length,
    warn: checks.filter((x) => x.result === 'WARN').length,
    fail: checks.filter((x) => x.result === 'FAIL').length,
    byRootCause: countBy(checks, 'root_cause'),
  };
  const report = {
    generatedAt,
    primaryBase: PRIMARY_BASE,
    secondaryBase: SECONDARY_BASE,
    staleCode: STALE_CODE,
    thresholds: { maxDriftMs: MAX_DRIFT_MS, warnDriftMs: WARN_DRIFT_MS, hotFreshMs: HOT_FRESH_MS },
    records,
    checks,
    summary,
    cache_update_gate: summary.fail > 0 ? 'FAIL' : summary.warn > 0 ? 'WARN' : 'PASS',
  };
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIT_DIR, 'tv-cache-update-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(AUDIT_DIR, 'tv-cache-update-summary.md'), renderMarkdown(report), 'utf8');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditTvCacheUpdate();
  console.log(JSON.stringify({ generatedAt: report.generatedAt, cache_update_gate: report.cache_update_gate, pass: report.summary.pass, warn: report.summary.warn, fail: report.summary.fail, byRootCause: report.summary.byRootCause }, null, 2));
  if (report.summary.fail > 0) process.exit(1);
}

export {
  auditTvCacheUpdate,
  buildCachedAggPath,
  cachedAggContentCheck,
  classifyCacheUpdateRelation,
  extractFirstUpdateCode,
  parseReverseUpdateCode,
};
