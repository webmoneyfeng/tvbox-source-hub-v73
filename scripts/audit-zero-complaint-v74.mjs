import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const DIST_SNAPSHOT_DIR = path.join(ROOT, 'dist', 'snapshot', 'latest');
const DEFAULT_BASES = ['https://tv.webhome.eu.org', 'https://tv.webclound.eu.org'];
const BASES = (process.env.ZERO_COMPLAINT_BASES || process.env.TVBOX_BASE || DEFAULT_BASES.join(','))
  .split(',')
  .map((x) => x.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const ONLINE_TIMEOUT = Number(process.env.ZERO_COMPLAINT_TIMEOUT_MS || 15000);
const SKIP_ONLINE = /^(1|true|yes)$/i.test(process.env.ZERO_COMPLAINT_SKIP_ONLINE || '');

const INPUTS = {
  remoteAudit: 'audit/tv-remote-full-latest.json',
  coverageAudit: 'audit/coverage-latest.json',
  sourceAudit: 'audit/source-discovery-latest.json',
  freeTierAudit: 'audit/free-tier-latest.json',
  snapshotValidation: 'dist/snapshot/latest/validation.json',
  snapshotWarningTriage: 'audit/snapshot-warning-triage-latest.json',
  snapshotPackGapAudit: 'audit/snapshot-pack-gap-latest.json',
  snapshotManifest: 'dist/snapshot/latest/manifest.json',
  visibleFreshnessAudit: 'audit/visible-freshness-latest.json',
};

function rel(...parts) {
  return path.join(ROOT, ...parts);
}

async function readJson(relativePath) {
  const abs = rel(...relativePath.split('/'));
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, path: relativePath, abs, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, path: relativePath, abs, error: String(err && err.message || err), data: null };
  }
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  return `${Math.round(num(value) * 1000) / 10}%`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = String(row?.[key] || 'UNKNOWN');
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function makeComplaint(severity, area, title, evidence, suggestion, source = '') {
  return { severity, area, title, evidence, suggestion, source };
}

function summarizeRemote(remote) {
  const data = remote.data || {};
  const summary = data.summary || {};
  const records = asArray(data.records);
  const failing = records.filter((r) => r.result === 'FAIL');
  const warning = records.filter((r) => r.result === 'WARN');
  const complaints = [];

  if (!remote.ok) {
    complaints.push(makeComplaint('P1', 'remote_audit', '遥控器全链路审计文件缺失或不可读', remote.error, '先重新运行 npm run audit:remote-full 生成可审计证据。', remote.path));
    return { summary, records, failing, warning, complaints };
  }

  const p1Checks = [
    ['category_fail', '可见分类存在空壳或分类请求失败'],
    ['schema_regression', '响应格式出现字段缺失或结构回退'],
    ['api_error', '电视端路径出现 API 错误'],
    ['snapshot_miss', '快照命中失败导致请求绕路'],
    ['filter_logic_bug', '筛选逻辑存在确定性缺陷'],
  ];
  for (const [key, label] of p1Checks) {
    if (num(summary[key]) > 0) {
      complaints.push(makeComplaint('P1', 'remote_audit', label, `${key}=${summary[key]}`, '修复对应接口/快照/筛选逻辑后重跑遥控器全量审计。', remote.path));
    }
  }

  if (num(summary.avg_detail_ok_rate, 1) < 0.95) {
    complaints.push(makeComplaint('P1', 'detail', '详情页有效率低于商业门槛', `avg_detail_ok_rate=${summary.avg_detail_ok_rate}`, '修复 ids 详情聚合、详情字段标准化与失效源过滤。', remote.path));
  }
  if (num(summary.avg_playable_rate, 1) < 0.9) {
    complaints.push(makeComplaint('P1', 'playback', '播放线路有效率低于商业门槛', `avg_playable_rate=${summary.avg_playable_rate}`, '优先过滤广告/解析页/失效播放组，并提升直连线路抽样覆盖。', remote.path));
  }

  if (num(summary.single_filter_fail) > 0) {
    complaints.push(makeComplaint('P2', 'filter_semantics', '单筛选按钮仍有 FAIL', `single_filter_fail=${summary.single_filter_fail}`, '逐个修复 FAIL 路径，不能用隐藏按钮代替根因修复。', remote.path));
  }
  if (num(summary.fail) > 0) {
    for (const row of failing.slice(0, 20)) {
      complaints.push(makeComplaint(
        'P2',
        'remote_path',
        `遥控器路径未达到预期：${row.path_id}`,
        `${row.root_cause || 'UNKNOWN'}；list=${row.list_count}；semantic=${row.semantic_hit_rate}；duplicate=${row.duplicate_rate}；${row.fix_suggestion || ''}`,
        row.fix_suggestion || '按路径追踪请求参数、快照命中、去重、语义映射与播放抽样。',
        remote.path,
      ));
    }
  }
  if (num(summary.max_duplicate_rate) > 0.05) {
    complaints.push(makeComplaint('P2', 'dedupe', '重复率超过 0投诉商业门槛', `max_duplicate_rate=${summary.max_duplicate_rate}`, '修 canonical identity、跨源合并键、排序前去重与分类/筛选内去重。', remote.path));
  }
  if (num(summary.min_semantic_hit_rate, 1) < 0.85) {
    complaints.push(makeComplaint('P2', 'semantic', '最低语义命中率低于商业门槛', `min_semantic_hit_rate=${summary.min_semantic_hit_rate}`, '补充标签解析、标题/备注证据、内容形态映射与源标签追踪。', remote.path));
  }

  for (const row of warning.slice(0, 20)) {
    complaints.push(makeComplaint(
      'P2',
      'remote_warn',
      `遥控器路径存在 WARN：${row.path_id}`,
      `${row.root_cause || 'UNKNOWN'}${row.path_cause ? ` / ${row.path_cause}` : ''}；${row.fix_suggestion || ''}`,
      row.fix_suggestion || '保留诊断记录并追踪是否属于源覆盖、标签解析或组合筛选过窄。',
      remote.path,
    ));
  }
  return { summary, records, failing, warning, complaints };
}

