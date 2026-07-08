import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const DIST_SNAPSHOT_DIR = path.join(ROOT, 'dist', 'snapshot', 'latest');
const TRIAGE_PATH = 'audit/snapshot-warning-triage-latest.json';
const OUT_JSON = 'audit/snapshot-pack-gap-latest.json';
const OUT_MD = 'audit/snapshot-pack-gap-summary.md';
const BASE = (process.env.TVBOX_BASE || process.env.PUBLIC_BASE || 'https://tv.webhome.eu.org').replace(/\/+$/, '');
const LIMIT = Number(process.env.SNAPSHOT_PACK_GAP_LIMIT || process.env.AUDIT_LIMIT || 24);
const TIMEOUT_MS = Number(process.env.SNAPSHOT_PACK_GAP_TIMEOUT_MS || 20000);

function rel(...parts) {
  return path.join(ROOT, ...parts);
}
async function readJson(relativePath) {
  const abs = rel(...relativePath.split('/'));
  const text = await fs.readFile(abs, 'utf8');
  return JSON.parse(text);
}
async function readOptionalJson(abs) {
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, data: JSON.parse(text), error: '' };
  } catch (err) {
    return { ok: false, data: null, error: String(err && err.message || err) };
  }
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function countList(data) {
  return asArray(data?.list).length;
}
function totalOf(data) {
  return num(data?.total, countList(data));
}
function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row?.[key];
    const k = String(value || 'UNKNOWN');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
