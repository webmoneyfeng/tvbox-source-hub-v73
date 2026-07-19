import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');

const DEFAULT_TVBOX_BASE = 'https://tv.webhome.eu.org';
const DEFAULT_PAGES_BASE = 'https://tvbox-source-hub-v73.pages.dev';
const DEFAULT_MAX_VISIBLE_AGE_MINUTES = 6;

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function httpGetJson(url, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.get(url, {
      headers: {
        'user-agent': 'TVBoxSourceHub-ReleaseReadiness/1.0',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        accept: 'application/json,text/plain,*/*',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const data = safeJsonParse(body);
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && data !== null, status: res.statusCode, url, data, body: data ? undefined : body.slice(0, 300), headers: res.headers, elapsedMs: Date.now() - started });
      });
    });
    req.on('error', (error) => resolve({ ok: false, status: 0, url, error: error.message, elapsedMs: Date.now() - started }));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function readLocalJson(rel) {
  const file = path.join(ROOT, rel);
  try {
    return { ok: true, status: 200, url: file, data: JSON.parse(await fs.readFile(file, 'utf8')) };
  } catch (error) {
    return { ok: false, status: 0, url: file, data: null, error: error.message };
  }
}

function decodeReverseUpdateCode(code) {
  const raw = String(code || '').trim();
  if (!/^\d{12}$/.test(raw)) return { valid: false, code: raw, display: '', iso: '', compact: '' };
  const compact = raw.split('').reverse().join('');
  const [, y, m, d, hh, mm] = compact.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/) || [];
  if (!y) return { valid: false, code: raw, display: '', iso: '', compact };
  const date = new Date(`${y}-${m}-${d}T${hh}:${mm}:00+08:00`);
  if (!Number.isFinite(date.getTime())) return { valid: false, code: raw, display: '', iso: '', compact };
  return { valid: true, code: raw, compact, display: `${y}-${m}-${d} ${hh}:${mm}`, iso: `${y}-${m}-${d}T${hh}:${mm}:00+08:00`, epochMs: date.getTime() };
}