function exactTitleUnstable(row) {
  const title = String(row?.title || '').trim();
  if (!title) return false;
  const runs = asArray(row?.aggregate_runs);
  const exactTitleRuns = runs.filter((x) => String(x?.term || '').trim() === title && (!x?.mode || x.mode === 'user'));
  if (!exactTitleRuns.length) return false;
  return exactTitleRuns.some((x) => num(x.exactIndex, -1) < 0 && num(x.fuzzyIndex, -1) < 0);
}

function summarizeCoverage(coverage) {
  const data = coverage.data || {};
  const rows = asArray(data.rows);
  const complaints = [];
  if (!coverage.ok) {
    complaints.push(makeComplaint('P1', 'coverage', '覆盖率审计文件缺失或不可读', coverage.error, '重新运行 npm run audit:coverage，恢复缺片根因审计。', coverage.path));
    return { rows, complaints };
  }
  if (num(data.fail) > 0) {
    for (const row of rows.filter((x) => x.result === 'FAIL').slice(0, 20)) {
      complaints.push(makeComplaint('P1', 'coverage', `覆盖审计失败：${row.title || row.id}`, `${row.root_cause || 'UNKNOWN'}；源命中=${row.source_hit_count || 0}；${row.note || ''}`, '补源、补别名召回、修聚合搜索排序或修解析器后复测。', coverage.path));
    }
  }
  for (const row of rows.filter((x) => x.result === 'WARN').slice(0, 30)) {
    const severity = row.priority === 'critical' && exactTitleUnstable(row) ? 'P1' : 'P2';
    const title = severity === 'P1' ? `核心搜索不稳定：${row.title || row.id}` : `覆盖审计 WARN：${row.title || row.id}`;
    const evidence = `${row.root_cause || 'UNKNOWN'}；源命中=${row.source_hit_count || 0}；${row.note || ''}`;
    const suggestion = severity === 'P1'
      ? '把该节目加入核心投诉种子，修复精确片名召回、别名/主演召回、排序压制和动态/快照一致性。'
      : '继续扩源、增强排序与标签召回，确保能稳定进入搜索第一页。';
    complaints.push(makeComplaint(severity, 'coverage', title, evidence, suggestion, coverage.path));
  }
  return { rows, complaints };
}

function summarizeSources(source) {
  const data = source.data || {};
  const complaints = [];
  if (!source.ok) {
    complaints.push(makeComplaint('P2', 'source_discovery', '源宇宙发现审计文件缺失或不可读', source.error, '重新运行源发现审计，恢复 ACTIVE/WATCH/REJECTED/BLOCKED 证据。', source.path));
    return { complaints };
  }
  if (num(data.active) <= 0) {
    complaints.push(makeComplaint('P1', 'source_discovery', '没有 ACTIVE 点播源', `active=${data.active}`, '恢复候选源准入，否则无法支撑商业覆盖。', source.path));
  }
  if (num(data.blocked) + num(data.rejected) > num(data.active) + num(data.watch)) {
    complaints.push(makeComplaint('P2', 'source_discovery', '不可用源占比过高', `ACTIVE/WATCH/REJECTED/BLOCKED=${data.active}/${data.watch}/${data.rejected}/${data.blocked}`, '清洗候选源、增加公开直连源发现、保留 BLOCKED 根因但不进入主链路。', source.path));
  }
  return { complaints };
}