function filterToken(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}
function filterPackRel(row) {
  return `filter-packs/t${row.category_id}/${row.filter_key}-${filterToken(row.option_value)}-p${row.page}-limit${LIMIT}.json`;
}
function requestPath(row) {
  const params = new URLSearchParams();
  params.set('ac', 'videolist');
  params.set('t', String(row.category_id));
  params.set('pg', String(row.page || 1));
  params.set('limit', String(LIMIT));
  params.set('f', JSON.stringify({ [row.filter_key]: row.option_value }));
  params.set('audit_pack_gap', `${Date.now()}_${Math.random().toString(36).slice(2)}`);
  return `/agg?${params.toString()}`;
}
async function fetchJson(pathname) {
  const url = BASE + pathname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json,*/*',
        'user-agent': 'SnapshotPackGapAudit/7.4',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    return { ok: res.ok, status: res.status, data, url, duration_ms: Date.now() - started, error: '' };
  } catch (err) {
    return { ok: false, status: 0, data: null, url, duration_ms: Date.now() - started, error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
function classify(row, local, remote) {
  const localCount = local.exists && local.ok ? countList(local.data) : 0;
  const localTotal = local.exists && local.ok ? totalOf(local.data) : 0;
  const remoteCount = remote.ok ? countList(remote.data) : 0;
  const remoteTotal = remote.ok ? totalOf(remote.data) : 0;
  if (!remote.ok) {
    return {
      root_cause: 'REMOTE_ERROR',
      severity: row.user_visible ? 'P2' : 'P3',
      user_risk: row.user_visible ? '动态兜底不可验证，若本地包也为空会造成可见按钮风险。' : '当前不可见，先观察远端错误。',
      fix_suggestion: '检查 Worker、域名或动态聚合超时；避免只依赖动态兜底支撑可见按钮。',
      localCount, localTotal, remoteCount, remoteTotal,
    };
  }
  if (!local.exists && remoteCount > 0) {
    return {
      root_cause: 'PACK_MISSING_REMOTE_HAS_DATA',
      severity: row.user_visible ? 'P2' : 'P3',
      user_risk: row.user_visible ? '本地静态包缺失但线上动态有数据；动态兜底失效时会变成空按钮。' : '规则当前不可见，静态包缺失不直接影响电视端。',
      fix_suggestion: '修复 generate-snapshot 的 filter-pack 生成覆盖，确保可见筛选有静态包。',
      localCount, localTotal, remoteCount, remoteTotal,
    };
  }
  if (local.exists && !local.ok) {
    return {
      root_cause: 'PACK_PARSE_ERROR',
      severity: row.user_visible ? 'P2' : 'P3',
      user_risk: row.user_visible ? '静态包不可解析，电视端静态兜底不可用。' : '不可见规则的静态包不可解析，先修生成质量。',
      fix_suggestion: '重新生成该 filter-pack，并加入 JSON 解析校验。',
      localCount, localTotal, remoteCount, remoteTotal,
    };
  }
  if (localCount > 0 && row.validation_count === 0) {
    return {
      root_cause: 'VALIDATION_STALE_LOCAL_HAS_DATA',
      severity: 'P3',
      user_risk: '本地静态包已有数据，但 validation 仍记录空，属于验证时点或报告陈旧。',
      fix_suggestion: '重跑 generate:snapshot 或 validation 生成，确保 warning 与现有 filter-pack 一致。',
      localCount, localTotal, remoteCount, remoteTotal,
    };
  }
  if (localCount === 0 && remoteCount > 0) {
    return {
      root_cause: 'LOCAL_EMPTY_REMOTE_HAS_DATA',
      severity: row.user_visible ? 'P2' : 'P3',
      user_risk: row.user_visible ? '电视端当前靠动态兜底返回；静态快照失败时有空按钮风险。' : '规则不可见，动态有数据但本地未固化。',
      fix_suggestion: '把动态返回固化进 filter-pack，或修 search-backfill/catalog-derived 回填逻辑。',
      localCount, localTotal, remoteCount, remoteTotal,
    };
  }
  if (localCount === 0 && remoteCount === 0) {
    return {
      root_cause: 'BOTH_EMPTY_SOURCE_OR_QUERY_GAP',
      severity: row.user_visible ? 'P2' : 'P3',
      user_risk: row.user_visible ? '可见按钮本轮线上也为空，需要回到筛选语义或源覆盖根因。' : '当前不可见，属于源覆盖或标签缺口观察项。',
      fix_suggestion: '检查源是否有相关内容、标签是否可解析、筛选条件是否过窄。',
      localCount, localTotal, remoteCount, remoteTotal,
    };
  }
  return {
    root_cause: 'CONSISTENT_HAS_DATA',
    severity: 'P3',
    user_risk: '静态包与线上都已有数据，原 warning 可视为已自愈或旧报告残留。',
    fix_suggestion: '重跑 snapshot warning triage，确认该 warning 是否消失。',
    localCount, localTotal, remoteCount, remoteTotal,
  };
}
async function auditRow(row) {
  const packRel = filterPackRel(row);
  const packAbs = path.join(DIST_SNAPSHOT_DIR, packRel);
  const localRead = await readOptionalJson(packAbs);
  const local = {
    exists: existsSync(packAbs),
    ok: localRead.ok,
    error: localRead.error,
    data: localRead.data,
    pack_rel: `dist/snapshot/latest/${packRel}`,
  };
  const reqPath = requestPath(row);
  const remote = await fetchJson(reqPath);
  const classified = classify(row, local, remote);
  return {
    warning: row.warning,
    category_id: row.category_id,
    category: row.category,
    filter_key: row.filter_key,
    filter_name: row.filter_name,
    option_name: row.option_name,
    option_value: row.option_value,
    page: row.page,
    user_visible: Boolean(row.user_visible),
    prior_remote_path_id: row.remote_path_id || '',
    local_pack: local.pack_rel,
    local_exists: local.exists,
    local_parse_ok: local.ok,
    local_error: local.ok ? '' : local.error,
    local_count: classified.localCount,
    local_total: classified.localTotal,
    remote_url: remote.url,
    remote_status: remote.status,
    remote_ok: remote.ok,
    remote_error: remote.error,
    remote_count: classified.remoteCount,
    remote_total: classified.remoteTotal,
    duration_ms: remote.duration_ms,
    root_cause: classified.root_cause,
    severity: classified.severity,
    user_risk: classified.user_risk,
    fix_suggestion: classified.fix_suggestion,
  };
}
function renderMarkdown(result) {
  const s = result.summary;
  const byCause = Object.entries(s.by_root_cause || {}).map(([k, v]) => `- ${k}：${v}`);
  const bySeverity = Object.entries(s.by_severity || {}).map(([k, v]) => `${k}=${v}`).join('；') || 'none';
  const riskRows = result.rows.filter((x) => x.severity === 'P2').slice(0, 30);
  const detailRows = result.rows.slice(0, 80).map((x, i) => `${i + 1}. ${x.severity}；${x.root_cause}；${x.category}/${x.filter_name}/${x.option_name}；local=${x.local_count}/${x.local_total}；remote=${x.remote_count}/${x.remote_total}；建议：${x.fix_suggestion}`);
  return [
    '# v7.4 SNAPSHOT_PACK_GAP 自愈审计报告',
    '',
    '## 总结',
    '',
    `- 生成时间：${result.generatedAt}`,
    `- 基准入口：${result.base}`,
    `- 检查对象：${s.checked}`,
    `- unknown：${s.unknown}`,
    `- 当前可见风险：${s.visible_p2}`,
    `- P级分布：${bySeverity}`,
    '',
    '## 根因分布',
    '',
    ...(byCause.length ? byCause : ['- ?']),
    '',
    '## 当前需要优先处理的可见风险',
    '',
    ...(riskRows.length ? riskRows.map((x) => `- ${x.severity}；${x.root_cause}；${x.category}/${x.filter_name}/${x.option_name}；local=${x.local_count}；remote=${x.remote_count}；风险：${x.user_risk}`) : ['- 暂无 P2 可见风险。']),
    '',
    '## 明细',
    '',
    ...(detailRows.length ? detailRows : ['- ?']),
    '',
    '## 终局承接',
    '',
    '- 终局：用户喜欢、0投诉、可商业化收费的 TVBox/FongMi/影视仓 点播 + 直播源。',
    '- 全局：SNAPSHOT_PACK_GAP 必须从“动态兜底能用”推进到“静态快照也能兜住”，否则商业化后动态失败会形成空按钮投诉。',
    '- 局部：本报告把每个 gap 拆成本地包、线上动态、validation 三方证据。',
    '- 节点：每条记录保留本地包路径、线上请求 URL、根因、P级和修复建议。',
    '- 末梢：若用户可见按钮只靠动态兜底，下一步必须固化到 filter-pack 或调整可见策略。',
    '',
  ].join('\n');
}
async function auditSnapshotPackGaps() {
  const generatedAt = new Date().toISOString();
  const triage = await readJson(TRIAGE_PATH);
  const targetRows = asArray(triage.rows).filter((x) => x.triage_type === 'SNAPSHOT_PACK_GAP');
  const rows = [];
  for (const row of targetRows) {
    rows.push(await auditRow(row));
  }
  const summary = {
    checked: rows.length,
    unknown: rows.filter((x) => x.root_cause === 'REMOTE_ERROR' || x.root_cause === 'PACK_PARSE_ERROR').length,
    visible_p2: rows.filter((x) => x.user_visible && x.severity === 'P2').length,
    by_root_cause: countBy(rows, 'root_cause'),
    by_severity: countBy(rows, 'severity'),
    by_category: countBy(rows, 'category'),
    max_duration_ms: rows.reduce((m, x) => Math.max(m, num(x.duration_ms)), 0),
  };
  const result = {
    generatedAt,
    base: BASE,
    input: {
      triage: TRIAGE_PATH,
      triageGeneratedAt: triage.generatedAt || '',
      limit: LIMIT,
    },
    summary,
    rows,
  };
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(rel(...OUT_JSON.split('/')), JSON.stringify(result, null, 2) + '\n', 'utf8');
  await fs.writeFile(rel(...OUT_MD.split('/')), renderMarkdown(result), 'utf8');
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditSnapshotPackGaps();
  console.log(JSON.stringify({
    generatedAt: result.generatedAt,
    checked: result.summary.checked,
    unknown: result.summary.unknown,
    visible_p2: result.summary.visible_p2,
    by_root_cause: result.summary.by_root_cause,
    by_severity: result.summary.by_severity,
  }, null, 2));
}
export { auditSnapshotPackGaps };