function extractCodeFromApi(api) {
  const m = String(api || '').match(/\/u(\d{12})(?:$|[/?#])/);
  return m ? m[1] : '';
}

function extractCodeFromName(name) {
  const m = String(name || '').match(/(?:^|\s*[·・]\s*)(\d{12})\s*$/);
  return m ? m[1] : '';
}

function classifyConfigSurface({ source, expectedName, expectedApiPrefix, payload }) {
  const site = payload?.sites?.[0];
  if (!site) {
    return { source, result: 'FAIL', root_cause: 'SCHEMA_REGRESSION', message: 'config missing sites[0]', siteName: '', api: '' };
  }
  const siteName = String(site.name || '').trim();
  const api = String(site.api || '').trim();
  const nameCode = extractCodeFromName(siteName);
  const apiCode = extractCodeFromApi(api);
  const apiOk = expectedApiPrefix ? api.startsWith(expectedApiPrefix) : /^https?:\/\//.test(api);
  if (nameCode && siteName.replace(/\s*[·・]\s*\d{12}\s*$/, '') === expectedName && apiOk) {
    if (!apiCode) {
      return { source, result: 'FAIL', root_cause: 'API_VERSION_MISSING', message: 'visible update code exists but API path has no matching version code', siteName, api, visibleUpdateText: nameCode, decoded: decodeReverseUpdateCode(nameCode) };
    }
    if (nameCode !== apiCode) {
      return { source, result: 'FAIL', root_cause: 'UPDATE_CODE_MISMATCH', message: 'site name and API path expose different update codes', siteName, api, nameCode, apiCode, visibleUpdateText: nameCode, decoded: decodeReverseUpdateCode(nameCode) };
    }
    return { source, result: 'PASS', root_cause: 'OK', message: 'visible update code matches the versioned API path', siteName, api, visibleUpdateText: nameCode, decoded: decodeReverseUpdateCode(nameCode) };
  }
  if (siteName === expectedName && apiOk && apiCode) {
    return { source, result: 'WARN', root_cause: 'VISIBLE_UPDATE_MISSING', message: 'API is versioned but the TV-visible entry name does not show the update code', siteName, api, visibleUpdateText: apiCode, decoded: decodeReverseUpdateCode(apiCode) };
  }
  if (siteName === expectedName && apiOk && !apiCode) {
    return { source, result: 'FAIL', root_cause: 'API_VERSION_MISSING', message: 'site name and API path both omit the required update code', siteName, api, visibleUpdateText: '' };
  }
  return { source, result: 'FAIL', root_cause: 'CONFIG_MISMATCH', message: 'config does not match expected TVBox entry contract', siteName, api, expectedName, expectedApiPrefix };
}

function classifyWorkerSurface({ onlineRow, localRow }) {
  if (onlineRow?.result === 'PASS' || localRow?.result !== 'PASS') return onlineRow;
  return {
    ...onlineRow,
    result: 'WARN',
    root_cause: 'NEEDS_WORKER_DEPLOY',
    online_root_cause: onlineRow?.root_cause || 'UNKNOWN',
    message: `local artifact is ready but the online Worker is still on the previous contract: ${onlineRow?.message || 'deployment required'}`,
  };
}

function classifyPagesStaticSurface({ pagesConfig, pagesCleanConfig, pagesManifest, currentWorkerCode, expectedStaticCode, expectedFullName, expectedCleanName, publicBase }) {
  const rows = [];
  const fullRow = classifyConfigSurface({
    source: 'pages-full-config',
    expectedName: expectedFullName,
    expectedApiPrefix: `${publicBase}/agg/u`,
    payload: pagesConfig?.data,
  });
  if (fullRow.result !== 'PASS') fullRow.root_cause = 'NEEDS_PAGES_DEPLOY';
  rows.push(fullRow);
  if (!pagesCleanConfig?.ok) {
    rows.push({ source: 'pages-clean-config', result: 'FAIL', root_cause: 'NEEDS_PAGES_DEPLOY', status: pagesCleanConfig?.status || 0, message: 'Pages static clean entry is missing or not JSON' });
  } else {
    const cleanRow = classifyConfigSurface({
      source: 'pages-clean-config',
      expectedName: expectedCleanName,
      expectedApiPrefix: `${publicBase}/agg-clean/u`,
      payload: pagesCleanConfig.data,
    });
    if (cleanRow.result !== 'PASS') cleanRow.root_cause = 'NEEDS_PAGES_DEPLOY';
    rows.push(cleanRow);
  }
  const manifestCode = String(pagesManifest?.data?.visibleUpdateText || '').trim();
  const staticCode = String(expectedStaticCode || '').trim();
  if (!pagesManifest?.ok) {
    rows.push({ source: 'pages-manifest', result: 'FAIL', root_cause: 'NEEDS_PAGES_DEPLOY', status: pagesManifest?.status || 0, message: 'Pages snapshot manifest is missing or invalid' });
  } else if (staticCode && manifestCode !== staticCode) {
    rows.push({ source: 'pages-manifest', result: 'WARN', root_cause: 'NEEDS_PAGES_DEPLOY', visibleUpdateText: manifestCode, expectedStaticCode: staticCode, currentWorkerCode, decoded: decodeReverseUpdateCode(manifestCode), message: 'Pages static snapshot does not match the local release artifact' });
  } else {
    rows.push({ source: 'pages-manifest', result: 'PASS', root_cause: 'OK', visibleUpdateText: manifestCode, expectedStaticCode: staticCode, currentWorkerCode, decoded: decodeReverseUpdateCode(manifestCode), message: 'Pages snapshot code matches the local release artifact' });
  }
  return rows;
}

function summarizeReleaseGate(rows) {
  const pass = rows.filter((r) => r.result === 'PASS').length;
  const warn = rows.filter((r) => r.result === 'WARN').length;
  const fail = rows.filter((r) => r.result === 'FAIL').length;
  const byRootCause = {};
  for (const row of rows) byRootCause[row.root_cause || 'UNKNOWN'] = (byRootCause[row.root_cause || 'UNKNOWN'] || 0) + 1;
  const production_deploy_required = rows.some((r) => ['NEEDS_WORKER_DEPLOY', 'NEEDS_PAGES_DEPLOY'].includes(r.root_cause));
  return { gate: fail ? 'FAIL' : warn ? 'WARN' : 'PASS', pass, warn, fail, byRootCause, production_deploy_required };
}

function ageMinutesFromCode(code, now = Date.now()) {
  const decoded = decodeReverseUpdateCode(code);
  if (!decoded.valid) return null;
  return Math.max(0, Math.round((now - decoded.epochMs) / 60000));
}

function statusFreshnessRow(statusData, maxAgeMinutes = DEFAULT_MAX_VISIBLE_AGE_MINUTES) {
  const code = String(statusData?.visibleUpdateText || '').trim();
  const decoded = decodeReverseUpdateCode(code);
  const ageMinutes = ageMinutesFromCode(code);
  if (!decoded.valid) return { source: 'worker-status', result: 'FAIL', root_cause: 'UPDATE_CODE_INVALID', visibleUpdateText: code, message: 'status visibleUpdateText is missing or invalid' };
  if (ageMinutes > maxAgeMinutes) return { source: 'worker-status', result: 'FAIL', root_cause: 'HOT_UPDATE_STALE', visibleUpdateText: code, decoded, ageMinutes, maxAgeMinutes, message: 'Worker hot update code exceeds freshness guard' };
  return { source: 'worker-status', result: 'PASS', root_cause: 'OK', visibleUpdateText: code, decoded, ageMinutes, maxAgeMinutes, message: 'Worker hot update is within freshness guard' };
}

function markdownReport(report) {
  const lines = [];
  lines.push('# v7.4 发布准备度与更新时间可见面审计');
  lines.push('');
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- 主入口：${report.tvboxBase}`);
  lines.push(`- Pages：${report.pagesBase}`);
  lines.push(`- gate：${report.summary.gate}`);
  lines.push(`- PASS/WARN/FAIL：${report.summary.pass}/${report.summary.warn}/${report.summary.fail}`);
  lines.push(`- production_deploy_required：${report.summary.production_deploy_required}`);
  lines.push('');
  lines.push('## 根因分布');
  for (const [k, v] of Object.entries(report.summary.byRootCause)) lines.push(`- ${k}=${v}`);
  lines.push('');
  lines.push('## 检查项');
  for (const row of report.rows) {
    lines.push(`- ${row.result}；${row.source}；${row.root_cause}；${row.message || ''}${row.visibleUpdateText ? `；code=${row.visibleUpdateText}` : ''}${row.ageMinutes != null ? `；age=${row.ageMinutes}min` : ''}`);
  }
  lines.push('');
  lines.push('## 发布闸门');
  lines.push('- 本审计不会自动部署。生产 Worker/Pages 发布仍需要用户明确批准。');
  lines.push('- 若出现 NEEDS_WORKER_DEPLOY：说明线上 Worker 的可见时间码、版本化 API 或本地构建契约仍未同步。');
  lines.push('- 若出现 NEEDS_PAGES_DEPLOY：说明 Pages 静态兜底仍旧，可能导致备用链路或静态镜像显示旧时间。');
  lines.push('');
  return lines.join('\n');
}

async function writeReport(report) {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIT_DIR, 'release-readiness-latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(path.join(AUDIT_DIR, 'release-readiness-summary.md'), markdownReport(report), 'utf8');
}

async function auditReleaseReadiness(options = {}) {
  const tvboxBase = options.tvboxBase || process.env.TVBOX_BASE || DEFAULT_TVBOX_BASE;
  const pagesBase = options.pagesBase || process.env.PAGES_BASE || DEFAULT_PAGES_BASE;
  const maxAgeMinutes = Number(options.maxAgeMinutes || process.env.MAX_VISIBLE_AGE_MINUTES || DEFAULT_MAX_VISIBLE_AGE_MINUTES);
  const generatedAt = nowIso();
  const [status, onlineConfig, onlineCleanConfig, pagesConfig, pagesCleanConfig, pagesManifest, localConfig, localCleanConfig, localManifest] = await Promise.all([
    httpGetJson(`${tvboxBase}/status.json?fresh=1`),
    httpGetJson(`${tvboxBase}/config.json?fresh=1`),
    httpGetJson(`${tvboxBase}/config-clean.json?fresh=1`),
    httpGetJson(`${pagesBase}/config.json`),
    httpGetJson(`${pagesBase}/config-clean.json`),
    httpGetJson(`${pagesBase}/snapshot/latest/manifest.json`),
    readLocalJson('dist/config.json'),
    readLocalJson('dist/config-clean.json'),
    readLocalJson('dist/snapshot/latest/manifest.json'),
  ]);

  const rows = [];
  rows.push(statusFreshnessRow(status.data, maxAgeMinutes));
  const localFullRow = classifyConfigSurface({ source: 'local-dist-full-config', expectedName: '影视点播', expectedApiPrefix: `${tvboxBase}/agg/u`, payload: localConfig.data });
  const localCleanRow = classifyConfigSurface({ source: 'local-dist-clean-config', expectedName: '影视点播洁净', expectedApiPrefix: `${tvboxBase}/agg-clean/u`, payload: localCleanConfig.data });
  const onlineFullRow = classifyConfigSurface({ source: 'online-worker-full-config', expectedName: '影视点播', expectedApiPrefix: `${tvboxBase}/agg/u`, payload: onlineConfig.data });
  const onlineCleanRow = classifyConfigSurface({ source: 'online-worker-clean-config', expectedName: '影视点播洁净', expectedApiPrefix: `${tvboxBase}/agg-clean/u`, payload: onlineCleanConfig.data });
  rows.push(classifyWorkerSurface({ onlineRow: onlineFullRow, localRow: localFullRow }));
  rows.push(classifyWorkerSurface({ onlineRow: onlineCleanRow, localRow: localCleanRow }));
  rows.push(localFullRow);
  rows.push(localCleanRow);
  rows.push(...classifyPagesStaticSurface({
    pagesConfig,
    pagesCleanConfig,
    pagesManifest,
    currentWorkerCode: status.data?.visibleUpdateText || '',
    expectedStaticCode: localManifest.data?.visibleUpdateText || '',
    expectedFullName: '影视点播',
    expectedCleanName: '影视点播洁净',
    publicBase: tvboxBase,
  }));

  const summary = summarizeReleaseGate(rows);
  const report = {
    generatedAt,
    tvboxBase,
    pagesBase,
    maxAgeMinutes,
    summary,
    rows,
    endpoints: { status, onlineConfig, onlineCleanConfig, pagesConfig, pagesCleanConfig, pagesManifest, localManifest },
  };
  await writeReport(report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  auditReleaseReadiness().then((report) => {
    console.log(JSON.stringify({ generatedAt: report.generatedAt, gate: report.summary.gate, summary: report.summary }, null, 2));
    if (report.summary.fail > 0) process.exitCode = 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  auditReleaseReadiness,
  classifyConfigSurface,
  classifyWorkerSurface,
  classifyPagesStaticSurface,
  decodeReverseUpdateCode,
  summarizeReleaseGate,
};
