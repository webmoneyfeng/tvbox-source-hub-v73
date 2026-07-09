import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const PRIMARY_BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const SECONDARY_BASE = (process.env.TVBOX_SECONDARY_BASE || 'https://tv.webclound.eu.org').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.UPDATE_SLA_TIMEOUT_MS || 20000);
const CRON_WINDOW_MS = Number(process.env.UPDATE_SLA_CRON_WINDOW_MS || 15 * 60 * 1000);
const AGG_DRIFT_MS = Number(process.env.UPDATE_SLA_AGG_DRIFT_MS || 2 * 60 * 1000);
const HOT_FRESH_MS = Number(process.env.UPDATE_SLA_HOT_FRESH_MS || 45 * 60 * 1000);
const SNAPSHOT_FRESH_MS = Number(process.env.UPDATE_SLA_SNAPSHOT_FRESH_MS || 6 * 60 * 60 * 1000);

const ROOT_CAUSES = {
  OK: 'OK',
  CONFIG_CACHE_STALE: 'CONFIG_CACHE_STALE',
  AGG_CACHE_STALE: 'AGG_CACHE_STALE',
  STATUS_CACHE_STALE: 'STATUS_CACHE_STALE',
  HOT_PROBE_STALE: 'HOT_PROBE_STALE',
  SNAPSHOT_STALE: 'SNAPSHOT_STALE',
  MIRROR_DRIFT: 'MIRROR_DRIFT',
  WORKER_ISOLATE_DRIFT: 'WORKER_ISOLATE_DRIFT',
  API_ERROR: 'API_ERROR',
  SCHEMA_REGRESSION: 'SCHEMA_REGRESSION',
};