function summarizeFreeTier(freeTier) {
  const data = freeTier.data || {};
  const rows = asArray(data.rows);
  const complaints = [];
  if (!freeTier.ok) {
    complaints.push(makeComplaint('P2', 'free_tier', '免费层审计文件缺失或不可读', freeTier.error, '重新运行 npm run audit:free-tier，确认 GitHub/Cloudflare 免费边界。', freeTier.path));
    return { rows, complaints };
  }
  for (const row of rows.filter((x) => x.result === 'FAIL')) {
    complaints.push(makeComplaint('P1', 'free_tier', `免费方案硬失败：${row.area}`, `${row.metric}；${row.note || ''}`, '调整调度频率、文件规模、Worker 请求策略或仓库可见性后复测。', freeTier.path));
  }
  for (const row of rows.filter((x) => x.result === 'WARN')) {
    complaints.push(makeComplaint('P2', 'free_tier', `免费方案存在风险：${row.area}`, `${row.metric}；${row.note || ''}`, '形成限流、缓存、降频、直连播放和不代理视频流的运营策略。', freeTier.path));
  }
  return { rows, complaints };
}

function formatCounts(obj) {
  const entries = Object.entries(obj || {});
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join('；') : 'none';
}

function summarizeSnapshotTriage(triage, warningCount) {
  const complaints = [];
  if (warningCount <= 0) return { summary: {}, rows: [], complaints };
  if (!triage.ok) {
    complaints.push(makeComplaint('P3', 'snapshot', '快照 warning 尚未分诊', `${warningCount} warnings；triage_error=${triage.error || 'missing'}`, '运行 node scripts/triage-snapshot-warnings-v74.mjs，把 warning 转成根因、可见性和修复队列。', triage.path));
    return { summary: {}, rows: [], complaints };
  }
  const summary = triage.data?.summary || {};
  const rows = asArray(triage.data?.rows);
  const total = num(summary.total, rows.length);
  const unclassified = num(summary.unclassified);
  const blocking = num(summary.current_tv_blocking);
  const visible = num(summary.user_visible);
  if (total !== warningCount) {
    complaints.push(makeComplaint('P3', 'snapshot', '快照 warning 分诊与验证数量不一致', `validation=${warningCount}；triage=${total}`, '重新运行快照分诊，避免用旧分诊解释新快照。', triage.path));
  }
  if (unclassified > 0) {
    complaints.push(makeComplaint('P2', 'snapshot', '存在未分类快照 warning', `unclassified=${unclassified}`, '补充分诊规则；未分类前不能证明该 warning 不会变成用户投诉。', triage.path));
  }
  if (blocking > 0) {
    const blockingRows = rows.filter((x) => x.current_tv_blocking).slice(0, 5);
    complaints.push(makeComplaint(
      'P2',
      'snapshot',
      '快照 warning 已映射到当前电视端可见阻塞',
      `blocking=${blocking}；examples=${blockingRows.map((x) => x.warning).join(' | ')}`,
      '按分诊根因修复可见按钮、快照包、筛选解析或源标签，不允许用笼统 warning 掩盖空按钮。',
      triage.path,
    ));
  }
  if (total > 0 && unclassified === 0 && blocking === 0) {
    complaints.push(makeComplaint(
      'P3',
      'snapshot',
      '快照 warning 已分诊为观察项',
      `total=${total}；visible=${visible}；by_type=${formatCounts(summary.by_type)}`,
      '继续收敛 SNAPSHOT_PACK_GAP 与 UI_HIDE_CANDIDATE；当前不把它升级为用户可见投诉，但仍阻止宣称终局完成。',
      triage.path,
    ));
  }
  return { summary, rows, complaints };
}

