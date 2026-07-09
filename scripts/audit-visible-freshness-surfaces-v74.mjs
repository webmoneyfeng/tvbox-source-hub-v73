import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audit');

const PRIMARY_BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const SECONDARY_BASE = (process.env.TVBOX_SECONDARY_BASE || 'https://tv.webclound.eu.org').replace(/\/+$/, '');
const STALE_CODE = process.env.TVBOX_STALE_UPDATE_CODE || '111111111111';
const OBSERVED_TV_CODE = process.env.TVBOX_OBSERVED_UPDATE_CODE || '';
const TIMEOUT_MS = Number(process.env.VISIBLE_FRESHNESS_TIMEOUT_MS || 20000);
const FRESH_GUARD_MS = Number(process.env.VISIBLE_FRESHNESS_GUARD_MS || 6 * 60 * 1000);

const ROOT_CAUSES = {
  OK: 'OK',
  API_ERROR: 'API_ERROR',
  SCHEMA_REGRESSION: 'SCHEMA_REGRESSION',
  SURFACE_MISSING_UPDATE_CODE: 'SURFACE_MISSING_UPDATE_CODE',
  SERVICE_UPDATE_STALE: 'SERVICE_UPDATE_STALE',
  SURFACE_DRIFT: 'SURFACE_DRIFT',
  APP_LOCAL_SITE_CACHE: 'APP_LOCAL_SITE_CACHE',
};

function extractUpdateCode(value) {
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

function minutes(ms) {
  if (ms === null || ms === undefined) return null;
  return Math.round(ms / 6000) / 10;
}

function withProbe(url) {
  const u = new URL(url);
  u.searchParams.set('freshness_probe', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return u.href;
}

function surfaceFreshnessCheck(record, now = Date.now(), guardMs = FRESH_GUARD_MS) {
  if (Number(record?.http_status || 0) !== 200) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.API_ERROR, age_ms: null, age_minutes: null };
  }
  if (!record?.schema_ok) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.SCHEMA_REGRESSION, age_ms: null, age_minutes: null };
  }
  if (!record?.update_code || !Number.isFinite(Number(record?.update_time))) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.SURFACE_MISSING_UPDATE_CODE, age_ms: null, age_minutes: null };
  }
  const age = now - Number(record.update_time);
  if (age > guardMs) {
    return { ...record, result: 'FAIL', root_cause: ROOT_CAUSES.SERVICE_UPDATE_STALE, age_ms: age, age_minutes: minutes(age) };
  }
  return { ...record, result: 'PASS', root_cause: ROOT_CAUSES.OK, age_ms: age, age_minutes: minutes(age) };
}