function withProbe(url) {
  const u = new URL(url);
  u.searchParams.set('probe', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return u.href;
}

async function fetchEndpoint(id, url, kind) {
  const startedAt = Date.now();
  const probedUrl = withProbe(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(probedUrl, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'user-agent': 'TVBoxSourceHubUpdateSlaAudit/7.4',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    const parsed = extractUpdate(id, kind, data);
    const schemaOk = schemaOkFor(kind, data);
    return {
      id,
      kind,
      url,
      request_url: probedUrl,
      http_status: res.status,
      ok: res.ok,
      schema_ok: schemaOk,
      cache_control: res.headers.get('cache-control') || '',
      cf_cache_status: res.headers.get('cf-cache-status') || '',
      duration_ms: Date.now() - startedAt,
      ...parsed,
      root_cause: res.ok ? (schemaOk ? ROOT_CAUSES.OK : ROOT_CAUSES.SCHEMA_REGRESSION) : ROOT_CAUSES.API_ERROR,
      result: res.ok && schemaOk ? 'PASS' : 'FAIL',
      error: res.ok ? '' : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      id,
      kind,
      url,
      request_url: probedUrl,
      http_status: 0,
      ok: false,
      schema_ok: false,
      cache_control: '',
      cf_cache_status: '',
      duration_ms: Date.now() - startedAt,
      update_code: '',
      update_time: null,
      update_iso: '',
      update_source: '',
      root_cause: ROOT_CAUSES.API_ERROR,
      result: 'FAIL',
      error: String(err && err.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function schemaOkFor(kind, data) {
  if (kind === 'config') return Array.isArray(data?.sites) && data.sites.length === 1 && typeof data.sites[0]?.name === 'string';
  if (kind === 'agg') return Array.isArray(data?.class) && data.class.length > 0;
  if (kind === 'status') return data && typeof data === 'object' && ('visibleUpdateText' in data || 'snapshot' in data);
  if (kind === 'snapshot') return data && typeof data === 'object' && ('manifest' in data || 'ok' in data);
  return Boolean(data && typeof data === 'object');
}

function extractFirstCode(value) {
  const m = String(value || '').match(/(\d{12})/);
  return m ? m[1] : '';
}

function parseReverseCode(code) {
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

function extractUpdate(id, kind, data) {
  let code = '';
  let source = '';
  let explicitAt = '';
  let evidence = '';
  if (kind === 'config') {
    const name = data?.sites?.[0]?.name || '';
    code = extractFirstCode(name);
    evidence = name;
  } else if (kind === 'agg') {
    const klass = (data?.class || []).find((x) => String(x?.type_id) === '0' || /^推荐/.test(String(x?.type_name || '')));
    code = extractFirstCode(klass?.type_name || '');
    evidence = klass?.type_name || '';
  } else if (kind === 'status') {
    code = extractFirstCode(data?.visibleUpdateText || '');
    source = String(data?.visibleUpdateSource || '');
    explicitAt = data?.visibleUpdateAt || data?.hotUpdate?.generatedAt || '';
    evidence = data?.visibleUpdateText || '';
  } else if (kind === 'snapshot') {
    const manifest = data?.manifest || data || {};
    code = extractFirstCode(manifest.visibleUpdateText || '');
    source = 'snapshot';
    explicitAt = manifest.snapshotGeneratedAt || manifest.generatedAt || data?.snapshotGeneratedAt || '';
    evidence = manifest.visibleUpdateText || explicitAt || '';
  }
  const fromExplicitAt = parseIso(explicitAt);
  const fromCode = parseReverseCode(code);
  const time = fromExplicitAt.time ?? fromCode.time;
  const iso = fromExplicitAt.iso || fromCode.iso;
  return { update_code: code, update_time: time, update_iso: iso, update_source: source, update_evidence: evidence };
}

function diffMs(a, b) {
  if (!Number.isFinite(Number(a?.update_time)) || !Number.isFinite(Number(b?.update_time))) return null;
  return Math.abs(Number(a.update_time) - Number(b.update_time));
}

function minutes(ms) {
  if (ms === null || ms === undefined) return null;
  return Math.round(ms / 6000) / 10;
}

function relation(id, left, right, maxMs, failRoot, warnRoot = ROOT_CAUSES.WORKER_ISOLATE_DRIFT, opts = {}) {
  const d = diffMs(left, right);
  const missing = !left || !right || !left.update_code || !right.update_code;
  if (missing) {
    return { id, left: left?.id || '', right: right?.id || '', result: 'FAIL', root_cause: ROOT_CAUSES.SCHEMA_REGRESSION, drift_ms: d, drift_minutes: minutes(d), message: 'missing update code' };
  }
  if (d === 0 || d <= maxMs) {
    return { id, left: left.id, right: right.id, result: 'PASS', root_cause: ROOT_CAUSES.OK, drift_ms: d, drift_minutes: minutes(d), message: 'within expected drift' };
  }
  const warnMs = opts.warnMs ?? CRON_WINDOW_MS;
  if (d <= warnMs) {
    return { id, left: left.id, right: right.id, result: 'WARN', root_cause: warnRoot, drift_ms: d, drift_minutes: minutes(d), message: `short-lived drift over ${minutes(maxMs)} minutes and within ${minutes(warnMs)} minutes` };
  }
  return { id, left: left.id, right: right.id, result: 'FAIL', root_cause: failRoot, drift_ms: d, drift_minutes: minutes(d), message: `drift over ${minutes(warnMs)} minutes` };
}

function freshness(id, record, maxAgeMs, staleRoot, opts = {}) {
  if (!record || !Number.isFinite(Number(record.update_time))) {
    return { id, target: record?.id || '', result: opts.missingAsWarn ? 'WARN' : 'FAIL', root_cause: ROOT_CAUSES.SCHEMA_REGRESSION, age_ms: null, age_minutes: null, message: 'missing update time' };
  }
  const age = Date.now() - Number(record.update_time);
  if (age <= maxAgeMs) return { id, target: record.id, result: 'PASS', root_cause: ROOT_CAUSES.OK, age_ms: age, age_minutes: minutes(age), message: 'fresh' };
  return { id, target: record.id, result: opts.warnOnly ? 'WARN' : 'FAIL', root_cause: staleRoot, age_ms: age, age_minutes: minutes(age), message: `stale over ${minutes(maxAgeMs)} minutes` };
}

function sourceCheck(statusRecord) {
  const source = String(statusRecord?.update_source || '');
  const ok = ['hot-probe', 'snapshot'].includes(source);
  return { id: 'status.visibleUpdateSource', target: statusRecord?.id || '', result: ok ? 'PASS' : 'FAIL', root_cause: ok ? ROOT_CAUSES.OK : ROOT_CAUSES.SCHEMA_REGRESSION, source, message: ok ? 'accepted source' : 'unexpected update source' };
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
  const checks = report.checks || [];
  const bad = checks.filter((x) => x.result !== 'PASS');
  const endpoints = report.endpoints || [];
  return [
    '# v7.4 更新时间一致性 SLA 审计',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 主入口：${report.primaryBase}`,
    `- 同构入口：${report.secondaryBase}`,
    `- PASS/WARN/FAIL：${report.summary.pass}/${report.summary.warn}/${report.summary.fail}`,
    `- update_sla_gate：${report.update_sla_gate}`,
    '',
    '## 端点抽取',
    '',
    ...endpoints.map((x) => `- ${x.result}；${x.id}；status=${x.http_status}；code=${x.update_code || 'none'}；source=${x.update_source || 'n/a'}；cache=${x.cache_control || 'n/a'}；root=${x.root_cause}`),
    '',
    '## 关系检查',
    '',
    ...checks.map((x) => `- ${x.result}；${x.id}；root=${x.root_cause}；drift=${formatMinuteValue(x.drift_minutes)}；age=${formatMinuteValue(x.age_minutes)}；${x.message || ''}`),
    '',
    '## 需要关注',
    '',
    ...(bad.length ? bad.map((x) => `- ${x.result}；${x.id}；${x.root_cause}；${x.message || ''}`) : ['- 当前无 FAIL/WARN。']),
    '',
    '## 判定口径',
    '',
    '- config 与 config-clean 必须同码。',
    '- 主域名与同构域名 config 必须同码，或差异不超过 1 个 Cron 周期时标记 WARN。',
    '- agg 推荐分类与 config 允许 2 分钟以内差异；超过 2 分钟但不超过 1 个 Cron 周期记为 Worker isolate/cache WARN。',
    '- status.visibleUpdateSource 必须是 hot-probe 或 snapshot。',
    '- hot-probe 必须 45 分钟内新鲜；snapshot 超过 6 小时只 WARN，不阻断 hot-probe。',
    '',
  ].join('\n');
}

async function auditUpdateSla() {
  const generatedAt = new Date().toISOString();
  const endpointsSpec = [
    { id: 'primary.config', base: PRIMARY_BASE, path: '/config.json', kind: 'config' },
    { id: 'primary.config_clean', base: PRIMARY_BASE, path: '/config-clean.json', kind: 'config' },
    { id: 'primary.agg', base: PRIMARY_BASE, path: '/agg', kind: 'agg' },
    { id: 'primary.agg_clean', base: PRIMARY_BASE, path: '/agg-clean', kind: 'agg' },
    { id: 'primary.status', base: PRIMARY_BASE, path: '/status.json', kind: 'status' },
    { id: 'primary.snapshot', base: PRIMARY_BASE, path: '/snapshot.json', kind: 'snapshot' },
    { id: 'secondary.config', base: SECONDARY_BASE, path: '/config.json', kind: 'config' },
    { id: 'secondary.config_clean', base: SECONDARY_BASE, path: '/config-clean.json', kind: 'config' },
  ];
  const endpoints = await Promise.all(endpointsSpec.map((x) => fetchEndpoint(x.id, x.base + x.path, x.kind)));
  const byId = Object.fromEntries(endpoints.map((x) => [x.id, x]));
  const checks = [
    relation('primary.config_vs_clean', byId['primary.config'], byId['primary.config_clean'], 0, ROOT_CAUSES.CONFIG_CACHE_STALE, ROOT_CAUSES.CONFIG_CACHE_STALE, { warnMs: 0 }),
    relation('secondary.config_vs_clean', byId['secondary.config'], byId['secondary.config_clean'], 0, ROOT_CAUSES.CONFIG_CACHE_STALE, ROOT_CAUSES.CONFIG_CACHE_STALE, { warnMs: 0 }),
    relation('primary_vs_secondary.config', byId['primary.config'], byId['secondary.config'], 0, ROOT_CAUSES.MIRROR_DRIFT, ROOT_CAUSES.MIRROR_DRIFT, { warnMs: CRON_WINDOW_MS }),
    relation('primary.agg_vs_config', byId['primary.agg'], byId['primary.config'], AGG_DRIFT_MS, ROOT_CAUSES.AGG_CACHE_STALE, ROOT_CAUSES.WORKER_ISOLATE_DRIFT, { warnMs: CRON_WINDOW_MS }),
    relation('primary.agg_clean_vs_config_clean', byId['primary.agg_clean'], byId['primary.config_clean'], AGG_DRIFT_MS, ROOT_CAUSES.AGG_CACHE_STALE, ROOT_CAUSES.WORKER_ISOLATE_DRIFT, { warnMs: CRON_WINDOW_MS }),
    relation('primary.status_vs_config', byId['primary.status'], byId['primary.config'], AGG_DRIFT_MS, ROOT_CAUSES.STATUS_CACHE_STALE, ROOT_CAUSES.WORKER_ISOLATE_DRIFT, { warnMs: CRON_WINDOW_MS }),
    sourceCheck(byId['primary.status']),
    freshness('primary.hot_probe_freshness', byId['primary.status'], HOT_FRESH_MS, ROOT_CAUSES.HOT_PROBE_STALE),
    freshness('primary.snapshot_freshness', byId['primary.snapshot'], SNAPSHOT_FRESH_MS, ROOT_CAUSES.SNAPSHOT_STALE, { warnOnly: true, missingAsWarn: true }),
  ];

  const endpointFailures = endpoints.filter((x) => x.result === 'FAIL').map((x) => ({ id: `endpoint.${x.id}`, result: 'FAIL', root_cause: x.root_cause, message: x.error || 'endpoint failed', target: x.id }));
  const allChecks = [...endpointFailures, ...checks];
  const summary = {
    pass: allChecks.filter((x) => x.result === 'PASS').length,
    warn: allChecks.filter((x) => x.result === 'WARN').length,
    fail: allChecks.filter((x) => x.result === 'FAIL').length,
    byRootCause: countBy(allChecks, 'root_cause'),
  };
  const report = {
    generatedAt,
    primaryBase: PRIMARY_BASE,
    secondaryBase: SECONDARY_BASE,
    thresholds: { cronWindowMs: CRON_WINDOW_MS, aggDriftMs: AGG_DRIFT_MS, hotFreshMs: HOT_FRESH_MS, snapshotFreshMs: SNAPSHOT_FRESH_MS },
    endpoints,
    checks: allChecks,
    summary,
    update_sla_gate: summary.fail > 0 ? 'FAIL' : summary.warn > 0 ? 'WARN' : 'PASS',
  };
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIT_DIR, 'update-sla-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(AUDIT_DIR, 'update-sla-summary.md'), renderMarkdown(report), 'utf8');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditUpdateSla();
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    update_sla_gate: report.update_sla_gate,
    pass: report.summary.pass,
    warn: report.summary.warn,
    fail: report.summary.fail,
    byRootCause: report.summary.byRootCause,
  }, null, 2));
  if (report.summary.fail > 0) process.exit(1);
}

export { auditUpdateSla, parseReverseCode };