function summarizeSnapshot(validation, manifest, triage) {
  const complaints = [];
  const validationData = validation.data || {};
  const manifestData = manifest.data || {};
  let triageSummary = { summary: {}, rows: [], complaints: [] };
  if (!validation.ok) {
    complaints.push(makeComplaint('P1', 'snapshot', '快照验证文件缺失或不可读', validation.error, '重新生成快照并运行验证，避免电视端读取未知状态。', validation.path));
  } else {
    const errors = asArray(validationData.errors);
    const warnings = asArray(validationData.warnings);
    for (const err of errors.slice(0, 20)) {
      complaints.push(makeComplaint('P1', 'snapshot', '快照验证存在 ERROR', String(err), '修复快照生成、分类、筛选或播放验证错误后再发布。', validation.path));
    }
    triageSummary = summarizeSnapshotTriage(triage, warnings.length);
    complaints.push(...triageSummary.complaints);
  }
  if (!manifest.ok) {
    complaints.push(makeComplaint('P1', 'snapshot', '快照 manifest 缺失或不可读', manifest.error, '恢复 manifest，确保更新时间码、分类、筛选包和文件清单可追踪。', manifest.path));
  } else if (manifestData.ok !== true) {
    complaints.push(makeComplaint('P1', 'snapshot', '快照 manifest 未标记 ok', `ok=${manifestData.ok}`, '确认快照生成完整性和原子发布状态。', manifest.path));
  }
  return { complaints, triage: triageSummary };
}

function summarizeSnapshotPackGaps(packGap) {
  const complaints = [];
  const data = packGap.data || {};
  const summary = data.summary || {};
  if (!packGap.ok) {
    complaints.push(makeComplaint('P3', 'snapshot_pack_gap', 'SNAPSHOT_PACK_GAP 尚未做三方复测', packGap.error || 'missing audit/snapshot-pack-gap-latest.json', '运行 npm run audit:snapshot-pack-gaps，确认本地 filter-pack、线上动态和 validation warning 的差异。', packGap.path));
    return { summary: {}, complaints };
  }
  const checked = num(summary.checked);
  const visibleP2 = num(summary.visible_p2);
  const unknown = num(summary.unknown);
  if (unknown > 0) {
    complaints.push(makeComplaint('P2', 'snapshot_pack_gap', 'SNAPSHOT_PACK_GAP 存在未知复测结果', `unknown=${unknown}；checked=${checked}`, '修复远端请求或本地包解析错误后重跑，否则不能证明静态兜底安全。', packGap.path));
  }
  if (visibleP2 > 0) {
    complaints.push(makeComplaint(
      'P2',
      'snapshot_pack_gap',
      '可见筛选按钮依赖动态兜底，静态 filter-pack 缺失',
      `visible_p2=${visibleP2}；by_root_cause=${formatCounts(summary.by_root_cause)}`,
      '修复 generate-snapshot 的 filter-pack 生成/回填逻辑，把线上动态可返回的数据固化到静态快照；修复前不能宣称商业级 0 投诉。',
      packGap.path,
    ));
  }
  return { summary, complaints };
}