function mostCommonCode(records) {
  const counts = new Map();
  for (const row of records || []) {
    if (!row?.update_code) continue;
    counts.set(row.update_code, (counts.get(row.update_code) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function classifyVisibleFreshness(surfaceRecords, observedCode = '') {
  const records = surfaceRecords || [];
  const failures = records.filter((x) => x.result === 'FAIL');
  const userVisible = records.filter((x) => x.user_visible);
  const currentCode = mostCommonCode(records);
  const visibleCodes = new Set(userVisible.map((x) => x.update_code).filter(Boolean));
  const allUserVisibleFresh = userVisible.length > 0 && userVisible.every((x) => x.result === 'PASS');
  const allServiceFresh = records.length > 0 && records.every((x) => x.result === 'PASS');

  if (failures.some((x) => x.root_cause === ROOT_CAUSES.SERVICE_UPDATE_STALE)) {
    return {
      result: 'FAIL',
      diagnosis: ROOT_CAUSES.SERVICE_UPDATE_STALE,
      current_code: currentCode,
      observed_code: observedCode,
      message: '服务端可见更新时间本身已经超过商业守门线，不能归因为电视端缓存。',
    };
  }
  if (failures.length) {
    return {
      result: 'FAIL',
      diagnosis: failures[0].root_cause || ROOT_CAUSES.SURFACE_DRIFT,
      current_code: currentCode,
      observed_code: observedCode,
      message: '至少一个服务端可见表面失败，需要先修服务端表面一致性。',
    };
  }
  if (visibleCodes.size > 1) {
    return {
      result: 'FAIL',
      diagnosis: ROOT_CAUSES.SURFACE_DRIFT,
      current_code: currentCode,
      observed_code: observedCode,
      message: '多个电视端可见表面返回不同更新时间码，属于服务端展示漂移。',
    };
  }
  const observed = extractUpdateCode(observedCode);
  if (observed && currentCode && observed !== currentCode && allUserVisibleFresh) {
    return {
      result: 'WARN',
      diagnosis: ROOT_CAUSES.APP_LOCAL_SITE_CACHE,
      current_code: currentCode,
      observed_code: observed,
      message: '服务端站点名/API/分类/旧码路径均为当前码，但电视端观测码仍旧，优先归因为电视 App 本地站点名缓存。',
    };
  }
  if (allServiceFresh) {
    return {
      result: 'PASS',
      diagnosis: 'SERVICE_FRESH',
      current_code: currentCode,
      observed_code: observed,
      message: '服务端所有可见更新时间表面均在商业守门线内。',
    };
  }
  return {
    result: 'FAIL',
    diagnosis: ROOT_CAUSES.SURFACE_DRIFT,
    current_code: currentCode,
    observed_code: observed,
    message: '无法证明服务端可见表面一致。',
  };
}

async function fetchJson(url) {
  const requestUrl = withProbe(url);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(requestUrl, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'cache-control': 'no-cache',
        'user-agent': 'TVBoxVisibleFreshnessAudit/7.4',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await res.text();
    let data = null;
    try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 500) }; }
    return { ok: res.ok, http_status: res.status, data, request_url: requestUrl, cache_control: res.headers.get('cache-control') || '', duration_ms: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, http_status: 0, data: null, request_url: requestUrl, cache_control: '', duration_ms: Date.now() - startedAt, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function updateFieldsFromCode(code, explicitIso = '') {
  const explicit = Date.parse(explicitIso || '');
  if (Number.isFinite(explicit)) return { update_code: code, update_time: explicit, update_iso: new Date(explicit).toISOString() };
  const parsed = parseReverseUpdateCode(code);
  return { update_code: code, update_time: parsed.time, update_iso: parsed.iso };
}

function configSurface(id, base, payload, clean = false) {
  const site = payload?.data?.sites?.[0] || {};
  const code = extractUpdateCode(site.name || site.api || '');
  const apiCode = extractUpdateCode(site.api || '');
  return surfaceFreshnessCheck({
    id,
    base,
    surface: clean ? 'config-clean.site' : 'config.site',
    user_visible: true,
    http_status: payload.http_status,
    schema_ok: Array.isArray(payload?.data?.sites) && payload.data.sites.length === 1 && Boolean(site.name),
    cache_control: payload.cache_control,
    request_url: payload.request_url,
    evidence: site.name || '',
    api: site.api || '',
    api_code: apiCode,
    ...updateFieldsFromCode(code),
    note: apiCode && code && apiCode !== code ? 'api path code differs from site name code' : '',
  });
}

function aggSurface(id, base, payload, clean = false) {
  const klass = (payload?.data?.class || []).find((x) => String(x?.type_id) === '0' || /^推荐/.test(String(x?.type_name || ''))) || payload?.data?.class?.[0] || {};
  const code = extractUpdateCode(payload?.data?.visible_update_text || klass.type_name || '');
  return surfaceFreshnessCheck({
    id,
    base,
    surface: clean ? 'agg-clean.class' : 'agg.class',
    user_visible: true,
    http_status: payload.http_status,
    schema_ok: Array.isArray(payload?.data?.class) && payload.data.class.length > 0 && Array.isArray(payload?.data?.list),
    cache_control: payload.cache_control,
    request_url: payload.request_url,
    evidence: payload?.data?.visible_update_text || klass.type_name || '',
    list_count: Array.isArray(payload?.data?.list) ? payload.data.list.length : 0,
    class_count: Array.isArray(payload?.data?.class) ? payload.data.class.length : 0,
    snapshot_mode: payload?.data?.snapshot_mode || '',
    hot_overlay_applied: Boolean(payload?.data?.hot_overlay_applied),
    ...updateFieldsFromCode(code),
  });
}

function statusSurface(id, base, payload) {
  const code = extractUpdateCode(payload?.data?.visibleUpdateText || '');
  return surfaceFreshnessCheck({
    id,
    base,
    surface: 'status.visibleUpdateText',
    user_visible: false,
    http_status: payload.http_status,
    schema_ok: payload?.data && typeof payload.data === 'object' && Boolean(payload.data.visibleUpdateText),
    cache_control: payload.cache_control,
    request_url: payload.request_url,
    evidence: payload?.data?.visibleUpdateText || '',
    update_source: payload?.data?.visibleUpdateSource || '',
    ...updateFieldsFromCode(code, payload?.data?.visibleUpdateAt || payload?.data?.hotUpdate?.generatedAt || ''),
  });
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows || []) {
    const k = String(row?.[key] || 'UNKNOWN');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function renderMarkdown(report) {
  const bad = (report.records || []).filter((x) => x.result !== 'PASS');
  return [
    '# v7.4 电视端可见更新时间表面审计',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 主入口：${report.primaryBase}`,
    `- 同构入口：${report.secondaryBase}`,
    `- 商业守门线：${minutes(report.thresholds.freshGuardMs)} 分钟`,
    `- 电视端观测码：${report.observedCode || '未提供'}`,
    `- visible_freshness_gate：${report.visible_freshness_gate}`,
    `- 诊断：${report.diagnosis.diagnosis}`,
    `- 当前服务端码：${report.diagnosis.current_code || 'none'}`,
    `- 结论：${report.diagnosis.message}`,
    '',
    '## 可见表面',
    '',
    ...report.records.map((x) => `- ${x.result}；${x.id}；surface=${x.surface}；code=${x.update_code || 'none'}；age=${x.age_minutes ?? 'n/a'}min；list=${x.list_count ?? 'n/a'}；cache=${x.cache_control || 'n/a'}；root=${x.root_cause}；evidence=${x.evidence || ''}`),
    '',
    '## 需关注项',
    '',
    ...(bad.length ? bad.map((x) => `- ${x.result}；${x.id}；${x.root_cause}；${x.note || x.evidence || ''}`) : ['- 当前无服务端可见表面 FAIL。']),
    '',
    '## 客服/运营判定口径',
    '',
    '- 若本报告 PASS，但用户站点列表仍显示旧码：优先判断为电视 App 本地站点名缓存；让用户进入“影视点播”后看分类栏 `推荐 · 当前码`。',
    '- 若旧 `/agg/u旧码` 路径也返回当前码且列表非空：内容层已无感更新，站点列表旧不代表节目未更新。',
    '- 若本报告 FAIL：不能让客户清缓存背锅，必须按 root_cause 修服务端。',
    '',
  ].join('\n');
}

async function auditVisibleFreshness() {
  const generatedAt = new Date().toISOString();
  const endpointSpecs = [
    { id: 'primary.config', base: PRIMARY_BASE, path: '/config.json', kind: 'config' },
    { id: 'primary.config_clean', base: PRIMARY_BASE, path: '/config-clean.json', kind: 'config-clean' },
    { id: 'primary.agg_stale_path', base: PRIMARY_BASE, path: `/agg/u${STALE_CODE}?ac=videolist&t=0&pg=1&limit=8&fresh=1`, kind: 'agg' },
    { id: 'primary.agg_clean_stale_path', base: PRIMARY_BASE, path: `/agg-clean/u${STALE_CODE}?ac=videolist&t=0&pg=1&limit=8&fresh=1`, kind: 'agg-clean' },
    { id: 'primary.status', base: PRIMARY_BASE, path: '/status.json', kind: 'status' },
    { id: 'secondary.config', base: SECONDARY_BASE, path: '/config.json', kind: 'config' },
    { id: 'secondary.agg_stale_path', base: SECONDARY_BASE, path: `/agg/u${STALE_CODE}?ac=videolist&t=0&pg=1&limit=8&fresh=1`, kind: 'agg' },
    { id: 'secondary.status', base: SECONDARY_BASE, path: '/status.json', kind: 'status' },
  ];
  const fetched = [];
  for (const spec of endpointSpecs) {
    fetched.push({ spec, payload: await fetchJson(spec.base + spec.path) });
  }
  const records = fetched.map(({ spec, payload }) => {
    if (spec.kind === 'config') return configSurface(spec.id, spec.base, payload, false);
    if (spec.kind === 'config-clean') return configSurface(spec.id, spec.base, payload, true);
    if (spec.kind === 'agg') return aggSurface(spec.id, spec.base, payload, false);
    if (spec.kind === 'agg-clean') return aggSurface(spec.id, spec.base, payload, true);
    return statusSurface(spec.id, spec.base, payload);
  });
  const diagnosis = classifyVisibleFreshness(records, OBSERVED_TV_CODE);
  const summary = {
    pass: records.filter((x) => x.result === 'PASS').length,
    warn: diagnosis.result === 'WARN' ? 1 : 0,
    fail: records.filter((x) => x.result === 'FAIL').length,
    byRootCause: countBy(records, 'root_cause'),
  };
  const report = {
    generatedAt,
    primaryBase: PRIMARY_BASE,
    secondaryBase: SECONDARY_BASE,
    staleCode: STALE_CODE,
    observedCode: extractUpdateCode(OBSERVED_TV_CODE),
    thresholds: { freshGuardMs: FRESH_GUARD_MS, timeoutMs: TIMEOUT_MS },
    records,
    diagnosis,
    summary,
    visible_freshness_gate: diagnosis.result === 'FAIL' || summary.fail > 0 ? 'FAIL' : diagnosis.result,
  };
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIT_DIR, 'visible-freshness-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(AUDIT_DIR, 'visible-freshness-summary.md'), renderMarkdown(report), 'utf8');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditVisibleFreshness();
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    visible_freshness_gate: report.visible_freshness_gate,
    diagnosis: report.diagnosis.diagnosis,
    current_code: report.diagnosis.current_code,
    observed_code: report.diagnosis.observed_code,
    pass: report.summary.pass,
    warn: report.summary.warn,
    fail: report.summary.fail,
    byRootCause: report.summary.byRootCause,
  }, null, 2));
  if (report.visible_freshness_gate === 'FAIL') process.exit(1);
}

export {
  auditVisibleFreshness,
  classifyVisibleFreshness,
  extractUpdateCode,
  parseReverseUpdateCode,
  surfaceFreshnessCheck,
};