function summarizeVisibleFreshness(visibleFreshness) {
  const complaints = [];
  const data = visibleFreshness.data || {};
  const diagnosis = data.diagnosis || {};
  const gate = String(data.visible_freshness_gate || '');
  if (!visibleFreshness.ok) {
    complaints.push(makeComplaint('P1', 'visible_freshness', '电视端可见更新时间审计缺失或不可读', visibleFreshness.error, '运行 npm run audit:visible-freshness，确认站点名、API版本路径、分类栏、旧码路径和状态端点同码且新鲜。', visibleFreshness.path));
    return { summary: {}, diagnosis: {}, complaints };
  }
  if (gate === 'FAIL') {
    complaints.push(makeComplaint(
      'P1',
      'visible_freshness',
      '电视端可见更新时间表面未通过商业守门线',
      `gate=${gate}；diagnosis=${diagnosis.diagnosis || 'UNKNOWN'}；current=${diagnosis.current_code || 'none'}；observed=${diagnosis.observed_code || 'none'}`,
      '不要让用户清缓存背锅；先修服务端 config、agg、旧码路径、status 的更新时间表面一致性。',
      visibleFreshness.path,
    ));
  } else if (gate === 'WARN' || diagnosis.diagnosis === 'APP_LOCAL_SITE_CACHE') {
    complaints.push(makeComplaint(
      'P3',
      'visible_freshness',
      '电视端站点列表可能缓存旧更新时间',
      `diagnosis=${diagnosis.diagnosis || gate}；current=${diagnosis.current_code || 'none'}；observed=${diagnosis.observed_code || 'none'}`,
      '客服口径：进入影视点播后看“推荐 · 当前码”；若分类栏新而站点列表旧，优先引导刷新/重进/重新导入。',
      visibleFreshness.path,
    ));
  }
  return { summary: data.summary || {}, diagnosis, complaints };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ONLINE_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json,*/*', 'user-agent': 'ZeroComplaintCommercialAudit/7.4', 'cache-control': 'no-cache' }, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: String(err && err.message || err), data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function probeOnline() {
  if (SKIP_ONLINE) return { skipped: true, rows: [], complaints: [] };
  const rows = [];
  const complaints = [];
  for (const base of BASES) {
    const config = await fetchWithTimeout(`${base}/config.json`);
    const status = await fetchWithTimeout(`${base}/status.json`);
    const sites = asArray(config.data?.sites);
    const siteNames = sites.map((x) => x?.name).filter(Boolean);
    const forbiddenUi = siteNames.some((x) => /备用/.test(String(x)));
    rows.push({ base, config_status: config.status, status_status: status.status, sites: siteNames, status_ok: status.ok, visibleUpdateText: status.data?.visibleUpdateText || config.data?.sites?.[0]?.name || '' });
    if (!config.ok) {
      complaints.push(makeComplaint('P0', 'online_entry', `入口不可导入：${base}/config.json`, `http_status=${config.status}; ${config.error || ''}`, '修复 Worker/Pages/域名路由；主备入口至少必须一个稳定可导入。', `${base}/config.json`));
      continue;
    }
    if (sites.length !== 1) {
      complaints.push(makeComplaint('P1', 'online_entry', `入口站点数量不符合单入口设计：${base}`, `sites.length=${sites.length}`, '恢复电视端只显示一个影视点播入口，隐藏底层源结构。', `${base}/config.json`));
    }
    if (!siteNames.some((x) => String(x).startsWith('影视点播'))) {
      complaints.push(makeComplaint('P1', 'online_entry', `入口名称不符合影视点播设计：${base}`, `sites=${siteNames.join(',')}`, '恢复“影视点播 · 更新时间码”入口文案。', `${base}/config.json`));
    }
    if (forbiddenUi) {
      complaints.push(makeComplaint('P3', 'online_entry', `入口文案出现禁用词：${base}`, `sites=${siteNames.join(',')}`, '清理电视端可见文案，不显示“备用”等底层结构词。', `${base}/config.json`));
    }
    if (!status.ok) {
      complaints.push(makeComplaint('P2', 'online_status', `状态端点不可用：${base}/status.json`, `http_status=${status.status}; ${status.error || ''}`, '恢复状态端点，便于商业运营监控更新时间、快照与健康状态。', `${base}/status.json`));
    }
  }
  const configOkCount = rows.filter((x) => x.config_status >= 200 && x.config_status < 300).length;
  if (rows.length && configOkCount === 0) {
    complaints.push(makeComplaint('P0', 'online_entry', '主备入口全部不可导入', `bases=${BASES.join(',')}`, '立即回滚到上一次有效 Worker/Pages 快照或切换域名。', 'online_probe'));
  }
  return { skipped: false, rows, complaints };
}

function buildHardGates(inputs, complaintCounts) {
  const remoteSummary = inputs.remoteAudit.data?.summary || {};
  const freeTier = inputs.freeTierAudit.data || {};
  const validation = inputs.snapshotValidation.data || {};
  const visibleFreshness = inputs.visibleFreshnessAudit.data || {};
  const gates = [
    { name: 'P0=0', pass: complaintCounts.P0 === 0, value: complaintCounts.P0 },
    { name: 'P1=0', pass: complaintCounts.P1 === 0, value: complaintCounts.P1 },
    { name: 'remote_fail=0', pass: num(remoteSummary.fail) === 0, value: num(remoteSummary.fail) },
    { name: 'single_filter_fail=0', pass: num(remoteSummary.single_filter_fail) === 0, value: num(remoteSummary.single_filter_fail) },
    { name: 'schema_regression=0', pass: num(remoteSummary.schema_regression) === 0, value: num(remoteSummary.schema_regression) },
    { name: 'api_error=0', pass: num(remoteSummary.api_error) === 0, value: num(remoteSummary.api_error) },
    { name: 'snapshot_miss=0', pass: num(remoteSummary.snapshot_miss) === 0, value: num(remoteSummary.snapshot_miss) },
    { name: 'filter_logic_bug=0', pass: num(remoteSummary.filter_logic_bug) === 0, value: num(remoteSummary.filter_logic_bug) },
    { name: 'duplicate_rate<=5%', pass: num(remoteSummary.max_duplicate_rate) <= 0.05, value: remoteSummary.max_duplicate_rate ?? null },
    { name: 'detail_ok_rate>=95%', pass: num(remoteSummary.avg_detail_ok_rate, 0) >= 0.95, value: remoteSummary.avg_detail_ok_rate ?? null },
    { name: 'playable_rate>=90%', pass: num(remoteSummary.avg_playable_rate, 0) >= 0.9, value: remoteSummary.avg_playable_rate ?? null },
    { name: 'free_tier_fail=0', pass: num(freeTier.fail) === 0, value: num(freeTier.fail) },
    { name: 'snapshot_errors=0', pass: asArray(validation.errors).length === 0, value: asArray(validation.errors).length },
    { name: 'visible_freshness_fail=0', pass: String(visibleFreshness.visible_freshness_gate || '') !== 'FAIL', value: visibleFreshness.visible_freshness_gate || 'missing' },
  ];
  return gates;
}

function scoreFromCounts(counts, hardGates) {
  let score = 100;
  score -= counts.P0 * 40;
  score -= counts.P1 * 20;
  score -= counts.P2 * 5;
  score -= counts.P3 * 1;
  score -= hardGates.filter((x) => !x.pass).length * 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderMarkdown(result) {
  const failedGates = result.hard_gates.filter((x) => !x.pass);
  const topQueue = result.next_fix_queue.slice(0, 30);
  const onlineRows = result.online_probe.rows || [];
  const remote = result.metrics.remote || {};
  const coverage = result.metrics.coverage || {};
  const sources = result.metrics.sources || {};
  const free = result.metrics.freeTier || {};
  const liveProxy = free.liveProxy || {};
  const snapshot = result.metrics.snapshot || {};
  const snapshotPackGaps = result.metrics.snapshotPackGaps || {};
  const visibleFreshness = result.metrics.visibleFreshness || {};
  return [
    '# v7.4 0投诉商业体验总控审计',
    '',
    '## 总结',
    '',
    `- 生成时间：${result.generatedAt}`,
    `- commercial_ready：${result.commercial_ready}`,
    `- zero_complaint_gate：${result.zero_complaint_gate}`,
    `- user_love_score：${result.user_love_score}/100`,
    `- P0/P1/P2/P3：${result.p0_count}/${result.p1_count}/${result.p2_count}/${result.p3_count}`,
    `- 输入证据：${Object.values(result.inputs).join('；')}`,
    '',
    '## 终局判定',
    '',
    result.commercial_ready
      ? '- 当前证据满足“用户喜欢、0投诉、可商业化收费”的上线门禁。'
      : '- 当前证据尚未满足“用户喜欢、0投诉、可商业化收费”的上线门禁，不能把工程可用误判为商业可收费。',
    '- 本报告只聚合现有审计与轻量入口探测，不替代遥控器实测、源覆盖深测和播放抽样。',
    '',
    '## 硬门槛',
    '',
    ...result.hard_gates.map((x) => `- ${x.pass ? 'PASS' : 'FAIL'}；${x.name}；value=${x.value}`),
    '',
    '## 当前核心指标',
    '',
    `- 遥控器路径：visible=${remote.visible_element_count ?? 'unknown'}；PASS/WARN/FAIL=${remote.pass ?? 'unknown'}/${remote.warn ?? 'unknown'}/${remote.fail ?? 'unknown'}；max_duplicate_rate=${remote.max_duplicate_rate ?? 'unknown'}；detail=${remote.avg_detail_ok_rate ?? 'unknown'}；playable=${remote.avg_playable_rate ?? 'unknown'}`,
    `- 覆盖审计：PASS/WARN/FAIL=${coverage.pass ?? 'unknown'}/${coverage.warn ?? 'unknown'}/${coverage.fail ?? 'unknown'}`,
    `- 源发现：candidate=${sources.candidateCount ?? 'unknown'}；ACTIVE/WATCH/REJECTED/BLOCKED=${sources.active ?? 'unknown'}/${sources.watch ?? 'unknown'}/${sources.rejected ?? 'unknown'}/${sources.blocked ?? 'unknown'}`,
    `- 免费层：PASS/WARN/FAIL=${free.pass ?? 'unknown'}/${free.warn ?? 'unknown'}/${free.fail ?? 'unknown'}`,
    `- 直播承载：channels=${liveProxy.totalChannels ?? 'unknown'}；proxied=${liveProxy.proxiedChannels ?? 'unknown'}；direct=${liveProxy.directChannels ?? 'unknown'}；proxyRatio=${Number.isFinite(Number(liveProxy.proxyRatio)) ? Math.round(Number(liveProxy.proxyRatio) * 100) + '%' : 'unknown'}`,
    `- 快照：errors=${snapshot.errors ?? 'unknown'}；warnings=${snapshot.warnings ?? 'unknown'}；triage=${snapshot.triage?.total ?? 'unknown'}；blocking=${snapshot.triage?.current_tv_blocking ?? 'unknown'}；visibleUpdateText=${snapshot.visibleUpdateText ?? 'unknown'}`,
    `- 可见更新时间：gate=${visibleFreshness.gate ?? 'unknown'}；diagnosis=${visibleFreshness.diagnosis ?? 'unknown'}；current=${visibleFreshness.current_code ?? 'unknown'}；observed=${visibleFreshness.observed_code ?? 'none'}`,
    '',
    '## 快照 warning 分诊',
    '',
    snapshot.triage?.total
      ? `- total=${snapshot.triage.total}；unclassified=${snapshot.triage.unclassified}；user_visible=${snapshot.triage.user_visible}；current_tv_blocking=${snapshot.triage.current_tv_blocking}；by_type=${formatCounts(snapshot.triage.by_type)}`
      : '- 当前无快照 warning 分诊数据。',
    '',
    '## 快照包自愈审计',
    '',
    snapshotPackGaps.checked
      ? `- checked=${snapshotPackGaps.checked}；visible_p2=${snapshotPackGaps.visible_p2}；unknown=${snapshotPackGaps.unknown}；by_root_cause=${formatCounts(snapshotPackGaps.by_root_cause)}`
      : '- 当前无 SNAPSHOT_PACK_GAP 自愈审计数据。',
    '',
    '## 在线入口轻量探测',
    '',
    result.online_probe.skipped
      ? '- 已按 ZERO_COMPLAINT_SKIP_ONLINE 跳过在线探测。'
      : onlineRows.length
        ? onlineRows.map((x) => `- ${x.base}；config=${x.config_status}；status=${x.status_status}；sites=${asArray(x.sites).join('|') || 'none'}；visible=${x.visibleUpdateText || 'unknown'}`).join('\n')
        : '- 无在线探测结果。',
    '',
    '## 阻塞投诉',
    '',
    result.blocking_complaints.length
      ? result.blocking_complaints.map((x) => `- ${x.severity}；${x.area}；${x.title}；证据：${x.evidence}；建议：${x.suggestion}`).join('\n')
      : '- 暂无 P0/P1 阻塞投诉。',
    '',
    '## 下一修复队列',
    '',
    topQueue.length
      ? topQueue.map((x, i) => `${i + 1}. ${x.severity}；${x.area}；${x.title}；证据：${x.evidence}；建议：${x.suggestion}`).join('\n')
      : '- 当前没有待修复队列。',
    '',
    '## 终局到下一阶段承接',
    '',
    '- 终局：用户喜欢的、0投诉的、可商业化收费的 TVBox/FongMi/影视仓 点播+直播源。',
    '- 全局：P0/P1 当前清零，但 P2 已暴露静态 filter-pack 缺失风险；继续用总控门禁统一遥控器、覆盖、源、免费层、快照和入口状态，避免动态兜底掩盖用户投诉。',
    '- 局部：下一阶段优先修复 P2 静态快照包缺口，同时继续收敛 P3 不可见按钮候选、真实投诉种子、审计性能和准实时运营闭环。',
    '- 节点：每个 warning、path_id、canary 条目、投诉种子都必须有请求 URL、根因、修复建议和复测证据。',
    '- 末梢：电视端每个按钮、搜索词、详情页、播放线路都按语义返回且不重复；用户反馈路径能自动进入下一轮审计。',
    '',
    failedGates.length
      ? `> 当前未过门槛：${failedGates.map((x) => x.name).join('，')}`
      : '> 当前硬门槛均通过。',
    '',
  ].join('\n');
}

async function auditZeroComplaint() {
  const generatedAt = new Date().toISOString();
  const loadedEntries = await Promise.all(Object.entries(INPUTS).map(async ([key, value]) => [key, await readJson(value)]));
  const loaded = Object.fromEntries(loadedEntries);

  const remote = summarizeRemote(loaded.remoteAudit);
  const coverage = summarizeCoverage(loaded.coverageAudit);
  const sources = summarizeSources(loaded.sourceAudit);
  const freeTier = summarizeFreeTier(loaded.freeTierAudit);
  const snapshot = summarizeSnapshot(loaded.snapshotValidation, loaded.snapshotManifest, loaded.snapshotWarningTriage);
  const snapshotPackGaps = summarizeSnapshotPackGaps(loaded.snapshotPackGapAudit);
  const visibleFreshness = summarizeVisibleFreshness(loaded.visibleFreshnessAudit);
  const online = await probeOnline();

  const allComplaints = [
    ...remote.complaints,
    ...coverage.complaints,
    ...sources.complaints,
    ...freeTier.complaints,
    ...snapshot.complaints,
    ...snapshotPackGaps.complaints,
    ...visibleFreshness.complaints,
    ...online.complaints,
  ];
  const complaintCounts = {
    P0: allComplaints.filter((x) => x.severity === 'P0').length,
    P1: allComplaints.filter((x) => x.severity === 'P1').length,
    P2: allComplaints.filter((x) => x.severity === 'P2').length,
    P3: allComplaints.filter((x) => x.severity === 'P3').length,
  };
  const hardGates = buildHardGates(loaded, complaintCounts);
  const hardGateOk = hardGates.every((x) => x.pass);
  const zeroComplaintGate = hardGateOk && allComplaints.length === 0 ? 'PASS' : complaintCounts.P0 || complaintCounts.P1 || !hardGateOk ? 'FAIL' : 'WARN';
  const commercialReady = zeroComplaintGate === 'PASS';
  const severityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const nextFixQueue = [...allComplaints].sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || String(a.area).localeCompare(String(b.area), 'zh-Hans-CN'));

  const result = {
    generatedAt,
    commercial_ready: commercialReady,
    zero_complaint_gate: zeroComplaintGate,
    user_love_score: scoreFromCounts(complaintCounts, hardGates),
    p0_count: complaintCounts.P0,
    p1_count: complaintCounts.P1,
    p2_count: complaintCounts.P2,
    p3_count: complaintCounts.P3,
    blocking_complaints: nextFixQueue.filter((x) => x.severity === 'P0' || x.severity === 'P1'),
    next_fix_queue: nextFixQueue,
    hard_gates: hardGates,
    inputs: Object.fromEntries(Object.entries(INPUTS).map(([key, value]) => [key, value])),
    online_probe: online,
    metrics: {
      remote: loaded.remoteAudit.data?.summary || {},
      remoteRootCauses: loaded.remoteAudit.data?.summary?.byRootCause || countBy(remote.records, 'root_cause'),
      coverage: {
        pass: loaded.coverageAudit.data?.pass,
        warn: loaded.coverageAudit.data?.warn,
        fail: loaded.coverageAudit.data?.fail,
        byRootCause: loaded.coverageAudit.data?.byRootCause || {},
      },
      sources: {
        candidateCount: loaded.sourceAudit.data?.candidateCount,
        active: loaded.sourceAudit.data?.active,
        watch: loaded.sourceAudit.data?.watch,
        rejected: loaded.sourceAudit.data?.rejected,
        blocked: loaded.sourceAudit.data?.blocked,
      },
      freeTier: {
        pass: loaded.freeTierAudit.data?.pass,
        warn: loaded.freeTierAudit.data?.warn,
        fail: loaded.freeTierAudit.data?.fail,
        liveProxy: loaded.freeTierAudit.data?.liveProxy || null,
      },
      snapshot: {
        errors: asArray(loaded.snapshotValidation.data?.errors).length,
        warnings: asArray(loaded.snapshotValidation.data?.warnings).length,
        triage: loaded.snapshotWarningTriage.data?.summary || null,
        visibleUpdateText: loaded.snapshotManifest.data?.visibleUpdateText,
        snapshotGeneratedAt: loaded.snapshotManifest.data?.snapshotGeneratedAt,
        sourceDiscoveryAt: loaded.snapshotManifest.data?.sourceDiscoveryAt,
        coverageAuditAt: loaded.snapshotManifest.data?.coverageAuditAt,
      },
      snapshotPackGaps: loaded.snapshotPackGapAudit.data?.summary || {},
      visibleFreshness: {
        gate: loaded.visibleFreshnessAudit.data?.visible_freshness_gate,
        diagnosis: loaded.visibleFreshnessAudit.data?.diagnosis?.diagnosis,
        current_code: loaded.visibleFreshnessAudit.data?.diagnosis?.current_code,
        observed_code: loaded.visibleFreshnessAudit.data?.diagnosis?.observed_code,
        summary: loaded.visibleFreshnessAudit.data?.summary || {},
      },
    },
  };

  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(path.join(AUDIT_DIR, 'zero-complaint-latest.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(AUDIT_DIR, 'zero-complaint-summary.md'), renderMarkdown(result), 'utf8');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditZeroComplaint();
  console.log(JSON.stringify({
    generatedAt: result.generatedAt,
    commercial_ready: result.commercial_ready,
    zero_complaint_gate: result.zero_complaint_gate,
    user_love_score: result.user_love_score,
    p0_count: result.p0_count,
    p1_count: result.p1_count,
    p2_count: result.p2_count,
    p3_count: result.p3_count,
    failed_hard_gates: result.hard_gates.filter((x) => !x.pass).map((x) => x.name),
  }, null, 2));
}

export { auditZeroComplaint };
